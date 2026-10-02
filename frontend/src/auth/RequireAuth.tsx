// ルートガード（要件 4-2, design 9 章）。
//
// 方針:
// - loading 中（起動時のユーザー復元が未完了）はリダイレクトせずローディング表示にする。
//   これにより認証済みでも一瞬 /login へ飛ぶ「ちらつき」を防ぐ。
// - 未認証（user===null）なら /login へリダイレクトし、元の遷移先を location.state.from に積む。
//   ログイン成功後に元ページへ戻せるようにするため。
// - 認証済みなら子要素をそのまま表示する。

import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

export interface RequireAuthProps {
  children: ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { user, loading } = useAuth()
  const location = useLocation()

  // 復元中はリダイレクト判定を保留し、ローディングを表示する（ちらつき防止）。
  if (loading) {
    return (
      <main aria-busy="true">
        <p>読み込み中...</p>
      </main>
    )
  }

  // 未認証は /login へ。元の遷移先を from に積んでログイン後に復帰できるようにする。
  if (user === null) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}
