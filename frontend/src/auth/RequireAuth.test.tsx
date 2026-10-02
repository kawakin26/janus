// @vitest-environment jsdom
// ルートガード RequireAuth のテスト。
// loading 中はちらつき防止でローディング表示、未認証は /login へ（from を保持）、
// 認証済みは保護コンテンツを表示することを検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from './AuthContext'
import { RequireAuth } from './RequireAuth'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { StorageClient, User } from '../storage/types'

afterEach(() => {
  vi.restoreAllMocks()
})

// /login 到達時に location.state.from を観測するためのダミー画面。
function LoginProbe() {
  const location = useLocation()
  const state = location.state as { from?: { pathname?: string } } | null
  return (
    <div>
      <span data-testid="at-login">login</span>
      <span data-testid="from">{state?.from?.pathname ?? 'none'}</span>
    </div>
  )
}

function renderGuarded(client: StorageClient) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/secret']}>
          <Routes>
            <Route
              path="/secret"
              element={
                <RequireAuth>
                  <div data-testid="protected">秘密のコンテンツ</div>
                </RequireAuth>
              }
            />
            <Route path="/login" element={<LoginProbe />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('RequireAuth', () => {
  it('loading 中はローディング表示で、保護コンテンツも /login も確定させない（ちらつき防止）', async () => {
    // currentUser を解決させず pending のままにして loading 状態を維持する。
    const client = createStubStorage({
      currentUser: vi.fn(() => new Promise<User | null>(() => {})),
    })
    renderGuarded(client)

    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
    expect(screen.queryByTestId('protected')).toBeNull()
    expect(screen.queryByTestId('at-login')).toBeNull()
  })

  it('未認証なら /login へリダイレクトし、from に元の遷移先を積む', async () => {
    const client = createStubStorage({ currentUser: vi.fn(async () => null) })
    renderGuarded(client)

    await waitFor(() => {
      expect(screen.getByTestId('at-login')).toBeInTheDocument()
    })
    expect(screen.getByTestId('from').textContent).toBe('/secret')
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('認証済みなら保護コンテンツを表示する', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
    })
    renderGuarded(client)

    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('at-login')).toBeNull()
  })
})
