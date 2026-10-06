// ツリー構築 — 設計 §4.8 / サーバー PageTreeView と同形状。
//
// 純粋関数。権限枝刈り不要（ローカルは全権限許可）。

import type { PageTreeNode } from './types'

/**
 * フラットなページ一覧からネストされたツリーを構築する。
 *
 * 手順:
 * 1. root 配下のページを収集
 * 2. 各ページの中間パスを導出し、仮想ノードを補完
 * 3. 親子接続
 * 4. 空仮想ノードのボトムアップ剪定
 * 5. パス昇順整列、hasChildren 確定
 */
export function buildPageTree(
  pages: { path: string; title: string }[],
  root: string = '/',
): PageTreeNode[] {
  const prefix = root === '/' ? '/' : root + '/'

  // path → node の Map。重複パス対策として実ページが勝つ。
  const nodeMap = new Map<string, PageTreeNode>()

  // 対象ページを収集し、中間ノードを含めて Map に登録する。
  for (const page of pages) {
    if (!page.path.startsWith(prefix) && page.path !== root) continue

    // root 以下のセグメントを分解して各中間パスを登録する。
    const relative = root === '/' ? page.path : page.path.slice(root.length)
    const segments = relative.split('/').filter((s) => s !== '')

    let current = root === '/' ? '' : root
    for (let i = 0; i < segments.length; i++) {
      current = current + '/' + segments[i]
      const isLeaf = i === segments.length - 1

      if (!nodeMap.has(current)) {
        nodeMap.set(current, {
          path: current,
          title: isLeaf ? page.title : segments[i],
          hasPage: isLeaf,
          hasChildren: false,
          children: [],
        })
      } else if (isLeaf) {
        // 既に仮想ノードとして登録されている場合、実ページ情報で上書き。
        const existing = nodeMap.get(current)!
        existing.title = page.title
        existing.hasPage = true
      }
    }
  }

  // 親子接続: 各ノードの親パスを求めて children に追加する。
  const rootChildren: PageTreeNode[] = []
  const rootPath = root === '/' ? '' : root

  for (const node of nodeMap.values()) {
    const lastSlash = node.path.lastIndexOf('/')
    const parentPath = lastSlash === 0 ? '' : node.path.slice(0, lastSlash)

    if (parentPath === rootPath) {
      rootChildren.push(node)
    } else {
      const parent = nodeMap.get(parentPath)
      if (parent) {
        parent.children.push(node)
      }
    }
  }

  // 空仮想ノードのボトムアップ剪定。
  function prune(nodes: PageTreeNode[]): PageTreeNode[] {
    return nodes.filter((node) => {
      node.children = prune(node.children)
      // hasPage=false かつ子なし → 除去
      if (!node.hasPage && node.children.length === 0) return false
      return true
    })
  }

  const pruned = prune(rootChildren)

  // パス昇順整列 + hasChildren 確定。
  function sortAndFinalize(nodes: PageTreeNode[]): void {
    nodes.sort((a, b) => a.path.localeCompare(b.path))
    for (const node of nodes) {
      sortAndFinalize(node.children)
      node.hasChildren = node.children.length > 0
    }
  }

  sortAndFinalize(pruned)
  return pruned
}
