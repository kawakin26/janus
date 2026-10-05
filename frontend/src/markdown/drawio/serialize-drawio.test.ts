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

describe('remarkDrawio: 空コンテナ', () => {
  it('code ノードが無い drawio コンテナはクラッシュせず空文字になる', () => {
    const xml = parseDrawioXml(':::drawio\n\n:::')
    expect(xml).toBe('')
  })
})
