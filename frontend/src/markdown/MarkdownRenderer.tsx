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

export interface MarkdownRendererProps {
  /** 表示する Markdown 本文。 */
  body: string
}

/** http/https の絶対 URL（＝外部リンク）かどうかを判定する。 */
function isExternalHref(href: string | undefined): boolean {
  if (href === undefined) {
    return false
  }
  return /^https?:\/\//i.test(href)
}

// リンクを安全側に描画するカスタムコンポーネント。
const components: Components = {
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
}

// remarkPlugins は再レンダーで作り直さないようモジュールスコープで固定する。
const remarkPlugins = [remarkGfm, remarkDirective, remarkDirectiveFallback]

/**
 * Markdown 本文を安全に（生 HTML 無効で）レンダリングする。
 */
function MarkdownRenderer({ body }: MarkdownRendererProps) {
  if (body === '') {
    return null
  }
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {body}
    </ReactMarkdown>
  )
}

export default MarkdownRenderer
