// `:::custom-map` ブロック境界ユーティリティのテスト（設計 §7.3）。

import { describe, expect, it } from 'vitest'
import { findCustomMapBlocks, replaceCustomMapBlock } from './map-block'

describe('findCustomMapBlocks', () => {
  it('単一ブロックの範囲を返し slice でブロック全体を取り出せる', () => {
    const body = [
      '# 見出し',
      '',
      ':::custom-map{filename="m.png"}',
      '',
      '- x=1 y=2',
      ':::',
      '',
      '本文のおわり',
    ].join('\n')

    const blocks = findCustomMapBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(body.slice(blocks[0].start, blocks[0].end)).toBe(
      [':::custom-map{filename="m.png"}', '', '- x=1 y=2', ':::'].join('\n'),
    )
    expect(blocks[0].index).toBe(0)
  })

  it('複数ブロックを出現順インデックスで区別する', () => {
    const body = [
      ':::custom-map{filename="a.png"}',
      '- x=1 y=2',
      ':::',
      '',
      '間のテキスト',
      '',
      ':::custom-map{filename="b.png"}',
      '- x=3 y=4',
      ':::',
    ].join('\n')

    const blocks = findCustomMapBlocks(body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].index).toBe(0)
    expect(blocks[1].index).toBe(1)
    expect(body.slice(blocks[0].start, blocks[0].end)).toContain('a.png')
    expect(body.slice(blocks[1].start, blocks[1].end)).toContain('b.png')
  })

  it('ネストした写真子リストを含むブロックを 1 ブロックとして扱う', () => {
    const body = [
      'まえがき',
      ':::custom-map{filename="m.png"}',
      '',
      '- x=1 y=2 label="入口"',
      '  - filename="entrance.jpg" desc="写真"',
      ':::',
      'あとがき',
    ].join('\n')

    const blocks = findCustomMapBlocks(body)
    expect(blocks).toHaveLength(1)
    const extracted = body.slice(blocks[0].start, blocks[0].end)
    expect(extracted).toContain('entrance.jpg')
    expect(extracted.startsWith(':::custom-map')).toBe(true)
    expect(extracted.endsWith(':::')).toBe(true)
  })

  it('custom-map ブロックが無ければ空配列を返す', () => {
    expect(findCustomMapBlocks('ただの本文\n- 箇条書き')).toEqual([])
  })
})

describe('replaceCustomMapBlock', () => {
  it('対象ブロックだけを置換し前後の本文を保持する', () => {
    const body = [
      '# 見出し',
      '',
      ':::custom-map{filename="old.png"}',
      '- x=1 y=2',
      ':::',
      '',
      'あとの本文',
    ].join('\n')

    const [block] = findCustomMapBlocks(body)
    const newBlock = [':::custom-map{filename="new.png"}', '', '- x=9 y=9', ':::'].join('\n')
    const result = replaceCustomMapBlock(body, block, newBlock)

    expect(result).toBe(
      ['# 見出し', '', ':::custom-map{filename="new.png"}', '', '- x=9 y=9', ':::', '', 'あとの本文'].join('\n'),
    )
    // 前後本文は保持される。
    expect(result.startsWith('# 見出し')).toBe(true)
    expect(result.endsWith('あとの本文')).toBe(true)
  })

  it('複数ブロックのうち 2 つめだけを置換しても 1 つめは不変', () => {
    const body = [
      ':::custom-map{filename="a.png"}',
      '- x=1 y=2',
      ':::',
      '',
      ':::custom-map{filename="b.png"}',
      '- x=3 y=4',
      ':::',
    ].join('\n')

    const blocks = findCustomMapBlocks(body)
    const result = replaceCustomMapBlock(body, blocks[1], ':::custom-map{filename="z.png"}\n:::')
    expect(result).toContain('a.png')
    expect(result).toContain('z.png')
    expect(result).not.toContain('b.png')
  })
})
