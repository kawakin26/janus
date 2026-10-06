// @vitest-environment jsdom
// ページツリー UI の統合テスト（design §3.14）。
// StorageProvider の client prop に getPageTree スタブを注入し、MemoryRouter でラップする。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { StorageProvider } from '../../storage/StorageProvider'
import { AuthProvider } from '../../auth/AuthContext'
import { createStubStorage, sampleUser } from '../../test/stub-storage'
import type { PageTreeNode } from '../../storage/types'
import { ApiError } from '../../storage/types'
import { PageTree } from './PageTree'

// モックツリー（design の例に準拠）:
// /blog（葉）、/docs（仮想・hasChildren）配下に /docs/guide（葉）・/docs/intro（hasChildren）
// → /docs/intro/deep（葉）。
const MOCK_TREE: PageTreeNode[] = [
  { path: '/blog', title: '/blog', hasPage: true, hasChildren: false, children: [] },
  {
    path: '/docs',
    title: 'docs',
    hasPage: false,
    hasChildren: true,
    children: [
      { path: '/docs/guide', title: 'Guide', hasPage: true, hasChildren: false, children: [] },
      {
        path: '/docs/intro',
        title: 'Intro',
        hasPage: true,
        hasChildren: true,
        children: [
          { path: '/docs/intro/deep', title: 'Deep', hasPage: true, hasChildren: false, children: [] },
        ],
      },
    ],
  },
]

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

// 現在の location.pathname を可視化してテストで検証するためのプローブ。
function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="location">{pathname}</div>
}

function renderTree(options?: {
  getPageTree?: () => Promise<PageTreeNode[]>
  initialPath?: string
}) {
  const getPageTree =
    options?.getPageTree ?? (async () => MOCK_TREE)
  const getPageTreeMock = vi.fn(getPageTree)
  const client = createStubStorage({
    currentUser: vi.fn(async () => sampleUser),
    getPageTree: getPageTreeMock,
  })
  render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[options?.initialPath ?? '/']}>
          <LocationProbe />
          <Routes>
            <Route path="*" element={<PageTree onNavigate={vi.fn()} />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
  return { getPageTreeMock }
}

