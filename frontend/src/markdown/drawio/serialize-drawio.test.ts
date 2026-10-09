// drawio シリアライザ／パーサの往復ユニットテスト（T-DRAW / ブロック 4 FEAT-002）。
// serializeDrawio の出力を remark-drawio の unified パイプラインで再パースし、
// data-drawio の XML が入力 XML と一致することで往復無損失を検証する
// （PageEditPage の parseCustomMapBlock と同じ unified 流儀）。

import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import remarkDrawio from './remark-drawio'
import { serializeDrawio } from './serialize-drawio'
import { findDrawioBlocks } from './drawio-block'

/** 記法テキストをパースし drawio コンテナの data-drawio（XML）を取り出す。無ければ null。 */
function parseDrawioXml(markdown: string): string | null {
  // parse-map.test.ts と同じ流儀で mdast を得てから remark-drawio の変換を適用する
  // （.parse() は parser 段のみ実行しトランスフォーマは走らないため手動適用する）。
  const tree = unified().use(remarkParse).use(remarkDirective).parse(markdown) as Root
  remarkDrawio()(tree)

  let xml: string | null = null
  visit(tree, 'containerDirective', (node: ContainerDirective) => {
    if (node.name !== 'drawio') return
    const value = node.data?.hProperties?.['data-drawio']
    if (typeof value === 'string') xml = value
  })
  return xml
}

/** serialize → parse 往復で XML が保たれることを確認するヘルパ。 */
function roundTrip(xml: string): string | null {
  return parseDrawioXml(serializeDrawio(xml))
}

describe('serializeDrawio: フェンス拡張ルール', () => {
  it('コロンもバッククォートも含まない XML は 3 連コロン＋3 連フェンスを使う', () => {
    const out = serializeDrawio('<mxGraphModel/>')
    expect(out).toBe(':::drawio\n```xml\n<mxGraphModel/>\n```\n:::')
  })

  it('XML に ``` を含む場合はコードフェンスを 4 連へ拡張する', () => {
    const out = serializeDrawio('a ``` b')
    const lines = out.split('\n')
    expect(lines[1]).toBe('````xml')
    expect(lines[3]).toBe('````')
  })

  it('XML の最長連続バッククォートが 4 なら 5 連へ拡張する', () => {
    const out = serializeDrawio('a ```` b')
    const lines = out.split('\n')
    expect(lines[1]).toBe('`````xml')
    expect(lines[3]).toBe('`````')
  })

  it('XML に ::: を含む場合はコンテナのコロンを 4 連へ拡張する', () => {
    const out = serializeDrawio('<n value=":::x"/>')
    const lines = out.split('\n')
    expect(lines[0]).toBe('::::drawio')
    expect(lines[4]).toBe('::::')
  })
})

describe('T-DRAW: 往復無損失', () => {
  it('(a) 行頭 ::: を含む XML でコンテナが早期終了せず保持される', () => {
    const xml = '<node value=":::foo should not close"/>'
    expect(roundTrip(xml)).toBe(xml)
  })

  it('(a) 複数行で行頭 ::: が独立行に現れても保持される', () => {
    const xml = ['<root>', ':::', 'still inside', ':::drawio', '</root>'].join('\n')
    expect(roundTrip(xml)).toBe(xml)
  })

  it('(b) ``` を含む XML でフェンスが拡張され往復で保たれる', () => {
    const xml = '<node value="code ``` fence"/>'
    expect(roundTrip(xml)).toBe(xml)
  })

  it('(b) 4 連バッククォートを含む XML でも往復で保たれる', () => {
    const xml = '<node value="longer ```` run"/>'
    expect(roundTrip(xml)).toBe(xml)
  })

  it('(c) 引用符と改行を含む XML の往復無損失', () => {
    const xml = [
      '<mxGraphModel>',
      '  <mxCell value="say &quot;hi&quot; and \'bye\'" />',
      '  <mxCell value="line1',
      'line2" />',
      '</mxGraphModel>',
    ].join('\n')
    expect(roundTrip(xml)).toBe(xml)
  })

  it('実用的な mxGraph XML の往復無損失', () => {
    const xml = [
      '<mxGraphModel dx="800" dy="600" grid="1">',
      '  <root>',
      '    <mxCell id="0" />',
      '    <mxCell id="1" parent="0" />',
      '    <mxCell id="2" value="Box" style="rounded=0;" vertex="1" parent="1">',
      '      <mxGeometry x="40" y="40" width="120" height="60" as="geometry" />',
      '    </mxCell>',
      '  </root>',
      '</mxGraphModel>',
    ].join('\n')
    expect(roundTrip(xml)).toBe(xml)
  })
})

