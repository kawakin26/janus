// 地図ビューア React コンポーネント（タスク 11 / 要件 3-1, 3-2, 3-3, 3-5）。
//
// 出典: GROWI プラグイン growi-plugin-custom-map v0.3.1 の src/viewer.ts からの移植。
// バニラ DOM 直接操作だった描画を React 化し、GROWI API 依存（添付解決・現在ページ解決・
// グローバル設定）を StorageClient（useStorage 経由）・props・定数へ置換した（design 7 章）。
// 座標計算・回転・クランプ・色選択などのロジックは流用する。記法仕様は不変。
// CAD 変換・GUI 編集・写真アップロードはフェーズ 3 のためここでは実装しない。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useStorage } from '../../storage/StorageProvider'
import { usePageError } from '../../pages/use-page-error'
import type { PageErrorHandler } from '../../pages/use-page-error'
import type { MapData, MarkerData } from './types'
import { PIN_SIZE_DEFAULT, LABEL_SIZE_DEFAULT, clamp, textColorForBg } from './map-utils'
import { DEFAULT_OPEN_LABEL, getMinimizedPinSize } from './config'
import { resolveMapImageUrl, resolvePhotoUrl, assetRefLabel } from './resolve-assets'

export interface CustomMapViewerProps {
  mapData: MapData
}

/** 詳細ポップアップで表示する 1 写真分の解決結果。 */
interface ResolvedPhoto {
  url: string
  desc: string
  name: string
}

/** 詳細ポップアップの表示内容。 */
interface DetailState {
  photos: ResolvedPhoto[]
  caption: string
  markerDesc: string
}

/** `|` 区切りを改行へ変換する（既存記法のコメント改行表現を踏襲）。 */
function withLineBreaks(text: string): string {
  return text.split('|').join('\n')
}

// desc/写真のあるマーカーのピンを点滅させる CSS を一度だけ注入する。
const BLINK_STYLE_ID = 'janus-custom-map-blink-style'
function ensureBlinkStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(BLINK_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = BLINK_STYLE_ID
  style.textContent = `
@keyframes janus-custom-map-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.janus-custom-map-pin-blink {
  animation: janus-custom-map-blink 1.2s ease-in-out infinite;
}`
  document.head.appendChild(style)
}

/**
 * 地図ビューア。閉じた状態では「マップを開く」ボタン、クリックでモーダルを開く。
 * モーダル内で画像の上にマーカーを重畳し、パン/ズーム/回転・最小化/復帰・
 * 写真/説明ポップアップを提供する。
 */
function CustomMapViewer({ mapData }: CustomMapViewerProps) {
  const storage = useStorage()
  const handleError = usePageError()
  const [open, setOpen] = useState(false)

  // link 属性があればボタン文言に使い、未指定時は既定文言（移植元の link || openMapLabel() 相当）。
  const openLabel = mapData.link || DEFAULT_OPEN_LABEL

  const handleOpen = useCallback(() => setOpen(true), [])
  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <>
      <button type="button" onClick={handleOpen}>
        {openLabel}
      </button>
      {open && (
        <MapModal
          mapData={mapData}
          storage={storage}
          onError={handleError}
          onClose={handleClose}
        />
      )}
    </>
  )
}

interface MapModalProps {
  mapData: MapData
  storage: ReturnType<typeof useStorage>
  onError: PageErrorHandler
  onClose: () => void
}

