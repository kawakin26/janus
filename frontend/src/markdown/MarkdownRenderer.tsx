// Markdown レンダラ（サブタスク 10.1 / 要件 2-3）。
//
// 方針（計画の確定判断に接地）:
// - react-markdown を remark-gfm / remark-directive / remarkDirectiveFallback で設定する。
//   GFM の表・打ち消し・タスクリスト等をサポートし、:::custom-map 等の未対応ディレクティブは
//   remarkDirectiveFallback がプレースホルダ要素へ無害化する（クラッシュしない）。
// - 生 HTML は無効のまま（rehype-raw を導入しない）。react-markdown 既定で本文中の生 HTML を
//   レンダリングしないため、dangerouslySetInnerHTML 相当の経路を作らず XSS を避ける（D2）。
// - リンクは components.a でカスタムし、外部リンク（http/https 絶対 URL）には
//   rel="noopener noreferrer" と target="_blank" を付ける。相対/内部リンクには付けない。
// - body が空のときは何も描画しない。

import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import remarkDirectiveFallback from './remark-directive-fallback'
import remarkCustomMap from './custom-map/remark-custom-map'
import CustomMapViewer from './custom-map/CustomMapViewer'
import type { MapData } from './custom-map/types'

export interface MarkdownRendererProps {
  /** 表示する Markdown 本文。 */
  body: string
}

/** data-custom-map 属性（文字列）から MapData を安全に復元する。失敗時 null。 */
function parseMapDataAttr(value: unknown): MapData | null {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value) as MapData
  } catch {
    return null
  }
}

/** http/https の絶対 URL（＝外部リンク）かどうかを判定する。 */
function isExternalHref(href: string | undefined): boolean {
  if (href === undefined) {
    return false
  }
  return /^https?:\/\//i.test(href)
}

// components を現在ページパスに応じて組み立てる。
function buildComponents(): Components {
  return {
    a({ href, children, ...rest }) {
      if (isExternalHref(href)) {
        return (
          <a href={href} rel="noopener noreferrer" target="_blank" {...rest}>
            {children}
          </a>
        )
      }
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      )
    },
    // custom-map 記法は remarkCustomMap が data-custom-map 付きの div に変換する。
    // その div を専用の地図ビューアへ差し替える。それ以外の div は素通しする。
    div({ children, ...rest }) {
      // react-markdown は node を渡すが描画には使わないため取り除く。
      const { node: _node, ...domProps } = rest as Record<string, unknown>
      void _node
      const mapData = parseMapDataAttr(domProps['data-custom-map'])
      if (mapData !== null) {
        return <CustomMapViewer mapData={mapData} />
      }
      return <div {...domProps}>{children}</div>
    },
  }
}

// remarkPlugins は再レンダーで作り直さないようモジュールスコープで固定する。
// 順序: custom-map を fallback の前に置き、custom-map 以外の未対応ディレクティブだけ
// fallback がプレースホルダ化する（fallback は hName 既設を尊重するため共存できる）。
const remarkPlugins = [remarkGfm, remarkDirective, remarkCustomMap, remarkDirectiveFallback]

/**
 * Markdown 本文を安全に（生 HTML 無効で）レンダリングする。
 */
function MarkdownRenderer({ body }: MarkdownRendererProps) {
  if (body === '') {
    return null
  }
  const components = buildComponents()
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {body}
    </ReactMarkdown>
  )
}

export default MarkdownRenderer
