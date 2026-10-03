// @vitest-environment jsdom
// ページ権限設定 PagePermissionPage のテスト（タスク19）。
// edit=true で一覧とフォームが描画 / 付与フォーム送信で grantPermission が入力どおり呼ばれる /
// edit=false または 403 で操作 UI を描画せず「編集権限がありません」/
// 削除ボタンで revokePermission(id) が呼ばれる、を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import PagePermissionPage from './PagePermissionPage'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { PermissionEntry, StorageClient } from '../storage/types'

afterEach(() => {
  vi.restoreAllMocks()
})

const entries: PermissionEntry[] = [
  {
    id: 11,
    path: '/docs/intro',
    principalType: 'user',
    principalId: 1,
    action: 'edit',
    effect: 'allow',
  },
]

function renderPermission(client: StorageClient, path: string) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/permissions/*" element={<PagePermissionPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('PagePermissionPage', () => {
  it('edit=true のとき一覧とフォームが描画される', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: true })),
      listPermissions: vi.fn(async () => entries),
    })
    renderPermission(client, '/permissions/docs/intro')

    await waitFor(() => {
      expect(screen.getByText('ユーザー #1')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('主体種別')).toBeInTheDocument()
    expect(screen.getByLabelText('主体ID')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '付与' })).toBeInTheDocument()
    expect(client.listPermissions).toHaveBeenCalledWith('/docs/intro')
  })

  it('付与フォーム送信で grantPermission が入力どおりの引数で呼ばれる', async () => {
    const grantPermission = vi.fn(async () => entries[0])
    const listPermissions = vi.fn(async () => entries)
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: true })),
      listPermissions,
      grantPermission,
    })
    renderPermission(client, '/permissions/docs/intro')

    await waitFor(() => {
      expect(screen.getByLabelText('主体ID')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('主体種別'), 'group')
    await user.type(screen.getByLabelText('主体ID'), '5')
    await user.selectOptions(screen.getByLabelText('操作'), 'edit')
    await user.selectOptions(screen.getByLabelText('効果'), 'deny')
    await user.click(screen.getByRole('button', { name: '付与' }))

    expect(grantPermission).toHaveBeenCalledWith({
      path: '/docs/intro',
      principalType: 'group',
      principalId: 5,
      action: 'edit',
      effect: 'deny',
    })
  })

  it('edit=false のとき操作 UI を描画せず「編集権限がありません」を出す', async () => {
    const listPermissions = vi.fn(async () => entries)
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: false })),
      listPermissions,
    })
    renderPermission(client, '/permissions/docs/secret')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('編集権限がありません')
    })
    expect(screen.queryByRole('button', { name: '付与' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('主体ID')).not.toBeInTheDocument()
    expect(listPermissions).not.toHaveBeenCalled()
  })

  it('削除ボタンで revokePermission(id) が呼ばれる', async () => {
    const revokePermission = vi.fn(async () => {})
    const listPermissions = vi.fn(async () => entries)
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getEffectivePermission: vi.fn(async () => ({ view: true, edit: true })),
      listPermissions,
      revokePermission,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPermission(client, '/permissions/docs/intro')

    await waitFor(() => {
      expect(screen.getByText('ユーザー #1')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(revokePermission).toHaveBeenCalledWith(11)
  })
})
