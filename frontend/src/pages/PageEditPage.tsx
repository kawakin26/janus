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
import styles from './PageEditPage.module.css'
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
  buildLoadMessage,
  createDrawioMessageHandler,
} from '../markdown/drawio/drawio-embed'

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
const DRAWIO_EMBED_SRC = '/drawio/webapp/index.html?embed=1&proto=json&spin=1&libraries=0&noExitBtn=0'

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
  const [drawioEditing, setDrawioEditing] = useState<{
    blockIndex: number | null
    xml: string
  } | null>(null)
  // embed iframe への参照（load / exit メッセージ送信に使う）。
  const drawioIframeRef = useRef<HTMLIFrameElement>(null)

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
  const openDrawioBlock = (blockIndex: number) => {
    const blocks = findDrawioBlocks(body)
    const block = blocks[blockIndex]
    if (!block) return
    const xml = parseDrawioBlock(body.slice(block.start, block.end))
    setDrawioEditing({ blockIndex, xml })
  }

  // 新規 drawio ブロックを追加するモードで開く（初期 XML は空）。
  const openNewDrawioBlock = () => {
    setDrawioEditing({ blockIndex: null, xml: '' })
  }

  const closeDrawioEditing = useCallback(() => setDrawioEditing(null), [])

  // save 受信 XML を serialize-drawio でブロック化し本文へ反映する。
  // 新規（blockIndex=null）は本文末尾へ追加、既存は対象ブロックのみ置換（§7.3 非破壊）。
  const applyDrawioXml = useCallback(
    (xml: string, blockIndex: number | null) => {
      const serialized = serializeDrawio(xml)
      setBody((prev) => {
        if (blockIndex === null) {
          const needsSeparator = prev.length > 0 && !prev.endsWith('\n')
          const prefix = prev.length > 0 ? prev + (needsSeparator ? '\n\n' : '\n') : ''
          return prefix + serialized + '\n'
        }
        const blocks = findDrawioBlocks(prev)
        const block = blocks[blockIndex]
        return block ? replaceDrawioBlock(prev, block, serialized) : prev
      })
    },
    [],
  )

  // embed iframe の postMessage ハンドラ（proto=json）を window に登録する。
  // init で既存 XML を load、save で本文へ反映、exit でクローズ。origin は自オリジン固定。
  useEffect(() => {
    if (drawioEditing === null) return
    const { blockIndex, xml } = drawioEditing

    const handler = createDrawioMessageHandler({
      onInit: () => {
        drawioIframeRef.current?.contentWindow?.postMessage(
          buildLoadMessage(xml),
          window.location.origin,
        )
      },
      onSave: (savedXml, { exit }) => {
        applyDrawioXml(savedXml, blockIndex)
        if (exit) closeDrawioEditing()
      },
      onExit: () => {
        closeDrawioEditing()
      },
    })

    window.addEventListener('message', handler)
    return () => {
      window.removeEventListener('message', handler)
    }
  }, [drawioEditing, applyDrawioXml, closeDrawioEditing])

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
      <form onSubmit={handleSubmit} noValidate className={styles.form}>
        {error !== null && (
          <p role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        <div className={styles.field}>
          <label htmlFor="title">タイトル</label>
          <input
            id="title"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="body">本文（Markdown）</label>
          <textarea
            id="body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
          />
        </div>

        <section className={styles.field} aria-label="地図 GUI 編集">
          {mapEditError !== null && (
            <p role="alert" aria-live="assertive">
              {mapEditError}
            </p>
          )}
          {mapEditing === null ? (
            <div className={styles.actions}>
              <button type="button" onClick={openNewMapBlock}>
                地図を追加
              </button>
              {Array.from({ length: customMapBlockCount }, (_, i) => (
                <button key={i} type="button" onClick={() => openMapBlock(i)}>
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
              <div className={styles.actions}>
                <button type="button" onClick={applyMapEditing}>
                  地図を本文へ反映
                </button>
                <button type="button" onClick={cancelMapEditing}>
                  地図編集をやめる
                </button>
              </div>
            </div>
          )}
        </section>

        <section className={styles.field} aria-label="drawio 描画 編集">
          <div className={styles.actions}>
            <button type="button" onClick={openNewDrawioBlock}>
              描画を追加
            </button>
            {Array.from({ length: drawioBlockCount }, (_, i) => (
              <button key={i} type="button" onClick={() => openDrawioBlock(i)}>
                描画 {i + 1} を編集
              </button>
            ))}
          </div>
          {drawioEditing !== null && (
            <div className={styles.drawioEditor}>
              <iframe
                ref={drawioIframeRef}
                src={DRAWIO_EMBED_SRC}
                title="drawio 描画エディタ"
                className={styles.drawioFrame}
              />
              <div className={styles.actions}>
                <button type="button" onClick={closeDrawioEditing}>
                  描画編集を閉じる
                </button>
              </div>
            </div>
          )}
        </section>

        <div className={styles.actions}>
          <button type="submit" disabled={submitting}>
            {submitting ? '保存中...' : '保存'}
          </button>
          <Link to={cancelTo} className={styles.cancel}>
            キャンセル
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}

export default PageEditPage
