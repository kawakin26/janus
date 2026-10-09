// 左ペイン viewport の長押しマーカー追加 状態機械フック（設計 §6.2 / FEAT-003）。
//
// 出典: GROWI プラグイン editor.ts の openMapPreviewModal 内 viewport ハンドラ
// （pointerdown / pointermove / endPointer）を React フック化したもの。editor.ts の
// 「未移動なら追加」を「閾値以上の静止長押しなら追加」に強化した点だけが差分。
//
// このフックは viewport の pan / pinch / 長押し追加 の協調を担う。マーカー上の操作は
// マーカー側ハンドラが stopPropagation するためここには流れてこない（closest で保険も掛ける）。
// view(ViewState) の更新と DOM 反映は applyTransform コールバックに委ねる（純粋計算は
// map-viewport に、DOM 副作用は呼び出し側に、という分離を守る）。

import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { MOVE_THRESHOLD, panView, pinchView, viewportToPercent } from './map-viewport'
import type { PinchStart, ViewState } from './map-viewport'

export interface LongPressAddHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void
}

export interface UseLongPressAddArgs {
  viewportRef: RefObject<HTMLDivElement | null>
  viewRef: MutableRefObject<ViewState>
  /** normalizeRotate 済みの回転角（0/90/180/270）。 */
  rotate: number
  getNatural: () => { w: number; h: number }
  /** マウント時に resolveLongPressMs() で解決した実効閾値（ms）。 */
  thresholdMs: number
  onAddMarker: (pos: { x: number; y: number }) => void
  /** view 更新後に DOM へ反映するコールバック。 */
  applyTransform: () => void
}

/**
 * viewport の 1本指/マウス/2本指操作を分岐する長押し追加フック。
 *  - 何もない場所で閾値以上の静止長押し → 離した位置にマーカー追加。
 *  - ドラッグ（MOVE_THRESHOLD 超）→ パン（追加しない）。
 *  - 閾値未満のタップ → 何もしない。
 *  - 2本指 → ピンチズーム（追加しない）。
 *  - 右クリック（button !== 0）→ 長押しタイマーを張らない（追加対象外）。
 */
export function useLongPressAdd(args: UseLongPressAddArgs): LongPressAddHandlers {
  const { viewportRef, viewRef, rotate, getNatural, thresholdMs, onAddMarker, applyTransform } = args

  // 状態はすべて useRef（再レンダー不要）。
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const downPos = useRef({ x: 0, y: 0 })
  const moved = useRef(false)
  const longPressReached = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pan = useRef({ startTx: 0, startTy: 0, startX: 0, startY: 0 })
  const pinch = useRef<PinchStart>({ startDist: 0, startScale: 1, startTx: 0, startTy: 0, cx: 0, cy: 0 })

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = undefined
    }
  }, [])

  // viewport ローカル座標へ変換する（矩形が無い jsdom では client 値をそのまま返す）。
  const vpPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return { x: clientX, y: clientY }
      return { x: clientX - rect.left, y: clientY - rect.top }
    },
    [viewportRef],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // マーカー上の操作はマーカー側ハンドラへ委ね、viewport では無視する。
      if ((e.target as HTMLElement).closest('[data-map-marker]')) return

      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try {
        viewportRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }

      if (pointers.current.size === 1) {
        downPos.current = { x: e.clientX, y: e.clientY }
        moved.current = false
        longPressReached.current = false
        pan.current = {
          startX: e.clientX,
          startY: e.clientY,
          startTx: viewRef.current.tx,
          startTy: viewRef.current.ty,
        }
        clearLongPressTimer()
        // 右クリックは追加対象外（長押しタイマーを張らない）。
        if (e.button === 0) {
          longPressTimer.current = setTimeout(() => {
            if (!moved.current) longPressReached.current = true
          }, thresholdMs)
        }
      } else if (pointers.current.size === 2) {
        const [a, b] = Array.from(pointers.current.values())
        pinch.current.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        pinch.current.startScale = viewRef.current.scale
        pinch.current.startTx = viewRef.current.tx
        pinch.current.startTy = viewRef.current.ty
        const mid = vpPoint((a.x + b.x) / 2, (a.y + b.y) / 2)
        pinch.current.cx = mid.x
        pinch.current.cy = mid.y
        // 2点目で長押しは無効化する。
        moved.current = true
        clearLongPressTimer()
      }
    },
    [viewportRef, viewRef, thresholdMs, vpPoint, clearLongPressTimer],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.current.size >= 2) {
        const [a, b] = Array.from(pointers.current.values())
        viewRef.current = pinchView(pinch.current, a.x, a.y, b.x, b.y)
        applyTransform()
      } else if (pointers.current.size === 1) {
        const dx = Math.abs(e.clientX - downPos.current.x)
        const dy = Math.abs(e.clientY - downPos.current.y)
        // 閾値内は静止長押し候補として維持し、パンもしない。
        if (dx <= MOVE_THRESHOLD && dy <= MOVE_THRESHOLD) return
        moved.current = true
        clearLongPressTimer()
        viewRef.current = panView(
          pan.current.startTx,
          pan.current.startTy,
          e.clientX - pan.current.startX,
          e.clientY - pan.current.startY,
          viewRef.current.scale,
        )
        applyTransform()
      }
    },
    [viewRef, applyTransform, clearLongPressTimer],
  )

  const endPointer = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      const wasSingle = pointers.current.size === 1
      pointers.current.delete(e.pointerId)
      clearLongPressTimer()
      try {
        viewportRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        /* noop */
      }

      // 1本指・未移動・閾値到達のときだけ追加する。
      if (wasSingle && !moved.current && longPressReached.current) {
        const p = vpPoint(e.clientX, e.clientY)
        const natural = getNatural()
        const pos = viewportToPercent({
          vx: p.x,
          vy: p.y,
          view: viewRef.current,
          naturalW: natural.w,
          naturalH: natural.h,
          ctx: { rotate },
        })
        onAddMarker(pos)
      }

      // 残り 1点ならパン基準を更新する（editor.ts と同じ継続処理）。
      if (pointers.current.size === 1) {
        const [p] = Array.from(pointers.current.values())
        pan.current = { startX: p.x, startY: p.y, startTx: viewRef.current.tx, startTy: viewRef.current.ty }
      }
    },
    [viewportRef, viewRef, rotate, getNatural, onAddMarker, vpPoint, clearLongPressTimer],
  )

  // アンマウント時に必ずタイマーを解除する。
  useEffect(() => clearLongPressTimer, [clearLongPressTimer])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
  }
}
