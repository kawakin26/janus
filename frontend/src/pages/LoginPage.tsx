// ログイン画面（要件 4-1）。
//
// 方針:
// - username/password フォーム。label と input を htmlFor/id で関連付け、送信ボタンは type="submit"。
//   エラーは既存 Alert（error variant・role="alert"）で読み上げ対象にする（アクセシビリティ配慮）。
// - レイアウトは ModeGate と同じ中央寄せカードをデザイントークンだけで組む（独自色は使わない）。
// - 送信で useAuth().login を呼ぶ。失敗（ApiError）時は detail があれば表示、無ければ汎用メッセージ。
// - 成功時は元ページ（location.state.from）か / へ replace 遷移する。
// - 既にログイン済み（user!==null）で /login に来たら / へリダイレクトする。
// - 送信中はボタンを disabled にして二重送信を防ぐ。

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { writeMode } from '../storage/mode'
import { ApiError } from '../storage/types'

/** location.state.from として積まれる遷移元の最小形。 */
interface LocationState {
  from?: { pathname?: string }
}

function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // ログイン後に戻る先。RequireAuth が積んだ from があればそこへ、無ければ / へ。
  const state = location.state as LocationState | null
  const redirectTo = state?.from?.pathname ?? '/'

  // 既にログイン済みで /login に来た場合は保護ルートへ戻す。
  if (user !== null) {
    return <Navigate to={redirectTo} replace />
  }

  const handleReturnToLocalMode = () => {
    writeMode('local')
    window.location.reload()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      // ApiError.detail があれば優先的に表示し、無ければ汎用メッセージ。
      if (err instanceof ApiError && err.detail !== undefined) {
        setError(err.detail)
      } else {
        setError('ユーザー名またはパスワードが違います')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // レイアウトは ModeGate と同じ「全画面中央寄せカード」をデザイントークンだけで組む。
  // 外側で水平/垂直中央、内側カードにフォームを縦積みで載せる。文言・入力属性は不変。
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-fg px-4">
      <main className="w-full max-w-sm rounded-lg border border-border bg-surface-raised p-8">
        <h1 className="text-xl font-semibold">ログイン</h1>
        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          {/* エラーは既存 Alert（error variant・role="alert"）で割り込み通知する。 */}
          {error !== null && <Alert variant="error">{error}</Alert>}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username">ユーザー名</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password">パスワード</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full"
            />
          </div>
          {/* 主要アクションは accent。type="submit" を保持して Enter 送信を維持する。 */}
          <Button
            variant="accent"
            type="submit"
            disabled={submitting}
            className="w-full justify-center"
          >
            {submitting ? 'ログイン中...' : 'ログイン'}
          </Button>
        </form>
        {/* フォーム外の副次導線。区切り線で分けて縦に揃える。 */}
        <div className="mt-6 border-t border-border pt-6">
          <Button
            type="button"
            onClick={handleReturnToLocalMode}
            className="w-full justify-center"
          >
            ローカルモードへ戻る
          </Button>
        </div>
      </main>
    </div>
  )
}

export default LoginPage
