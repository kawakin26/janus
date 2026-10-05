// drawio 専用 remark プラグイン（タスク 15 / ブロック 4 FEAT-002）。
//
// 方針（remark-custom-map.ts と同形）:
// - remark-directive の後・remark-directive-fallback の前に差し込む。
// - containerDirective かつ name==='drawio' のノードを走査し、配下最初の code ノードの
//   .value（生 mxGraph XML）を取り出して data.hName='div' /
//   data.hProperties に data-drawio（XML 本文）と data-directive='drawio' を設定し、子を空にする。
// - fallback は hName 既設を尊重するため drawio には触れない。
// - react-markdown の components.div 側で data-drawio を検出し専用コンポーネントを描画する。
//   生 HTML 有効化（rehype-raw）は不要。
//
// code ノードが無い（空コンテナ）場合はクラッシュせず XML を空文字として扱う。

import { visit } from 'unist-util-visit'
import type { Code, Root } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'

/** コンテナ配下を走査し最初の code ノードの .value を返す。無ければ空文字。 */
function findFirstCodeValue(node: ContainerDirective): string {
  let value = ''
  visit(node, 'code', (code: Code) => {
    value = code.value
    return false // 最初の code で打ち切る
  })
  return value
}

/**
 * drawio コンテナディレクティブを専用描画用の div へ変換する remark プラグイン。
 * react-markdown の remarkPlugins に remark-directive の後ろ・fallback の前で渡す。
 */
export default function remarkDrawio() {
  return (tree: Root): void => {
    visit(tree, 'containerDirective', (node: ContainerDirective) => {
      if (node.name !== 'drawio') return

      const xml = findFirstCodeValue(node)
      node.children = []
      const data = node.data ?? (node.data = {})
      data.hName = 'div'
      data.hProperties = {
        'data-drawio': xml,
        'data-directive': 'drawio',
      }
    })
  }
}
