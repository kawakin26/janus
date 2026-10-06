// ページ作成・編集（サブタスク 10.2 / 要件 2-1, 2-2, 2-7）。
//
// 方針:
// - splat（/edit/* の * 部分）から現在パスを解決し、マウント時に getPage(path) を試みる。
//   既存（Page が返る）なら title/body を初期値にした「編集（updatePage）」モード、
//   null なら「新規作成（createPage）」モードにする。
// - フォームは title（任意）と body（Markdown テキストエリア）。label と input を
//   htmlFor/id で関連付け、送信中は二重送信防止で disabled にする（LoginPage の流儀）。
// - 保存成功で /view/<path> へ遷移する。
// - 新規作成時に createPage が ApiError(409) を throw したら「同一パスのページが既に存在します」を
//   role="alert" で表示して遷移しない（要件 2-7）。detail があればそれを優先。
// - 401/その他は usePageError で処理する（401 は logout＋/login 誘導）。
// - 画面は useStorage() 契約経由のみでデータ操作する（RestClient 具象・fetch を直接使わない）。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStorage } from '../storage/StorageProvider'
import AppLayout from '../components/AppLayout'
import Breadcrumbs from '../components/Breadcrumbs'
import { usePageError } from './use-page-error'
import { ApiError } from '../storage/types'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import MapEditor from '../markdown/custom-map/MapEditor'
import { buildMapData } from '../markdown/custom-map/parse-map'
import { serializeMapData } from '../markdown/custom-map/serialize-map'
import { findCustomMapBlocks, replaceCustomMapBlock } from '../markdown/custom-map/map-block'
import type { MapData } from '../markdown/custom-map/types'
import remarkDrawio from '../markdown/drawio/remark-drawio'
import { serializeDrawio } from '../markdown/drawio/serialize-drawio'
import { findDrawioBlocks, replaceDrawioBlock } from '../markdown/drawio/drawio-block'
import {
  buildExportMessage,
  buildLoadMessage,
  createDrawioMessageHandler,
} from '../markdown/drawio/drawio-embed'
import { useTheme } from '../theme/useTheme'

/**
 * 本文中の index 番目の `:::custom-map` ブロックを buildMapData で MapData 化する。
 * ブロックが見つからない/パースできない場合は null。
 */
function parseCustomMapBlock(blockText: string): MapData | null {
  const tree = unified().use(remarkParse).use(remarkDirective).parse(blockText) as Root
  let found: ContainerDirective | null = null
  visit(tree, 'containerDirective', (node: ContainerDirective) => {
    if (!found && node.name === 'custom-map') found = node
  })
  return found ? buildMapData(found) : null
}

/**
 * `:::drawio` ブロックテキストから mxGraph XML を取り出す。
 * remark-drawio の unified パイプライン（serialize-drawio.test.ts と同流儀）で data-drawio を読む。
 * パースできない/見つからない場合は空文字（＝新規図として開く）。
 */
function parseDrawioBlock(blockText: string): string {
  const tree = unified().use(remarkParse).use(remarkDirective).parse(blockText) as Root
  remarkDrawio()(tree)
  let xml = ''
  visit(tree, 'containerDirective', (node: ContainerDirective) => {
    if (node.name !== 'drawio') return
    const value = node.data?.hProperties?.['data-drawio']
    if (typeof value === 'string') xml = value
  })
  return xml
}

/** 同梱 webapp を embed モード（proto=json）で開く iframe の src（自オリジン・外部 CDN 不使用）。 */
const DRAWIO_EMBED_SRC_BASE =
  '/drawio/webapp/index.html?embed=1&proto=json&spin=1&libraries=0&noExitBtn=0'

/**
 * iframe の src を Janus の実効テーマ連動で組み立てる（問題1・案A）。
 * embed モードの draw.io は urlParams.dark を最優先で見るため、&dark=1/0 を付けて
 * 親 Janus（dark）と子 draw.io（既定 light）のテーマ割れ＝ダークで線が見えない問題を解消する。
 * 公開 embed.diagrams.net へは接続せず、自オリジン同梱 iframe の urlParams のみで制御する。
 */
