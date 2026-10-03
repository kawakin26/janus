// @vitest-environment jsdom
// ページ履歴 PageHistoryPage のテスト（タスク18）。
// 一覧が新しい順に描画 / 2件選択で diff が add/del/equal に色分け /
// view=false または 403 で本文・一覧を描画せず「閲覧権限がありません」/
// edit=false で復元ボタン非表示・edit=true で restoreRevision が正しい number で呼ばれる、を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import PageHistoryPage from './PageHistoryPage'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import { ApiError } from '../storage/types'
import type { RevisionSummary, StorageClient } from '../storage/types'

afterEach(() => {
  vi.restoreAllMocks()
})

const revisions: RevisionSummary[] = [
  { id: 3, number: 2, created_at: '2024-01-02T00:00:00Z', author: sampleUser },
  { id: 1, number: 1, created_at: '2024-01-01T00:00:00Z', author: null },
]

function renderHistory(client: StorageClient, path: string) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/view/*" element={<div data-testid="view">閲覧</div>} />
            <Route path="/history/*" element={<PageHistoryPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('PageHistoryPage', () => {
  it('view 可のとき listRevisions の一覧が新しい順に描画される', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: false })),
      listRevisions: vi.fn(async () => revisions),
    })
    renderHistory(client, '/history/docs/intro')

    const list = await screen.findByRole('list', { name: 'リビジョン一覧' })
    const items = within(list).getAllByRole('listitem')
    // 新しい順（#2 → #1）に並ぶ。
    expect(within(items[0]).getByText('#2')).toBeInTheDocument()
    expect(within(items[1]).getByText('#1')).toBeInTheDocument()
    expect(client.listRevisions).toHaveBeenCalledWith('/docs/intro', {
      limit: 50,
      offset: 0,
    })
  })

  it('2件選択して diffRevisions の結果が add/del/equal に色分け描画される', async () => {
    const diffRevisions = vi.fn(async () => [
      { op: 'equal' as const, line: 'same' },
      { op: 'del' as const, line: 'old' },
      { op: 'add' as const, line: 'new' },
    ])
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: false })),
      listRevisions: vi.fn(async () => revisions),
      diffRevisions,
    })
    renderHistory(client, '/history/docs/intro')

    await screen.findByRole('list', { name: 'リビジョン一覧' })

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('比較元'), '1')
    await user.selectOptions(screen.getByLabelText('比較先'), '2')
    await user.click(screen.getByRole('button', { name: '差分を表示' }))

    await waitFor(() => {
      expect(screen.getByText('same')).toBeInTheDocument()
    })
    expect(diffRevisions).toHaveBeenCalledWith('/docs/intro', 1, 2)
    // op 種別は data-op 属性で区別できる。
    expect(screen.getByText('same').closest('li')).toHaveAttribute('data-op', 'equal')
    expect(screen.getByText('old').closest('li')).toHaveAttribute('data-op', 'del')
    expect(screen.getByText('new').closest('li')).toHaveAttribute('data-op', 'add')
  })

  it('view=false のとき一覧を描画せず「閲覧権限がありません」を出す', async () => {
    const listRevisions = vi.fn(async () => revisions)
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: false, edit: false })),
      listRevisions,
    })
    renderHistory(client, '/history/docs/secret')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('閲覧権限がありません')
    })
    expect(screen.queryByText('#2')).not.toBeInTheDocument()
    expect(listRevisions).not.toHaveBeenCalled()
  })

  it('listRevisions が 403 のとき一覧を描画せず「閲覧権限がありません」を出す', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: false })),
      listRevisions: vi.fn(async () => {
        throw new ApiError(403, 'forbidden', 'forbidden')
      }),
    })
    renderHistory(client, '/history/docs/secret')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('閲覧権限がありません')
    })
    expect(screen.queryByText('#2')).not.toBeInTheDocument()
  })

  it('edit=false のとき復元ボタンが非表示になる', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: false })),
      listRevisions: vi.fn(async () => revisions),
    })
    renderHistory(client, '/history/docs/intro')

    await screen.findByRole('list', { name: 'リビジョン一覧' })
    expect(
      screen.queryByRole('button', { name: 'このリビジョンに復元' }),
    ).not.toBeInTheDocument()
  })

  it('edit=true のとき復元ボタンで restoreRevision が正しい number で呼ばれる', async () => {
    const restoreRevision = vi.fn(async () => ({
      id: 1,
      path: '/docs/intro',
      title: 'Intro',
      body: 'x',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      created_by: sampleUser,
      updated_by: sampleUser,
    }))
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: true })),
      listRevisions: vi.fn(async () => revisions),
      restoreRevision,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderHistory(client, '/history/docs/intro')

    const list = await screen.findByRole('list', { name: 'リビジョン一覧' })

    // #2 の行（新しい順の先頭）の復元ボタンを押す。
    const row = within(list).getAllByRole('listitem')[0]
    const button = within(row).getByRole('button', { name: 'このリビジョンに復元' })
    const user = userEvent.setup()
    await user.click(button)

    expect(restoreRevision).toHaveBeenCalledWith('/docs/intro', 2)
    await waitFor(() => {
      expect(screen.getByTestId('view')).toBeInTheDocument()
    })
  })
})
