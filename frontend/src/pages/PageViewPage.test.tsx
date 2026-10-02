// @vitest-environment jsdom
// ページ閲覧 PageViewPage のテスト（サブタスク 10.1/10.2）。
// body が MarkdownRenderer 経由で描画される / 404 で「見つかりません」＋作成導線 /
// 子ページが listChildren の戻りでリンク化される / 削除で deletePage が正しい path で呼ばれる、を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import PageViewPage from './PageViewPage'
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
    body: '# 見出し\n\n本文テキスト',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    created_by: sampleUser,
    updated_by: sampleUser,
    ...overrides,
  }
}

function renderView(client: StorageClient, path: string) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<div data-testid="home">ホーム</div>} />
            <Route path="/view/*" element={<PageViewPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('PageViewPage', () => {
  it('getPage の body が MarkdownRenderer 経由で描画される', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
      listChildren: vi.fn(async () => []),
    })
    renderView(client, '/view/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '見出し' })).toBeInTheDocument()
    })
    expect(screen.getByText('本文テキスト')).toBeInTheDocument()
    expect(client.getPage).toHaveBeenCalledWith('/docs/intro')
  })

  it('getPage が null のとき 404 メッセージと作成導線を出す', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => null),
      listChildren: vi.fn(async () => []),
    })
    renderView(client, '/view/docs/missing')

    await waitFor(() => {
      expect(screen.getByText('ページが見つかりません')).toBeInTheDocument()
    })
    const createLink = screen.getByRole('link', { name: 'このパスで新規作成' })
    expect(createLink).toHaveAttribute('href', '/edit/docs/missing')
  })

  it('子ページが listChildren の戻りでリンク化される', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
      listChildren: vi.fn(async () => [
        { path: '/docs/intro/a', title: '子A' },
        { path: '/docs/intro/b', title: '子B' },
      ]),
    })
    renderView(client, '/view/docs/intro')

    const linkA = await screen.findByRole('link', { name: '子A' })
    expect(linkA).toHaveAttribute('href', '/view/docs/intro/a')
    expect(screen.getByRole('link', { name: '子B' })).toHaveAttribute(
      'href',
      '/view/docs/intro/b',
    )
    expect(client.listChildren).toHaveBeenCalledWith('/docs/intro')
  })

  it('削除ボタンで deletePage が正しい path で呼ばれ / へ遷移する', async () => {
    const deletePage = vi.fn(async () => {})
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
      listChildren: vi.fn(async () => []),
      deletePage,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderView(client, '/view/docs/intro')

    const deleteButton = await screen.findByRole('button', { name: '削除' })
    const user = userEvent.setup()
    await user.click(deleteButton)

    expect(deletePage).toHaveBeenCalledWith('/docs/intro')
    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument()
    })
  })
})
