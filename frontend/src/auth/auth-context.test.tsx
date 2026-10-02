// @vitest-environment jsdom
// AuthProvider / useAuth の状態遷移テスト。
// StorageProvider に注入したスタブ StorageClient で、起動時復元・login 成功/失敗・logout を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider, useAuth } from './AuthContext'
import { ApiError } from '../storage/types'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { StorageClient } from '../storage/types'
import type { AuthContextValue } from './AuthContext'

afterEach(() => {
  vi.restoreAllMocks()
})

// useAuth の値をテストから操作/観察するためのプローブ。
function AuthProbe({ onReady }: { onReady: (ctx: AuthContextValue) => void }) {
  const ctx = useAuth()
  onReady(ctx)
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="user">{ctx.user?.username ?? 'none'}</span>
    </div>
  )
}

function renderWithAuth(client: StorageClient) {
  let latest: AuthContextValue | null = null
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <AuthProbe onReady={(ctx) => (latest = ctx)} />
      </AuthProvider>
    </StorageProvider>,
  )
  return () => {
    if (latest === null) {
      throw new Error('AuthContext がまだ初期化されていません')
    }
    return latest
  }
}

describe('AuthProvider', () => {
  it('起動時に currentUser で復元し、loading が true→false になる', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
    })
    renderWithAuth(client)

    // 復元完了後に user が設定され loading が false になる。
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('user').textContent).toBe('alice')
  })

  it('未認証（currentUser が null）なら user は null のまま', async () => {
    const client = createStubStorage({ currentUser: vi.fn(async () => null) })
    renderWithAuth(client)

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('user').textContent).toBe('none')
  })

  it('login 成功で user が更新される', async () => {
    const login = vi.fn(async () => ({ token: 'tok', user: sampleUser }))
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
      login,
    })
    const getCtx = renderWithAuth(client)

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await act(async () => {
      await getCtx().login('alice', 'secret')
    })

    expect(login).toHaveBeenCalledWith('alice', 'secret')
    expect(screen.getByTestId('user').textContent).toBe('alice')
  })

  it('login 失敗（ApiError）は呼び出し側へ再 throw される', async () => {
    const login = vi.fn(async () => {
      throw new ApiError(400, 'bad', '認証失敗')
    })
    const client = createStubStorage({
      currentUser: vi.fn(async () => null),
      login,
    })
    const getCtx = renderWithAuth(client)

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })

    await expect(getCtx().login('x', 'y')).rejects.toBeInstanceOf(ApiError)
    expect(screen.getByTestId('user').textContent).toBe('none')
  })

  it('logout で user が null になる', async () => {
    const logout = vi.fn(async () => {})
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      logout,
    })
    const getCtx = renderWithAuth(client)

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('alice')
    })

    await act(async () => {
      await getCtx().logout()
    })

    expect(logout).toHaveBeenCalled()
    expect(screen.getByTestId('user').textContent).toBe('none')
  })
})
