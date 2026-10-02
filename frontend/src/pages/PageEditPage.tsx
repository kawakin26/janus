// ページ作成・編集（サブタスク 10.2 / 要件 2-1, 2-2, 2-7）。
//
// 方針:
// - splat（/edit/* の * 部分）から現在パスを解決し、マウント時に getPage(path) を試みる。
//   既存（Page が返る）なら title/body を初期値にした「編集（updatePage）」モード、
//   null なら「新規作成（createPage）」モードにする。
// - フォームは title（任意）と body（Markdown テキストエリア）。label と input を
//   htmlFor/id で関連付け、送信中は二重送信防止で disabled にする（LoginPage の流儀）。
// - 保存成功で /view/<path> へ遷移する。
// - 新規作成時に createPage が ApiError(409) を throw したら「同一パスのページが既に存在します」を
//   role="alert" で表示して遷移しない（要件 2-7）。detail があればそれを優先。
// - 401/その他は usePageError で処理する（401 は logout＋/login 誘導）。
// - 画面は useStorage() 契約経由のみでデータ操作する（RestClient 具象・fetch を直接使わない）。

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStorage } from '../storage/StorageProvider'
import { usePageError } from './use-page-error'
import { ApiError } from '../storage/types'

function PageEditPage() {
  const splat = useParams()['*'] ?? ''
  const path = '/' + splat
  const storage = useStorage()
  const navigate = useNavigate()
  const handleError = usePageError()

  const [loading, setLoading] = useState(true)
  // 既存ページか新規作成かの判定。true なら updatePage、false なら createPage。
  const [isExisting, setIsExisting] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        if (fetched !== null) {
          setIsExisting(true)
          setTitle(fetched.title)
          setBody(fetched.body)
        } else {
          setIsExisting(false)
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (isExisting) {
        await storage.updatePage(path, { title, body })
      } else {
        await storage.createPage({ path, title, body })
      }
      navigate(`/view${path}`, { replace: true })
    } catch (err) {
      // 新規作成時の重複パス（409）は専用の日本語メッセージを出す。
      if (err instanceof ApiError && err.status === 409) {
        setError(err.detail ?? '同一パスのページが既に存在します')
      } else {
        setError(handleError(err, 'ページの保存に失敗しました'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main>
        <p>読み込み中...</p>
      </main>
    )
  }

  return (
    <main>
      <h1>{isExisting ? 'ページ編集' : 'ページ新規作成'}</h1>
      <p>パス: {path}</p>
      <form onSubmit={handleSubmit} noValidate>
        {error !== null && (
          <p role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="title">タイトル</label>
          <input
            id="title"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="body">本文（Markdown）</label>
          <textarea
            id="body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? '保存中...' : '保存'}
        </button>
      </form>
    </main>
  )
}

export default PageEditPage
