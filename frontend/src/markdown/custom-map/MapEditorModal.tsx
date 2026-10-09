// 新しいモーダル編集 UI 本体（設計 §5/§7 / FEAT-003）。
//
// 出典: GROWI プラグイン editor.ts の openMapPreviewModal を React 化し、GROWI API 依存
// （直 PUT・添付解決）を StorageClient（useStorage）へ置換したもの。左ペイン viewport は
// map-viewport.ts の共有 API（閲覧側 CustomMapViewer と同一）で transform/fit/パン/ズーム
// /ピンチ/座標逆変換を行い、長押し追加は use-longpress-add.ts に委ねる。右ペインは選択中
// マーカー 0 or 1 件分を排他表示し、X/Y 数値入力・写真 desc 編集・詳細設定を編集できる。
//
// 不変条件:
//  - サーバー永続化はしない。保存は onSave(draft) で親（PageEditPage）に委ねる。
//  - 親の MapData は壊さない。マウント時に deepCloneMapData で draft を作り、全変更は
//    不変更新（新オブジェクト/配列生成）で setDraft する。
//  - UI 配色は既存トークン（surface-raised/border/fg/primary/danger 等）のみ。マーカー既定
//    色 #ff3b30 は記法ドメイン定数として許容。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { useStorage } from '../../storage/StorageProvider'
import { usePageError } from '../../pages/use-page-error'
import { readMode } from '../../storage/mode'
import type { Asset, AssetRef, Folder } from '../../storage/types'
import type { MapData, MarkerData, PhotoData } from './types'
import {
  clamp,
  normalizeRotate,
  textColorForBg,
  PIN_SIZE_DEFAULT,
  PIN_SIZE_MIN,
  PIN_SIZE_MAX,
  LABEL_SIZE_DEFAULT,
  LABEL_SIZE_MIN,
  LABEL_SIZE_MAX,
} from './map-utils'
import {
  stageTransform,
  markerInnerTransform,
  computeFitView,
  zoomAround,
  viewportToPercent,
  MOVE_THRESHOLD,
} from './map-viewport'
import type { ViewState } from './map-viewport'
import { resolveLongPressMs } from './longpress-config'
import { useLongPressAdd } from './use-longpress-add'

export interface MapEditorModalProps {
  mapData: MapData
  onSave: (next: MapData) => void
  onDiscard: () => void
  /**
   * 編集対象ブロックの表示番号（1 始まり）。見出しのフォールバック「マップ N」に使う。
   * 親（PageEditPage）がモーダルを開いた瞬間に確定した値を渡す（既存ブロックは blockIndex+1、
   * 新規追加は開いた時点のブロック数+1）。モーダル表示中は固定され、再算出に依存しない。
   */
  blockNumber: number
}

// マーカー既定色（記法ドメイン定数。テーマトークンではない）。
const DEFAULT_MARKER_COLOR = '#ff3b30'

// ラベル付き入力の縦積み（旧 MapEditor の体裁を踏襲）。
const FIELD_CLASS = 'grid gap-1 [&>label]:text-sm [&>label]:text-fg'

/** 座標を 0〜100(%) にクランプし小数第 1 位へ丸める（editor.ts の round1 相当）。 */
function roundCoord(v: number): number {
  return Math.round(clamp(v, 0, 100) * 10) / 10
}

/**
 * draft 初期化専用のディープコピー（設計 §5.3）。親の MapData と参照を完全に断つ。
 * AssetSpecifier は {kind,value} の平坦オブジェクトなので {...s} が葉の複製として十分。
 */
function deepCloneMapData(m: MapData): MapData {
  return {
    // title はプリミティブ文字列なのでスプレッド `...m` 経由でそのまま複製される。
    ...m,
    assetRef: { ...m.assetRef, specifiers: m.assetRef.specifiers.map((s) => ({ ...s })) },
    markers: m.markers.map((mk) => ({
      ...mk,
      photos: mk.photos.map((p) => ({
        ...p,
        assetRef: { ...p.assetRef, specifiers: p.assetRef.specifiers.map((s) => ({ ...s })) },
      })),
    })),
  }
}

