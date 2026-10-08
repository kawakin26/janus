// ログイン画面（要件 4-1）。
//
// 方針:
// - username/password フォーム。label と input を htmlFor/id で関連付け、送信ボタンは type="submit"。
//   エラーは role="alert" / aria-live で読み上げ対象にする（アクセシビリティ配慮）。
// - 送信で useAuth().login を呼ぶ。失敗（ApiError）時は detail があれば表示、無ければ汎用メッセージ。
// - 成功時は元ページ（location.state.from）か / へ replace 遷移する。
// - 既にログイン済み（user!==null）で /login に来たら / へリダイレクトする。
// - 送信中はボタンを disabled にして二重送信を防ぐ。

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
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

  return (
    <main>
      <h1>ログイン</h1>
      <form onSubmit={handleSubmit} noValidate>
        {error !== null && (
          <p role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="username">ユーザー名</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'ログイン中...' : 'ログイン'}
        </button>
      </form>
      <Button type="button" onClick={handleReturnToLocalMode}>
        ローカルモードへ戻る
      </Button>
    </main>
  )
}

export default LoginPage
