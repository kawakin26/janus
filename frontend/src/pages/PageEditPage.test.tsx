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
import { ThemeProvider } from '../theme/ThemeProvider'
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
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/edit/*" element={<PageEditPage />} />
            <Route path="/view/*" element={<div data-testid="view">閲覧</div>} />
          </Routes>
          </MemoryRouter>
        </ThemeProvider>
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

  it('drawio 全画面トグルで全画面クラスが付き、再トグル/Esc で外れる', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByDisplayValue('既存の本文')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))

    // 描画エディタ（iframe）が開くまで待つ。
    const frame = await screen.findByTitle('drawio 描画エディタ')
    const editor = frame.parentElement as HTMLElement
    expect(editor.className).not.toMatch(/Fullscreen/)

    // 全画面表示にするとクラスが付き、dialog ロールになる。
    await user.click(screen.getByRole('button', { name: '全画面表示' }))
    expect(editor.className).toMatch(/Fullscreen/)
    expect(screen.getByRole('dialog')).toBe(editor)

    // 再トグルで外れる。
    await user.click(screen.getByRole('button', { name: '全画面を解除' }))
    expect(editor.className).not.toMatch(/Fullscreen/)

    // もう一度全画面にして Esc で解除する。
    await user.click(screen.getByRole('button', { name: '全画面表示' }))
    expect(editor.className).toMatch(/Fullscreen/)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(editor.className).not.toMatch(/Fullscreen/))
  })

  it('描画編集を閉じると全画面状態もリセットされる', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByDisplayValue('既存の本文')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')
    await user.click(screen.getByRole('button', { name: '全画面表示' }))
    await user.click(screen.getByRole('button', { name: '描画編集を閉じる' }))

    // エディタが閉じ、再度開いても全画面状態は持ち越さない。
    expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    const frame = await screen.findByTitle('drawio 描画エディタ')
    expect((frame.parentElement as HTMLElement).className).not.toMatch(/Fullscreen/)
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
