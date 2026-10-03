// ページ閲覧（サブタスク 10.1 の閲覧 + 10.2 の削除導線 + D6 の子ナビ）。
//
// 方針:
// - splat（/view/* の * 部分）から現在パスを解決し、useStorage().getPage(path) で本文を取得する。
//   取得中はローディング、null（404）なら「ページが見つかりません」＋新規作成（/edit/<path>）導線、
//   取得成功ならタイトルと MarkdownRenderer による本文を描画する。
// - listChildren(path) の結果を子ページリンク一覧として表示する（D6 の階層ナビ）。
// - 「編集」リンク（/edit/<path>）と「削除」ボタン（確認の上 deletePage → / へ）を置く。
// - 401/その他エラーは usePageError で処理する（401 は logout＋/login 誘導）。
// - 画面は useStorage() 契約経由のみでデータ操作する（RestClient 具象・fetch を直接使わない）。

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStorage } from '../storage/StorageProvider'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import AppLayout from '../components/AppLayout'
import Breadcrumbs from '../components/Breadcrumbs'
import { usePageError } from './use-page-error'
import styles from './PageViewPage.module.css'
import type { Page, PageSummary } from '../storage/types'

function PageViewPage() {
  const splat = useParams()['*'] ?? ''
  const path = '/' + splat
  const storage = useStorage()
  const navigate = useNavigate()
  const handleError = usePageError()

  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState<Page | null>(null)
  const [children, setChildren] = useState<PageSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const fetched = await storage.getPage(path)
        if (!active) {
          return
        }
        setPage(fetched)
        // 子ページ一覧は本文の有無に関わらず取得を試みる（階層の入口）。
        try {
          const kids = await storage.listChildren(path)
          if (active) {
            setChildren(kids)
          }
        } catch {
          // 子一覧の失敗は致命的でないので握りつぶす（空のまま）。
          if (active) {
            setChildren([])
          }
        }
      } catch (err) {
        if (active) {
          setError(handleError(err, 'ページの取得に失敗しました'))
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
  }, [storage, path, handleError])

  const handleDelete = useCallback(async () => {
    // 確認の上で削除し、成功したら一覧へ戻る。
    if (!window.confirm('このページを削除しますか？')) {
      return
    }
    try {
      await storage.deletePage(path)
      navigate('/', { replace: true })
    } catch (err) {
      setError(handleError(err, 'ページの削除に失敗しました'))
    }
  }, [storage, path, navigate, handleError])

  if (loading) {
    return (
      <AppLayout>
        <p>読み込み中...</p>
      </AppLayout>
    )
  }

  if (error !== null) {
    return (
      <AppLayout>
        <p role="alert" aria-live="assertive">
          {error}
        </p>
      </AppLayout>
    )
  }

  // 404: ページが存在しない。新規作成への導線を出す。
  if (page === null) {
    return (
      <AppLayout>
        <Breadcrumbs path={path} />
        <h1>ページが見つかりません</h1>
        <p>パス: {path}</p>
        <Link to={`/edit${path}`}>このパスで新規作成</Link>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <Breadcrumbs path={path} />
      <h1>{page.title}</h1>
      <nav aria-label="ページ操作" className={styles.actions}>
        <Link to="/" className={styles.listLink}>
          一覧へ
        </Link>
        <Link to={`/edit${path}`} className={styles.editButton}>
          編集
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          className={styles.deleteButton}
        >
          削除
        </button>
      </nav>
      <article>
        <MarkdownRenderer body={page.body} />
      </article>
      {children.length > 0 && (
        <section>
          <h2>子ページ</h2>
          <ul>
            {children.map((child) => (
              <li key={child.path}>
                <Link to={`/view${child.path}`}>{child.title || child.path}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppLayout>
  )
}

export default PageViewPage
