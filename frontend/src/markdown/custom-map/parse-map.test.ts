// custom-map記法パーサのユニットテスト。

import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import { buildMapData } from './parse-map'
import type { MapData } from './types'

function parse(markdown: string): MapData | null {
  const tree = unified().use(remarkParse).use(remarkDirective).parse(markdown) as Root
  let found: ContainerDirective | null = null
  visit(tree, 'containerDirective', (node: ContainerDirective) => {
    if (!found && node.name === 'custom-map') found = node
  })
  return found ? buildMapData(found) : null
}

describe('buildMapData: アセット指定子', () => {
  it('folderとfilename/aliasnameを出現順でAssetRefへ変換する', () => {
    const data = parse([
      ':::custom-map{folder="本館/2F" aliasname="floor-plan" filename="plan.svg" cx="30" cy="70" rotate="-90" link="図面を開く"}',
      '',
      '- x=10 y=20 label="入口"',
      '  - alias="entrance.jpg" desc="写真"',
      ':::',
    ].join('\n'))!

    expect(data.assetRef).toEqual({
      baseFolderPath: '本館/2F',
      specifiers: [
        { kind: 'alias', value: 'floor-plan' },
        { kind: 'filename', value: 'plan.svg' },
      ],
    })
    expect(data.rotate).toBe(270)
    expect(data.cx).toBe(30)
    expect(data.cy).toBe(70)
    expect(data.link).toBe('図面を開く')
    expect(data.markers[0].photos).toEqual([{
      assetRef: {
        baseFolderPath: '本館/2F',
        specifiers: [{ kind: 'alias', value: 'entrance.jpg' }],
      },
      desc: '写真',
    }])
  })

  it('fileとaliasの短縮記法およびfilename:valueを受け付ける', () => {
    const data = parse([
      ':::custom-map{folder="maps" file="plan.png"}',
      '',
      '- x=1 y=2',
      '  - filename="photos/entrance.jpg" desc="入口"',
      ':::',
    ].join('\n'))!
    expect(data.assetRef.specifiers).toEqual([{ kind: 'filename', value: 'plan.png' }])
    expect(data.markers[0].photos[0].assetRef.specifiers).toEqual([
      { kind: 'filename', value: 'photos/entrance.jpg' },
    ])
  })

  it('指定子が無い参照は空AssetRefを作る', () => {
    const data = parse([':::custom-map{folder="maps"}', '', '- x=1 y=2', ':::'].join('\n'))!
    expect(data.assetRef).toEqual({ baseFolderPath: 'maps', specifiers: [] })
  })

  it('labelやdescの引用値にある指定子風文字列を解釈しない', () => {
    const data = parse([
      ':::custom-map{folder="maps" file="plan.png"}',
      '',
      '- x=1 y=2 label="入口 file:ignored alias:ignored" desc="filename:not-a-ref"',
      '  - alias="entrance.jpg" desc="写真 file:not-a-ref alias:not-a-ref"',
      ':::',
    ].join('\n'))!

    expect(data.markers[0]).toMatchObject({
      label: '入口 file:ignored alias:ignored',
      desc: 'filename:not-a-ref',
    })
    expect(data.markers[0].photos[0]).toEqual({
      assetRef: {
        baseFolderPath: 'maps',
        specifiers: [{ kind: 'alias', value: 'entrance.jpg' }],
      },
      desc: '写真 file:not-a-ref alias:not-a-ref',
    })
  })
})

describe('buildMapData: マーカー表示属性', () => {
  it('複数マーカーのx/y/label/color/descと既定値を読み取る', () => {
    const data = parse([
      ':::custom-map{filename="m.png"}',
      '',
      '- x=10 y=20 label="入口" color="#00ff00" desc="注意"',
      '- x=30 y=40 label="出口"',
      ':::',
    ].join('\n'))!
    expect(data.markers).toHaveLength(2)
    expect(data.markers[0]).toMatchObject({ x: 10, y: 20, label: '入口', color: '#00ff00', desc: '注意' })
    expect(data.markers[1]).toMatchObject({ x: 30, y: 40, label: '出口', color: '#ff3b30' })
  })

  it('xもyも無い行はマーカーにしない', () => {
    const data = parse([':::custom-map{filename="m.png"}', '', '- 説明文', '- x=1 y=2', ':::'].join('\n'))!
    expect(data.markers).toHaveLength(1)
  })
})

describe('buildMapData: title 属性（作業2）', () => {
  it('title 属性を読み取る', () => {
    const data = parse([
      ':::custom-map{filename="plan.svg" title="現場見取り図"}',
      '',
      '- x=1 y=2',
      ':::',
    ].join('\n'))!
    expect(data.title).toBe('現場見取り図')
  })

  it('title 属性が無ければ空文字（後方互換）', () => {
    const data = parse([':::custom-map{filename="plan.svg"}', '', '- x=1 y=2', ':::'].join('\n'))!
    expect(data.title).toBe('')
  })
})
