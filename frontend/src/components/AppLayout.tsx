// 共通レイアウト（デザインシステム刷新・タスク 3）。
//
// 方針（design.md §4 に接地）:
// - Zed docs 風の「上部ヘッダー + 左サイドバーナビ + 中央本文」。見た目は Tailwind v4 ユーティリティ
//   へ全面移行し、Preflight をそのまま活かす（導入前の UA 既定へ revert する一時互換コードは書かない）。
// - 非破壊（§4.2）: useAuth() を直読みし、user===null（未ログイン / 復元中）のときはヘッダー/サイドバーを
//   出さず <main> のみ返す。/login・404 はこのレイアウト外のまま（App.tsx は変更しない）。
//   ログアウトは logout() → /login へ replace 遷移（従来挙動と同じ）。既存 aria/テキストを維持。
// - レスポンシブ（§4.3）: 広幅（md: 以上）はサイドバー常設。狭幅はヘッダーのハンバーガーで
//   モーダルオーバーレイとして開閉する。開時は最初のナビ項目へフォーカス移動、Escape / 背景クリック /
//   ナビ項目選択で閉じ、閉時はハンバーガーへフォーカス復帰。展開中は背後コンテナへ inert を付与する。
//   モーダル挙動（フォーカス移動/復帰・inert・aria-modal）は狭幅のオーバーレイ表示時のみ適用し、
//   広幅常設時は適用しない。

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ThemeToggle } from '../theme/ThemeToggle'
import PageTree from './sidebar/PageTree'

export interface AppLayoutProps {
  children: ReactNode
}

// グローバル導線（§4.4）。文脈導線（履歴 / 権限 / 編集）はここに出さない。
const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/', label: 'ページ一覧' },
  { to: '/assets', label: 'アセットライブラリ' },
]

// 共通ナビ本体。常設サイドバーとモバイルオーバーレイの双方で使う。
// firstItemRef は（オーバーレイ時のみ）開いた直後に最初のナビ項目へフォーカスするための参照。
function NavItems({
  pathname,
  onNavigate,
  firstItemRef,
}: {
  pathname: string
  onNavigate?: () => void
  firstItemRef?: React.Ref<HTMLAnchorElement>
}) {
  return (
    <>
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item, index) => {
          const active = pathname === item.to
          return (
            <li key={item.to}>
              <Link
                ref={index === 0 ? firstItemRef : undefined}
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={
                  'block rounded px-3 py-1.5 text-sm no-underline ' +
                  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ' +
                  (active
                    ? 'bg-primary/10 text-primary'
                    : 'text-fg hover:bg-surface')
                }
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
      {/* ページツリー（§3.10）。区切り + セクションラベル + ツリー本体を NAV_ITEMS 直下に置く。
          NavItems は広幅常設ナビ・狭幅オーバーレイの両方で描画されるため、ツリーも両モードで出る。 */}
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs text-fg-muted">ページ</p>
        <PageTree onNavigate={onNavigate} />
      </div>
    </>
  )
}

function AppLayout({ children }: AppLayoutProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // 狭幅オーバーレイの開閉状態と、フォーカス管理用の参照。
  const [menuOpen, setMenuOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const firstNavItemRef = useRef<HTMLAnchorElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  // 開いたとき: 最初のナビ項目へフォーカス移動（§4.3）。
  useEffect(() => {
    if (menuOpen) {
      firstNavItemRef.current?.focus()
    }
  }, [menuOpen])

  // 展開中は背後コンテナを inert にして Tab がオーバーレイ外へ抜けないようにする（§4.3）。
  // inert は React 18 の型・一部環境（jsdom 等）で DOM プロパティが未実装のため、
  // ref 経由で属性として付与する（toggleAttribute は環境差に強い）。
  const backgroundRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    backgroundRef.current?.toggleAttribute('inert', menuOpen)
  }, [menuOpen])

  // 閉じる共通処理: 状態を閉じ、ハンバーガーへフォーカス復帰（§4.3）。
  const closeMenu = () => {
    setMenuOpen(false)
    hamburgerRef.current?.focus()
  }

  // Escape で閉じる（§4.3）。開いている間だけ購読する。
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  // user が null（未ログイン / 復元中）のときはヘッダー/サイドバーを出さない（従来挙動）。
  if (user === null) {
    return <main className="mx-auto max-w-3xl p-6">{children}</main>
  }

  const overlayId = 'global-nav-overlay'

  return (
    <div className="min-h-screen bg-surface text-fg">
      {/* 背後コンテナ: 展開中は inert が付与され、本文/ヘッダー/常設サイドバーが操作不可になる。 */}
      <div ref={backgroundRef}>
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface-raised px-6 py-3">
          <div className="flex items-center gap-3">
            {/* 狭幅時のハンバーガー（md: 以上では非表示）。aria-expanded / aria-controls を持つ。 */}
            <button
              ref={hamburgerRef}
              type="button"
              aria-label="ナビゲーションを開く"
              aria-expanded={menuOpen}
              aria-controls={overlayId}
              onClick={() => setMenuOpen(true)}
              className="inline-flex items-center justify-center rounded border border-border bg-surface-raised px-2 py-1.5 text-fg hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring md:hidden"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <Link to="/" className="text-xl font-bold text-fg no-underline">
              Janus
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {/* ライセンス導線。Janus 本体は MIT（ルート LICENSE）、
                同梱物・依存のライセンスは THIRD-PARTY-NOTICES.md にまとめている。
                いずれも public/ に置いた静的ファイルへの <a> リンク。 */}
            <a
              className="text-xs text-fg-muted"
              href="/LICENSE.html"
              target="_blank"
              rel="noreferrer"
            >
              ライセンス
            </a>
            <a
              className="text-xs text-fg-muted"
              href="/THIRD-PARTY-NOTICES.html"
              target="_blank"
              rel="noreferrer"
            >
              帰属表記
            </a>
            <span className="text-sm text-fg-muted">{user.username}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded border border-border bg-surface-raised px-3 py-1.5 text-sm text-fg hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
            >
              ログアウト
            </button>
          </div>
        </header>

        <div className="flex">
          {/* 常設サイドバー（§4.1）。広幅のみ表示（md:block）。モーダル挙動は適用しない。 */}
          <nav
            aria-label="グローバル"
            className="hidden w-56 shrink-0 border-r border-border bg-surface-raised p-4 md:block"
          >
            <NavItems pathname={pathname} />
          </nav>

          <main className="mx-auto max-w-3xl flex-1 p-6">{children}</main>
        </div>
      </div>

      {/* 狭幅オーバーレイ（§4.3）。DOM には常にマウントし、広幅では md:hidden で視覚的に隠す。
          開いている間だけ背景とパネルを描画し、モーダル挙動を適用する。 */}
      {menuOpen && (
        <div className="md:hidden">
          {/* 背景クリックで閉じる。 */}
          <div
            ref={backdropRef}
            data-testid="nav-backdrop"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={closeMenu}
          />
          <div
            id={overlayId}
            role="dialog"
            aria-modal="true"
            aria-label="グローバルナビゲーション"
            className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-surface-raised p-4"
          >
            <NavItems
              pathname={pathname}
              onNavigate={closeMenu}
              firstItemRef={firstNavItemRef}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default AppLayout
