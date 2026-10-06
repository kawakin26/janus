// currentPagePath の単体テスト（純粋関数のため jsdom 環境は不要）。

import { describe, expect, it } from 'vitest'

import { currentPagePath } from './current-path'

describe('currentPagePath', () => {
  it('各ルートプレフィックスを剥がして path を復元する', () => {
    expect(currentPagePath('/view/docs/intro')).toBe('/docs/intro')
    expect(currentPagePath('/edit/docs/intro')).toBe('/docs/intro')
    expect(currentPagePath('/history/docs/intro')).toBe('/docs/intro')
    expect(currentPagePath('/permissions/docs/intro')).toBe('/docs/intro')
  })

  it('空 splat（/view/）はルートページ "/" を返す', () => {
    expect(currentPagePath('/view/')).toBe('/')
  })

  it('多重スラッシュを畳む', () => {
    expect(currentPagePath('/view//docs')).toBe('/docs')
  })

  it('プレフィックス非該当は null を返す', () => {
    expect(currentPagePath('/')).toBeNull()
    expect(currentPagePath('/assets')).toBeNull()
    expect(currentPagePath('/login')).toBeNull()
    expect(currentPagePath('/viewer/docs')).toBeNull()
  })
})
