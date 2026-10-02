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
import { usePageError } from './use-page-error'
import styles from './PageListPage.module.css'
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
      <h1>ページ一覧</h1>
      <p className={styles.lead}>ルート直下（/）のページ一覧です。</p>

      <section className={styles.createSection}>
        <h2>新規作成</h2>
        <form onSubmit={handleCreate} noValidate className={styles.createForm}>
          <label htmlFor="new-path">パス</label>
          <input
            id="new-path"
            name="new-path"
            type="text"
            placeholder="docs/new"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button type="submit">新規作成</button>
        </form>
      </section>

      {loading ? (
        <p>読み込み中...</p>
      ) : error !== null ? (
        <p role="alert" aria-live="assertive">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p>ページがありません</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.path}>
              <Link to={`/view${item.path}`}>{item.title || item.path}</Link>
            </li>
          ))}
        </ul>
      )}
    </AppLayout>
  )
}

export default PageListPage
