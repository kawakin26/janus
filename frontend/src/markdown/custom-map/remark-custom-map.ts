// custom-map 専用 remark プラグイン（タスク 11 / 要件 3-1, 3-2）。
//
// 方針（計画 D3）:
// - remark-directive の後・remark-directive-fallback の前に差し込む。
// - containerDirective かつ name==='custom-map' のノードを buildMapData で MapData 化し、
//   data.hName='div' / data.hProperties に data-custom-map（MapData の JSON）と
//   data-directive='custom-map' を設定、子を空にする。
// - fallback は hName 既設を尊重するため custom-map には触れない（他ディレクティブ向けは残る）。
// - react-markdown の components.div 側で data-custom-map を検出し CustomMapViewer を描画する。
//   生 HTML 有効化（rehype-raw）は不要。

import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import { buildMapData } from './parse-map'

/**
 * custom-map コンテナディレクティブを専用描画用の div へ変換する remark プラグイン。
 * react-markdown の remarkPlugins に remark-directive の後ろ・fallback の前で渡す。
 */
export default function remarkCustomMap() {
  return (tree: Root): void => {
    visit(tree, 'containerDirective', (node: ContainerDirective) => {
      if (node.name !== 'custom-map') return

      const mapData = buildMapData(node)
      node.children = []
      const data = node.data ?? (node.data = {})
      data.hName = 'div'
      data.hProperties = {
        'data-custom-map': JSON.stringify(mapData),
        'data-directive': 'custom-map',
      }
    })
  }
}
