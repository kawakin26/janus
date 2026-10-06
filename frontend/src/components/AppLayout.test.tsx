// @vitest-environment jsdom
// 共通レイアウト AppLayout のテスト（デザインシステム刷新・タスク 3）。
// 既存の非破壊挙動（ログイン時ヘッダー表示 / 未ログイン非表示 / ログアウト遷移）を緑に保ちつつ、
// 狭幅モバイルオーバーレイサイドバーの a11y（design.md §4.3/§10）を role/属性/フォーカスベースで検証する。
//
// jsdom は実レイアウト（md: ブレークポイント）を計算しないため、オーバーレイは DOM に常にマウントし
// CSS の md:hidden で視覚制御する実装方針（design.md 補足）に合わせ、ハンバーガー操作で開閉を検証する。
// ThemeToggle が useTheme を要求するため ThemeProvider でラップし、system 追従購読が走る分
// window.matchMedia を vi.fn() スタブでモックする（theme.test.tsx の installMatchMedia 流儀を踏襲）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import { ThemeProvider } from '../theme/ThemeProvider'
import AppLayout from './AppLayout'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { StorageClient } from '../storage/types'

// matchMedia のスタブ（theme.test.tsx の installMatchMedia と同じ流儀）。
// matches / addEventListener / removeEventListener / addListener / removeListener / dispatchEvent を持つ。
function installMatchMedia(initialMatches = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: initialMatches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }))
}

