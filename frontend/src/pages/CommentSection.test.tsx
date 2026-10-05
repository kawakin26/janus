// @vitest-environment jsdom
// コメント欄 CommentSection の最小テスト（タスク 18）。
// - 一覧が昇順で描画される / 本文がプレーンテキスト（タグがエスケープ）で描画される
// - 投稿で addComment が呼ばれ一覧に追加される
// - 400（空本文）で ApiError の detail が表示される
// - 投稿者本人は編集/削除導線が出る、無関係ユーザー（canEdit=false・非本人）は出ない

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import CommentSection from './CommentSection'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import { ApiError } from '../storage/types'
import type { Comment, StorageClient } from '../storage/types'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    body: 'こんにちは',
    author: sampleUser,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderSection(client: StorageClient, canEdit = false) {
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <CommentSection path="/docs/intro" canEdit={canEdit} />
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
}

describe('CommentSection', () => {
  it('コメント一覧を昇順で描画し、本文はプレーンテキストとして出す', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      listComments: vi.fn(async () => [
        makeComment({ id: 1, body: '<script>alert(1)</script>' }),
        makeComment({ id: 2, body: '二番目' }),
      ]),
    })
    renderSection(client)

    // 本文がテキストノードとして描画される（タグが実行・解釈されず文字列として出る）。
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(screen.getByText('二番目')).toBeInTheDocument()
    // dangerouslySetInnerHTML を使っていないので script 要素は DOM に注入されない。
    expect(document.querySelector('script')).toBeNull()
  })

  it('投稿で addComment が呼ばれ、一覧に追加される', async () => {
    const addComment = vi.fn(async (_path: string, body: string) =>
      makeComment({ id: 99, body }),
    )
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      listComments: vi.fn(async () => []),
      addComment,
    })
    renderSection(client)

    await screen.findByText('まだコメントはありません。')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('コメントを投稿'), '新規コメント')
    await user.click(screen.getByRole('button', { name: '投稿' }))

    expect(addComment).toHaveBeenCalledWith('/docs/intro', '新規コメント')
    expect(await screen.findByText('新規コメント')).toBeInTheDocument()
  })

  it('400（空本文）で ApiError の detail を表示する', async () => {
    const addComment = vi.fn(async () => {
      throw new ApiError(400, '本文を入力してください。', '本文を入力してください。')
    })
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      listComments: vi.fn(async () => []),
      addComment,
    })
    renderSection(client)

    await screen.findByText('まだコメントはありません。')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('コメントを投稿'), ' ')
    await user.click(screen.getByRole('button', { name: '投稿' }))

    expect(await screen.findByText('本文を入力してください。')).toBeInTheDocument()
  })

  it('投稿者本人には編集/削除導線が出る', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      listComments: vi.fn(async () => [makeComment({ author: sampleUser })]),
    })
    renderSection(client, false)

    await screen.findByText('こんにちは')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '編集' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument()
  })

  it('無関係ユーザー（canEdit=false・非投稿者）には編集/削除導線が出ない', async () => {
    const other = { ...sampleUser, id: 999, username: 'bob' }
    const client = createStubStorage({
      currentUser: vi.fn(async () => other),
      listComments: vi.fn(async () => [makeComment({ author: sampleUser })]),
    })
    renderSection(client, false)

    await screen.findByText('こんにちは')
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull()
    expect(screen.queryByRole('button', { name: '削除' })).toBeNull()
  })
})