describe('PageTree', () => {
  it('展開トグル: マーカー click で aria-expanded が false→true になり子グループが現れる', async () => {
    renderTree()
    const user = userEvent.setup()

    // /docs 行（仮想ノード）の treeitem を取得。初期は折畳。
    const docsItem = await screen.findByRole('treeitem', { name: /docs/ })
    expect(docsItem).toHaveAttribute('aria-expanded', 'false')
    expect(within(docsItem).queryByRole('group')).toBeNull()

    const marker = within(docsItem).getByRole('button', { name: '展開/折り畳み' })
    await user.click(marker)

    expect(docsItem).toHaveAttribute('aria-expanded', 'true')
    expect(within(docsItem).getByRole('group')).toBeInTheDocument()
    // マーカー操作で遷移しない（location は '/' のまま）。
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('一括展開/折り畳み: getPageTree の呼び出し回数が増えない', async () => {
    const { getPageTreeMock } = renderTree()
    const user = userEvent.setup()

    await screen.findByRole('tree', { name: 'ページ' })
    expect(getPageTreeMock).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /全展開/ }))
    // 全展開可能ノードが開き、深い葉 /docs/intro/deep が可視になる。
    expect(await screen.findByText('Deep')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /全折畳/ }))
    // 第 1 階層のみ: 深い行は消える。
    await waitFor(() => expect(screen.queryByText('Deep')).toBeNull())

    // 追加ネットワーク無し。
    expect(getPageTreeMock).toHaveBeenCalledTimes(1)
  })

  it('グレーアウト非遷移: 仮想ノードのページ名はリンクではない', async () => {
    renderTree()

    await screen.findByRole('tree', { name: 'ページ' })
    // /docs は仮想ノード。リンク（role=link）としては存在しない。
    expect(screen.queryByRole('link', { name: 'docs' })).toBeNull()
    // テキストは描画される（グレーアウト表示）。
    expect(screen.getByText('docs')).toBeInTheDocument()
  })

  it('現在ページハイライト: /view/docs/intro で該当 treeitem に aria-current="page"', async () => {
    renderTree({ initialPath: '/view/docs/intro' })

    const introLink = await screen.findByRole('link', { name: 'Intro' })
    const introItem = introLink.closest('[role="treeitem"]')
    expect(introItem).toHaveAttribute('aria-current', 'page')
  })

  it('祖先自動展開: 現在ページの祖先（/docs）が初期展開され現在行が可視になる', async () => {
    renderTree({ initialPath: '/view/docs/intro' })

    // /docs が開き、現在ページ /docs/intro が可視（aria-current="page"）。
    // 祖先は自身を含めないため /docs/intro 自体は展開されない（Deep は不可視）。
    const introLink = await screen.findByRole('link', { name: 'Intro' })
    expect(introLink.closest('[role="treeitem"]')).toHaveAttribute('aria-current', 'page')
    const docsItem = screen.getByRole('treeitem', { name: /docs/ })
    expect(docsItem).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('Deep')).toBeNull()
  })

  it('localStorage 復元: 保存された展開パスが初期展開される', async () => {
    window.localStorage.setItem('janus-sidebar-expanded', JSON.stringify(['/docs']))
    renderTree({ initialPath: '/' })

    // /docs が展開済み（子 Guide が可視）。/docs/intro は未展開（Deep は不可視）。
    expect(await screen.findByText('Guide')).toBeInTheDocument()
    expect(screen.queryByText('Deep')).toBeNull()
  })

  it('優先関係: 復元 ∪ 現在パス祖先の和集合で展開される', async () => {
    // 復元に /docs/intro（過去に開いていた枝）を仕込み、現在パスは /view/docs/intro。
    // 現在パス祖先 /docs（自動展開）と、復元された /docs/intro の和集合で両方開く。
    window.localStorage.setItem(
      'janus-sidebar-expanded',
      JSON.stringify(['/docs/intro']),
    )
    renderTree({ initialPath: '/view/docs/intro' })

    // /docs（現在パス祖先）∪ /docs/intro（復元）で Deep まで可視。
    expect(await screen.findByText('Deep')).toBeInTheDocument()
  })

  it('ローディング表示: 取得遅延中は「読み込み中…」が出る', async () => {
    let resolve: (nodes: PageTreeNode[]) => void = () => {}
    const pending = new Promise<PageTreeNode[]>((r) => {
      resolve = r
    })
    renderTree({ getPageTree: () => pending })

    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    resolve(MOCK_TREE)
    await screen.findByRole('tree', { name: 'ページ' })
  })

  it('エラー表示: 500 で控えめなエラーテキストが出て兄弟（本文）を壊さない', async () => {
    renderTree({
      getPageTree: async () => {
        throw new ApiError(500, 'server error')
      },
    })

    expect(await screen.findByText('ツリーを読み込めませんでした')).toBeInTheDocument()
    // 一括ボタン（兄弟要素）は壊れず残る。
    expect(screen.getByRole('button', { name: /全展開/ })).toBeInTheDocument()
  })

  it('空 title フォールバック: title が空のページはパス末尾セグメントで表示される', async () => {
    const emptyTitleTree: PageTreeNode[] = [
      { path: '/map_library', title: '', hasPage: true, hasChildren: false, children: [] },
      { path: '/docs', title: '  ', hasPage: true, hasChildren: false, children: [] },
    ]
    renderTree({ getPageTree: async () => emptyTitleTree })

    // 空 title → 末尾セグメントにフォールバック。
    expect(await screen.findByRole('link', { name: 'map_library' })).toBeInTheDocument()
    // 空白のみ title も同様にフォールバック。
    expect(screen.getByRole('link', { name: 'docs' })).toBeInTheDocument()
  })
})
