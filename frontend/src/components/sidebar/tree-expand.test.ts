// @vitest-environment jsdom
// tree-expand ヘルパの単体テスト。localStorage を使うため jsdom 環境。

import { afterEach, describe, expect, it } from 'vitest'

import type { PageTreeNode } from '../../storage/types'
import {
  SIDEBAR_EXPANDED_KEY,
  ancestorPaths,
  expandablePaths,
  readExpanded,
  writeExpanded,
} from './tree-expand'

afterEach(() => {
  window.localStorage.clear()
})

describe('ancestorPaths', () => {
  it('空文字は [] を返す', () => {
    expect(ancestorPaths('')).toEqual([])
  })

  it('1 セグメントは [] を返す（自身は含めない）', () => {
    expect(ancestorPaths('/blog')).toEqual([])
  })

  it('深いパスの祖先を近い順に返す', () => {
    expect(ancestorPaths('/docs/intro/deep')).toEqual(['/docs', '/docs/intro'])
  })
})

describe('expandablePaths', () => {
  const tree: PageTreeNode[] = [
    { path: '/blog', title: '/blog', hasPage: true, hasChildren: false, children: [] },
    {
      path: '/docs',
      title: 'docs',
      hasPage: false,
      hasChildren: true,
      children: [
        { path: '/docs/guide', title: 'Guide', hasPage: true, hasChildren: false, children: [] },
        {
          path: '/docs/intro',
          title: 'Intro',
          hasPage: true,
          hasChildren: true,
          children: [
            { path: '/docs/intro/deep', title: 'Deep', hasPage: true, hasChildren: false, children: [] },
          ],
        },
      ],
    },
  ]

  it('hasChildren=true のノードのみを再帰収集する（葉は除外）', () => {
    expect(expandablePaths(tree)).toEqual(['/docs', '/docs/intro'])
  })

  it('空ツリーは [] を返す', () => {
    expect(expandablePaths([])).toEqual([])
  })
})

describe('readExpanded / writeExpanded', () => {
  it('書込→読出で往復する', () => {
    writeExpanded(['/docs', '/docs/intro'])
    expect(readExpanded()).toEqual(['/docs', '/docs/intro'])
  })

  it('未設定時は [] を返す', () => {
    expect(readExpanded()).toEqual([])
  })

  it('不正 JSON は [] を返す', () => {
    window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, '{not json')
    expect(readExpanded()).toEqual([])
  })

  it('非配列は [] を返す', () => {
    window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, JSON.stringify({ a: 1 }))
    expect(readExpanded()).toEqual([])
  })

  it('非文字列要素はフィルタする', () => {
    window.localStorage.setItem(
      SIDEBAR_EXPANDED_KEY,
      JSON.stringify(['/docs', 1, null, '/blog']),
    )
    expect(readExpanded()).toEqual(['/docs', '/blog'])
  })
})
