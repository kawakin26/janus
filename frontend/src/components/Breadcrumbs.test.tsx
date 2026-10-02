// @vitest-environment jsdom
// Breadcrumbs コンポーネントの描画テスト（タスク 13 / 要件 2-6）。
// 中間セグメントが /view/<累積path> リンクになり、末尾は aria-current="page" の現在地、
// ルート直下（/）はホームのみでセグメント無し、を検証する。

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Breadcrumbs from './Breadcrumbs'

function renderBreadcrumbs(path: string) {
  render(
    <MemoryRouter>
      <Breadcrumbs path={path} />
    </MemoryRouter>,
  )
}

describe('Breadcrumbs', () => {
  it('nav 要素で囲まれ、中間セグメントが /view/<累積path> リンクになる', () => {
    renderBreadcrumbs('/docs/guide/intro')
    const nav = screen.getByRole('navigation', { name: 'パンくず' })

    const home = within(nav).getByRole('link', { name: 'ホーム' })
    expect(home).toHaveAttribute('href', '/')

    const docs = within(nav).getByRole('link', { name: 'docs' })
    expect(docs).toHaveAttribute('href', '/view/docs')

    const guide = within(nav).getByRole('link', { name: 'guide' })
    expect(guide).toHaveAttribute('href', '/view/docs/guide')
  })

  it('末尾セグメントはリンクでなく aria-current="page" の現在地になる', () => {
    renderBreadcrumbs('/docs/guide/intro')

    // intro はリンクではない。
    expect(screen.queryByRole('link', { name: 'intro' })).toBeNull()
    const current = screen.getByText('intro')
    expect(current).toHaveAttribute('aria-current', 'page')
  })

  it('ルート直下（/）ではホームのみで現在地表示、セグメントリンク無し', () => {
    renderBreadcrumbs('/')
    const nav = screen.getByRole('navigation', { name: 'パンくず' })

    // ホームはリンクでなく現在地。
    expect(within(nav).queryByRole('link')).toBeNull()
    const home = within(nav).getByText('ホーム')
    expect(home).toHaveAttribute('aria-current', 'page')
  })
})
