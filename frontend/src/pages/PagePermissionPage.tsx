// ページ権限設定（タスク19）。
//
// 方針:
// - splat（/permissions/* の * 部分）から現在パスを解決し（PageViewPage 流儀）、
//   マウント時に getEffectivePermission(path) を取得する。
//   edit が false（または 403）のときは一覧・フォームを描画せず
//   「編集権限がありません」を role="alert" で表示する（権限設定系 403 は編集文言に集約）。
// - edit 可のときは listPermissions(path) で現在のエントリ一覧を表示し、
//   主体(user/group)×action(view/edit)×effect(allow/deny) の最小フォームで
//   grantPermission を呼ぶ。principalId は数値入力。重複は 409 で日本語メッセージ。
//   各行で updatePermission(id, effect)（effect 切替）・revokePermission(id)（取消）。
//   各操作後に listPermissions を再取得して一覧を更新する。
// - 401/その他エラーは usePageError（401 は logout＋/login 誘導、403 は「編集権限がありません」）。
// - 画面は useStorage() 契約経由のみでデータ操作する（RestClient 具象・fetch を直接使わない）。

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useStorage } from '../storage/StorageProvider'
import AppLayout from '../components/AppLayout'
import Breadcrumbs from '../components/Breadcrumbs'
import { usePageError } from './use-page-error'
import { ApiError } from '../storage/types'
import type { PermissionEntry } from '../storage/types'
import styles from './PagePermissionPage.module.css'

type PrincipalType = 'user' | 'group'
type Action = 'view' | 'edit'
type Effect = 'allow' | 'deny'

function PagePermissionPage() {
  const splat = useParams()['*'] ?? ''
  const path = '/' + splat
  const storage = useStorage()
  const handleError = usePageError()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<PermissionEntry[]>([])

  // 付与フォームの入力状態。
  const [principalType, setPrincipalType] = useState<PrincipalType>('user')
  const [principalId, setPrincipalId] = useState('')
  const [action, setAction] = useState<Action>('view')
  const [effect, setEffect] = useState<Effect>('allow')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reloadEntries = useCallback(async () => {
    const list = await storage.listPermissions(path)
    setEntries(list)
  }, [storage, path])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const effective = await storage.getEffectivePermission(path)
        if (!active) {
          return
        }
        if (!effective.edit) {
          // edit 不足: 一覧・フォームを描画しない。
          setError('編集権限がありません')
          return
        }
        const list = await storage.listPermissions(path)
        if (active) {
          setEntries(list)
        }
      } catch (err) {
        if (active) {
          const fallback =
            err instanceof ApiError && err.status === 403
              ? '編集権限がありません'
              : '権限の取得に失敗しました'
          setError(handleError(err, fallback))
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

  const handleGrant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const idValue = Number(principalId)
    if (principalId.trim() === '' || Number.isNaN(idValue)) {
      setFormError('主体IDには数値を入力してください')
      return
    }
    setSubmitting(true)
    try {
      await storage.grantPermission({
        path,
        principalType,
        principalId: idValue,
        action,
        effect,
      })
      setPrincipalId('')
      await reloadEntries()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError(err.detail ?? '同一の権限が既に存在します')
      } else {
        const fallback =
          err instanceof ApiError && err.status === 403
            ? '編集権限がありません'
            : '権限の付与に失敗しました'
        setFormError(handleError(err, fallback))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = useCallback(
    async (id: number, nextEffect: Effect) => {
      try {
        await storage.updatePermission(id, nextEffect)
        await reloadEntries()
      } catch (err) {
        const fallback =
          err instanceof ApiError && err.status === 403
            ? '編集権限がありません'
            : '権限の更新に失敗しました'
        setError(handleError(err, fallback))
      }
    },
    [storage, reloadEntries, handleError],
  )

  const handleRevoke = useCallback(
    async (id: number) => {
      if (!window.confirm('この権限エントリを削除しますか？')) {
        return
      }
      try {
        await storage.revokePermission(id)
        await reloadEntries()
      } catch (err) {
        const fallback =
          err instanceof ApiError && err.status === 403
            ? '編集権限がありません'
            : '権限の削除に失敗しました'
        setError(handleError(err, fallback))
      }
    },
    [storage, reloadEntries, handleError],
  )

  if (loading) {
    return (
      <AppLayout>
        <p>読み込み中...</p>
      </AppLayout>
    )
  }

  // edit 不足・その他エラーのときは一覧・フォームを描画しない。
  if (error !== null) {
    return (
      <AppLayout>
        <Breadcrumbs path={path} />
        <h1>権限設定</h1>
        <p role="alert" aria-live="assertive">
          {error}
        </p>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <Breadcrumbs path={path} />
      <h1>権限設定</h1>
      <p>パス: {path}</p>

      <section>
        <h2>権限エントリ</h2>
        {entries.length === 0 ? (
          <p>権限エントリがありません。</p>
        ) : (
          <ul className={styles.entryList}>
            {entries.map((entry) => (
              <li key={entry.id} className={styles.entryItem}>
                <span>
                  {entry.principalType === 'user' ? 'ユーザー' : 'グループ'} #
                  {entry.principalId}
                </span>
                <span>{entry.action === 'view' ? '閲覧' : '編集'}</span>
                <label className={styles.entryEffect}>
                  <span className={styles.visuallyHidden}>
                    効果（#{entry.id}）
                  </span>
                  <select
                    aria-label={`効果（#${entry.id}）`}
                    value={entry.effect}
                    onChange={(e) =>
                      handleUpdate(entry.id, e.target.value as Effect)
                    }
                  >
                    <option value="allow">許可</option>
                    <option value="deny">拒否</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.revokeButton}
                  onClick={() => handleRevoke(entry.id)}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>権限を付与</h2>
        <form onSubmit={handleGrant} noValidate className={styles.form}>
          {formError !== null && (
            <p role="alert" aria-live="assertive">
              {formError}
            </p>
          )}
          <div className={styles.field}>
            <label htmlFor="principalType">主体種別</label>
            <select
              id="principalType"
              value={principalType}
              onChange={(e) => setPrincipalType(e.target.value as PrincipalType)}
            >
              <option value="user">ユーザー</option>
              <option value="group">グループ</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="principalId">主体ID</label>
            <input
              id="principalId"
              name="principalId"
              type="number"
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="action">操作</label>
            <select
              id="action"
              value={action}
              onChange={(e) => setAction(e.target.value as Action)}
            >
              <option value="view">閲覧</option>
              <option value="edit">編集</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="effect">効果</label>
            <select
              id="effect"
              value={effect}
              onChange={(e) => setEffect(e.target.value as Effect)}
            >
              <option value="allow">許可</option>
              <option value="deny">拒否</option>
            </select>
          </div>
          <div className={styles.actions}>
            <button type="submit" disabled={submitting}>
              {submitting ? '付与中...' : '付与'}
            </button>
          </div>
        </form>
      </section>
    </AppLayout>
  )
}

export default PagePermissionPage