function buildDrawioEmbedSrc(effectiveTheme: 'light' | 'dark'): string {
  return `${DRAWIO_EMBED_SRC_BASE}&dark=${effectiveTheme === 'dark' ? 1 : 0}`
}

// ネイティブ要素へ直接付ける Tailwind クラス（要素タグ不変の制約のため共通 UI コンポーネントは使わない）。
// 体裁は Button/Alert の normal/error variant と同一ユーティリティに揃える（見た目を変えないため）。
// ネイティブ button へ付ける variant 別クラス（Button コンポーネントの VARIANTS と同一ユーティリティ）。
// 操作の意味に応じて使い分ける: 新規作成/確定=accent、中立操作=normal、破壊的操作=danger。
const BUTTON_BASE_CLASS =
  'inline-flex items-center rounded px-3 py-1.5 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'
const BUTTON_NORMAL_CLASS =
  BUTTON_BASE_CLASS +
  ' border border-border bg-control text-fg hover:bg-control-hover hover:border-fg-muted'
const BUTTON_ACCENT_CLASS =
  BUTTON_BASE_CLASS + ' bg-primary text-primary-contrast hover:bg-primary-hover'
const ALERT_ERROR_CLASS = 'rounded px-3 py-2 bg-danger/10 text-danger'

/** 新規マップブロック（マーカーなし・参照なし）の初期 MapData。 */
function emptyMapData(): MapData {
  return {
    assetRef: { specifiers: [] },
    cx: 50,
    cy: 50,
    scale: 1,
    restore: 15,
    rotate: 0,
    link: '',
    pinSize: 12,
    labelSize: 12,
    markers: [],
  }
}