/** マップ画像とマーカーを表示するモーダル。開くたびに画像 URL を解決する。 */
function MapModal({ mapData, storage, onError, onClose }: MapModalProps) {
  // 解決状態: 'resolving'（解決中）/ 'resolved'（URL あり）/ 'not-found'（URL なし）/ 'error'（取得エラー）。
  const [status, setStatus] = useState<'resolving' | 'resolved' | 'not-found' | 'error'>('resolving')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // 各マーカーの内側要素（回転・スケール打ち消し用）。
  const markerInnerRefs = useRef<(HTMLDivElement | null)[]>([])

  const rotate = mapData.rotate || 0

  // 点滅 CSS を注入する（モーダル表示時）。
  useEffect(() => {
    ensureBlinkStyle()
  }, [])

  // マップ画像の解決（モーダルを開いたとき 1 回）。
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const url = await resolveMapImageUrl(storage, mapData)
        if (!active) {
          if (url !== null) storage.releaseAssetFileUrl(url)
          return
        }
        setImageUrl(url)
        setStatus(url === null ? 'not-found' : 'resolved')
      } catch (err) {
        const message = onError(err, 'マップ画像の取得に失敗しました')
        if (!active) return
        setImageUrl(null)
        setErrorMessage(message)
        setStatus('error')
      }
    })()
    return () => {
      active = false
    }
  }, [storage, mapData, onError])

  // マップ画像の一時URLは表示中だけ所有し、再表示・アンマウント時に解放する。
  useEffect(() => {
    if (imageUrl === null) return
    return () => storage.releaseAssetFileUrl(imageUrl)
  }, [imageUrl, storage])

  // 写真ポップアップの一時URLも閉じた時・別内容への切替時に解放する。
  useEffect(() => {
    if (detail === null) return
    return () => {
      for (const photo of detail.photos) {
        if (photo.url) storage.releaseAssetFileUrl(photo.url)
      }
    }
  }, [detail, storage])

  // ビュー状態（scale / 平行移動）。描画中に書き換えるため ref で保持する。
  const view = useRef({ scale: mapData.scale || 1, tx: 0, ty: 0 })

  // 元画像座標(px,py)を rotate + scale した後の相対オフセットを返す。
  // transform は translate(tx,ty) rotate(rot) scale(s) の順で適用される前提。
  const rotScale = useCallback(
    (px: number, py: number, s: number): { x: number; y: number } => {
      const rad = (rotate * Math.PI) / 180
      const cosR = Math.cos(rad)
      const sinR = Math.sin(rad)
      const sx = px * s
      const sy = py * s
      return { x: sx * cosR - sy * sinR, y: sx * sinR + sy * cosR }
    },
    [rotate],
  )

  const applyTransform = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const { scale, tx, ty } = view.current
    stage.style.transform = `translate(${tx}px, ${ty}px) rotate(${rotate}deg) scale(${scale})`
    // マーカーの中身は回転を打ち消して常に正立させ、拡大の逆数でサイズを一定に保つ。
    const inv = scale ? 1 / scale : 1
    for (const inner of markerInnerRefs.current) {
      if (inner) inner.style.transform = `translate(-50%, -50%) rotate(${-rotate}deg) scale(${inv})`
    }
  }, [rotate])

  // 画像ロード時に viewport へフィットさせ、cx/cy を中心に合わせる。
  const handleImageLoad = useCallback(() => {
    const img = imgRef.current
    const viewport = viewportRef.current
    const stage = stageRef.current
    if (!img || !viewport || !stage) return

    const naturalW = img.naturalWidth
    const naturalH = img.naturalHeight
    stage.style.width = `${naturalW}px`
    stage.style.height = `${naturalH}px`

    const vpW = viewport.clientWidth
    const vpH = viewport.clientHeight

    // 90/270 度回転では見かけの幅・高さが入れ替わる。
    const swap = rotate === 90 || rotate === 270
    const dispW = swap ? naturalH : naturalW
    const dispH = swap ? naturalW : naturalH
    const fitScale = dispW && dispH ? Math.min(vpW / dispW, vpH / dispH) : 1
    const baseScale = (fitScale || 1) * (mapData.scale || 1)
    view.current.scale = baseScale

    const centerX = (mapData.cx / 100) * naturalW
    const centerY = (mapData.cy / 100) * naturalH
    const off = rotScale(centerX, centerY, baseScale)
    view.current.tx = vpW / 2 - off.x
    view.current.ty = vpH / 2 - off.y

    applyTransform()
  }, [rotate, mapData.scale, mapData.cx, mapData.cy, rotScale, applyTransform])

  // ---- パン / ピンチ / ホイールズーム（Pointer Events / wheel）----
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pan = useRef({ startTx: 0, startTy: 0, startX: 0, startY: 0 })
  const pinch = useRef({ startDist: 0, startScale: 1, startTx: 0, startTy: 0, cx: 0, cy: 0 })

  const vpPoint = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: clientX, y: clientY }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // マーカー上の操作はパンに取られないよう無視する。
      if ((e.target as HTMLElement).closest('[data-map-marker]')) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try {
        viewportRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
      if (pointers.current.size === 1) {
        pan.current = {
          startX: e.clientX,
          startY: e.clientY,
          startTx: view.current.tx,
          startTy: view.current.ty,
        }
        if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
      } else if (pointers.current.size === 2) {
        const [a, b] = Array.from(pointers.current.values())
        pinch.current.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        pinch.current.startScale = view.current.scale
        pinch.current.startTx = view.current.tx
        pinch.current.startTy = view.current.ty
        const mid = vpPoint((a.x + b.x) / 2, (a.y + b.y) / 2)
        pinch.current.cx = mid.x
        pinch.current.cy = mid.y
      }
    },
    [vpPoint],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.current.size >= 2) {
        const [a, b] = Array.from(pointers.current.values())
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        const factor = dist / pinch.current.startDist
        const newScale = clamp(pinch.current.startScale * factor, 0.02, 40)
        const ratio = newScale / pinch.current.startScale
        view.current.tx = pinch.current.cx - (pinch.current.cx - pinch.current.startTx) * ratio
        view.current.ty = pinch.current.cy - (pinch.current.cy - pinch.current.startTy) * ratio
        view.current.scale = newScale
        applyTransform()
      } else if (pointers.current.size === 1) {
        view.current.tx = pan.current.startTx + (e.clientX - pan.current.startX)
        view.current.ty = pan.current.startTy + (e.clientY - pan.current.startY)
        applyTransform()
      }
    },
    [applyTransform],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    try {
      viewportRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    if (pointers.current.size === 1) {
      const [p] = Array.from(pointers.current.values())
      pan.current = { startX: p.x, startY: p.y, startTx: view.current.tx, startTy: view.current.ty }
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
    } else if (pointers.current.size === 0) {
      if (viewportRef.current) viewportRef.current.style.cursor = 'grab'
    }
  }, [])

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
      const newScale = clamp(view.current.scale * factor, 0.02, 40)
      const ratio = newScale / view.current.scale
      view.current.tx = px - (px - view.current.tx) * ratio
      view.current.ty = py - (py - view.current.ty) * ratio
      view.current.scale = newScale
      applyTransform()
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [applyTransform, imageUrl])

  // マーカー詳細（写真ギャラリー＋説明）を解決して開く。
  const showDetail = useCallback(
    async (marker: MarkerData) => {
      const photos = marker.photos ?? []
      const hasDetail = !!(marker.desc && marker.desc.trim()) || photos.length > 0
      if (photos.length === 0 && !hasDetail) return
      if (photos.length === 0) {
        setDetail({ photos: [], caption: marker.label, markerDesc: marker.desc })
        return
      }
      const resolved = await Promise.all(
        photos.map(async (p): Promise<ResolvedPhoto> => {
          try {
            const url = await resolvePhotoUrl(storage, p)
            return { url: url ?? '', desc: p.desc, name: assetRefLabel(p.assetRef) }
          } catch (err) {
            const message = onError(err, '写真の取得に失敗しました')
            if (message !== null) setErrorMessage(message)
            return { url: '', desc: p.desc, name: assetRefLabel(p.assetRef) }
          }
        }),
      )
      setDetail({ photos: resolved, caption: marker.label, markerDesc: marker.desc })
    },
    [storage, onError],
  )

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="地図ビューア"
    >
      <div
        className="relative rounded-lg bg-surface-raised p-5 shadow-sm max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute -top-4 -right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border-0 bg-fg text-surface text-xl cursor-pointer"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>

        {status === 'error' ? (
          <p role="alert" style={{ width: 'min(80vw, 640px)', padding: '8px 4px', textAlign: 'center' }}>
            {errorMessage}
          </p>
        ) : status === 'not-found' ? (
          <MapNotFound fileName={assetRefLabel(mapData.assetRef)} />
        ) : (
          <div
            ref={viewportRef}
            className="relative overflow-hidden rounded bg-surface-raised cursor-grab touch-none"
            style={{ width: 'min(80vw, 900px)', height: 'min(75vh, 675px)' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              ref={stageRef}
              style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', willChange: 'transform' }}
            >
              {imageUrl !== null && (
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt={assetRefLabel(mapData.assetRef)}
                  draggable={false}
                  onLoad={handleImageLoad}
                  style={{ display: 'block', userSelect: 'none', pointerEvents: 'none' }}
                />
              )}
              {mapData.markers.map((marker, i) => (
                <Marker
                  key={i}
                  marker={marker}
                  mapData={mapData}
                  rotate={rotate}
                  innerRef={(el) => {
                    markerInnerRefs.current[i] = el
                  }}
                  onShowDetail={() => {
                    void showDetail(marker)
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {errorMessage !== null && status !== 'error' && (
          <p role="alert" className="text-danger" style={{ margin: '8px 0 0' }}>{errorMessage}</p>
        )}
      </div>

      {detail !== null && <DetailPopup detail={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** マップが解決できなかったときの日本語メッセージ（design 9 章の思想）。 */
function MapNotFound({ fileName }: { fileName: string }) {
  return (
    <div className="text-fg" style={{ width: 'min(80vw, 640px)', padding: '8px 4px', textAlign: 'center' }}>
      <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
        マップ/画像が見つかりません
      </div>
      <div className="text-fg-muted" style={{ fontSize: '13px', lineHeight: 1.7 }}>
        指定されたマップ{' '}
        <code className="bg-surface rounded-sm" style={{ fontFamily: 'monospace', padding: '1px 4px' }}>
          {fileName}
        </code>{' '}
        が見つかりませんでした。
        <br />
        ファイル名または別名が、アセットライブラリに登録した値と一致しているか確認してください。
      </div>
    </div>
  )
}

interface MarkerProps {
  marker: MarkerData
  mapData: MapData
  rotate: number
  innerRef: (el: HTMLDivElement | null) => void
  onShowDetail: () => void
}

/** マーカー（ピン＋ラベル）。クリックで最小化⇔復帰、右クリック/ロングプレスで詳細。 */
function Marker({ marker, mapData, rotate, innerRef, onShowDetail }: MarkerProps) {
  const [minimized, setMinimized] = useState(false)
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressed = useRef(false)
  const downPos = useRef({ x: 0, y: 0 })

  const color = marker.color || '#ff3b30'
  const pinPx = mapData.pinSize || PIN_SIZE_DEFAULT
  const labelPx = mapData.labelSize || LABEL_SIZE_DEFAULT
  const labelBottomPx = pinPx + 4
  const minPinPx = getMinimizedPinSize()
  const restoreSec = mapData.restore || 15

  const hasDetail = useMemo(
    () => !!(marker.desc && marker.desc.trim()) || (marker.photos && marker.photos.length > 0),
    [marker.desc, marker.photos],
  )

  useEffect(() => {
    return () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current)
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  const toggleMinimize = useCallback(() => {
    setMinimized((prev) => {
      const next = !prev
      if (restoreTimer.current) clearTimeout(restoreTimer.current)
      if (next) {
        // 一定時間後に自動復帰する。
        restoreTimer.current = setTimeout(() => setMinimized(false), restoreSec * 1000)
      }
      return next
    })
  }, [restoreSec])

  const curPinPx = minimized ? minPinPx : pinPx
  const blink = minimized || hasDetail

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation()
    longPressed.current = false
    downPos.current = { x: e.clientX, y: e.clientY }
    if (e.pointerType === 'touch') {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
      longPressTimer.current = setTimeout(() => {
        longPressed.current = true
        onShowDetail()
      }, 500)
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (longPressTimer.current == null) return
    const dx = Math.abs(e.clientX - downPos.current.x)
    const dy = Math.abs(e.clientY - downPos.current.y)
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = undefined
    }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation()
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = undefined
    }
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return
    toggleMinimize()
  }
  const onContextMenu = (e: ReactPointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    onShowDetail()
  }

  const interaction = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onContextMenu,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  }

  return (
    <div
      data-map-marker="true"
      style={{ position: 'absolute', left: `${marker.x}%`, top: `${marker.y}%`, zIndex: 5 }}
    >
      <div
        ref={innerRef}
        data-marker-inner="true"
        style={{
          position: 'relative',
          transformOrigin: 'center center',
          transform: `translate(-50%, -50%) rotate(${-rotate}deg)`,
        }}
      >
        {marker.label && !minimized && (
          <div
            {...interaction}
            style={{
              position: 'absolute',
              bottom: `${labelBottomPx}px`,
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: color,
              color: textColorForBg(color),
              padding: '4px 8px',
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
          {...interaction}
          data-marker-pin="true"
          data-minimized={minimized ? 'true' : 'false'}
          className={blink ? 'janus-custom-map-pin-blink' : undefined}
          style={{
            position: 'relative',
            width: `${curPinPx}px`,
            height: `${curPinPx}px`,
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
}

interface DetailPopupProps {
  detail: DetailState
  onClose: () => void
}

/** マーカー詳細（写真ギャラリー＋各写真コメント＋マーカー説明）のポップアップ。 */
function DetailPopup({ detail, onClose }: DetailPopupProps) {
  const { photos, caption, markerDesc } = detail
  const single = photos.length === 1
  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/80"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="マーカー詳細"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '16px',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {caption && (
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold', textAlign: 'center' }}>
            {caption}
          </div>
        )}
        {photos.map((p, i) => (
          <div
            key={i}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}
          >
            {p.url ? (
              <img
                src={p.url}
                alt={p.desc || caption || ''}
                style={{
                  maxWidth: '85vw',
                  maxHeight: single ? '70vh' : '55vh',
                  borderRadius: '6px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                style={{
                  color: '#ddd',
                  fontSize: '13px',
                  textAlign: 'center',
                  whiteSpace: 'pre-wrap',
                  border: '1px dashed rgba(255,255,255,0.4)',
                  borderRadius: '6px',
                  padding: '24px 28px',
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                {`画像を表示できません${p.name ? `\n(${p.name})` : ''}`}
              </div>
            )}
            {p.desc && p.desc.trim() && (
              <div
                style={{
                  color: '#fff',
                  fontSize: '13px',
                  lineHeight: 1.6,
                  textAlign: 'center',
                  whiteSpace: 'pre-wrap',
                  maxWidth: '85vw',
                  background: 'rgba(255,255,255,0.10)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                }}
              >
                {withLineBreaks(p.desc)}
              </div>
            )}
          </div>
        ))}
        {markerDesc && markerDesc.trim() && (
          <div
            style={{
              color: '#fff',
              fontSize: '14px',
              lineHeight: 1.6,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              maxWidth: '85vw',
              background: 'rgba(255,255,255,0.08)',
              padding: '10px 16px',
              borderRadius: '6px',
            }}
          >
            {withLineBreaks(markerDesc)}
          </div>
        )}
      </div>
    </div>
  )
}

export default CustomMapViewer
