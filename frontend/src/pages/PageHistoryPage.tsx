// ページ履歴（タスク18）。
//
// 方針:
// - splat（/history/* の * 部分）から現在パスを解決し（PageViewPage 流儀）、
//   マウント時に getEffectivePermission(path) を取得する。
//   view が false（または 403）のときはリビジョン一覧・本文を描画せず
//   「閲覧権限がありません」を role="alert" で表示する。
// - view 可のときは listRevisions(path, {limit, offset}) で履歴一覧を新しい順に表示し、
//   「次へ/前へ」で offset を進める最小ページング（総件数 API が無いため、取得件数が
//   limit 未満なら「次へ」を無効化）。
// - from/to の number をセレクト2つで選び diffRevisions(path, from, to) を呼ぶと、
//   DiffLine[] を行単位で add/del/equal に色分けして描画する。
// - edit 可のときのみ各リビジョン行に「このリビジョンに復元」ボタンを出し、
//   確認の上 restoreRevision(path, number) → /view/<path> へ遷移する。
// - 401/その他エラーは usePageError（401 は logout＋/login 誘導）。
// - 画面は useStorage() 契約経由のみでデータ操作する（RestClient 具象・fetch を直接使わない）。

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStorage } from '../storage/StorageProvider'
import AppLayout from '../components/AppLayout'
import Breadcrumbs from '../components/Breadcrumbs'
import { usePageError } from './use-page-error'
import { ApiError } from '../storage/types'
import type {
  DiffLine,
  EffectivePermission,
  RevisionSummary,
} from '../storage/types'

const PAGE_SIZE = 50

// 復元ボタン（accent 枠線型・元は青枠 #2563eb）。
const RESTORE_BUTTON_CLASS =
  'inline-flex items-center rounded border border-primary bg-surface-raised px-3 py-1 ' +
  'text-primary hover:bg-primary/10 ml-auto ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

// 差分行の op 別色（統一性優先で success/danger トークンの /alpha 下地に寄せる）。
const DIFF_ROW_BASE = 'flex gap-2 px-2 py-0.5 whitespace-pre-wrap'

