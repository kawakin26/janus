// 未対応ディレクティブを無害なプレースホルダへ変換する remark プラグイン（design 2 章 / D3）。
//
// 方針:
// - remark-directive を有効にすると `:::custom-map` 等は mdast の
//   containerDirective / leafDirective / textDirective ノードとして AST に入る。
//   タスク 10 ではマップ描画（custom-map の実レンダリング）はスコープ外（タスク 11）。
// - そこで各ディレクティブノードに hName / hProperties を設定し、
//   対応する HTML 要素（text/leaf は span、container は div）として素通し描画する。
//   `data-directive="<name>"` 属性を目印として残し、タスク 11 で実ビューアへ差し替えられるようにする。
// - 既に hName が設定済みのノード（他プラグインが処理済み）は上書きしない。
// - マップ描画・アセット解決は一切行わない。クラッシュせず本文テキストを素通し表示する。

import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

/** ディレクティブ種別ごとの既定要素名。 */
const DEFAULT_TAG = {
  textDirective: 'span',
  leafDirective: 'div',
  containerDirective: 'div',
} as const

type DirectiveType = keyof typeof DEFAULT_TAG

/**
 * 未対応ディレクティブを無害なプレースホルダ要素へ変換する remark プラグイン。
 * react-markdown の remarkPlugins に remark-directive の後ろで渡して使う。
 */
export default function remarkDirectiveFallback() {
  return (tree: Root): void => {
    visit(tree, (node) => {
      const type = node.type as string
      if (
        type !== 'textDirective' &&
        type !== 'leafDirective' &&
        type !== 'containerDirective'
      ) {
        return
      }

      // mdast のディレクティブノードは name と任意の attributes / data を持つ。
      const directive = node as {
        name: string
        attributes?: Record<string, string | null | undefined> | null
        data?: {
          hName?: string
          hProperties?: Record<string, unknown>
        }
      }

      const data = directive.data ?? (directive.data = {})

      // 既に他プラグインが要素名を割り当てていれば尊重する。
      if (data.hName === undefined) {
        data.hName = DEFAULT_TAG[type as DirectiveType]
      }

      // ディレクティブ由来の属性を素通ししつつ、目印として data-directive を付与する。
      data.hProperties = {
        ...(directive.attributes ?? {}),
        ...(data.hProperties ?? {}),
        'data-directive': directive.name,
      }
    })
  }
}
