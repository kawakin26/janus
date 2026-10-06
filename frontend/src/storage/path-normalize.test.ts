import { describe, expect, it } from 'vitest'

import { normalizePath } from './path-normalize'

describe('normalizePath', () => {
  it('多重スラッシュを正規化する', () => {
    expect(normalizePath('/docs//intro')).toBe('/docs/intro')
    expect(normalizePath('///')).toBe('/')
  })

  it('"." を除去する', () => {
    expect(normalizePath('/docs/./intro')).toBe('/docs/intro')
    expect(normalizePath('.')).toBe('/')
  })

  it('".." を遡上せず除去する', () => {
    expect(normalizePath('/docs/../intro')).toBe('/docs/intro')
    expect(normalizePath('..')).toBe('/')
  })

  it('ルートをそのまま返す', () => {
    expect(normalizePath('/')).toBe('/')
  })

  it('末尾スラッシュを除去する', () => {
    expect(normalizePath('/docs/intro/')).toBe('/docs/intro')
  })

  it('空文字を "/" に正規化する', () => {
    expect(normalizePath('')).toBe('/')
  })

  it('先頭スラッシュ抜けを補う', () => {
    expect(normalizePath('docs/intro')).toBe('/docs/intro')
  })

  it('前後空白を除去する', () => {
    expect(normalizePath('  /docs  ')).toBe('/docs')
  })

  it('セグメント内の空白を除去する', () => {
    expect(normalizePath('/ docs /intro')).toBe('/docs/intro')
  })
})
