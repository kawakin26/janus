// @vitest-environment jsdom
// 共通レイアウト AppLayout のテスト（タスク 13）。
// ログイン時にヘッダー（Janus/一覧リンク・username・ログアウト）が出る /
// 未ログイン時はヘッダーが出ず children のみ /
// ログアウト押下で logout() が呼ばれ /login へ遷移する、を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import AppLayout from './AppLayout'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { StorageClient } from '../storage/types'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderLayout(client: StorageClient, initialPath = '/') {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
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
            <Route path="/login" element={<div data-testid="login">ログイン画面</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('AppLayout', () => {
  it('ログイン時にヘッダー（Janus/一覧・username・ログアウト）が出る', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
    })
    renderLayout(client)

    const header = await screen.findByRole('banner')
    expect(within(header).getByRole('link', { name: 'Janus' })).toHaveAttribute('href', '/')
    expect(within(header).getByRole('link', { name: 'ページ一覧' })).toHaveAttribute('href', '/')
    expect(within(header).getByText('alice')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
    expect(screen.getByTestId('content')).toBeInTheDocument()
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
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      logout,
    })
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
