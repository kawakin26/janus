// ページ一覧・階層ナビの入口（サブタスク 10.2 / 要件 2-6）。
//
// 方針:
// - マウント時に useStorage().listChildren('/') でトップレベル直下の一覧（PageSummary[]）を取得し、
//   各項目を /view/<path> へのリンクとして表示する（D6 の最小階層ナビ入口）。
// - 取得中はローディング、空なら「ページがありません」。
// - 新規作成導線: パス入力フォーム → /edit/<入力パス> へ遷移（最小構成）。
// - 401/その他エラーは usePageError で処理する（401 は logout＋/login 誘導）。
// - 画面は useStorage() 契約経由のみでデータ操作する（RestClient 具象・fetch を直接使わない）。

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStorage } from '../storage/StorageProvider'
import AppLayout from '../components/AppLayout'
import { Button } from '../components/ui/Button'
import { Alert } from '../components/ui/Alert'
import { usePageError } from './use-page-error'
import type { PageSummary } from '../storage/types'

/** 入力パスを先頭 / 付き・末尾 / 無しの正規形へ整える。 */
function normalizePath(input: string): string {
  const trimmed = input.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return '/' + trimmed
}

function PageListPage() {
  const storage = useStorage()
  const navigate = useNavigate()
  const handleError = usePageError()

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<PageSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newPath, setNewPath] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const children = await storage.listChildren('/')
        if (active) {
          setItems(children)
        }
      } catch (err) {
        if (active) {
          setError(handleError(err, 'ページ一覧の取得に失敗しました'))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [storage, handleError])

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const path = normalizePath(newPath)
    if (path === '/') {
      return
    }
    navigate(`/edit${path}`)
  }

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold text-fg">ページ一覧</h1>
      <p className="-mt-2 text-fg-muted">ルート直下（/）のページ一覧です。</p>

      {/* 新規作成（§5.2 のフォーム/ボタン/入力体裁・カードは surface-raised + border）。 */}
      <section className="my-6 rounded-md border border-border bg-surface-raised p-4">
        <h2 className="text-lg font-semibold text-fg">新規作成</h2>
        <form
          onSubmit={handleCreate}
          noValidate
          className="mt-3 flex flex-wrap items-center gap-3"
        >
          <label htmlFor="new-path" className="text-sm text-fg">
            パス
          </label>
          <input
            id="new-path"
            name="new-path"
            type="text"
            placeholder="docs/new"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1.5 text-fg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          />
          <Button type="submit">新規作成</Button>
        </form>
      </section>

      {loading ? (
        <p className="text-fg-muted">読み込み中...</p>
      ) : error !== null ? (
        <Alert variant="error" aria-live="assertive">
          {error}
        </Alert>
      ) : items.length === 0 ? (
        <p className="text-fg-muted">ページがありません</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.map((item) => (
            <li key={item.path} className="border-b border-border py-2">
              <Link to={`/view${item.path}`} className="text-primary">
                {item.title || item.path}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppLayout>
  )
}

export default PageListPage
