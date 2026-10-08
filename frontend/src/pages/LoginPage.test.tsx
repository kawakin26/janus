// @vitest-environment jsdom
// ログイン画面 LoginPage のテスト。
// 送信で login が呼ばれる / 失敗で日本語エラー表示 / 成功で from or / へ遷移 /
// ログイン済みで /login 来訪時は / へ、を検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import LoginPage from './LoginPage'
import { ApiError } from '../storage/types'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { StorageClient } from '../storage/types'
import { MODE_KEY } from '../storage/mode'

const originalLocation = window.location

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: vi.fn() },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
  localStorage.clear()
  vi.restoreAllMocks()
})

// 遷移先を観測するためのダミー保護画面。
function HomeProbe() {
  return <div data-testid="home">ホーム</div>
}
function SecretProbe() {
  return <div data-testid="secret">秘密</div>
}

// MemoryRouter の initialEntries が受け取る各要素の型（文字列 or Location 部分形）。
type RouterEntry = string | { pathname: string; state?: unknown }

function renderLogin(client: StorageClient, initialEntries: RouterEntry[]) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/" element={<HomeProbe />} />
            <Route path="/secret" element={<SecretProbe />} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

/** AuthProvider の起動復元（loading→false）が終わるのを待つ。 */
async function waitForLoginForm() {
  await waitFor(() => {
    expect(screen.getByLabelText('ユーザー名')).toBeInTheDocument()
  })
}

describe('LoginPage', () => {
  it('ローカルモードへ戻ると local を保存して reload する', async () => {
    const login = vi.fn(async () => ({ token: 'tok', user: sampleUser }))
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
      login,
    })
    renderLogin(client, ['/login'])
    await waitForLoginForm()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'ローカルモードへ戻る' }))

    expect(localStorage.getItem(MODE_KEY)).toBe('local')
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    expect(login).not.toHaveBeenCalled()
  })

  it('送信で login が呼ばれ、成功時に / へ遷移する', async () => {
    const login = vi.fn(async () => ({ token: 'tok', user: sampleUser }))
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
      login,
    })
    renderLogin(client, ['/login'])
    await waitForLoginForm()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('ユーザー名'), 'alice')
    await user.type(screen.getByLabelText('パスワード'), 'secret')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(login).toHaveBeenCalledWith('alice', 'secret')
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
  })

  it('成功時に location.state.from があればそこへ遷移する', async () => {
    const login = vi.fn(async () => ({ token: 'tok', user: sampleUser }))
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
      login,
    })
    renderLogin(client, [
      { pathname: '/login', state: { from: { pathname: '/secret' } } },
    ])
    await waitForLoginForm()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('ユーザー名'), 'alice')
    await user.type(screen.getByLabelText('パスワード'), 'secret')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getByTestId('secret')).toBeInTheDocument()
    })
  })

  it('失敗時に ApiError.detail を日本語エラーとして表示する', async () => {
    const login = vi.fn(async () => {
      throw new ApiError(400, 'bad', 'ユーザー名またはパスワードが違います')
    })
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
      login,
    })
    renderLogin(client, ['/login'])
    await waitForLoginForm()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('ユーザー名'), 'x')
    await user.type(screen.getByLabelText('パスワード'), 'y')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'ユーザー名またはパスワードが違います',
      )
    })
    // 遷移していない（まだログイン画面にいる）。
    expect(screen.queryByTestId('home')).toBeNull()
  })

  it('detail が無い失敗では汎用エラーを表示する', async () => {
    const login = vi.fn(async () => {
      throw new Error('network')
    })
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
      login,
    })
    renderLogin(client, ['/login'])
    await waitForLoginForm()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('ユーザー名'), 'x')
    await user.type(screen.getByLabelText('パスワード'), 'y')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'ユーザー名またはパスワードが違います',
      )
    })
  })

  it('ログイン済みで /login に来たら / へリダイレクトする', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
    })
    renderLogin(client, ['/login'])

    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('ユーザー名')).toBeNull()
  })
})
