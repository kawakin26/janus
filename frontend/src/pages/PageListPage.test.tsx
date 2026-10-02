// @vitest-environment jsdom
// ページ一覧 PageListPage のテスト（サブタスク 10.2 / 要件 2-6）。
// listChildren('/') の戻りがリンク化される / 空のとき空メッセージ /
// 新規作成導線でパス入力して /edit/<path> へ遷移する、を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import PageListPage from './PageListPage'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { StorageClient } from '../storage/types'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderList(client: StorageClient) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<PageListPage />} />
            <Route path="/edit/*" element={<div data-testid="edit">編集</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('PageListPage', () => {
  it('listChildren の結果がリンクとして出る', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      listChildren: vi.fn(async () => [
        { path: '/docs', title: 'ドキュメント' },
        { path: '/blog', title: 'ブログ' },
      ]),
    })
    renderList(client)

    const docsLink = await screen.findByRole('link', { name: 'ドキュメント' })
    expect(docsLink).toHaveAttribute('href', '/view/docs')
    expect(screen.getByRole('link', { name: 'ブログ' })).toHaveAttribute('href', '/view/blog')
    expect(client.listChildren).toHaveBeenCalledWith('/')
  })

  it('空のとき空メッセージを出す', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      listChildren: vi.fn(async () => []),
    })
    renderList(client)

    await waitFor(() => {
      expect(screen.getByText('ページがありません')).toBeInTheDocument()
    })
  })

  it('新規作成導線でパス入力して /edit/<path> へ遷移する', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      listChildren: vi.fn(async () => []),
    })
    renderList(client)

    await waitFor(() => {
      expect(screen.getByText('ページがありません')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('パス'), 'docs/new')
    await user.click(screen.getByRole('button', { name: '新規作成' }))

    await waitFor(() => {
      expect(screen.getByTestId('edit')).toBeInTheDocument()
    })
  })
})
