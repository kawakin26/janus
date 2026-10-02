// パンくず純粋ロジック toBreadcrumbSegments のユニットテスト（タスク 13）。

import { describe, expect, it } from 'vitest'
import { toBreadcrumbSegments } from './breadcrumbs'

describe('toBreadcrumbSegments', () => {
  it('/ は空配列を返す', () => {
    expect(toBreadcrumbSegments('/')).toEqual([])
  })

  it('空文字は空配列を返す', () => {
    expect(toBreadcrumbSegments('')).toEqual([])
  })

  it('単一セグメントを累積パス付きで返す', () => {
    expect(toBreadcrumbSegments('/a')).toEqual([{ label: 'a', path: '/a' }])
  })

  it('複数セグメントを先頭から累積して返す', () => {
    expect(toBreadcrumbSegments('/a/b/c')).toEqual([
      { label: 'a', path: '/a' },
      { label: 'b', path: '/a/b' },
      { label: 'c', path: '/a/b/c' },
    ])
  })

  it('末尾スラッシュを無視する', () => {
    expect(toBreadcrumbSegments('/a/b/c/')).toEqual([
      { label: 'a', path: '/a' },
      { label: 'b', path: '/a/b' },
      { label: 'c', path: '/a/b/c' },
    ])
  })

  it('重複スラッシュを無視する', () => {
    expect(toBreadcrumbSegments('//a//b//')).toEqual([
      { label: 'a', path: '/a' },
      { label: 'b', path: '/a/b' },
    ])
  })
})
