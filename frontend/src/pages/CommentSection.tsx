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
import type { Comment } from '../storage/types'

// 投稿/保存ボタン（accent 塗り・元 primaryButton は青塗り）。
const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center rounded bg-primary px-3 py-1.5 text-primary-contrast ' +
  'hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

// 編集/キャンセルボタン（accent 枠線型・元 secondaryButton は青枠）。
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center rounded border border-primary bg-surface px-3 py-1.5 ' +
  'text-primary hover:bg-primary/10 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

// 削除ボタン（danger 枠線型・元 dangerButton は赤枠）。
const DANGER_BUTTON_CLASS =
  'inline-flex items-center rounded border border-danger bg-surface px-3 py-1.5 ' +
  'text-danger hover:bg-danger/10 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

// コメント本文のテキストエリア。
const TEXTAREA_CLASS =
  'w-full box-border rounded border border-border bg-surface px-2 py-2 resize-y text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

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
    <section className="mt-8 pt-6 border-t border-border" aria-label="コメント">
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
        <ul className="list-none m-0 mb-6 p-0 flex flex-col gap-4">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded-md border border-border bg-surface-raised p-3"
            >
              <div className="flex gap-3 items-baseline mb-1.5 text-sm text-fg-muted">
                <span className="font-semibold text-fg">
                  {comment.author?.username ?? '(削除済みユーザー)'}
                </span>
                <time dateTime={comment.created_at}>{comment.created_at}</time>
              </div>
              {editingId === comment.id ? (
                <div className="flex flex-col gap-2">
                  <label className="sr-only" htmlFor={`edit-${comment.id}`}>
                    コメントを編集
                  </label>
                  <textarea
                    id={`edit-${comment.id}`}
                    className={TEXTAREA_CLASS}
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    rows={3}
                  />
                  {editError !== null && (
                    <p role="alert" aria-live="assertive" className="m-0 text-sm text-danger">
                      {editError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => void handleUpdate(comment.id)}
                      className={PRIMARY_BUTTON_CLASS}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className={SECONDARY_BUTTON_CLASS}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* 本文はテキストノードとして描画（dangerouslySetInnerHTML 不使用）。 */}
                  <p className="m-0 whitespace-pre-wrap break-words">{comment.body}</p>
                  {canModify(comment) && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => beginEdit(comment)}
                        className={SECONDARY_BUTTON_CLASS}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(comment.id)}
                        className={DANGER_BUTTON_CLASS}
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

      <form onSubmit={handlePost} className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="comment-draft">
          コメントを投稿
        </label>
        <textarea
          id="comment-draft"
          className={TEXTAREA_CLASS}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="コメントを入力"
        />
        {postError !== null && (
          <p role="alert" aria-live="assertive" className="m-0 text-sm text-danger">
            {postError}
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            type="submit"
            disabled={posting}
            className={PRIMARY_BUTTON_CLASS}
          >
            投稿
          </button>
        </div>
      </form>
    </section>
  )
}

export default CommentSection
