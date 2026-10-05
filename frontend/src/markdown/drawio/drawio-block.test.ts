// `:::drawio` ブロック境界ユーティリティのテスト（ブロック 4 FEAT-004）。map-block.test.ts と同形。

import { describe, expect, it } from 'vitest'
import { findDrawioBlocks, replaceDrawioBlock } from './drawio-block'
import { serializeDrawio } from './serialize-drawio'

describe('findDrawioBlocks', () => {
  it('単一ブロックの範囲を返し slice でブロック全体を取り出せる', () => {
    const body = [
      '# 見出し',
      '',
      ':::drawio',
      '```xml',
      '<mxGraphModel/>',
      '```',
      ':::',
      '',
      '本文のおわり',
    ].join('\n')

    const blocks = findDrawioBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(body.slice(blocks[0].start, blocks[0].end)).toBe(
      [':::drawio', '```xml', '<mxGraphModel/>', '```', ':::'].join('\n'),
    )
    expect(blocks[0].index).toBe(0)
  })

  it('複数ブロックを出現順インデックスで区別する', () => {
    const body = [
      serializeDrawio('<a/>'),
      '',
      '間のテキスト',
      '',
      serializeDrawio('<b/>'),
    ].join('\n')

    const blocks = findDrawioBlocks(body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].index).toBe(0)
    expect(blocks[1].index).toBe(1)
    expect(body.slice(blocks[0].start, blocks[0].end)).toContain('<a/>')
    expect(body.slice(blocks[1].start, blocks[1].end)).toContain('<b/>')
    // 間のテキストはどのブロックにも含まれない。
    expect(body.slice(blocks[0].start, blocks[0].end)).not.toContain('間のテキスト')
  })

  it('コードフェンス内に行頭 ::: を含むブロックでも 1 ブロックとして閉じる（コロン数一致）', () => {
    // serializeDrawio は XML 内 ::: でコンテナを 4 連コロンへ拡張する。開始/終了が 4 連で揃い、
    // 本文中の 3 連 ::: 行では閉じないことを確認する。
    const body = serializeDrawio(['<root>', ':::', 'inner', '</root>'].join('\n'))

    const blocks = findDrawioBlocks(body)
    expect(blocks).toHaveLength(1)
    const extracted = body.slice(blocks[0].start, blocks[0].end)
    expect(extracted.startsWith('::::drawio')).toBe(true)
    expect(extracted.endsWith('::::')).toBe(true)
    expect(extracted).toContain(':::')
    expect(extracted).toContain('inner')
  })

  it('drawio ブロックが無ければ空配列を返す', () => {
    expect(findDrawioBlocks('ただの本文\n- 箇条書き')).toEqual([])
  })

  it('終了行が無いブロックは本文末尾までを範囲にする', () => {
    const body = [':::drawio', '```xml', '<x/>', '```'].join('\n')
    const blocks = findDrawioBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(body.slice(blocks[0].start, blocks[0].end)).toBe(body)
  })
})

describe('replaceDrawioBlock', () => {
  it('対象ブロックだけを置換し前後の本文を保持する', () => {
    const body = [
      '# 見出し',
      '',
      serializeDrawio('<old/>'),
      '',
      'あとの本文',
    ].join('\n')

    const [block] = findDrawioBlocks(body)
    const result = replaceDrawioBlock(body, block, serializeDrawio('<new/>'))

    expect(result).toContain('<new/>')
    expect(result).not.toContain('<old/>')
    expect(result.startsWith('# 見出し')).toBe(true)
    expect(result.endsWith('あとの本文')).toBe(true)
  })

  it('複数ブロックのうち 2 つめだけを置換しても 1 つめは不変', () => {
    const body = [serializeDrawio('<a/>'), '', serializeDrawio('<b/>')].join('\n')

    const blocks = findDrawioBlocks(body)
    const result = replaceDrawioBlock(body, blocks[1], serializeDrawio('<z/>'))
    expect(result).toContain('<a/>')
    expect(result).toContain('<z/>')
    expect(result).not.toContain('<b/>')
  })
})