describe('serializeDrawio: title 対応と正規化（要件C-4/C-5）', () => {
  it('(a) title 省略時は従来どおり属性なし :::drawio（後方互換・既存テスト不変）', () => {
    expect(serializeDrawio('<mxGraphModel/>')).toBe(
      ':::drawio\n```xml\n<mxGraphModel/>\n```\n:::',
    )
  })

  it('(b) title 非空のとき開始行に {title="..."} を付ける', () => {
    const out = serializeDrawio('<mxGraphModel/>', '現場図')
    expect(out.split('\n')[0]).toBe(':::drawio{title="現場図"}')
  })

  it('(c) 正規化: " と \' は全角化、改行は空白、} は全角、\\ は literal 保持', () => {
    expect(serializeDrawio('<x/>', 'a"b').split('\n')[0]).toBe(':::drawio{title="a”b"}')
    expect(serializeDrawio('<x/>', "a'b").split('\n')[0]).toBe(':::drawio{title="a’b"}')
    expect(serializeDrawio('<x/>', 'a\nb').split('\n')[0]).toBe(':::drawio{title="a b"}')
    expect(serializeDrawio('<x/>', 'a}b').split('\n')[0]).toBe(':::drawio{title="a｝b"}')
    // バックスラッシュはエスケープせずそのまま（remark-directive が literal 保持）。
    expect(serializeDrawio('<x/>', 'C:\\dir').split('\n')[0]).toBe(':::drawio{title="C:\\dir"}')
  })

  it('(d) title 往復（正規化後の値）: serialize → findDrawioBlocks で一致する', () => {
    const cases: Array<[string, string]> = [
      ['現場レイアウト', '現場レイアウト'], // 日本語はそのまま
      ['genba', 'genba'], // ASCII はそのまま
      ['C:\\dir\\x', 'C:\\dir\\x'], // バックスラッシュは literal 往復
      ['a"b', 'a”b'], // 二重引用符は全角化後の値で往復
      ["a'b", 'a’b'], // 単引用符は全角化後の値で往復
      ['a\nb', 'a b'], // 改行は空白化後の値で往復
      ['a}b', 'a｝b'], // } は全角化後の値で往復
    ]
    for (const [input, normalized] of cases) {
      const out = serializeDrawio('<mxGraphModel/>', input)
      const blocks = findDrawioBlocks(out)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].title).toBe(normalized)
    }
  })

  it('(e) 閲覧経路の無回帰（最重要）: 特殊文字 title でも drawio が認識され data-drawio が XML と一致する', () => {
    // 正規化を外した実装（旧エスケープのように `"`→`\"` を出す）だと、"/' を含むケースで
    // remark-directive が開始行を container directive と認識せず drawio 非認識になり本テストが落ちる。
    // ＝このテストは「閲覧経路で図が消える」破壊（レビュー指摘1）を検出する構成である。
    const xml = '<mxGraphModel><root/></mxGraphModel>'
    const titles = [
      'a"b', // 二重引用符
      "a'b", // 単引用符
      'C:\\dir', // バックスラッシュ
      'line1\nline2', // 改行
      'a b c', // 空白
      '現場レイアウト', // 日本語
      'a}b', // 閉じブレース
      'a|b', // パイプ
      'A:B', // コロン
      'a/b', // スラッシュ
    ]
    for (const title of titles) {
      const out = serializeDrawio(xml, title)
      expect(parseDrawioXml(out)).toBe(xml)
    }
  })
})

describe('remarkDrawio: 空コンテナ', () => {
  it('code ノードが無い drawio コンテナはクラッシュせず空文字になる', () => {
    const xml = parseDrawioXml(':::drawio\n\n:::')
    expect(xml).toBe('')
  })
})
