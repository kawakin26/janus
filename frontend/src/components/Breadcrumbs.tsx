// パンくずナビ（タスク 13 / 要件 2-6）。
//
// 方針:
// - path を props で受け、toBreadcrumbSegments で分解する（純粋ロジックは breadcrumbs.ts）。
// - 先頭に一覧（/）への「ホーム」リンク、各セグメントは /view/<累積path> へのリンク。
// - 末尾（現在ページ）はリンクにせず aria-current="page" の span で現在地を示す。
// - 全体を <nav aria-label="パンくず"> で囲む（アクセシビリティ）。

import { Link } from 'react-router-dom'
import { toBreadcrumbSegments } from './breadcrumbs'

export interface BreadcrumbsProps {
  /** 現在ページのパス（例 /docs/guide/intro）。先頭 / 付き。 */
  path: string
}

// パンくず項目の共通体裁（§5.2・Zed 風の端正なナビ）。
// セグメント間の区切り「>」は、先頭以外の項目に before: 擬似要素で与える
// （従来の `.item + .item::before { content: '>' }` と同じ見た目・DOM テキスト非混入）。
const ITEM = 'inline-flex items-center gap-1'
const SEPARATOR =
  "before:text-fg-muted before:content-['>'] before:mr-1"
// 現在地（末尾/ホーム）の強調。リンクより控えめな前景色で太字にする。
const CURRENT = 'font-semibold text-fg'
// リンクはアクセント色（index.css の base で下線が付く）。
const LINK = 'text-primary'

function Breadcrumbs({ path }: BreadcrumbsProps) {
  const segments = toBreadcrumbSegments(path)

  return (
    <nav aria-label="パンくず" className="mb-4 text-sm">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
        <li className={ITEM}>
          {segments.length === 0 ? (
            // ルート直下（/）では現在地が「ホーム」。
            <span className={CURRENT} aria-current="page">
              ホーム
            </span>
          ) : (
            <Link to="/" className={LINK}>
              ホーム
            </Link>
          )}
        </li>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1
          return (
            <li key={segment.path} className={`${ITEM} ${SEPARATOR}`}>
              {isLast ? (
                <span className={CURRENT} aria-current="page">
                  {segment.label}
                </span>
              ) : (
                <Link to={`/view${segment.path}`} className={LINK}>
                  {segment.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumbs
