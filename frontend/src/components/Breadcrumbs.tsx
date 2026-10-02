// パンくずナビ（タスク 13 / 要件 2-6）。
//
// 方針:
// - path を props で受け、toBreadcrumbSegments で分解する（純粋ロジックは breadcrumbs.ts）。
// - 先頭に一覧（/）への「ホーム」リンク、各セグメントは /view/<累積path> へのリンク。
// - 末尾（現在ページ）はリンクにせず aria-current="page" の span で現在地を示す。
// - 全体を <nav aria-label="パンくず"> で囲む（アクセシビリティ）。

import { Link } from 'react-router-dom'
import { toBreadcrumbSegments } from './breadcrumbs'
import styles from './Breadcrumbs.module.css'

export interface BreadcrumbsProps {
  /** 現在ページのパス（例 /docs/guide/intro）。先頭 / 付き。 */
  path: string
}

function Breadcrumbs({ path }: BreadcrumbsProps) {
  const segments = toBreadcrumbSegments(path)

  return (
    <nav aria-label="パンくず" className={styles.breadcrumbs}>
      <ol className={styles.list}>
        <li className={styles.item}>
          {segments.length === 0 ? (
            // ルート直下（/）では現在地が「ホーム」。
            <span className={styles.current} aria-current="page">
              ホーム
            </span>
          ) : (
            <Link to="/">ホーム</Link>
          )}
        </li>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1
          return (
            <li key={segment.path} className={styles.item}>
              {isLast ? (
                <span className={styles.current} aria-current="page">
                  {segment.label}
                </span>
              ) : (
                <Link to={`/view${segment.path}`}>{segment.label}</Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumbs
