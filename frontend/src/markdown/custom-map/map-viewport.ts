// マップビューアのパン/ズーム/回転の純粋ロジック（設計 §3.2 / FEAT-001）。
//
// 出典: GROWI プラグイン growi-plugin-custom-map v0.3.1 の src/viewer.ts と、
// 本リポジトリ CustomMapViewer.tsx（MapModal 内）が実質同一で持っていた座標・変換計算を、
// DOM 非依存の純粋関数・定数として一箇所に集約したもの（B 案＝ロジック共有）。
// 閲覧側 CustomMapViewer と編集側 MapEditorModal が共有する。
// DOM 参照・副作用（style.transform 代入 / setPointerCapture 等）は一切持たない。
// 記法仕様・既存の数式は不変。

import { clamp } from './map-utils'

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** ビュー状態（平行移動と拡大率）。回転角は RotateContext で別途渡す。 */
export interface ViewState {
  scale: number
  tx: number
  ty: number
}

/**
 * 回転角(deg)を 0/90/180/270 前提で扱うためのコンテキスト。
 * rotate は map-utils.normalizeRotate 済みの値を渡す（§3.2 不変条件）。
 */
export interface RotateContext {
  rotate: number
}

/** ピンチ開始時に凍結する基準値。 */
export interface PinchStart {
  startDist: number
  startScale: number
  startTx: number
  startTy: number
  /** viewport ローカルのピンチ中心 x。 */
  cx: number
  /** viewport ローカルのピンチ中心 y。 */
  cy: number
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

// scale の下限・上限。閲覧側 CustomMapViewer の現行値 0.02〜40 を維持して回帰を防ぐ。
// 編集側も同じ定数を使う（editor.ts の下限 0.05 → 0.02 へ広がる意図的差分・設計 §3.2 / §12.1）。
export const VIEW_SCALE_MIN = 0.02
export const VIEW_SCALE_MAX = 40

// 長押し/クリック判定の移動しきい値（px）。編集側で共有する（設計 §4.1）。
export const MOVE_THRESHOLD = 5

// ---------------------------------------------------------------------------
// 座標変換
// ---------------------------------------------------------------------------

/**
 * 元画像座標(px,py)を rotate + scale した後の相対オフセットを返す。
 * transform は translate(tx,ty) rotate(rot) scale(s) の順で適用される前提。
 */
export function rotScale(px: number, py: number, s: number, ctx: RotateContext): { x: number; y: number } {
  const rad = (ctx.rotate * Math.PI) / 180
  const cosR = Math.cos(rad)
  const sinR = Math.sin(rad)
  const sx = px * s
  const sy = py * s
  return { x: sx * cosR - sy * sinR, y: sx * sinR + sy * cosR }
}

/**
 * stage 要素に適用する transform 文字列。
 * → `translate(${tx}px, ${ty}px) rotate(${rotate}deg) scale(${scale})`
 */
export function stageTransform(view: ViewState, ctx: RotateContext): string {
  return `translate(${view.tx}px, ${view.ty}px) rotate(${ctx.rotate}deg) scale(${view.scale})`
}

/**
 * マーカー内側要素に適用する transform 文字列。
 * 回転・スケールを打ち消して常に正立・一定サイズにする。
 * → `translate(-50%, -50%) rotate(${-rotate}deg) scale(${scale ? 1/scale : 1})`
 */
export function markerInnerTransform(scale: number, ctx: RotateContext): string {
  const inv = scale ? 1 / scale : 1
  return `translate(-50%, -50%) rotate(${-ctx.rotate}deg) scale(${inv})`
}

// ---------------------------------------------------------------------------
// フィット計算
// ---------------------------------------------------------------------------

/**
 * 画像自然サイズと viewport サイズから、フィットさせる scale と中心合わせ tx/ty を計算する。
 * mapScale は mapData.scale（既定 1）、cx/cy は中心%（0..100）。
 *
 * ゼロ viewport / ゼロ natural ガード（閲覧側 CustomMapViewer.handleImageLoad と同一の二段ガード）:
 *  - 90/270 度回転では見かけの幅・高さが入れ替わる（swap）。
 *  - dispW または dispH が 0 のとき {scale:1,tx:0,ty:0} を早期 return。
 *  - fitScale が 0/NaN のとき (fitScale || 1) で 1 にフォールバック。
 */
export function computeFitView(args: {
  naturalW: number
  naturalH: number
  viewportW: number
  viewportH: number
  mapScale: number
  cx: number
  cy: number
  ctx: RotateContext
}): ViewState {
  const { naturalW, naturalH, viewportW, viewportH, mapScale, cx, cy, ctx } = args

  const swap = ctx.rotate === 90 || ctx.rotate === 270
  const dispW = swap ? naturalH : naturalW
  const dispH = swap ? naturalW : naturalH

  // 表示幅/高が 0 のときは安全値（scale=1）を返す。
  if (!dispW || !dispH) return { scale: 1, tx: 0, ty: 0 }

  const fitScale = Math.min(viewportW / dispW, viewportH / dispH)
  const baseScale = (fitScale || 1) * (mapScale || 1)

  const centerX = (cx / 100) * naturalW
  const centerY = (cy / 100) * naturalH
  const off = rotScale(centerX, centerY, baseScale, ctx)
  return {
    scale: baseScale,
    tx: viewportW / 2 - off.x,
    ty: viewportH / 2 - off.y,
  }
}

/**
 * クリック点(viewport ローカル)→元画像基準の%(0..100 クランプ)。
 * 回転打ち消し＋scale 除算の逆変換。naturalW/H が 0 のときは {x:0,y:0} を返す（ゼロ除算回避）。
 */
export function viewportToPercent(args: {
  vx: number
  vy: number
  view: ViewState
  naturalW: number
  naturalH: number
  ctx: RotateContext
}): { x: number; y: number } {
  const { vx, vy, view, naturalW, naturalH, ctx } = args
  if (!naturalW || !naturalH) return { x: 0, y: 0 }

  const scale = view.scale || 1
  // stage は translate(tx,ty) rotate(rot) scale(s) の順。平行移動とスケールを戻す。
  const dx = (vx - view.tx) / scale
  const dy = (vy - view.ty) / scale

  // 回転を打ち消す（rotScale の逆回転）。
  const rad = (ctx.rotate * Math.PI) / 180
  const cosR = Math.cos(rad)
  const sinR = Math.sin(rad)
  const px = dx * cosR + dy * sinR
  const py = -dx * sinR + dy * cosR

  return {
    x: clamp((px / naturalW) * 100, 0, 100),
    y: clamp((py / naturalH) * 100, 0, 100),
  }
}

// ---------------------------------------------------------------------------
// ズーム / パン
// ---------------------------------------------------------------------------

/**
 * 固定点(px,py: viewport ローカル)を保ったままの拡大。ホイール/ピンチ共通。
 * scale は VIEW_SCALE_MIN/MAX でクランプする。
 */
export function zoomAround(view: ViewState, px: number, py: number, factor: number): ViewState {
  const newScale = clamp(view.scale * factor, VIEW_SCALE_MIN, VIEW_SCALE_MAX)
  const ratio = newScale / view.scale
  return {
    scale: newScale,
    tx: px - (px - view.tx) * ratio,
    ty: py - (py - view.ty) * ratio,
  }
}

/**
 * ピンチの現在 2 点(a,b)から新しい ViewState を計算する（PinchStart を基準）。
 * ピンチ中心(cx,cy)を固定点とし、scale は VIEW_SCALE_MIN/MAX でクランプする。
 */
export function pinchView(start: PinchStart, aX: number, aY: number, bX: number, bY: number): ViewState {
  const dist = Math.hypot(aX - bX, aY - bY) || 1
  const factor = dist / start.startDist
  const newScale = clamp(start.startScale * factor, VIEW_SCALE_MIN, VIEW_SCALE_MAX)
  const ratio = newScale / start.startScale
  return {
    scale: newScale,
    tx: start.cx - (start.cx - start.startTx) * ratio,
    ty: start.cy - (start.cy - start.startTy) * ratio,
  }
}

/** パンの新 tx/ty。scale は不変で平行移動量 dx/dy を加える。 */
export function panView(startTx: number, startTy: number, dx: number, dy: number, scale: number): ViewState {
  return { scale, tx: startTx + dx, ty: startTy + dy }
}
