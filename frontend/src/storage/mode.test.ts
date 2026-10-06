// @vitest-environment jsdom
// mode.ts のテスト。mode.ts は window.localStorage を使うため jsdom 環境で実行する。
// 正常値の round-trip / 不正値 / 未設定 / localStorage 例外時の握りつぶしを網羅する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODE_KEY, clearMode, readMode, writeMode } from './mode'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mode.ts', () => {
  it("writeMode→readMode が 'local' を round-trip する", () => {
    writeMode('local')
    expect(localStorage.getItem(MODE_KEY)).toBe('local')
    expect(readMode()).toBe('local')
  })

  it("writeMode→readMode が 'server' を round-trip する", () => {
    writeMode('server')
    expect(localStorage.getItem(MODE_KEY)).toBe('server')
    expect(readMode()).toBe('server')
  })

  it('未設定時は null を返す', () => {
    expect(readMode()).toBeNull()
  })

  it('不正値（許可リスト外）は null に正規化する', () => {
    localStorage.setItem(MODE_KEY, 'xxx')
    expect(readMode()).toBeNull()
  })

  it('clearMode でモードを削除する', () => {
    writeMode('local')
    clearMode()
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
    expect(readMode()).toBeNull()
  })

  it('readMode は getItem 例外時に null を返す', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('getItem failed')
    })
    expect(readMode()).toBeNull()
  })

  it('writeMode は setItem 例外時に throw しない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('setItem failed')
    })
    expect(() => writeMode('local')).not.toThrow()
  })

  it('clearMode は removeItem 例外時に throw しない', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('removeItem failed')
    })
    expect(() => clearMode()).not.toThrow()
  })
})
