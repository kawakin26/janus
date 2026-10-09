// map-viewport.ts の純粋関数テスト（設計 §10.1 / FEAT-001）。
// DOM 非依存の純粋計算なので特別な環境は不要（mode.test.ts と同じ Vitest ハーネス）。

import { describe, expect, it } from 'vitest'
import {
  MOVE_THRESHOLD,
  VIEW_SCALE_MAX,
  VIEW_SCALE_MIN,
  computeFitView,
  markerInnerTransform,
  panView,
  pinchView,
  rotScale,
  stageTransform,
  viewportToPercent,
  zoomAround,
} from './map-viewport'
import type { PinchStart, ViewState } from './map-viewport'

// 浮動小数の比較ヘルパ。
function expectClose(actual: number, expected: number, precision = 6): void {
  expect(actual).toBeCloseTo(expected, precision)
}

describe('定数', () => {
  it('VIEW_SCALE_MIN/MAX と MOVE_THRESHOLD が設計値である', () => {
    expect(VIEW_SCALE_MIN).toBe(0.02)
    expect(VIEW_SCALE_MAX).toBe(40)
    expect(MOVE_THRESHOLD).toBe(5)
  })
})

describe('rotScale', () => {
  it('rotate 0 は scale 倍のみ（回転なし）', () => {
    const r = rotScale(10, 20, 2, { rotate: 0 })
    expectClose(r.x, 20)
    expectClose(r.y, 40)
  })

  it('rotate 90 は (x,y)→(-y,x)*s', () => {
    const r = rotScale(10, 20, 1, { rotate: 90 })
    expectClose(r.x, -20)
    expectClose(r.y, 10)
  })

  it('rotate 180 は符号反転*s', () => {
    const r = rotScale(10, 20, 1, { rotate: 180 })
    expectClose(r.x, -10)
    expectClose(r.y, -20)
  })

  it('rotate 270 は (x,y)→(y,-x)*s', () => {
    const r = rotScale(10, 20, 1, { rotate: 270 })
    expectClose(r.x, 20)
    expectClose(r.y, -10)
  })
})

