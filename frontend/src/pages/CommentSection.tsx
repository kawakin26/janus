// ページ閲覧画面のコメント欄（タスク 18 / design 2.2・4 章）。
//
// 方針:
// - useStorage() 契約のみでデータ操作する（RestClient 具象・fetch を直接使わない）。
// - 一覧は作成日時昇順（サーバーが昇順で返す）。投稿フォームと、各コメントの
//   編集・削除導線を持つ。
// - 本文は React のテキストノード（{comment.body}）として描画し、
//   dangerouslySetInnerHTML を一切使わない（プレーンテキスト・XSS 経路を作らない）。
// - 編集/削除ボタンの可視性は「投稿者本人 or ページ edit 権限」で出し分ける（補助表示）。
//   最終的な認可はサーバーが担うため、ここでの出し分けはヒントに過ぎない。
// - エラーは usePageError で分岐する（401 は logout+/login、403 は権限メッセージ、
//   400 等は detail またはフォールバック）。

import { useCallback, useEffect, useState } from 'react'
import { useStorage } from '../storage/StorageProvider'
import { useAuth } from '../auth/AuthContext'
import { usePageError } from './use-page-error'
import styles from './CommentSection.module.css'
import type { Comment } from '../storage/types'

interface CommentSectionProps {
  /** 対象ページのパス（例: /docs/intro）。 */
  path: string
  /** 現在ユーザーがこのページを編集できるか（導線の出し分け補助）。 */
  canEdit: boolean
}

function CommentSection({ path, canEdit }: CommentSectionProps) {
  const storage = useStorage()
  const { user } = useAuth()
  const handleError = usePageError()

  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // 投稿フォーム。
  const [draft, setDraft] = useState('')
  const [postError, setPostError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  // 編集中のコメント（id）と編集本文、編集エラー。
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setListError(null)
      try {
        const fetched = await storage.listComments(path)
        if (active) {
          setComments(fetched)
        }
      } catch (err) {
        if (active) {
          setListError(handleError(err, 'コメントの取得に失敗しました'))
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

  const handlePost = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setPostError(null)
      setPosting(true)
      try {
        const created = await storage.addComment(path, draft)
        setComments((prev) => [...prev, created])
        setDraft('')
      } catch (err) {
        setPostError(handleError(err, 'コメントの投稿に失敗しました'))
      } finally {
        setPosting(false)
      }
    },
    [storage, path, draft, handleError],
  )

  const beginEdit = useCallback((comment: Comment) => {
    setEditingId(comment.id)
    setEditDraft(comment.body)
    setEditError(null)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
    setEditError(null)
  }, [])

  const handleUpdate = useCallback(
    async (id: number) => {
      setEditError(null)
      try {
        const updated = await storage.updateComment(id, editDraft)
        setComments((prev) =>
          prev.map((item) => (item.id === id ? updated : item)),
        )
        setEditingId(null)
        setEditDraft('')
      } catch (err) {
        setEditError(handleError(err, 'コメントの更新に失敗しました'))
      }
    },
    [storage, editDraft, handleError],
  )

  const handleDelete = useCallback(
    async (id: number) => {
      if (!window.confirm('このコメントを削除しますか？')) {
        return
      }
      try {
        await storage.deleteComment(id)
        setComments((prev) => prev.filter((item) => item.id !== id))
      } catch (err) {
        setListError(handleError(err, 'コメントの削除に失敗しました'))
      }
    },
    [storage, handleError],
  )

  /** 投稿者本人 or ページ edit 権限なら編集/削除導線を見せる（補助表示）。 */
  const canModify = useCallback(
    (comment: Comment): boolean => {
      if (canEdit) {
        return true
      }
      return (
        user !== null &&
        comment.author !== null &&
        comment.author.id === user.id
      )
    },
    [canEdit, user],
  )

  return (
    <section className={styles.section} aria-label="コメント">
      <h2>コメント</h2>

      {loading ? (
        <p>コメントを読み込み中...</p>
      ) : listError !== null ? (
        <p role="alert" aria-live="assertive">
          {listError}
        </p>
      ) : comments.length === 0 ? (
        <p>まだコメントはありません。</p>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.author}>
                  {comment.author?.username ?? '(削除済みユーザー)'}
                </span>
                <time dateTime={comment.created_at}>{comment.created_at}</time>
              </div>
              {editingId === comment.id ? (
                <div className={styles.editForm}>
                  <label className={styles.srOnly} htmlFor={`edit-${comment.id}`}>
                    コメントを編集
                  </label>
                  <textarea
                    id={`edit-${comment.id}`}
                    className={styles.textarea}
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    rows={3}
                  />
                  {editError !== null && (
                    <p role="alert" aria-live="assertive" className={styles.error}>
                      {editError}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <button
                      type="button"
                      onClick={() => void handleUpdate(comment.id)}
                      className={styles.primaryButton}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className={styles.secondaryButton}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* 本文はテキストノードとして描画（dangerouslySetInnerHTML 不使用）。 */}
                  <p className={styles.body}>{comment.body}</p>
                  {canModify(comment) && (
                    <div className={styles.actions}>
                      <button
                        type="button"
                        onClick={() => beginEdit(comment)}
                        className={styles.secondaryButton}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(comment.id)}
                        className={styles.dangerButton}
                      >
                        削除
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handlePost} className={styles.postForm}>
        <label className={styles.srOnly} htmlFor="comment-draft">
          コメントを投稿
        </label>
        <textarea
          id="comment-draft"
          className={styles.textarea}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="コメントを入力"
        />
        {postError !== null && (
          <p role="alert" aria-live="assertive" className={styles.error}>
            {postError}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="submit"
            disabled={posting}
            className={styles.primaryButton}
          >
            投稿
          </button>
        </div>
      </form>
    </section>
  )
}

export default CommentSection
