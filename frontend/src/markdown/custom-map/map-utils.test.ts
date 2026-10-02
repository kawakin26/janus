// 純ユーティリティのユニットテスト（タスク 11 / 要件 3-1, 3-2）。

import { describe, expect, it } from 'vitest'
import {
  LABEL_SIZE_MAX,
  LABEL_SIZE_MIN,
  PIN_SIZE_MAX,
  PIN_SIZE_MIN,
  clamp,
  isCadFile,
  normalizeForSearch,
  normalizeRotate,
  textColorForBg,
  toNumber,
} from './map-utils'

describe('toNumber', () => {
  it('数値文字列を数値へ変換する', () => {
    expect(toNumber('42', 0)).toBe(42)
    expect(toNumber('3.14', 0)).toBeCloseTo(3.14)
  })
  it('空/null/非数は fallback を返す', () => {
    expect(toNumber('', 7)).toBe(7)
    expect(toNumber(null, 7)).toBe(7)
    expect(toNumber(undefined, 7)).toBe(7)
    expect(toNumber('abc', 7)).toBe(7)
  })
})

describe('clamp', () => {
  it('範囲内はそのまま、範囲外は端へ丸める', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
  it('ピン/ラベルの範囲でクランプできる', () => {
    expect(clamp(1, PIN_SIZE_MIN, PIN_SIZE_MAX)).toBe(PIN_SIZE_MIN)
    expect(clamp(999, PIN_SIZE_MIN, PIN_SIZE_MAX)).toBe(PIN_SIZE_MAX)
    expect(clamp(999, LABEL_SIZE_MIN, LABEL_SIZE_MAX)).toBe(LABEL_SIZE_MAX)
  })
})

describe('normalizeRotate', () => {
  it('0/90/180/270 に正規化する', () => {
    expect(normalizeRotate(0)).toBe(0)
    expect(normalizeRotate(90)).toBe(90)
    expect(normalizeRotate(180)).toBe(180)
    expect(normalizeRotate(270)).toBe(270)
  })
  it('負値・360 超・端数を丸める', () => {
    expect(normalizeRotate(-90)).toBe(270)
    expect(normalizeRotate(360)).toBe(0)
    expect(normalizeRotate(450)).toBe(90)
    expect(normalizeRotate(44)).toBe(0)
    expect(normalizeRotate(46)).toBe(90)
  })
})

describe('textColorForBg', () => {
  it('明るい背景には黒を返す', () => {
    expect(textColorForBg('#ffffff')).toBe('#000000')
    expect(textColorForBg('#ffff00')).toBe('#000000')
  })
  it('暗い背景には白を返す', () => {
    expect(textColorForBg('#000000')).toBe('#ffffff')
    expect(textColorForBg('#ff3b30')).toBe('#ffffff')
  })
  it('#rgb 短縮・rgb() も解釈する', () => {
    expect(textColorForBg('#fff')).toBe('#000000')
    expect(textColorForBg('rgb(255,255,255)')).toBe('#000000')
    expect(textColorForBg('rgba(0,0,0,0.5)')).toBe('#ffffff')
  })
  it('解釈できない値は白を返す', () => {
    expect(textColorForBg('')).toBe('#ffffff')
    expect(textColorForBg('not-a-color')).toBe('#ffffff')
  })
})

describe('isCadFile', () => {
  it('.dxf / .jww を CAD と判定する（大小無視）', () => {
    expect(isCadFile('plan.dxf')).toBe(true)
    expect(isCadFile('PLAN.DXF')).toBe(true)
    expect(isCadFile('drawing.jww')).toBe(true)
  })
  it('画像や空は CAD でない', () => {
    expect(isCadFile('map.png')).toBe(false)
    expect(isCadFile('map.jpg')).toBe(false)
    expect(isCadFile('')).toBe(false)
  })
})

describe('normalizeForSearch', () => {
  it('全角英数字を半角化し小文字へ揃える', () => {
    expect(normalizeForSearch('ＡＢＣ')).toBe('abc')
    expect(normalizeForSearch('Abc')).toBe('abc')
  })
  it('空文字はそのまま空', () => {
    expect(normalizeForSearch('')).toBe('')
  })
})
