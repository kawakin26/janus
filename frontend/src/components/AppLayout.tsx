// 共通レイアウト（タスク 13）。
//
// 方針（計画の確定判断に接地）:
// - 保護画面の共通ヘッダー（<header>）＋ <main> ラッパを 1 箇所に集約する。
// - useAuth() を直読みし、user===null（未ログイン / 復元中）のときはヘッダーを出さず children のみ返す。
//   これは従来 App.tsx の LogoutBar が持っていた「user が null なら非表示」挙動の踏襲。
//   /login・404 はこのレイアウト外のままなのでヘッダーは出ない（既存挙動を自然に維持）。
// - ヘッダー: アプリ名「Janus」を / へのリンク、「ページ一覧」導線（/）、username、ログアウトボタン。
//   ログアウトは logout() → /login へ replace 遷移（従来挙動と同じ）。
// - 追加 Context や props は増やさない（children のみ）。

import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import styles from './AppLayout.module.css'

export interface AppLayoutProps {
  children: ReactNode
}

function AppLayout({ children }: AppLayoutProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  // user が null（未ログイン / 復元中）のときはヘッダーを出さない（従来 LogoutBar 挙動）。
  if (user === null) {
    return <main className={styles.main}>{children}</main>
  }

  return (
    <>
      <header className={styles.header}>
        <nav className={styles.nav} aria-label="グローバル">
          <Link to="/" className={styles.brand}>
            Janus
          </Link>
          <Link to="/">ページ一覧</Link>
          <Link to="/assets">アセットライブラリ</Link>
        </nav>
        <div className={styles.account}>
          <span>{user.username}</span>
          <button type="button" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  )
}

export default AppLayout
