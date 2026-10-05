// 記法シリアライザの往復無損失テスト（設計 §12 T-MAP）。
// MapData → serializeMapData → buildMapData が元 MapData（正規化後）と一致することを検証する。

import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import { buildMapData } from './parse-map'
import { serializeMapData } from './serialize-map'
import type { MapData } from './types'

/** parse-map.test.ts と同じ流儀で custom-map コンテナを取り出し buildMapData に渡す。 */
function parse(markdown: string): MapData | null {
  const tree = unified().use(remarkParse).use(remarkDirective).parse(markdown) as Root
  let found: ContainerDirective | null = null
  visit(tree, 'containerDirective', (node: ContainerDirective) => {
    if (!found && node.name === 'custom-map') found = node
  })
  return found ? buildMapData(found) : null
}

/** MapData → serializeMapData → buildMapData の往復結果を返す。 */
function roundTrip(mapData: MapData): MapData {
  const text = serializeMapData(mapData)
  const parsed = parse(text)
  expect(parsed).not.toBeNull()
  return parsed!
}

/** buildMapData 既定値で埋めた MapData を作るヘルパ（省略時の既定を明示）。 */
function makeMapData(overrides: Partial<MapData> = {}): MapData {
  return {
    assetRef: { specifiers: [] },
    cx: 50,
    cy: 50,
    scale: 1,
    restore: 15,
    rotate: 0,
    link: '',
    pinSize: 12,
    labelSize: 12,
    markers: [],
    ...overrides,
  }
}

