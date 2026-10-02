// 記法パーサ（mdast → MapData）のユニットテスト（タスク 11 / 要件 3-1, 3-2）。
// 移植元 viewer.ts の記法サンプルに即したケースで、コンテナ属性・マーカー・写真の
// パースと既定値・クランプ・回転正規化を検証する。

import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import { buildMapData } from './parse-map'
import type { MapData } from './types'

/** Markdown から最初の custom-map コンテナを MapData へ変換するヘルパ。 */
function parse(markdown: string): MapData | null {
  const tree = unified().use(remarkParse).use(remarkDirective).parse(markdown) as Root
  let found: ContainerDirective | null = null
  visit(tree, 'containerDirective', (node: ContainerDirective) => {
    if (!found && node.name === 'custom-map') found = node
  })
  return found ? buildMapData(found) : null
}

describe('buildMapData: コンテナ属性', () => {
  it('属性を読み取り、既定値・クランプ・rotate 正規化を適用する', () => {
    const md = [
      ':::custom-map{file="plan.png" src="/map-library" cx="30" cy="70" scale="2" rotate="-90" pinSize="100" labelSize="2" restore="20" link="現場見取り図を開く"}',
      '',
      '- x=10 y=20 label="A"',
      ':::',
    ].join('\n')
    const data = parse(md)
    expect(data).not.toBeNull()
    expect(data!.file).toBe('plan.png')
    expect(data!.src).toBe('/map-library')
    expect(data!.link).toBe('現場見取り図を開く')
    expect(data!.cx).toBe(30)
    expect(data!.cy).toBe(70)
    expect(data!.scale).toBe(2)
    expect(data!.rotate).toBe(270) // -90 を正規化
    expect(data!.pinSize).toBe(48) // 100 → PIN_SIZE_MAX
    expect(data!.labelSize).toBe(8) // 2 → LABEL_SIZE_MIN
    expect(data!.restore).toBe(20)
  })

  it('属性未指定なら既定値を使う', () => {
    const md = [':::custom-map{file="m.png"}', '', '- x=1 y=2', ':::'].join('\n')
    const data = parse(md)!
    expect(data.cx).toBe(50)
    expect(data.cy).toBe(50)
    expect(data.scale).toBe(1)
    expect(data.rotate).toBe(0)
    expect(data.restore).toBe(15)
    expect(data.pinSize).toBe(12)
    expect(data.labelSize).toBe(12)
    expect(data.link).toBe('')
  })
})

describe('buildMapData: マーカー', () => {
  it('複数マーカーの x/y/label/color/desc を読み取る', () => {
    const md = [
      ':::custom-map{file="m.png"}',
      '',
      '- x=10 y=20 label="入口" color="#00ff00" desc="注意"',
      '- x=30 y=40 label="出口"',
      ':::',
    ].join('\n')
    const data = parse(md)!
    expect(data.markers).toHaveLength(2)
    expect(data.markers[0]).toMatchObject({
      x: 10,
      y: 20,
      label: '入口',
      color: '#00ff00',
      desc: '注意',
    })
    expect(data.markers[1]).toMatchObject({ x: 30, y: 40, label: '出口', color: '#ff3b30' })
  })

  it('x も y も無い行はマーカーにしない', () => {
    const md = [
      ':::custom-map{file="m.png"}',
      '',
      '- これは説明文',
      '- x=1 y=2',
      ':::',
    ].join('\n')
    const data = parse(md)!
    expect(data.markers).toHaveLength(1)
    expect(data.markers[0]).toMatchObject({ x: 1, y: 2 })
  })

  it('同一行 photo=（旧記法）は写真 1 枚として取り込む', () => {
    const md = [
      ':::custom-map{file="m.png"}',
      '',
      '- x=1 y=2 photo="a.png" desc="コメント"',
      ':::',
    ].join('\n')
    const data = parse(md)!
    expect(data.markers[0].photos).toEqual([{ photo: 'a.png', desc: 'コメント' }])
  })

  it('ネスト list の写真（新記法）が同一行 photo を上書きする', () => {
    const md = [
      ':::custom-map{file="m.png"}',
      '',
      '- x=1 y=2 photo="old.png"',
      '  - photo="new1.png" desc="d1"',
      '  - photo="new2.png" desc="d2"',
      ':::',
    ].join('\n')
    const data = parse(md)!
    expect(data.markers[0].photos).toEqual([
      { photo: 'new1.png', desc: 'd1' },
      { photo: 'new2.png', desc: 'd2' },
    ])
  })

  it('photoSrc / photosrc の別名を許容する', () => {
    const md = [
      ':::custom-map{file="m.png"}',
      '',
      '- x=1 y=2 photoSrc="/pages/a"',
      '- x=3 y=4 photosrc="/pages/b"',
      ':::',
    ].join('\n')
    const data = parse(md)!
    expect(data.markers[0].photoSrc).toBe('/pages/a')
    expect(data.markers[1].photoSrc).toBe('/pages/b')
  })

  it('クォートされた属性値（空白を含む）を 1 つの値として読む', () => {
    const md = [
      ':::custom-map{file="m.png"}',
      '',
      '- x=1 y=2 label="第 2 工場 入口"',
      ':::',
    ].join('\n')
    const data = parse(md)!
    expect(data.markers[0].label).toBe('第 2 工場 入口')
  })
})