/** マップ参照の代表 1 指定子（filename 優先、無ければ alias）を作る。 */
function assetToSpecifiers(asset: Asset): AssetRef['specifiers'] {
  if (asset.filename) return [{ kind: 'filename', value: asset.filename }]
  if (asset.alias) return [{ kind: 'alias', value: asset.alias }]
  return []
}

function MapEditorModal({ mapData, onSave, onDiscard, blockNumber }: MapEditorModalProps) {
  const storage = useStorage()
  const handleError = usePageError()

  // 長押し閾値はマウント時に 1 回だけ解決して固定する（設計 §6.2・開くたびに最新を読む）。
  // 遅延初期化で初回レンダー時に 1 回だけ resolveLongPressMs() を呼び、以降は固定値を使う。
  const [thresholdMs] = useState(() => resolveLongPressMs())

  // ローカルモードのときだけカメラ撮影 UI を促す（capture="environment"）。
  const isLocalMode = readMode() === 'local'

  // カメラ（videoinput）の有無。カメラが無いと確実に分かったときだけ「カメラで撮影」を隠す。
  // 未確定・判定不能（未対応ブラウザ / 非セキュアコンテキスト / 例外）は安全側で true に倒す。
  const [hasCamera, setHasCamera] = useState(true)

  // 作業用コピー（draft）。保存時のみ onSave(draft) で親へ反映する。
  const [draft, setDraft] = useState<MapData>(() => deepCloneMapData(mapData))
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // マップ画像選択・写真アップロード先フォルダ（ルート=null）。
  const [folders, setFolders] = useState<Folder[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [folderId, setFolderId] = useState<number | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const markerInnerRefs = useRef<(HTMLDivElement | null)[]>([])

  const rotate = normalizeRotate(draft.rotate || 0)

  // ビュー状態（scale / 平行移動）。描画中に書き換えるため ref で保持する。
  const viewRef = useRef<ViewState>({ scale: draft.scale || 1, tx: 0, ty: 0 })

  const cameraInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([])

  // --- マップ画像上の transform 反映 ---
  const applyTransform = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.style.transform = stageTransform(viewRef.current, { rotate })
    const inner = markerInnerTransform(viewRef.current.scale, { rotate })
    for (const el of markerInnerRefs.current) {
      if (el) el.style.transform = inner
    }
  }, [rotate])

  // cx/cy/scale/rotate いずれかの変更時に再フィットする。
  const refitView = useCallback(() => {
    const img = imgRef.current
    const viewport = viewportRef.current
    const stage = stageRef.current
    if (!img || !viewport || !stage) return
    viewRef.current = computeFitView({
      naturalW: img.naturalWidth,
      naturalH: img.naturalHeight,
      viewportW: viewport.clientWidth,
      viewportH: viewport.clientHeight,
      mapScale: draft.scale || 1,
      cx: draft.cx,
      cy: draft.cy,
      ctx: { rotate },
    })
    applyTransform()
  }, [draft.scale, draft.cx, draft.cy, rotate, applyTransform])

  // 画像ロード時に viewport へフィットさせる（閲覧側 handleImageLoad と同一）。
  const handleImageLoad = useCallback(() => {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage) return
    stage.style.width = `${img.naturalWidth}px`
    stage.style.height = `${img.naturalHeight}px`
    refitView()
  }, [refitView])

  // cx/cy/scale/rotate が変わったら再フィットする（画像ロード済み前提）。
  useEffect(() => {
    refitView()
  }, [refitView])

  // マウント時に 1 回だけカメラ（videoinput）の有無を判定する。
  // enumerateDevices で videoinput の件数のみを見る（権限要求 getUserMedia は呼ばない）。
  // 権限未許可だとラベルは空になるがデバイス自体は列挙されるため、kind だけで判定する。
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md || typeof md.enumerateDevices !== 'function') return // 未対応・非セキュアは安全側(true)
    let cancelled = false
    md.enumerateDevices()
      .then((devices) => {
        if (cancelled) return
        setHasCamera(devices.some((d) => d.kind === 'videoinput'))
      })
      .catch(() => {
        // 判定不能のときは安全側で表示を維持する（何もしない=true のまま）。
      })
    return () => {
      cancelled = true
    }
  }, [])

  const getNatural = useCallback(() => {
    const img = imgRef.current
    return { w: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0 }
  }, [])

  // --- 長押しマーカー追加 ---
  // 追加したマーカー（末尾）を選択するため、最新の markers 長を鏡写しする。
  const markerCountRef = useRef(draft.markers.length)
  useEffect(() => {
    // 既存: handleAddMarker が newIndex = markerCountRef.current を読んで setSelected するため、
    // 最新件数を鏡写しする（この代入は削除しない。選択ロジックが依存する）。
    markerCountRef.current = draft.markers.length
    // 件数変化で markerInnerRefs の要素構成が変わる。新規要素のインライン transform は
    // scale=1 固定のため、ここで現在の view.scale に基づく 1/scale 補正を全マーカーへ再適用する
    // （未適用だと新規マーカーだけ scale 倍に見える不具合になる）。
    applyTransform()
  }, [draft.markers.length, applyTransform])

  const handleAddMarker = useCallback((pos: { x: number; y: number }) => {
    const newIndex = markerCountRef.current
    setDraft((prev) => {
      const next: MarkerData = {
        x: roundCoord(pos.x),
        y: roundCoord(pos.y),
        label: '',
        desc: '',
        color: DEFAULT_MARKER_COLOR,
        photos: [],
      }
      return { ...prev, markers: [...prev.markers, next] }
    })
    setSelected(newIndex)
  }, [])

  const longPressHandlers = useLongPressAdd({
    viewportRef,
    viewRef,
    rotate,
    getNatural,
    thresholdMs,
    onAddMarker: handleAddMarker,
    applyTransform,
  })

  // ホイールズーム。passive:false にするため addEventListener で直接登録する。
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      viewRef.current = zoomAround(viewRef.current, px, py, factor)
      applyTransform()
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [applyTransform, imageUrl])

  // --- マーカードラッグ移動 / 選択（ピン・ラベル共通ハンドラ）---
  // editor.ts の attachMarkerDrag 相当: MOVE_THRESHOLD 超でドラッグ移動開始、
  // 未移動のまま up したら選択のみ。
  const dragging = useRef<{ index: number; startX: number; startY: number; moved: boolean } | null>(null)

  const onMarkerPointerDown = useCallback(
    (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      dragging.current = { index, startX: e.clientX, startY: e.clientY, moved: false }
      try {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    },
    [],
  )

  const onMarkerPointerMove = useCallback(
    (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragging.current
      if (!state || state.index !== index) return
      // 閾値未満は単純クリック候補としてまだ動かさない。
      if (
        !state.moved &&
        Math.abs(e.clientX - state.startX) <= MOVE_THRESHOLD &&
        Math.abs(e.clientY - state.startY) <= MOVE_THRESHOLD
      ) {
        return
      }
      const vp = viewportRef.current?.getBoundingClientRect()
      if (!vp) return
      const natural = getNatural()
      const pos = viewportToPercent({
        vx: e.clientX - vp.left,
        vy: e.clientY - vp.top,
        view: viewRef.current,
        naturalW: natural.w,
        naturalH: natural.h,
        ctx: { rotate },
      })
      state.moved = true
      setSelected(index)
      const x = roundCoord(pos.x)
      const y = roundCoord(pos.y)
      setDraft((prev) => ({
        ...prev,
        markers: prev.markers.map((mk, i) => (i === index ? { ...mk, x, y } : mk)),
      }))
    },
    [getNatural, rotate],
  )

  const onMarkerPointerUp = useCallback(
    (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
      const state = dragging.current
      dragging.current = null
      // 未移動 up は選択のみ。
      if (state && !state.moved) setSelected(index)
    },
    [],
  )

  // --- フォルダ/アセット一覧の取得（マウント時・folderId 変更時）---
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [fs, as] = await Promise.all([
          storage.listFolders(folderId),
          storage.listAssets(folderId),
        ])
        if (!active) return
        setFolders(fs)
        setAssets(as)
      } catch (err) {
        if (active) setError(handleError(err, 'アセット一覧の取得に失敗しました'))
      }
    })()
    return () => {
      active = false
    }
  }, [storage, folderId, handleError])

  // --- マップ画像 URL の解決（draft.assetRef が変わるたび）---
  useEffect(() => {
    let active = true
    const hasRef = draft.assetRef.specifiers.length > 0
    void (async () => {
      try {
        const url = hasRef ? await storage.resolveAssetUrl(draft.assetRef) : null
        if (!active) {
          if (url) storage.releaseAssetFileUrl(url)
          return
        }
        setImageUrl(url)
      } catch (err) {
        if (active) setError(handleError(err, 'マップ画像の取得に失敗しました'))
      }
    })()
    return () => {
      active = false
    }
  }, [storage, draft.assetRef, handleError])

  // 解決した一時 URL は不要になったら解放する。
  useEffect(() => {
    if (imageUrl === null) return
    return () => storage.releaseAssetFileUrl(imageUrl)
  }, [imageUrl, storage])

  // --- Esc で破棄確認 ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (window.confirm('編集を破棄して閉じますか？')) onDiscard()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDiscard])

  // --- draft 更新ヘルパ ---
  const selectMapAsset = useCallback((asset: Asset) => {
    setDraft((prev) => ({
      ...prev,
      assetRef: {
        ...(prev.assetRef.baseFolderPath ? { baseFolderPath: prev.assetRef.baseFolderPath } : {}),
        specifiers: assetToSpecifiers(asset),
      },
    }))
  }, [])

  const patchMarker = useCallback((index: number, patch: Partial<MarkerData>) => {
    setDraft((prev) => ({
      ...prev,
      markers: prev.markers.map((mk, i) => (i === index ? { ...mk, ...patch } : mk)),
    }))
  }, [])

  const removeMarker = useCallback((index: number) => {
    setDraft((prev) => ({ ...prev, markers: prev.markers.filter((_, i) => i !== index) }))
    setSelected(null)
  }, [])

  const attachPhoto = useCallback(
    async (index: number, file: File) => {
      setError(null)
      try {
        const asset = await storage.uploadAsset({ folderId, file })
        const specifier: AssetRef['specifiers'][number] = asset.filename
          ? { kind: 'filename', value: asset.filename }
          : { kind: 'alias', value: asset.alias }
        setDraft((prev) => {
          const current = prev.markers[index]
          if (!current) return prev
          const photo: PhotoData = {
            assetRef: {
              ...(prev.assetRef.baseFolderPath
                ? { baseFolderPath: prev.assetRef.baseFolderPath }
                : {}),
              specifiers: [specifier],
            },
            desc: '',
          }
          return {
            ...prev,
            markers: prev.markers.map((mk, i) =>
              i === index ? { ...mk, photos: [...mk.photos, photo] } : mk,
            ),
          }
        })
      } catch (err) {
        setError(handleError(err, '写真のアップロードに失敗しました'))
      }
    },
    [storage, folderId, handleError],
  )

  const setPhotoDesc = useCallback((markerIndex: number, photoIndex: number, desc: string) => {
    setDraft((prev) => ({
      ...prev,
      markers: prev.markers.map((mk, i) =>
        i === markerIndex
          ? { ...mk, photos: mk.photos.map((p, j) => (j === photoIndex ? { ...p, desc } : p)) }
          : mk,
      ),
    }))
  }, [])

  const removePhoto = useCallback((markerIndex: number, photoIndex: number) => {
    setDraft((prev) => ({
      ...prev,
      markers: prev.markers.map((mk, i) =>
        i === markerIndex ? { ...mk, photos: mk.photos.filter((_, j) => j !== photoIndex) } : mk,
      ),
    }))
  }, [])

  const folderOptions = useMemo(() => folders.map((f) => ({ id: f.id, name: f.name })), [folders])

  const mapSpecifier = draft.assetRef.specifiers[0] ?? null
  const pinPx = draft.pinSize || PIN_SIZE_DEFAULT
  const labelPx = draft.labelSize || LABEL_SIZE_DEFAULT
  const labelBottomPx = pinPx + 4

  const selectedMarker = selected !== null ? draft.markers[selected] : undefined

  // 編集中マップの識別見出し。title を優先し、空（空白のみ含む）なら「マップ N」へフォールバック。
  // draft.title を使うことで、入力欄での編集が見出しへ即時に追従する。
  const displayTitle = draft.title.trim() !== '' ? draft.title : `マップ ${blockNumber}`

  // マーカーの選択/ドラッグ共通ハンドラ（ピン・ラベル双方に付ける）。
  const markerInteraction = (i: number) => ({
    onPointerDown: onMarkerPointerDown(i),
    onPointerMove: onMarkerPointerMove(i),
    onPointerUp: onMarkerPointerUp(i),
    onPointerCancel: onMarkerPointerUp(i),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="マップ編集"
      className="fixed inset-0 z-[9999] flex bg-black/70"
    >
      <div className="relative m-auto flex h-[min(85vh,720px)] w-[min(95vw,1100px)] overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
        {/* 左ペイン: viewport */}
        <div
          ref={viewportRef}
          className="relative flex-1 overflow-hidden touch-none cursor-crosshair bg-surface"
          onPointerDown={longPressHandlers.onPointerDown}
          onPointerMove={longPressHandlers.onPointerMove}
          onPointerUp={longPressHandlers.onPointerUp}
          onPointerCancel={longPressHandlers.onPointerCancel}
          data-testid="map-editor-viewport"
        >
          <div
            ref={stageRef}
            style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', willChange: 'transform' }}
          >
            {imageUrl !== null && (
              <img
                ref={imgRef}
                src={imageUrl}
                alt="マッププレビュー"
                draggable={false}
                onLoad={handleImageLoad}
                style={{ display: 'block', userSelect: 'none', pointerEvents: 'none' }}
              />
            )}
            {draft.markers.map((marker, i) => {
              const color = /^#[0-9a-fA-F]{6}$/.test(marker.color) ? marker.color : DEFAULT_MARKER_COLOR
              const isSel = selected === i
              return (
                <div
                  key={i}
                  data-map-marker="true"
                  data-marker-index={i}
                  data-selected={isSel ? 'true' : 'false'}
                  style={{ position: 'absolute', left: `${marker.x}%`, top: `${marker.y}%`, zIndex: 5 }}
                >
                  <div
                    ref={(el) => {
                      markerInnerRefs.current[i] = el
                    }}
                    style={{
                      position: 'relative',
                      transformOrigin: 'center center',
                      // 初期値は scale=1。マウント/画像ロード後に applyTransform が現在 scale で上書きする。
                      transform: markerInnerTransform(1, { rotate }),
                    }}
                  >
                    {marker.label && (
                      <div
                        {...markerInteraction(i)}
                        data-marker-label="true"
                        style={{
                          position: 'absolute',
                          bottom: `${labelBottomPx}px`,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          backgroundColor: color,
                          color: textColorForBg(color),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: `${labelPx}px`,
                          whiteSpace: 'nowrap',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        {marker.label}
                      </div>
                    )}
                    <div
                      {...markerInteraction(i)}
                      data-marker-pin="true"
                      className={
                        isSel
                          ? 'outline outline-2 outline-offset-2 outline-primary'
                          : undefined
                      }
                      style={{
                        position: 'relative',
                        width: `${pinPx}px`,
                        height: `${pinPx}px`,
                        backgroundColor: color,
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                        cursor: 'pointer',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          {imageUrl === null && (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-fg-muted">
              マップ画像を選択すると、長押しでマーカーを配置できます。
            </div>
          )}
          <p
            className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white"
          >
            長押しでマーカー追加 / マーカーをドラッグで移動 / ホイール・ピンチで拡大 / 背景ドラッグで移動
          </p>
        </div>

        {/* 右ペイン: 編集フィールド（排他） */}
        <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-auto border-l border-border p-3">
          {/* 編集中マップの識別見出し（title 優先、空なら「マップ N」）。 */}
          <h2 className="text-base font-bold text-fg" data-testid="map-editor-heading">
            {displayTitle} を編集
          </h2>
          {error !== null && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}

          {/* 1. マップ画像選択 */}
          <section className="grid gap-2">
            <h3 className="text-sm font-bold text-fg">マップ画像</h3>
            <div className={FIELD_CLASS}>
              <label htmlFor="map-editor-folder">フォルダ</label>
              <select
                id="map-editor-folder"
                value={folderId ?? ''}
                onChange={(e) => setFolderId(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">ルート</option>
                {folderOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={FIELD_CLASS}>
              <label htmlFor="map-editor-asset">マップ画像</label>
              <select
                id="map-editor-asset"
                value={mapSpecifier?.value ?? ''}
                onChange={(e) => {
                  const asset = assets.find(
                    (a) => a.filename === e.target.value || a.alias === e.target.value,
                  )
                  if (asset) selectMapAsset(asset)
                }}
              >
                <option value="">（未選択）</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.filename || a.alias}>
                    {a.alias || a.filename}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* 2. マップ全体設定（詳細設定） */}
          <details className="rounded border border-border p-2">
            <summary className="cursor-pointer text-sm font-bold text-fg">詳細設定</summary>
            <div className="mt-2 grid gap-2">
              <div className={FIELD_CLASS}>
                <span className="text-sm text-fg">回転</span>
                <div className="flex gap-1.5">
                  {[0, 90, 180, 270].map((deg) => (
                    <Button
                      key={deg}
                      type="button"
                      variant={rotate === deg ? 'accent' : 'normal'}
                      aria-pressed={rotate === deg}
                      className="flex-1 justify-center text-xs"
                      onClick={() => setDraft((prev) => ({ ...prev, rotate: normalizeRotate(deg) }))}
                    >
                      {deg}°
                    </Button>
                  ))}
                </div>
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-pin-size">ピンサイズ (px)</label>
                <input
                  id="map-editor-pin-size"
                  type="number"
                  min={PIN_SIZE_MIN}
                  max={PIN_SIZE_MAX}
                  value={draft.pinSize}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, pinSize: clamp(Number(e.target.value), PIN_SIZE_MIN, PIN_SIZE_MAX) }))
                  }
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-label-size">ラベル文字サイズ (px)</label>
                <input
                  id="map-editor-label-size"
                  type="number"
                  min={LABEL_SIZE_MIN}
                  max={LABEL_SIZE_MAX}
                  value={draft.labelSize}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      labelSize: clamp(Number(e.target.value), LABEL_SIZE_MIN, LABEL_SIZE_MAX),
                    }))
                  }
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-title">タイトル</label>
                <input
                  id="map-editor-title"
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-link">起動ボタンの文言 (link)</label>
                <input
                  id="map-editor-link"
                  type="text"
                  value={draft.link}
                  onChange={(e) => setDraft((prev) => ({ ...prev, link: e.target.value }))}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-restore">自動復帰(秒) (restore)</label>
                <input
                  id="map-editor-restore"
                  type="number"
                  value={draft.restore}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) setDraft((prev) => ({ ...prev, restore: v }))
                  }}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-cx">初期中心X% (cx)</label>
                <input
                  id="map-editor-cx"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.cx}
                  onChange={(e) => setDraft((prev) => ({ ...prev, cx: clamp(Number(e.target.value), 0, 100) }))}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-cy">初期中心Y% (cy)</label>
                <input
                  id="map-editor-cy"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.cy}
                  onChange={(e) => setDraft((prev) => ({ ...prev, cy: clamp(Number(e.target.value), 0, 100) }))}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="map-editor-scale">初期倍率 (scale)</label>
                <input
                  id="map-editor-scale"
                  type="number"
                  step="any"
                  value={draft.scale}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) setDraft((prev) => ({ ...prev, scale: v }))
                  }}
                />
              </div>
            </div>
          </details>

          {/* 3. マーカー一覧（簡易・選択切替） */}
          <section className="grid gap-1">
            <h3 className="text-sm font-bold text-fg">マーカー一覧 ({draft.markers.length})</h3>
            {draft.markers.length === 0 ? (
              <p className="text-sm text-fg-muted">マップを長押ししてマーカーを追加できます。</p>
            ) : (
              draft.markers.map((m, i) => (
                <Button
                  key={i}
                  type="button"
                  variant={selected === i ? 'accent' : 'normal'}
                  aria-pressed={selected === i}
                  className="justify-start text-xs"
                  onClick={() => setSelected(i)}
                >
                  {`#${i + 1} ${m.label || '(ラベルなし)'}`}
                </Button>
              ))
            )}
          </section>

          {/* 4. 選択中マーカー編集（排他） */}
          {selected !== null && selectedMarker ? (
            <section className="grid gap-2 rounded border border-primary p-3">
              <h3 className="text-sm font-bold text-fg">選択中: #{selected + 1}</h3>
              <div className={FIELD_CLASS}>
                <label htmlFor="marker-label">ラベル</label>
                <input
                  id="marker-label"
                  type="text"
                  value={selectedMarker.label}
                  onChange={(e) => patchMarker(selected, { label: e.target.value })}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="marker-color">色</label>
                <input
                  id="marker-color"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(selectedMarker.color) ? selectedMarker.color : DEFAULT_MARKER_COLOR}
                  onChange={(e) => patchMarker(selected, { color: e.target.value })}
                />
              </div>
              <div className="flex gap-3">
                <div className={FIELD_CLASS}>
                  <label htmlFor="marker-x">X (%)</label>
                  <input
                    id="marker-x"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={selectedMarker.x}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) patchMarker(selected, { x: roundCoord(v) })
                    }}
                  />
                </div>
                <div className={FIELD_CLASS}>
                  <label htmlFor="marker-y">Y (%)</label>
                  <input
                    id="marker-y"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={selectedMarker.y}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) patchMarker(selected, { y: roundCoord(v) })
                    }}
                  />
                </div>
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="marker-desc">説明</label>
                <textarea
                  id="marker-desc"
                  rows={2}
                  value={selectedMarker.desc}
                  onChange={(e) => patchMarker(selected, { desc: e.target.value })}
                />
              </div>

              {/* 参考写真 */}
              <div className="grid gap-2">
                <span className="text-sm font-bold text-fg">参考写真</span>
                {selectedMarker.photos.map((photo, pi) => (
                  <div key={pi} className="grid gap-1 rounded border border-border p-2">
                    <span className="text-xs text-fg-muted">
                      写真 #{pi + 1}: {photo.assetRef.specifiers[0]?.value ?? '(参照なし)'}
                    </span>
                    <div className={FIELD_CLASS}>
                      <label htmlFor={`photo-${pi}-desc`}>コメント</label>
                      <input
                        id={`photo-${pi}-desc`}
                        type="text"
                        value={photo.desc}
                        placeholder="この写真のコメント（任意、| で改行）"
                        onChange={(e) => setPhotoDesc(selected, pi, e.target.value)}
                      />
                    </div>
                    <div>
                      <Button type="button" variant="danger" className="text-xs" onClick={() => removePhoto(selected, pi)}>
                        写真を削除
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {/* カメラが無いと確実に分かったときだけ「カメラで撮影」を出さない。 */}
                  {hasCamera && (
                    <>
                      <label className="sr-only" htmlFor="marker-photo-camera">
                        カメラで撮影
                      </label>
                      <input
                        id="marker-photo-camera"
                        ref={(element) => {
                          cameraInputRefs.current[selected] = element
                        }}
                        className="sr-only"
                        type="file"
                        accept="image/*"
                        capture={isLocalMode ? 'environment' : undefined}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void attachPhoto(selected, file)
                          e.target.value = ''
                        }}
                      />
                      <Button type="button" onClick={() => cameraInputRefs.current[selected]?.click()}>
                        カメラで撮影
                      </Button>
                    </>
                  )}
                  <label className="sr-only" htmlFor="marker-photo-file">
                    ファイルを選択
                  </label>
                  <input
                    id="marker-photo-file"
                    ref={(element) => {
                      fileInputRefs.current[selected] = element
                    }}
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void attachPhoto(selected, file)
                      e.target.value = ''
                    }}
                  />
                  <Button type="button" onClick={() => fileInputRefs.current[selected]?.click()}>
                    ファイルを選択
                  </Button>
                </div>
              </div>

              <div>
                <Button type="button" variant="danger" onClick={() => removeMarker(selected)}>
                  マーカーを削除
                </Button>
              </div>
            </section>
          ) : (
            <p className="text-sm text-fg-muted">マーカーを選択すると編集できます。</p>
          )}

          {/* 5. 保存/破棄 */}
          <div className="mt-auto flex gap-2">
            <Button type="button" variant="accent" onClick={() => onSave(draft)}>
              保存して閉じる
            </Button>
            <Button type="button" variant="normal" onClick={onDiscard}>
              破棄して閉じる
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default MapEditorModal
