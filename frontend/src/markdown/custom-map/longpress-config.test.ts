// @vitest-environment jsdom
// longpress-config.ts のテスト（design.md §10.2）。
// window.localStorage と import.meta.env に依存するため jsdom 環境で実行する。
// round-trip / 不正値→下限 500 への切り上げ or フォールバック / 未設定時の既定 /
// env モック / localStorage 例外の握りつぶし / 優先順位 user > env > 500 を網羅する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LONGPRESS_MS_HARDCODED_DEFAULT,
  LONGPRESS_MS_KEY,
  LONGPRESS_MS_MIN,
  clearUserLongPressMs,
  readEnvDefaultMs,
  readUserLongPressMs,
  resolveDefaultMs,
  resolveLongPressMs,
  writeUserLongPressMs,
} from './longpress-config'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('longpress-config 定数', () => {
  it('キー・下限・既定が設計どおり', () => {
    expect(LONGPRESS_MS_KEY).toBe('janus-map-longpress-ms')
    expect(LONGPRESS_MS_MIN).toBe(500)
    expect(LONGPRESS_MS_HARDCODED_DEFAULT).toBe(500)
  })
})

describe('writeUserLongPressMs / readUserLongPressMs', () => {
  it('正常値を round-trip する', () => {
    writeUserLongPressMs(800)
    expect(localStorage.getItem(LONGPRESS_MS_KEY)).toBe('800')
    expect(readUserLongPressMs()).toBe(800)
  })

  it('保存前に 500 未満は 500 へ切り上げる', () => {
    writeUserLongPressMs(300)
    expect(localStorage.getItem(LONGPRESS_MS_KEY)).toBe('500')
    expect(readUserLongPressMs()).toBe(500)
  })

  it('未設定時は null を返す', () => {
    expect(readUserLongPressMs()).toBeNull()
  })

  it('非数の保存値は null に正規化する', () => {
    localStorage.setItem(LONGPRESS_MS_KEY, 'abc')
    expect(readUserLongPressMs()).toBeNull()
  })

  it('0 の保存値は null に正規化する', () => {
    localStorage.setItem(LONGPRESS_MS_KEY, '0')
    expect(readUserLongPressMs()).toBeNull()
  })

  it('負値の保存値は null に正規化する', () => {
    localStorage.setItem(LONGPRESS_MS_KEY, '-100')
    expect(readUserLongPressMs()).toBeNull()
  })

  it('Infinity の保存値は null に正規化する', () => {
    localStorage.setItem(LONGPRESS_MS_KEY, 'Infinity')
    expect(readUserLongPressMs()).toBeNull()
  })

  it('clearUserLongPressMs で削除する', () => {
    writeUserLongPressMs(700)
    clearUserLongPressMs()
    expect(localStorage.getItem(LONGPRESS_MS_KEY)).toBeNull()
    expect(readUserLongPressMs()).toBeNull()
  })
})

describe('readEnvDefaultMs', () => {
  it('未設定なら null', () => {
    expect(readEnvDefaultMs()).toBeNull()
  })

  it('有限かつ正の数値文字列を採用する', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '800')
    expect(readEnvDefaultMs()).toBe(800)
  })

  it('非数は null', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', 'abc')
    expect(readEnvDefaultMs()).toBeNull()
  })

  it('0 以下は null', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '0')
    expect(readEnvDefaultMs()).toBeNull()
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '-50')
    expect(readEnvDefaultMs()).toBeNull()
  })
})

describe('resolveDefaultMs', () => {
  it('env 未設定なら 500', () => {
    expect(resolveDefaultMs()).toBe(500)
  })

  it('env 既定があればそれを採用（下限 500 以上）', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '800')
    expect(resolveDefaultMs()).toBe(800)
  })

  it('env 既定が 500 未満でも 500 へ切り上げる', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '300')
    expect(resolveDefaultMs()).toBe(500)
  })
})

describe('resolveLongPressMs 優先順位 user > env > 500', () => {
  it('ユーザー設定も env も無ければ 500', () => {
    expect(resolveLongPressMs()).toBe(500)
  })

  it('env 既定のみあれば env を採用（下限 500）', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '800')
    expect(resolveLongPressMs()).toBe(800)
  })

  it('env 既定が 500 未満でも最終的に 500', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '200')
    expect(resolveLongPressMs()).toBe(500)
  })

  it('ユーザー設定があれば env より優先する', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '800')
    writeUserLongPressMs(1000)
    expect(resolveLongPressMs()).toBe(1000)
  })

  it('ユーザーが 300ms を設定しても 500 へ切り上がり env より優先される', () => {
    vi.stubEnv('VITE_MAP_LONGPRESS_MS', '800')
    writeUserLongPressMs(300)
    // 保存時に 500 へ切り上げ済み・user が env(800) より優先。
    expect(readUserLongPressMs()).toBe(500)
    expect(resolveLongPressMs()).toBe(500)
  })

  it('末尾 max: 保存値が直接 500 未満に書き換えられても最終的に 500', () => {
    localStorage.setItem(LONGPRESS_MS_KEY, '100')
    expect(readUserLongPressMs()).toBe(100)
    expect(resolveLongPressMs()).toBe(500)
  })
})

describe('localStorage 例外の握りつぶし', () => {
  it('readUserLongPressMs は getItem 例外時に null を返す', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('getItem failed')
    })
    expect(readUserLongPressMs()).toBeNull()
  })

  it('writeUserLongPressMs は setItem 例外時に throw しない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('setItem failed')
    })
    expect(() => writeUserLongPressMs(800)).not.toThrow()
  })

  it('clearUserLongPressMs は removeItem 例外時に throw しない', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('removeItem failed')
    })
    expect(() => clearUserLongPressMs()).not.toThrow()
  })

  it('resolveLongPressMs は getItem 例外時でも既定へフォールバックする', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('getItem failed')
    })
    expect(resolveLongPressMs()).toBe(500)
  })
})
