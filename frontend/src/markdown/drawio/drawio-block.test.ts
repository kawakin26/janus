// `:::drawio` ブロック境界ユーティリティのテスト（ブロック 4 FEAT-004）。map-block.test.ts と同形。

import { describe, expect, it } from 'vitest'
import { findDrawioBlocks, replaceDrawioBlock } from './drawio-block'
import { serializeDrawio } from './serialize-drawio'

/** title 付き/なしの drawio ブロック記法を組み立てるテストヘルパ。 */
function drawioBlock(xml: string, attr?: string): string {
  const open = attr !== undefined ? `:::drawio{${attr}}` : ':::drawio'
  return [open, '```xml', xml, '```', ':::'].join('\n')
}

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

describe('findDrawioBlocks: title 抽出（要件C-2/C-3）', () => {
  it('{title="現場図"} から title を取り出す', () => {
    const blocks = findDrawioBlocks(drawioBlock('<mxGraphModel/>', 'title="現場図"'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].title).toBe('現場図')
  })

  it('属性なし :::drawio は title が空文字（後方互換）', () => {
    const blocks = findDrawioBlocks(drawioBlock('<mxGraphModel/>'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].title).toBe('')
  })

  it('単引用符 title も取り出す', () => {
    const blocks = findDrawioBlocks(drawioBlock('<x/>', "title='現場'"))
    expect(blocks[0].title).toBe('現場')
  })

  it('バックスラッシュを含む title を literal にそのまま返す（アンエスケープしない）', () => {
    // 値に生の `\` を含む。serializer と対称に `\` を畳まず・剥がさずそのまま読む。
    const blocks = findDrawioBlocks(drawioBlock('<x/>', 'title="C:\\dir\\x"'))
    expect(blocks[0].title).toBe('C:\\dir\\x')
  })

  it('全角引用符・空白・日本語・/・:・| を含む title を literal にそのまま返す', () => {
    const blocks = findDrawioBlocks(drawioBlock('<x/>', 'title="”A”棟 / B:C|D"'))
    expect(blocks[0].title).toBe('”A”棟 / B:C|D')
  })

  it('title 付きでも開始/終了コロン数一致・終了行判定・複数ブロックのインデックスが従来どおり', () => {
    const body = [
      serializeDrawio('<a/>', '一番目'),
      '',
      '間のテキスト',
      '',
      serializeDrawio('<b/>'),
    ].join('\n')
    const blocks = findDrawioBlocks(body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].index).toBe(0)
    expect(blocks[0].title).toBe('一番目')
    expect(blocks[1].index).toBe(1)
    expect(blocks[1].title).toBe('')
    expect(body.slice(blocks[0].start, blocks[0].end)).toContain('<a/>')
    expect(body.slice(blocks[1].start, blocks[1].end)).toContain('<b/>')
  })

  it('XML 内 ::: でコロンを拡張したブロックでも title が付いていれば読める', () => {
    const body = serializeDrawio(['<root>', ':::', 'inner', '</root>'].join('\n'), '図A')
    const blocks = findDrawioBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].title).toBe('図A')
    const extracted = body.slice(blocks[0].start, blocks[0].end)
    expect(extracted.startsWith('::::drawio{title="図A"}')).toBe(true)
    expect(extracted.endsWith('::::')).toBe(true)
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
