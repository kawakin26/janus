// @vitest-environment jsdom
// ページ作成・編集 PageEditPage のテスト（サブタスク 10.2）。
// 既存ページの編集で updatePage(path,{title,body}) が呼ばれ /view へ遷移 /
// 新規作成で createPage({path,title,body}) が呼ばれる /
// createPage が ApiError(409) を throw したとき日本語メッセージが role="alert" に出て遷移しない、を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import PageEditPage from './PageEditPage'
import { ApiError } from '../storage/types'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { Page, StorageClient } from '../storage/types'

afterEach(() => {
  vi.restoreAllMocks()
})

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 1,
    path: '/docs/intro',
    title: 'イントロ',
    body: '既存の本文',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    created_by: sampleUser,
    updated_by: sampleUser,
    ...overrides,
  }
}

function renderEdit(client: StorageClient, path: string) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/edit/*" element={<PageEditPage />} />
            <Route path="/view/*" element={<div data-testid="view">閲覧</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('PageEditPage', () => {
  it('既存ページの編集で updatePage が呼ばれ /view へ遷移する', async () => {
    const updatePage = vi.fn(async () => makePage())
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
      updatePage,
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByDisplayValue('既存の本文')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    const body = screen.getByLabelText('本文（Markdown）')
    await user.clear(body)
    await user.type(body, '更新後の本文')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(updatePage).toHaveBeenCalledWith('/docs/intro', {
      title: 'イントロ',
      body: '更新後の本文',
    })
    await waitFor(() => {
      expect(screen.getByTestId('view')).toBeInTheDocument()
    })
  })

  it('新規作成で createPage が呼ばれ /view へ遷移する', async () => {
    const createPage = vi.fn(async () => makePage({ path: '/docs/new', title: 'T', body: 'B' }))
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => null),
      createPage,
    })
    renderEdit(client, '/edit/docs/new')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ新規作成' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('タイトル'), 'T')
    await user.type(screen.getByLabelText('本文（Markdown）'), 'B')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(createPage).toHaveBeenCalledWith({ path: '/docs/new', title: 'T', body: 'B' })
    await waitFor(() => {
      expect(screen.getByTestId('view')).toBeInTheDocument()
    })
  })

  it('createPage が 409 を throw したとき日本語メッセージを表示し遷移しない', async () => {
    const createPage = vi.fn(async () => {
      throw new ApiError(409, 'conflict')
    })
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => null),
      createPage,
    })
    renderEdit(client, '/edit/docs/dup')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ新規作成' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('本文（Markdown）'), 'B')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('同一パスのページが既に存在します')
    })
    expect(screen.queryByTestId('view')).toBeNull()
  })
})
