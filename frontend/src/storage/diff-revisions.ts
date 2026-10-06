// 差分変換 — diff パッケージの diffLines を DiffLine[] に変換する。
//
// 純粋関数。サーバー difflib との厳密一致は目標にしない（設計 §4.9）。

import { diffLines } from 'diff'

import type { DiffLine } from './types'

/**
 * 2 つのテキストの行単位差分を DiffLine[] として返す。
 */
export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText)
  const result: DiffLine[] = []

  for (const change of changes) {
    const op: DiffLine['op'] = change.added ? 'add' : change.removed ? 'del' : 'equal'

    // diffLines は各ハンク末尾に改行を含むため split 後の末尾空要素を落とす。
    const lines = change.value.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }

    for (const line of lines) {
      result.push({ op, line })
    }
  }

  return result
}