function PageHistoryPage() {
  const splat = useParams()['*'] ?? ''
  const path = '/' + splat
  const storage = useStorage()
  const navigate = useNavigate()
  const handleError = usePageError()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [perm, setPerm] = useState<EffectivePermission>({ view: false, edit: false })
  const [revisions, setRevisions] = useState<RevisionSummary[]>([])
  const [offset, setOffset] = useState(0)

  // 差分表示の選択状態と結果。
  const [fromNumber, setFromNumber] = useState<number | null>(null)
  const [toNumber, setToNumber] = useState<number | null>(null)
  const [diff, setDiff] = useState<DiffLine[] | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)

  // 初回に実効権限を取得する（view が無ければ一覧取得そのものを行わない）。
  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setError(null)
      setPerm({ view: false, edit: false })
      try {
        const effective = await storage.getEffectivePermission(path)
        if (!active) {
          return
        }
        setPerm(effective)
        if (!effective.view) {
          // view 不足: 一覧・本文を描画しない。
          setError('閲覧権限がありません')
        }
      } catch (err) {
        if (active) {
          const fallback =
            err instanceof ApiError && err.status === 403
              ? '閲覧権限がありません'
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

  // view 可かつ offset 変化のたびに履歴一覧を取得する。
  useEffect(() => {
    if (!perm.view) {
      return
    }
    let active = true
    void (async () => {
      try {
        const list = await storage.listRevisions(path, { limit: PAGE_SIZE, offset })
        if (active) {
          setRevisions(list)
        }
      } catch (err) {
        if (active) {
          const fallback =
            err instanceof ApiError && err.status === 403
              ? '閲覧権限がありません'
              : '履歴の取得に失敗しました'
          setError(handleError(err, fallback))
          setRevisions([])
        }
      }
    })()
    return () => {
      active = false
    }
  }, [storage, path, handleError, perm.view, offset])

  const handleDiff = useCallback(async () => {
    setDiffError(null)
    setDiff(null)
    if (fromNumber === null || toNumber === null) {
      setDiffError('比較する2件のリビジョンを選択してください')
      return
    }
    try {
      const result = await storage.diffRevisions(path, fromNumber, toNumber)
      setDiff(result)
    } catch (err) {
      const fallback =
        err instanceof ApiError && err.status === 403
          ? '閲覧権限がありません'
          : '差分の取得に失敗しました'
      setDiffError(handleError(err, fallback))
    }
  }, [storage, path, fromNumber, toNumber, handleError])

  const handleRestore = useCallback(
    async (number: number) => {
      if (!window.confirm(`リビジョン #${number} に復元しますか？`)) {
        return
      }
      try {
        await storage.restoreRevision(path, number)
        navigate(`/view${path}`, { replace: true })
      } catch (err) {
        const fallback =
          err instanceof ApiError && err.status === 403
            ? '編集権限がありません'
            : '復元に失敗しました'
        setError(handleError(err, fallback))
      }
    },
    [storage, path, navigate, handleError],
  )

  if (loading) {
    return (
      <AppLayout>
        <p>読み込み中...</p>
      </AppLayout>
    )
  }

  // view 不足・その他エラーのときは一覧・本文を描画しない。
  if (error !== null) {
    return (
      <AppLayout>
        <Breadcrumbs path={path} />
        <h1>ページ履歴</h1>
        <p role="alert" aria-live="assertive">
          {error}
        </p>
      </AppLayout>
    )
  }

  const opClassName = (op: DiffLine['op']): string => {
    if (op === 'add') return `${DIFF_ROW_BASE} bg-success/10 text-success`
    if (op === 'del') return `${DIFF_ROW_BASE} bg-danger/10 text-danger`
    return `${DIFF_ROW_BASE} text-fg`
  }

  const opLabel = (op: DiffLine['op']): string => {
    if (op === 'add') return '追加'
    if (op === 'del') return '削除'
    return '変更なし'
  }

  return (
    <AppLayout>
      <Breadcrumbs path={path} />
      <h1>ページ履歴</h1>
      <p>パス: {path}</p>

      <section>
        <h2>リビジョン一覧</h2>
        {revisions.length === 0 ? (
          <p>リビジョンがありません。</p>
        ) : (
          <ul className="list-none p-0 mb-4" aria-label="リビジョン一覧">
            {revisions.map((rev) => (
              <li
                key={rev.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-2"
              >
                <span className="min-w-12 font-semibold">#{rev.number}</span>
                <span className="text-sm text-fg-muted">{rev.created_at}</span>
                <span className="text-sm text-fg-muted">
                  {rev.author ? rev.author.username : '不明'}
                </span>
                {perm.edit && (
                  <button
                    type="button"
                    className={RESTORE_BUTTON_CLASS}
                    onClick={() => handleRestore(rev.number)}
                  >
                    このリビジョンに復元
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <nav aria-label="ページング" className="flex gap-3 mb-6">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            前へ
          </button>
          <button
            type="button"
            disabled={revisions.length < PAGE_SIZE}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            次へ
          </button>
        </nav>
      </section>

      <section>
        <h2>差分表示</h2>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <label htmlFor="diff-from">比較元</label>
          <select
            id="diff-from"
            value={fromNumber ?? ''}
            onChange={(e) =>
              setFromNumber(e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">選択してください</option>
            {revisions.map((rev) => (
              <option key={rev.id} value={rev.number}>
                #{rev.number}
              </option>
            ))}
          </select>
          <label htmlFor="diff-to">比較先</label>
          <select
            id="diff-to"
            value={toNumber ?? ''}
            onChange={(e) =>
              setToNumber(e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">選択してください</option>
            {revisions.map((rev) => (
              <option key={rev.id} value={rev.number}>
                #{rev.number}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleDiff}>
            差分を表示
          </button>
        </div>
        {diffError !== null && (
          <p role="alert" aria-live="assertive">
            {diffError}
          </p>
        )}
        {diff !== null && (
          <ul className="list-none p-0 m-0 font-mono text-sm">
            {diff.map((entry, index) => (
              <li
                key={index}
                className={opClassName(entry.op)}
                data-op={entry.op}
              >
                <span className="w-4 text-center select-none" aria-hidden="true">
                  {entry.op === 'add' ? '+' : entry.op === 'del' ? '-' : ' '}
                </span>
                <span className="sr-only">{opLabel(entry.op)}</span>
                <span className="flex-1">{entry.line}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppLayout>
  )
}

export default PageHistoryPage
