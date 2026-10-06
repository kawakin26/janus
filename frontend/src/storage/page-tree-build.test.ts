import { describe, expect, it } from 'vitest'

import { buildPageTree } from './page-tree-build'
import type { PageTreeNode } from './types'

/** ツリー内の全ノードを再帰的にフラット化する。 */
function flattenTree(nodes: PageTreeNode[]): PageTreeNode[] {
  const result: PageTreeNode[] = []
  for (const node of nodes) {
    result.push(node)
    result.push(...flattenTree(node.children))
  }
  return result
}

describe('buildPageTree', () => {
  it('空配列 → 空配列', () => {
    expect(buildPageTree([])).toEqual([])
  })

  it('単一 /a — 実ページ', () => {
    const tree = buildPageTree([{ path: '/a', title: 'A' }])
    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('/a')
    expect(tree[0].title).toBe('A')
    expect(tree[0].hasPage).toBe(true)
    expect(tree[0].hasChildren).toBe(false)
    expect(tree[0].children).toEqual([])
  })

  it('ネスト /a + /a/b', () => {
    const tree = buildPageTree([
      { path: '/a', title: 'A' },
      { path: '/a/b', title: 'B' },
    ])
    expect(tree).toHaveLength(1)
    const a = tree[0]
    expect(a.hasPage).toBe(true)
    expect(a.hasChildren).toBe(true)
    expect(a.children).toHaveLength(1)

    const b = a.children[0]
    expect(b.path).toBe('/a/b')
    expect(b.hasPage).toBe(true)
    expect(b.hasChildren).toBe(false)
  })

  it('仮想ノード: /a/b/c のみ存在', () => {
    const tree = buildPageTree([{ path: '/a/b/c', title: 'C' }])
    expect(tree).toHaveLength(1)

    const a = tree[0]
    expect(a.path).toBe('/a')
    expect(a.hasPage).toBe(false)
    expect(a.title).toBe('a') // 末尾セグメント

    const b = a.children[0]
    expect(b.path).toBe('/a/b')
    expect(b.hasPage).toBe(false)
    expect(b.title).toBe('b')

    const c = b.children[0]
    expect(c.path).toBe('/a/b/c')
    expect(c.hasPage).toBe(true)
    expect(c.title).toBe('C')
  })

  it('空仮想ノード剪定: hasPage=false かつ children=[] のノードが出力に無い', () => {
    // /a のみ → 仮想 /a は実ページ子孫を持たない場合は剪定対象…
    // ただし /a は実ページなので残る。
    // 剪定を確認するには、実ページの中間に立つ仮想ノードが子を失った場合。
    // buildPageTree は入力に基づいてのみ構築するので、
    // 全ノードで hasPage=false && children.length===0 が 0 件であることを検証。
    const tree = buildPageTree([
      { path: '/a/b/c', title: 'C' },
      { path: '/x', title: 'X' },
    ])
    const all = flattenTree(tree)
    const emptyVirtual = all.filter((n) => !n.hasPage && n.children.length === 0)
    expect(emptyVirtual).toHaveLength(0)
  })

  it('hasChildren が全ノードで正しい', () => {
    const tree = buildPageTree([
      { path: '/a', title: 'A' },
      { path: '/a/b', title: 'B' },
      { path: '/c', title: 'C' },
    ])
    const all = flattenTree(tree)
    for (const node of all) {
      expect(node.hasChildren).toBe(node.children.length > 0)
    }
  })

  it('root 指定: root="/a" で /a 配下のみ対象', () => {
    const tree = buildPageTree(
      [
        { path: '/a/b', title: 'B' },
        { path: '/a/c', title: 'C' },
        { path: '/x', title: 'X' },
      ],
      '/a',
    )
    const all = flattenTree(tree)
    expect(all.every((n) => n.path.startsWith('/a/'))).toBe(true)
    expect(all.find((n) => n.path === '/x')).toBeUndefined()
  })

  it('同階層の children がパス昇順', () => {
    const tree = buildPageTree([
      { path: '/c', title: 'C' },
      { path: '/a', title: 'A' },
      { path: '/b', title: 'B' },
    ])
    expect(tree.map((n) => n.path)).toEqual(['/a', '/b', '/c'])
  })
})
