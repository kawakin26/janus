import { describe, expect, it } from 'vitest'

import { computeDiff } from './diff-revisions'

describe('computeDiff', () => {
  it('無変更 — 全行 equal', () => {
    const result = computeDiff('a\nb\nc\n', 'a\nb\nc\n')
    expect(result.every((d) => d.op === 'equal')).toBe(true)
    expect(result.filter((d) => d.op === 'add')).toHaveLength(0)
    expect(result.filter((d) => d.op === 'del')).toHaveLength(0)
    expect(result.map((d) => d.line)).toEqual(['a', 'b', 'c'])
  })

  it('追加のみ', () => {
    const result = computeDiff('a\nb\n', 'a\nb\nc\n')
    expect(result.filter((d) => d.op === 'add').map((d) => d.line)).toEqual(['c'])
    expect(result.filter((d) => d.op === 'del')).toHaveLength(0)
  })

  it('削除のみ', () => {
    const result = computeDiff('a\nb\nc\n', 'a\nb\n')
    expect(result.filter((d) => d.op === 'del').map((d) => d.line)).toEqual(['c'])
    expect(result.filter((d) => d.op === 'add')).toHaveLength(0)
  })

  it('混在（1 行置換）', () => {
    const result = computeDiff('a\nb\nc\n', 'a\nB\nc\n')
    const dels = result.filter((d) => d.op === 'del')
    const adds = result.filter((d) => d.op === 'add')
    expect(dels.map((d) => d.line)).toContain('b')
    expect(adds.map((d) => d.line)).toContain('B')
    expect(
      result
        .filter((d) => d.op === 'equal')
        .map((d) => d.line),
    ).toEqual(expect.arrayContaining(['a', 'c']))
  })

  it('末尾空行が混入しない', () => {
    const result = computeDiff('a\nb\n', 'a\nb\nc\n')
    // oldText: a, b (2 行) / newText: a, b, c (3 行)
    // equal: a, b / add: c → 3 行
    expect(result).toHaveLength(3)
    // 各 DiffLine.line に余分な空文字が混入していない。
    for (const d of result) {
      expect(d.line).not.toBe('')
    }
  })
})