describe('serializeMapData: 往復無損失（T-MAP）', () => {
  it('(1) 等号形式参照（filename）の往復で buildMapData が同一 MapData に読み戻す', () => {
    const original = makeMapData({
      assetRef: { baseFolderPath: '本館/2F', specifiers: [{ kind: 'filename', value: 'plan.svg' }] },
      cx: 30,
      cy: 70,
      rotate: 270,
      link: '図面を開く',
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    const result = roundTrip(original)
    expect(result).toEqual(original)
  })

  it('(1) 等号形式参照（aliasname）の往復で buildMapData が同一 MapData に読み戻す', () => {
    const original = makeMapData({
      assetRef: { baseFolderPath: 'maps', specifiers: [{ kind: 'alias', value: 'floor-plan' }] },
      markers: [{ x: 1, y: 2, label: '', desc: '', color: '#ff3b30', photos: [] }],
    })
    const result = roundTrip(original)
    expect(result).toEqual(original)

    // 等号形式（aliasname=）で出力されること（コロン形式を使わない）を明示的に確認する。
    const text = serializeMapData(original)
    expect(text).toContain('aliasname="floor-plan"')
    expect(text).not.toContain('aliasname:')
  })

  it('(2) 複数指定子は代表 1 件に正規化され往復が決定的になる', () => {
    const original = makeMapData({
      assetRef: {
        baseFolderPath: 'maps',
        specifiers: [
          { kind: 'alias', value: 'floor-plan' },
          { kind: 'filename', value: 'plan.svg' },
        ],
      },
      markers: [{ x: 5, y: 5, label: '', desc: '', color: '#ff3b30', photos: [] }],
    })

    const text = serializeMapData(original)
    // 代表（先頭）1 件のみ出力され、2 件目は出力されない。
    expect(text).toContain('aliasname="floor-plan"')
    expect(text).not.toContain('plan.svg')

    const result = roundTrip(original)
    expect(result.assetRef).toEqual({
      baseFolderPath: 'maps',
      specifiers: [{ kind: 'alias', value: 'floor-plan' }],
    })
  })

  it('(3) 参照なし（specifiers 空）の往復で参照属性を一切出力せず空 specifiers に読み戻す', () => {
    const original = makeMapData({
      assetRef: { baseFolderPath: '本館/2F', specifiers: [] },
      cx: 30,
      cy: 70,
      markers: [{ x: 1, y: 2, label: '', desc: '', color: '#ff3b30', photos: [] }],
    })

    const text = serializeMapData(original)
    expect(text).not.toContain('filename')
    expect(text).not.toContain('aliasname')
    expect(text).not.toContain('alias')

    const result = roundTrip(original)
    expect(result.assetRef).toEqual({ baseFolderPath: '本館/2F', specifiers: [] })
    expect(result).toEqual(original)
  })

  it('(4) ラベルに "・改行・/・: を含む複数マーカー＋写真子リスト＋既定値省略の往復', () => {
    // 改行は既存記法上 `|` で表現される（buildMapData は `|` を保持し、表示時に
    // CustomMapViewer.withLineBreaks が改行へ戻す）。MapData の正準形も `|` 表現を使う。
    const original = makeMapData({
      assetRef: { baseFolderPath: 'A/B', specifiers: [{ kind: 'filename', value: 'map.svg' }] },
      // cx/cy/scale/restore/rotate/link/pinSize/labelSize はすべて既定（省略される）。
      markers: [
        {
          x: 10,
          y: 20,
          label: '入口 "北" / A:B',
          desc: '注意|2行目',
          color: '#00ff00',
          photos: [
            {
              assetRef: { baseFolderPath: 'A/B', specifiers: [{ kind: 'filename', value: 'photos/entrance.jpg' }] },
              desc: '入口の写真',
            },
            {
              assetRef: { baseFolderPath: 'A/B', specifiers: [{ kind: 'alias', value: 'exit-photo' }] },
              desc: '',
            },
          ],
        },
        {
          x: 30,
          y: 40,
          label: '出口',
          desc: '',
          color: '#ff3b30', // 既定色（省略される）。
          photos: [],
        },
      ],
    })

    const result = roundTrip(original)
    expect(result).toEqual(original)
  })

  it('(4) ラベル/説明に `\\` を含む往復（spec §7.2 の `\\`→`\\\\` エスケープ）', () => {
    // 設計 §7.2 / tasks.md タスク8 の「値中の `\\` を `\\\\` に（`\\` を先に処理）」を検証する。
    // frozen な parse-map.ts の reader は `\\\\` を畳まず `\\` を「クォート直前」でのみ剥がすため、
    // 以下の値（単独 `\\`・連続 `\\\\`・Windows パス・パス中にクォートを含む・先頭 `\\`）は
    // Markdown+reader の合成を通して往復無損失になる。
    const original = makeMapData({
      assetRef: { baseFolderPath: 'A/B', specifiers: [{ kind: 'filename', value: 'map.svg' }] },
      markers: [
        {
          x: 10,
          y: 20,
          label: 'C:\\path\\to\\file', // Windows パス（連続しないバックスラッシュ）
          desc: 'back\\\\slash と \\start', // 連続バックスラッシュ・先頭バックスラッシュ
          color: '#ff3b30',
          photos: [
            {
              assetRef: { baseFolderPath: 'A/B', specifiers: [{ kind: 'filename', value: 'p.jpg' }] },
              desc: 'C:\\dir "ラベル" \\x', // バックスラッシュとクォートの混在（直前隣接なし）
            },
          ],
        },
      ],
    })
    const result = roundTrip(original)
    expect(result).toEqual(original)
  })

  it('既知の非対応 D-MAP-ESC（据え置き）: クォート直前の `\\`・値末尾の単独 `\\` は往復しない', () => {
    // frozen な reader（parse-map.ts）は `\\` を「クォートの直前」でのみ剥がし、`\\\\` を畳まない。
    // このため「クォート直前の `\\`」（`a\\"b`）と「値末尾の単独 `\\`」（`end\\`）は Markdown+reader の
    // 合成が本質的に不可逆で、serializeMapData 側のエスケープ強化だけでは往復できない（parse-map.ts は
    // frozen のため変更不可。記法仕様の正は foundation 側）。D-MAP-SLASH/PIPE/UNKNOWN/MULTISPEC と
    // 同列の既知据え置きとして扱い、GUI 入力制約は増やさない（ごく稀なエッジ・費用対効果が低いため）。
    // この非対応を回帰として固定する（往復で値が変わることを明示）。
    const breakingLabel = 'a\\"b' // バックスラッシュの直後にクォート
    const breakingDesc = 'end\\' // 値末尾の単独バックスラッシュ
    const original = makeMapData({
      assetRef: { specifiers: [{ kind: 'filename', value: 'm.png' }] },
      markers: [{ x: 1, y: 2, label: breakingLabel, desc: breakingDesc, color: '#ff3b30', photos: [] }],
    })
    const result = roundTrip(original)
    // 往復で元に戻らない（既知の非対応）。少なくとも一方が変化することを確認する。
    const changed = result.markers[0].label !== breakingLabel || result.markers[0].desc !== breakingDesc
    expect(changed).toBe(true)
  })

  it('GUI の生改行(\\n)は `|` へ変換して出力され buildMapData が `|` 表現で読み戻す', () => {
    // GUI の textarea は生の改行を与えるが、属性行を壊さないよう `|` へ変換して出力する。
    const original = makeMapData({
      assetRef: { specifiers: [{ kind: 'filename', value: 'm.png' }] },
      markers: [{ x: 1, y: 2, label: '', desc: '一行目\n二行目', color: '#ff3b30', photos: [] }],
    })
    const text = serializeMapData(original)
    expect(text).toContain('desc="一行目|二行目"')
    expect(text).not.toContain('\n二行目') // 生改行は属性値中に出力されない

    const result = roundTrip(original)
    // buildMapData は `|` を保持する（表示時に withLineBreaks が改行へ戻す）。
    expect(result.markers[0].desc).toBe('一行目|二行目')
  })

  it('マーカーなし・参照なしの最小 MapData も往復する', () => {
    const original = makeMapData()
    const result = roundTrip(original)
    expect(result).toEqual(original)
  })
})