describe('computeFitView', () => {
  it('横長画像を viewport にフィットし中心(50,50)を viewport 中央へ合わせる（rotate 0）', () => {
    // 画像 400x200、viewport 200x200、mapScale 1。
    // fitScale = min(200/400, 200/200) = 0.5。中心 (200,100)*0.5 = (100,50)。
    const v = computeFitView({
      naturalW: 400,
      naturalH: 200,
      viewportW: 200,
      viewportH: 200,
      mapScale: 1,
      cx: 50,
      cy: 50,
      ctx: { rotate: 0 },
    })
    expectClose(v.scale, 0.5)
    expectClose(v.tx, 100 - 100) // vpW/2 - off.x = 100 - 100
    expectClose(v.ty, 100 - 50) // vpH/2 - off.y = 100 - 50
  })

  it('縦長画像でも高さ基準でフィットする（rotate 0）', () => {
    // 画像 200x400、viewport 200x200。fitScale = min(200/200, 200/400) = 0.5。
    const v = computeFitView({
      naturalW: 200,
      naturalH: 400,
      viewportW: 200,
      viewportH: 200,
      mapScale: 1,
      cx: 50,
      cy: 50,
      ctx: { rotate: 0 },
    })
    expectClose(v.scale, 0.5)
  })

  it('90 度回転では見かけの幅高が入れ替わる', () => {
    // 画像 400x200、rotate 90 → dispW=200, dispH=400。
    // fitScale = min(200/200, 200/400) = 0.5。
    const v = computeFitView({
      naturalW: 400,
      naturalH: 200,
      viewportW: 200,
      viewportH: 200,
      mapScale: 1,
      cx: 50,
      cy: 50,
      ctx: { rotate: 90 },
    })
    expectClose(v.scale, 0.5)
  })

  it('270 度回転も 90 と同じく幅高入れ替えでフィットする', () => {
    const v90 = computeFitView({
      naturalW: 400,
      naturalH: 200,
      viewportW: 200,
      viewportH: 200,
      mapScale: 1,
      cx: 50,
      cy: 50,
      ctx: { rotate: 90 },
    })
    const v270 = computeFitView({
      naturalW: 400,
      naturalH: 200,
      viewportW: 200,
      viewportH: 200,
      mapScale: 1,
      cx: 50,
      cy: 50,
      ctx: { rotate: 270 },
    })
    expectClose(v270.scale, v90.scale)
  })

  it('mapScale を baseScale に乗じる', () => {
    const v = computeFitView({
      naturalW: 400,
      naturalH: 200,
      viewportW: 200,
      viewportH: 200,
      mapScale: 2,
      cx: 50,
      cy: 50,
      ctx: { rotate: 0 },
    })
    // fitScale 0.5 * mapScale 2 = 1。
    expectClose(v.scale, 1)
  })

  it('中心合わせ: 選んだ cx/cy が viewport 中央に来る tx/ty を返す', () => {
    const naturalW = 400
    const naturalH = 200
    const viewportW = 200
    const viewportH = 200
    const cx = 25
    const cy = 75
    const ctx = { rotate: 0 }
    const v = computeFitView({ naturalW, naturalH, viewportW, viewportH, mapScale: 1, cx, cy, ctx })
    // 中心点をフォワード変換すると viewport 中央になるはず。
    const centerX = (cx / 100) * naturalW
    const centerY = (cy / 100) * naturalH
    const off = rotScale(centerX, centerY, v.scale, ctx)
    expectClose(v.tx + off.x, viewportW / 2)
    expectClose(v.ty + off.y, viewportH / 2)
  })

  it('viewport サイズ 0 では安全値 scale=1 / tx=ty=0 を返す', () => {
    const v = computeFitView({
      naturalW: 400,
      naturalH: 200,
      viewportW: 0,
      viewportH: 0,
      mapScale: 1,
      cx: 50,
      cy: 50,
      ctx: { rotate: 0 },
    })
    // dispW/dispH は非 0 だが fitScale=0 → (fitScale||1)=1。
    expectClose(v.scale, 1)
  })

  it('画像 natural サイズ 0 では安全値 scale=1 / tx=ty=0 を早期 return する', () => {
    const v = computeFitView({
      naturalW: 0,
      naturalH: 0,
      viewportW: 200,
      viewportH: 200,
      mapScale: 1,
      cx: 50,
      cy: 50,
      ctx: { rotate: 0 },
    })
    expect(v).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
})

describe('viewportToPercent', () => {
  it('rotate 0 で rotScale と往復整合する', () => {
    const naturalW = 400
    const naturalH = 200
    const ctx = { rotate: 0 }
    const view: ViewState = { scale: 0.5, tx: 30, ty: 40 }
    // 画像内の既知点 (100,50) %=(25,25) をフォワード変換して viewport 点を作る。
    const px = (25 / 100) * naturalW // 100
    const py = (25 / 100) * naturalH // 50
    const off = rotScale(px, py, view.scale, ctx)
    const vx = view.tx + off.x
    const vy = view.ty + off.y
    const pct = viewportToPercent({ vx, vy, view, naturalW, naturalH, ctx })
    expectClose(pct.x, 25)
    expectClose(pct.y, 25)
  })

  it('rotate 90 で rotScale と往復整合する', () => {
    const naturalW = 400
    const naturalH = 200
    const ctx = { rotate: 90 }
    const view: ViewState = { scale: 0.75, tx: -10, ty: 60 }
    const px = (40 / 100) * naturalW // 160
    const py = (60 / 100) * naturalH // 120
    const off = rotScale(px, py, view.scale, ctx)
    const vx = view.tx + off.x
    const vy = view.ty + off.y
    const pct = viewportToPercent({ vx, vy, view, naturalW, naturalH, ctx })
    expectClose(pct.x, 40)
    expectClose(pct.y, 60)
  })

  it('0..100 にクランプする', () => {
    const pct = viewportToPercent({
      vx: 100000,
      vy: -100000,
      view: { scale: 1, tx: 0, ty: 0 },
      naturalW: 400,
      naturalH: 200,
      ctx: { rotate: 0 },
    })
    expect(pct.x).toBe(100)
    expect(pct.y).toBe(0)
  })

  it('natural サイズ 0 では {0,0} を返す', () => {
    const pct = viewportToPercent({
      vx: 10,
      vy: 20,
      view: { scale: 1, tx: 0, ty: 0 },
      naturalW: 0,
      naturalH: 0,
      ctx: { rotate: 0 },
    })
    expect(pct).toEqual({ x: 0, y: 0 })
  })
})

describe('zoomAround', () => {
  it('固定点を保ったまま拡大する（固定点の画像位置が動かない）', () => {
    const view: ViewState = { scale: 1, tx: 0, ty: 0 }
    const px = 50
    const py = 60
    const next = zoomAround(view, px, py, 2)
    expectClose(next.scale, 2)
    // 固定点が指す「画像上の点」が変換後も同じ viewport 位置に来る。
    // (px - tx)/scale は固定点のステージ座標。拡大前後で一致するはず。
    expectClose((px - view.tx) / view.scale, (px - next.tx) / next.scale)
    expectClose((py - view.ty) / view.scale, (py - next.ty) / next.scale)
  })

  it('下限 VIEW_SCALE_MIN でクランプする', () => {
    const next = zoomAround({ scale: VIEW_SCALE_MIN, tx: 0, ty: 0 }, 0, 0, 0.1)
    expect(next.scale).toBe(VIEW_SCALE_MIN)
  })

  it('上限 VIEW_SCALE_MAX でクランプする', () => {
    const next = zoomAround({ scale: VIEW_SCALE_MAX, tx: 0, ty: 0 }, 0, 0, 10)
    expect(next.scale).toBe(VIEW_SCALE_MAX)
  })
})

describe('pinchView', () => {
  const start: PinchStart = {
    startDist: 100,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    cx: 50,
    cy: 50,
  }

  it('2 点間距離の比率で scale が変わる', () => {
    // 新しい距離 200 → factor 2。
    const next = pinchView(start, 0, 0, 200, 0)
    expectClose(next.scale, 2)
  })

  it('ピンチ中心を固定点として tx/ty を更新する', () => {
    const next = pinchView(start, 0, 0, 200, 0)
    const ratio = next.scale / start.startScale
    expectClose(next.tx, start.cx - (start.cx - start.startTx) * ratio)
    expectClose(next.ty, start.cy - (start.cy - start.startTy) * ratio)
  })

  it('scale は VIEW_SCALE_MIN/MAX でクランプする', () => {
    const shrink = pinchView(start, 0, 0, 1, 0) // 距離≈1 → 極小 factor
    expect(shrink.scale).toBe(VIEW_SCALE_MIN)
    const grow = pinchView({ ...start, startScale: 10 }, 0, 0, 100000, 0)
    expect(grow.scale).toBe(VIEW_SCALE_MAX)
  })
})

describe('panView', () => {
  it('scale 不変で tx/ty に dx/dy を加える', () => {
    const next = panView(10, 20, 5, -7, 1.5)
    expect(next).toEqual({ scale: 1.5, tx: 15, ty: 13 })
  })
})

describe('stageTransform / markerInnerTransform', () => {
  it('stageTransform は translate→rotate→scale の順で文字列化する', () => {
    const s = stageTransform({ scale: 2, tx: 10, ty: 20 }, { rotate: 90 })
    expect(s).toBe('translate(10px, 20px) rotate(90deg) scale(2)')
  })

  it('markerInnerTransform は逆回転・逆スケールを文字列化する', () => {
    const s = markerInnerTransform(2, { rotate: 90 })
    expect(s).toBe('translate(-50%, -50%) rotate(-90deg) scale(0.5)')
  })

  it('scale=0 のとき逆スケールは 1 にフォールバックする', () => {
    // rotate 0 では -rotate が -0 だが文字列化で "0" になる（既存 CustomMapViewer と同一挙動）。
    const s = markerInnerTransform(0, { rotate: 0 })
    expect(s).toBe('translate(-50%, -50%) rotate(0deg) scale(1)')
  })
})
