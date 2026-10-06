// 展開集合の導出・localStorage 入出力ヘルパ（design §3.6/§3.7）。
// localStorage の防御運用は theme-core.ts に倣う（キー定数・try/catch・不正値フォールバック・
// 書込失敗の握りつぶし）。純粋ロジックと localStorage I/O のみ（DOM/React 非依存）。

import type { PageTreeNode } from '../../storage/types'

/** 現在パスの全祖先パスを返す（自身は含めない。'/docs/intro/deep' → ['/docs','/docs/intro']）。 */
export function ancestorPaths(path: string): string[] {
  const segs = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i < segs.length; i++) {
    out.push('/' + segs.slice(0, i).join('/'))
  }
  return out
}

/**
 * 展開可能ノード（hasChildren=true）の path のみを再帰収集する。
 * 葉は含めない（永続化配列を無意味に膨らませないため）。
 */
export function expandablePaths(tree: PageTreeNode[]): string[] {
  const out: string[] = []
  const walk = (nodes: PageTreeNode[]) => {
    for (const node of nodes) {
      if (node.hasChildren) {
        out.push(node.path)
      }
      walk(node.children)
    }
  }
  walk(tree)
  return out
}

/** 展開集合の localStorage キー（design §3.7 で確定）。 */
export const SIDEBAR_EXPANDED_KEY = 'janus-sidebar-expanded'

/**
 * localStorage から展開中パス配列を読む。
 * 読み取り失敗・不正 JSON・非配列は []、非文字列要素はフィルタして無視する。
 */
export function readExpanded(): string[] {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

/** 展開中パス配列を localStorage に書く。書込失敗は握りつぶす（UI を壊さない）。 */
export function writeExpanded(paths: string[]): void {
  try {
    window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, JSON.stringify(paths))
  } catch {
    /* プライベートモード等では握りつぶす（UI を壊さない） */
  }
}
