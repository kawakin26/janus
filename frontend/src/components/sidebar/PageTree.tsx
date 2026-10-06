// ページツリーのコンテナ（design §3.3/§3.4/§3.7/§3.10/§3.13）。
//
// - 取得: useStorage().getPageTree('/') を初回 1 回だけ呼ぶ（遅延ロードしない）。
// - 状態: tree（1 つのネスト構造）+ expanded（Set<string>）のみ。子キャッシュ Map は持たない。
// - 初期展開: readExpanded() ∪ ancestorPaths(現在パス)（復元を先に、現在パス祖先を追加・§3.7）。
// - 永続化: expanded 変化のたび writeExpanded。
// - 一括ボタン: すべて展開=expandablePaths(tree) / すべて折り畳む=空集合（追加ネットワーク無し）。
// - ローディング/エラー: 控えめな text-fg-muted text-sm。401 は usePageError に委譲。
//   ツリー取得失敗は本文描画を妨げず、サイドバー局所の劣化に留める。

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStorage } from '../../storage/StorageProvider'
import type { PageTreeNode } from '../../storage/types'
import { usePageError } from '../../pages/use-page-error'
import { currentPagePath } from './current-path'
import {
  ancestorPaths,
  expandablePaths,
  readExpanded,
  writeExpanded,
} from './tree-expand'
import { PageTreeNodeRow } from './PageTreeNodeRow'

export interface PageTreeProps {
  onNavigate?: () => void
}

export function PageTree({ onNavigate }: PageTreeProps) {
  const storage = useStorage()
  const handleError = usePageError()
  const { pathname } = useLocation()
  const current = currentPagePath(pathname)

  const [tree, setTree] = useState<PageTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 初期展開集合: 復元 ∪ 現在パス祖先（§3.7）。遅延初期化で初回のみ算出する。
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set<string>([...readExpanded(), ...ancestorPaths(currentPagePath(pathname) ?? '')]),
  )

  // 取得は初回 1 回だけ（storage 参照は安定）。クリーンアップで古い結果を無視する。
  useEffect(() => {
    // 初回マウント時のみ実行する（loading は初期 true・error は初期 null のため
    // 同期的な setState は不要。結果は非同期コールバック内でのみ反映する）。
    let active = true
    storage
      .getPageTree('/')
      .then((nodes) => {
        if (!active) return
        setTree(nodes)
      })
      .catch((err: unknown) => {
        if (!active) return
        // 401 は usePageError が logout＋/login 遷移し null を返す（表示抑止）。
        const message = handleError(err, 'ツリーを読み込めませんでした')
        setError(message)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [storage, handleError])

  // 永続化: expanded が変わるたび保存する。
  useEffect(() => {
    writeExpanded([...expanded])
  }, [expanded])

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(expandablePaths(tree)))
  const collapseAll = () => setExpanded(new Set())

  const isCurrent = (path: string) => current !== null && path === current

  const bulkButton =
    'whitespace-nowrap rounded px-2 py-1 text-xs text-fg hover:bg-surface ' +
    'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

  return (
    <div className="mt-1">
      <div className="mb-1 flex items-center gap-1">
        <button type="button" onClick={expandAll} className={bulkButton}>
          <span aria-hidden="true">＋</span> 全展開
        </button>
        <button type="button" onClick={collapseAll} className={bulkButton}>
          <span aria-hidden="true">－</span> 全折畳
        </button>
      </div>

      {loading ? (
        <p className="text-fg-muted text-sm">読み込み中…</p>
      ) : error !== null ? (
        <p className="text-fg-muted text-sm">{error}</p>
      ) : (
        <ul role="tree" aria-label="ページ" className="flex flex-col">
          {tree.map((node) => (
            <PageTreeNodeRow
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              isCurrent={isCurrent}
              onToggle={toggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export default PageTree