beforeEach(() => {
  installMatchMedia(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

function renderLayout(client: StorageClient, initialPath = '/') {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route
                path="/"
                element={
                  <AppLayout>
                    <div data-testid="content">本文</div>
                  </AppLayout>
                }
              />
              <Route
                path="/assets"
                element={
                  <AppLayout>
                    <div data-testid="assets">アセット画面</div>
                  </AppLayout>
                }
              />
              <Route path="/login" element={<div data-testid="login">ログイン画面</div>} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </AuthProvider>
    </StorageProvider>,
  )
}

function loggedInStub(overrides: Partial<Parameters<typeof createStubStorage>[0]> = {}) {
  return createStubStorage({
    currentUser: vi.fn(async () => sampleUser),
    getPageTree: vi.fn(async () => []),
    ...overrides,
  })
}

describe('AppLayout（非破壊の既存挙動）', () => {
  it('ログイン時にヘッダー（Janus/username・ログアウト）とグローバルナビが出る', async () => {
    const client = loggedInStub()
    renderLayout(client)

    const header = await screen.findByRole('banner')
    expect(within(header).getByRole('link', { name: 'Janus' })).toHaveAttribute('href', '/')
    expect(within(header).getByText('alice')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()

    // グローバルナビ（aria-label="グローバル"）に一覧とアセットの導線がある。
    const nav = screen.getByRole('navigation', { name: 'グローバル' })
    expect(within(nav).getByRole('link', { name: 'ページ一覧' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: 'アセットライブラリ' })).toHaveAttribute(
      'href',
      '/assets',
    )
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('アクティブなナビ項目に aria-current="page" が付く', async () => {
    const client = loggedInStub()
    renderLayout(client, '/')

    await screen.findByRole('banner')
    const nav = screen.getByRole('navigation', { name: 'グローバル' })
    expect(within(nav).getByRole('link', { name: 'ページ一覧' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'アセットライブラリ' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('未ログイン時はヘッダーを出さず children のみ', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
    })
    renderLayout(client)

    await waitFor(() => {
      expect(screen.getByTestId('content')).toBeInTheDocument()
    })
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'ログアウト' })).toBeNull()
  })

  it('ログアウト押下で logout() が呼ばれ /login へ遷移する', async () => {
    const logout = vi.fn(async () => {})
    const client = loggedInStub({ logout })
    renderLayout(client)

    const button = await screen.findByRole('button', { name: 'ログアウト' })
    const user = userEvent.setup()
    await user.click(button)

    expect(logout).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('login')).toBeInTheDocument()
    })
  })
})

describe('AppLayout（狭幅オーバーレイの a11y・design.md §4.3/§10）', () => {
  async function renderOpenedMenu() {
    const client = loggedInStub()
    renderLayout(client)
    const hamburger = await screen.findByRole('button', { name: 'ナビゲーションを開く' })
    const user = userEvent.setup()
    return { user, hamburger }
  }

  it('(a) ハンバーガー押下で aria-expanded が false→true になり最初のナビ項目へフォーカスが移る', async () => {
    const { user, hamburger } = await renderOpenedMenu()
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')

    await user.click(hamburger)

    expect(hamburger).toHaveAttribute('aria-expanded', 'true')
    const dialog = screen.getByRole('dialog', { name: 'グローバルナビゲーション' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // 開時に最初のナビ項目（ページ一覧）へフォーカスが移る。
    const firstItem = within(dialog).getByRole('link', { name: 'ページ一覧' })
    expect(document.activeElement).toBe(firstItem)
  })

  it('(b) Escape で閉じ、aria-expanded が false へ戻りハンバーガーへフォーカス復帰', async () => {
    const { user, hamburger } = await renderOpenedMenu()
    await user.click(hamburger)
    expect(screen.getByRole('dialog', { name: 'グローバルナビゲーション' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'グローバルナビゲーション' })).toBeNull()
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(hamburger)
  })

  it('(c) 背景オーバーレイクリックで閉じ、aria-expanded が false へ戻りハンバーガーへフォーカス復帰', async () => {
    const { user, hamburger } = await renderOpenedMenu()
    await user.click(hamburger)

    await user.click(screen.getByTestId('nav-backdrop'))

    expect(screen.queryByRole('dialog', { name: 'グローバルナビゲーション' })).toBeNull()
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(hamburger)
  })

  it('(d) ナビ項目選択で閉じて遷移し、閉後の aria-expanded は false', async () => {
    const { user, hamburger } = await renderOpenedMenu()
    await user.click(hamburger)
    const dialog = screen.getByRole('dialog', { name: 'グローバルナビゲーション' })

    // ナビ項目選択で閉じ、同時に /assets へ遷移する（AppLayout は遷移後も常設されるため再マウントされる）。
    await user.click(within(dialog).getByRole('link', { name: 'アセットライブラリ' }))

    expect(await screen.findByTestId('assets')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'グローバルナビゲーション' })).toBeNull()
    // 遷移後に再マウントされたヘッダーのハンバーガーは閉状態（false）。
    const hamburgerAfter = screen.getByRole('button', { name: 'ナビゲーションを開く' })
    expect(hamburgerAfter).toHaveAttribute('aria-expanded', 'false')
  })

  it('(f) 展開中は背後コンテナに inert が掛かり、閉じると外れる', async () => {
    const { user, hamburger } = await renderOpenedMenu()
    const header = screen.getByRole('banner')
    const background = header.parentElement as HTMLElement
    expect(background.hasAttribute('inert')).toBe(false)

    await user.click(hamburger)
    expect(background.hasAttribute('inert')).toBe(true)

    await user.keyboard('{Escape}')
    expect(background.hasAttribute('inert')).toBe(false)
  })
})

describe('AppLayout（ページツリー統合・design §3.10）', () => {
  it('広幅: グローバルナビ内にページツリー（role="tree"）が描画される', async () => {
    const client = loggedInStub()
    renderLayout(client)

    await screen.findByRole('banner')
    const nav = screen.getByRole('navigation', { name: 'グローバル' })
    expect(within(nav).getByRole('tree', { name: 'ページ' })).toBeInTheDocument()
    expect(within(nav).getByText('ページ')).toBeInTheDocument()
  })

  it('狭幅オーバーレイ: dialog 内にもページツリーが描画される', async () => {
    const client = loggedInStub()
    renderLayout(client)
    const hamburger = await screen.findByRole('button', { name: 'ナビゲーションを開く' })
    const user = userEvent.setup()
    await user.click(hamburger)

    const dialog = screen.getByRole('dialog', { name: 'グローバルナビゲーション' })
    expect(within(dialog).getByRole('tree', { name: 'ページ' })).toBeInTheDocument()
  })
})