function PageEditPage() {
  const splat = useParams()['*'] ?? ''
  const path = '/' + splat
  const storage = useStorage()
  const navigate = useNavigate()
  const handleError = usePageError()
  const { effectiveTheme } = useTheme()

  const [loading, setLoading] = useState(true)
  // 既存ページか新規作成かの判定。true なら updatePage、false なら createPage。
  const [isExisting, setIsExisting] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 地図 GUI 編集の状態。mapEditing が null でなければエディタを開いている。
  // blockIndex が null のときは本文末尾へ新規ブロックを追加するモード。
  const [mapEditing, setMapEditing] = useState<{ blockIndex: number | null; data: MapData } | null>(
    null,
  )
  const [mapEditError, setMapEditError] = useState<string | null>(null)

  // drawio GUI 編集の状態。drawioEditing が null でなければ embed iframe を開いている。
  // blockIndex が null のときは本文末尾へ新規ブロックを追加するモード。xml は初期読込み用。
  // src はエディタを開いた時点の実効テーマで固定する（問題3）。セッション途中で OS テーマが
  // 変わっても iframe を再読込（＝セッション開始時 XML への巻き戻り）させないため、
  // effectiveTheme を直接 src に結ばず、開いた瞬間の値をここへ captured して固定する。
  const [drawioEditing, setDrawioEditing] = useState<{
    blockIndex: number | null
    xml: string
    src: string
  } | null>(null)
  // 新規描画（blockIndex=null）の autosave 重複（問題1）を防ぐためのセッション用ライブ
  // ブロックインデックス。最初の save で挿入先が確定したらその index を記録し、以降の
  // autosave はそのブロックを置換する（末尾へ追加し続けない）。
  const drawioSessionBlockIndexRef = useRef<number | null>(null)
  // embed iframe への参照（load / exit メッセージ送信に使う）。
  const drawioIframeRef = useRef<HTMLIFrameElement>(null)
  // drawio エディタを全画面オーバーレイ（モーダル）で表示するか。ホスト側 CSS のみで制御し、
  // postMessage 契約・:::drawio 保存形式には一切触れない。
  // エディタは既定で全画面で開く（open 時に true をセット）。これはページ全体のスクロール文脈を
  // 排除し、表セル編集時のキャレット/編集ボックスの飛び（問題2）を実質回避するため（案A）。
  const [isDrawioFullscreen, setIsDrawioFullscreen] = useState(false)

  // 本文中の custom-map ブロック数（導線の出し分けに使う）。
  const customMapBlockCount = findCustomMapBlocks(body).length

  // 本文中の drawio ブロック数（導線の出し分けに使う）。
  const drawioBlockCount = findDrawioBlocks(body).length

  // 既存ブロックを GUI 編集で開く。パースできなければエラー表示。
  const openMapBlock = (blockIndex: number) => {
    setMapEditError(null)
    const blocks = findCustomMapBlocks(body)
    const block = blocks[blockIndex]
    if (!block) return
    const data = parseCustomMapBlock(body.slice(block.start, block.end))
    if (data === null) {
      setMapEditError('この地図ブロックを読み込めませんでした。')
      return
    }
    setMapEditing({ blockIndex, data })
  }

  // 新規マップブロックを追加するモードで開く。
  const openNewMapBlock = () => {
    setMapEditError(null)
    setMapEditing({ blockIndex: null, data: emptyMapData() })
  }

  // GUI 編集を本文へ反映する。対象ブロックだけを serializeMapData 出力で置換し、
  // 本文の他テキストは保持する（§7.3）。新規は本文末尾へ追加する。
  const applyMapEditing = () => {
    if (mapEditing === null) return
    const serialized = serializeMapData(mapEditing.data)
    if (mapEditing.blockIndex === null) {
      const needsSeparator = body.length > 0 && !body.endsWith('\n')
      const prefix = body.length > 0 ? body + (needsSeparator ? '\n\n' : '\n') : ''
      setBody(prefix + serialized + '\n')
    } else {
      const blocks = findCustomMapBlocks(body)
      const block = blocks[mapEditing.blockIndex]
      if (block) {
        setBody(replaceCustomMapBlock(body, block, serialized))
      }
    }
    setMapEditing(null)
  }

  const cancelMapEditing = () => setMapEditing(null)

  // 既存 drawio ブロックを embed エディタで開く。
  // 表セル編集の飛び（問題2）回避のため既定で全画面オーバーレイで開く（案A）。
  const openDrawioBlock = (blockIndex: number) => {
    const blocks = findDrawioBlocks(body)
    const block = blocks[blockIndex]
    if (!block) return
    const xml = parseDrawioBlock(body.slice(block.start, block.end))
    // 既存ブロック編集はセッションの挿入先が既に確定しているので live index も同じ値にする。
    drawioSessionBlockIndexRef.current = blockIndex
    // src は開いた時点のテーマで固定（問題3）。
    setDrawioEditing({ blockIndex, xml, src: buildDrawioEmbedSrc(effectiveTheme) })
    setIsDrawioFullscreen(true)
  }

  // 新規 drawio ブロックを追加するモードで開く（初期 XML は空）。
  // 表セル編集の飛び（問題2）回避のため既定で全画面オーバーレイで開く（案A）。
  const openNewDrawioBlock = () => {
    // 新規はまだ挿入先が未確定。最初の save で確定する（問題1）。
    drawioSessionBlockIndexRef.current = null
    // src は開いた時点のテーマで固定（問題3）。
    setDrawioEditing({ blockIndex: null, xml: '', src: buildDrawioEmbedSrc(effectiveTheme) })
    setIsDrawioFullscreen(true)
  }

  const closeDrawioEditing = useCallback(() => {
    setDrawioEditing(null)
    // 編集を閉じるときは全画面状態もリセットする。
    setIsDrawioFullscreen(false)
    // セッションのライブインデックスも破棄する（次セッションへ漏らさない）。
    drawioSessionBlockIndexRef.current = null
  }, [])

  // 「描画編集を閉じる」押下時に、閉じる前に最新 XML を回収するための保留状態。
  // export を送って応答（onExport）を待ち、本文へ反映してから閉じる。応答が来ない場合に
  // 備えてタイムアウトで強制的に閉じる（autosave:1 で反映済みのため取りこぼしは最小）。
  const drawioCloseAfterExportRef = useRef(false)
  const drawioCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ホスト側の「描画編集を閉じる」から呼ぶ閉じ要求（embed プロトコル調査の結論に基づく）。
  // draw.io の exit イベントは modified を常に false 化するため未保存判定に使えない。
  // 代わりに {action:'export', format:'xml'} で最新 XML を pull し、onExport で本文へ反映
  // してから閉じる（autosave 取りこぼしや CHANGE 未発火の最後の 1 編集も確実に回収する）。
  // iframe 未準備や応答が無いときは（タイムアウトで）直接閉じる（フォールバック）。
  const requestCloseDrawioEditing = useCallback(() => {
    const target = drawioIframeRef.current?.contentWindow
    if (!target) {
      closeDrawioEditing()
      return
    }
    drawioCloseAfterExportRef.current = true
    target.postMessage(buildExportMessage(), window.location.origin)
    // export 応答が来ない場合のフォールバック（autosave 済み前提で閉じる）。
    if (drawioCloseTimerRef.current !== null) clearTimeout(drawioCloseTimerRef.current)
    drawioCloseTimerRef.current = setTimeout(() => {
      if (drawioCloseAfterExportRef.current) {
        drawioCloseAfterExportRef.current = false
        closeDrawioEditing()
      }
    }, 1500)
  }, [closeDrawioEditing])

  // save 受信 XML を serialize-drawio でブロック化し本文へ反映する。
  // autosave 有効時は 1 編集セッションで save が何度も届く。セッションのライブ
  // インデックス（drawioSessionBlockIndexRef）を使い、
  //  - まだ挿入先未確定（null）＝新規描画の初回 save: 本文末尾へ 1 ブロック追加し、
  //    追加したブロックの index を ref へ記録する（以降はこのブロックを置換）。
  //  - 確定済み（number）: 対象ブロックのみ置換（§7.3 非破壊）。
  // これにより反復 autosave が :::drawio ブロックを重複追加しない（問題1）。
  //
  // finding#1（save-and-exit の置換先競合）対策: 挿入先 index は **呼び出し時点で
  // 同期的に snapshot** し、setBody updater 内ではこの snapshot を使う。
  // save(exit:true) では onSave が applyDrawioXml の直後に closeDrawioEditing() を呼び、
  // それが drawioSessionBlockIndexRef.current を null に戻す。React の updater は即時
  // 実行が保証されないため、updater 内で ref を遅延参照すると close 後の null を読み、
  // 既存図を置換する代わりに本文末尾へ新規ブロックを追記してしまう（既存図が更新されず
  // 新旧の図が併存する）。snapshot を閉じ込めることでこの競合を断つ。
  const applyDrawioXml = useCallback((xml: string) => {
    const serialized = serializeDrawio(xml)
    // 呼び出し時点のライブ index を snapshot（以降の close による ref リセットと競合させない）。
    const snapshotIndex = drawioSessionBlockIndexRef.current
    setBody((prev) => {
      if (snapshotIndex === null) {
        const needsSeparator = prev.length > 0 && !prev.endsWith('\n')
        const prefix = prev.length > 0 ? prev + (needsSeparator ? '\n\n' : '\n') : ''
        const next = prefix + serialized + '\n'
        // 追加した新規ブロックの index を確定し、次回以降の autosave は置換させる。
        // セッションが既に閉じている（ref が null へ戻った）場合は上書きしない。
        if (drawioSessionBlockIndexRef.current === null) {
          drawioSessionBlockIndexRef.current = findDrawioBlocks(next).length - 1
        }
        return next
      }
      const blocks = findDrawioBlocks(prev)
      const block = blocks[snapshotIndex]
      return block ? replaceDrawioBlock(prev, block, serialized) : prev
    })
  }, [])

  // embed iframe の postMessage ハンドラ（proto=json）を window に登録する。
  // init で既存 XML を load、save で本文へ反映、exit でクローズ。origin は自オリジン固定。
  useEffect(() => {
    if (drawioEditing === null) return
    const { xml } = drawioEditing

    const handler = createDrawioMessageHandler({
      onInit: () => {
        drawioIframeRef.current?.contentWindow?.postMessage(
          buildLoadMessage(xml),
          window.location.origin,
        )
      },
      onSave: (savedXml, { exit }) => {
        // Save ボタン/Ctrl+S。本文へ反映し、保存して閉じる要求なら閉じる。
        applyDrawioXml(savedXml)
        if (exit) closeDrawioEditing()
      },
      onAutosave: (savedXml) => {
        // autosave:1 により編集のたびに届く。本文 state へ反映し続けて取りこぼしを防ぐ（主因対策）。
        applyDrawioXml(savedXml)
      },
      onExport: (exportedXml) => {
        // {action:'export',format:'xml'} への応答。最新 XML を本文へ反映する。
        if (exportedXml.length > 0) applyDrawioXml(exportedXml)
        // 「描画編集を閉じる」からの export だった場合は、回収後に閉じる（フォールバックタイマー解除）。
        if (drawioCloseAfterExportRef.current) {
          drawioCloseAfterExportRef.current = false
          if (drawioCloseTimerRef.current !== null) {
            clearTimeout(drawioCloseTimerRef.current)
            drawioCloseTimerRef.current = null
          }
          closeDrawioEditing()
        }
      },
      onExit: () => {
        // draw.io 内の Exit ボタン等による終了通知。modified は常に false のため判定に使わない。
        // autosave:1 で編集内容は本文へ反映済みのため、ここは素直に閉じる
        //（export pull を挟むと iframe 無応答時に閉じられなくなるため挟まない）。
        closeDrawioEditing()
      },
    })

    window.addEventListener('message', handler)
    return () => {
      window.removeEventListener('message', handler)
    }
  }, [drawioEditing, applyDrawioXml, closeDrawioEditing, requestCloseDrawioEditing])

  // 全画面オーバーレイ中は Esc キーで全画面を解除する（アクセシビリティ・最小実装）。
  useEffect(() => {
    if (!isDrawioFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDrawioFullscreen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isDrawioFullscreen])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const fetched = await storage.getPage(path)
        if (!active) {
          return
        }
        if (fetched !== null) {
          setIsExisting(true)
          setTitle(fetched.title)
          setBody(fetched.body)
        } else {
          setIsExisting(false)
        }
      } catch (err) {
        if (active) {
          setError(handleError(err, 'ページの取得に失敗しました'))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [storage, path, handleError])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // draw.io 編集セッション中はページ保存を拒否する（問題3・レビュー finding#1）。
    // 開いたままページ保存すると、未到達の autosave（applyDrawioXml→body 反映）を取りこぼし、
    // 古い body を永続化して遷移＝編集を破棄する競合が起きる。先に「描画編集を閉じる」で
    // exit/modified ガードを通し、本文へ反映を確定させてから保存させる。
    // これにより save_page_body 単一経路（updatePage/createPage）はそのまま維持する。
    if (drawioEditing !== null) {
      setError('描画エディタを開いています。先に「描画編集を閉じる」で編集を確定してからページを保存してください。')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      if (isExisting) {
        await storage.updatePage(path, { title, body })
      } else {
        await storage.createPage({ path, title, body })
      }
      navigate(`/view${path}`, { replace: true })
    } catch (err) {
      // 新規作成時の重複パス（409）は専用の日本語メッセージを出す。
      if (err instanceof ApiError && err.status === 409) {
        setError(err.detail ?? '同一パスのページが既に存在します')
      } else {
        setError(handleError(err, 'ページの保存に失敗しました'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <p>読み込み中...</p>
      </AppLayout>
    )
  }

  // キャンセル先: 既存ページなら閲覧へ戻る、新規なら一覧へ戻る。
  const cancelTo = isExisting ? `/view${path}` : '/'

  return (
    <AppLayout>
      <Breadcrumbs path={path} />
      <h1>{isExisting ? 'ページ編集' : 'ページ新規作成'}</h1>
      <p>パス: {path}</p>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error !== null && (
          <p role="alert" aria-live="assertive" className={ALERT_ERROR_CLASS}>
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title">タイトル</label>
          <input
            id="title"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-border bg-surface-raised px-3 py-1.5 text-fg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="body">本文（Markdown）</label>
          <textarea
            id="body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="w-full rounded border border-border bg-surface-raised px-3 py-1.5 font-mono text-fg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          />
        </div>

        <section className="flex flex-col gap-1.5" aria-label="地図 GUI 編集">
          {mapEditError !== null && (
            <p role="alert" aria-live="assertive" className={ALERT_ERROR_CLASS}>
              {mapEditError}
            </p>
          )}
          {mapEditing === null ? (
            <div className="flex items-center gap-2">
              <span className="mr-1 text-sm font-semibold text-fg-muted">地図</span>
              {/* 新規作成はアクセント（主要アクション）、既存の編集は中立の normal。 */}
              <button type="button" onClick={openNewMapBlock} className={BUTTON_ACCENT_CLASS}>
                地図を追加
              </button>
              {Array.from({ length: customMapBlockCount }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => openMapBlock(i)}
                  className={BUTTON_NORMAL_CLASS}
                >
                  地図 {i + 1} を編集
                </button>
              ))}
            </div>
          ) : (
            <div>
              <MapEditor
                mapData={mapEditing.data}
                onChange={(next) => setMapEditing({ blockIndex: mapEditing.blockIndex, data: next })}
              />
              <div className="flex items-center gap-2">
                {/* 本文へ反映は確定アクション=アクセント、やめる（取り消し）は中立=normal。 */}
                <button type="button" onClick={applyMapEditing} className={BUTTON_ACCENT_CLASS}>
                  地図を本文へ反映
                </button>
                <button type="button" onClick={cancelMapEditing} className={BUTTON_NORMAL_CLASS}>
                  地図編集をやめる
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-1.5" aria-label="drawio 描画 編集">
          <div className="flex items-center gap-2">
            <span className="mr-1 text-sm font-semibold text-fg-muted">描画</span>
            {/* 新規作成はアクセント（主要アクション）、既存の編集は中立の normal。
                draw.io 編集セッション中（drawioEditing!==null）は追加・編集ボタンを無効化する
                （finding#1）。別の描画を開くと現在の iframe が exit/modified ガードを通らず
                直接差し替えられ、autosave 到達前の未反映 XML を取りこぼすため。先に
                「描画編集を閉じる」で exit ガードを通してセッションを終えてから次を開かせる。 */}
            <button
              type="button"
              onClick={openNewDrawioBlock}
              disabled={drawioEditing !== null}
              className={BUTTON_ACCENT_CLASS}
            >
              描画を追加
            </button>
            {Array.from({ length: drawioBlockCount }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openDrawioBlock(i)}
                disabled={drawioEditing !== null}
                className={BUTTON_NORMAL_CLASS}
              >
                描画 {i + 1} を編集
              </button>
            ))}
          </div>
          {drawioEditing !== null && (
            <div
              className={
                isDrawioFullscreen
                  ? 'flex flex-col gap-2 fixed inset-0 z-50 p-2 bg-surface'
                  : 'flex flex-col gap-2'
              }
              role={isDrawioFullscreen ? 'dialog' : undefined}
              aria-modal={isDrawioFullscreen ? true : undefined}
              aria-label={isDrawioFullscreen ? 'drawio 描画エディタ（全画面）' : undefined}
            >
              <iframe
                ref={drawioIframeRef}
                src={drawioEditing.src}
                title="drawio 描画エディタ"
                className={
                  isDrawioFullscreen
                    ? 'w-full flex-1 min-h-0 border border-border'
                    : 'w-full h-[70vh] min-h-[480px] border border-border'
                }
              />
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setIsDrawioFullscreen((prev) => !prev)}
                  className={BUTTON_NORMAL_CLASS}
                >
                  {isDrawioFullscreen ? '全画面を解除' : '全画面表示'}
                </button>
                <button
                  type="button"
                  onClick={requestCloseDrawioEditing}
                  className={BUTTON_NORMAL_CLASS}
                >
                  描画編集を閉じる
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="flex items-center gap-4">
          {/* draw.io の保存（本文へ反映）とページ全体の保存を文言で分離・明示する（問題3・案C）。
              draw.io 編集中はページ保存を無効化する（finding#1）。開いたまま保存すると未到達の
              autosave を取りこぼすため、先に「描画編集を閉じる」で編集を確定させてから保存させる。
              onSubmit 側の guard と二重化（キーボード submit 等の抜け道も塞ぐ）。 */}
          <button
            type="submit"
            disabled={submitting || drawioEditing !== null}
            className={BUTTON_ACCENT_CLASS}
          >
            {submitting ? '保存中...' : 'ページを保存'}
          </button>
          <Link to={cancelTo} className="text-fg-muted">
            キャンセル
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}

export default PageEditPage
