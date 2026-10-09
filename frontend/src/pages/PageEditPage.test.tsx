// @vitest-environment jsdom
// ページ作成・編集 PageEditPage のテスト（サブタスク 10.2）。
// 既存ページの編集で updatePage(path,{title,body}) が呼ばれ /view へ遷移 /
// 新規作成で createPage({path,title,body}) が呼ばれる /
// createPage が ApiError(409) を throw したとき日本語メッセージが role="alert" に出て遷移しない、を検証する。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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

/**
 * iframe（draw.io webapp）からの postMessage を自オリジンで模す。
 * PageEditPage の message ハンドラは origin===window.location.origin のみ受理するため、
 * jsdom の既定 origin で MessageEvent を dispatch する。
 */
function dispatchDrawioMessage(payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify(payload),
        origin: window.location.origin,
      }),
    )
  })
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
    await user.click(screen.getByRole('button', { name: 'ページを保存' }))

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
    await user.click(screen.getByRole('button', { name: 'ページを保存' }))

    expect(createPage).toHaveBeenCalledWith({ path: '/docs/new', title: 'T', body: 'B' })
    await waitFor(() => {
      expect(screen.getByTestId('view')).toBeInTheDocument()
    })
  })

  it('drawio は既定で全画面（dialog）で開き、解除/Esc で外れ再トグルできる', async () => {
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
    // 問題2 対処で既定が全画面オーバーレイになったため、開いた直後から dialog ロールを持つ。
    const frame = await screen.findByTitle('drawio 描画エディタ')
    const editor = frame.parentElement as HTMLElement
    expect(screen.getByRole('dialog')).toBe(editor)

    // 全画面を解除すると dialog ロールが外れる。
    await user.click(screen.getByRole('button', { name: '全画面を解除' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // 再び全画面にすると dialog ロールが戻る。
    await user.click(screen.getByRole('button', { name: '全画面表示' }))
    expect(screen.getByRole('dialog')).toBe(editor)

    // Esc で解除する。
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('描画編集を閉じると（exit 往復後に）全画面状態もリセットされ、再度開くと既定の全画面に戻る', async () => {
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
    // 既定で全画面（dialog）。一旦解除してから閉じる。
    expect(screen.getByRole('dialog')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: '全画面を解除' }))

    // 「描画編集を閉じる」は閉じる前に最新 XML を pull するため export を要求する
    //（直接 iframe を破棄しない）。export 応答が来るまでエディタはまだ閉じない。
    await user.click(screen.getByRole('button', { name: '描画編集を閉じる' }))
    expect(screen.queryByTitle('drawio 描画エディタ')).not.toBeNull()

    // draw.io が export（最新 XML）を返すと、本文へ回収してから閉じる。
    dispatchDrawioMessage({ event: 'export', xml: '<mxGraphModel/>', format: 'xml' })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })

    // 再度開くと（既定どおり）全画面で開く。
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('draw.io 内の exit 通知を受けると（modified に依存せず）素直に閉じる', async () => {
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

    // draw.io 側の Exit ボタン等が exit を送ると閉じる。modified は常に false 化されるため
    // host は判定に使わない（autosave:1 で編集内容は本文へ反映済みという前提）。
    dispatchDrawioMessage({ event: 'exit', modified: false })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })
  })

  it('autosave イベントで編集内容が本文へ反映される（保存操作なしでも取りこぼさない）', async () => {
    const updatePage = vi.fn(async () => makePage())
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body: '' })),
      updatePage,
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')

    // 「ファイル→保存」せず autosave だけが届いても本文へ反映される（主因対策の回帰テスト）。
    dispatchDrawioMessage({ event: 'autosave', xml: '<mxGraphModel>AUTO</mxGraphModel>' })
    // exit で閉じてから保存。
    dispatchDrawioMessage({ event: 'exit', modified: false })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })
    await user.click(screen.getByRole('button', { name: 'ページを保存' }))
    await waitFor(() => expect(updatePage).toHaveBeenCalledTimes(1))
    // autosave された XML が本文（:::drawio ブロック）へ入っている。
    expect(updatePage).toHaveBeenCalledWith(
      '/docs/intro',
      expect.objectContaining({
        body: expect.stringContaining('AUTO'),
      }),
    )
    expect(updatePage).toHaveBeenCalledWith(
      '/docs/intro',
      expect.objectContaining({
        body: expect.stringContaining(':::drawio'),
      }),
    )
  })

  it('新規描画の反復 autosave は :::drawio ブロックを重複追加せず同一ブロックを置換する', async () => {
    const updatePage = vi.fn(async () => makePage())
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body: '' })),
      updatePage,
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')

    // autosave の反復 save を 3 回受信する（新規描画・同一セッション）。
    dispatchDrawioMessage({ event: 'save', xml: '<mxGraphModel>A</mxGraphModel>' })
    dispatchDrawioMessage({ event: 'save', xml: '<mxGraphModel>AB</mxGraphModel>' })
    dispatchDrawioMessage({ event: 'save', xml: '<mxGraphModel>ABC</mxGraphModel>' })

    // 本文には :::drawio ブロックが 1 つだけ（最新 XML）であること。
    const bodyField = screen.getByLabelText('本文（Markdown）') as HTMLTextAreaElement
    await waitFor(() => {
      expect(bodyField.value).toContain('ABC')
    })
    const blockCount = (bodyField.value.match(/:::drawio/g) ?? []).length
    expect(blockCount).toBe(1)
    expect(bodyField.value).not.toContain('>A<')
  })

  it('既存描画の save(exit:true) は対象ブロックだけを置換し（追記せず）エディタを閉じる（finding#1）', async () => {
    // 既存 :::drawio ブロックを 2 つ持つ本文。2 番目（index 1）を編集して
    // save(exit:true) を送ったとき、close による ref リセットと競合しても
    // 対象ブロックだけが置換され、ブロック数が増えない（新規追記されない）ことを検証する。
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () =>
        makePage({
          body:
            ':::drawio\n```\n<mxGraphModel>FIRST</mxGraphModel>\n```\n:::\n\n' +
            ':::drawio\n```\n<mxGraphModel>SECOND</mxGraphModel>\n```\n:::\n',
        }),
      ),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    // 2 番目の既存描画（index 1）をセレクトで選び「描画を編集」で開く。
    await user.selectOptions(screen.getByRole('combobox', { name: '編集する描画を選択' }), '1')
    await user.click(screen.getByRole('button', { name: '描画を編集' }))
    await screen.findByTitle('drawio 描画エディタ')

    // save と同時に exit:true を受信（「ファイル→保存」して閉じる操作）。
    // onSave は applyDrawioXml の直後に closeDrawioEditing() を呼ぶため、snapshot で
    // 競合を断てていなければ本文末尾へ新規ブロックが追記されてしまう。
    dispatchDrawioMessage({ event: 'save', xml: '<mxGraphModel>SECOND-EDITED</mxGraphModel>', exit: true })

    // エディタが閉じる。
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })

    const bodyField = screen.getByLabelText('本文（Markdown）') as HTMLTextAreaElement
    // 対象（2 番目）ブロックだけが置換され、1 番目は不変。ブロック数は 2 のまま（追記なし）。
    expect(bodyField.value).toContain('SECOND-EDITED')
    expect(bodyField.value).toContain('FIRST')
    expect(bodyField.value).not.toContain('>SECOND<')
    const blockCount = (bodyField.value.match(/:::drawio/g) ?? []).length
    expect(blockCount).toBe(2)
  })

  it('セッション途中の OS テーマ変更で iframe src（dark パラメータ）が再読込されない', async () => {
    // 制御可能な matchMedia を用意し、prefers-color-scheme の change を発火できるようにする。
    const listeners = new Set<() => void>()
    const mql = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: (cb: () => void) => listeners.add(cb),
      removeListener: (cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => true,
    }
    const originalMatchMedia = window.matchMedia
    window.matchMedia = (() => mql) as unknown as typeof window.matchMedia

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
    const frame = (await screen.findByTitle('drawio 描画エディタ')) as HTMLIFrameElement
    // 開いた時点は light（matches=false）なので dark=0 で固定されている。
    expect(frame.src).toContain('dark=0')

    // OS テーマが dark に変わり、ThemeProvider が change を受けても、
    // iframe src はセッション開始時の値（dark=0）のまま＝再読込（XML 巻き戻り）しない。
    act(() => {
      mql.matches = true
      listeners.forEach((cb) => cb())
    })
    expect(frame.src).toContain('dark=0')
    expect(frame.src).not.toContain('dark=1')

    window.matchMedia = originalMatchMedia
  })

  it('draw.io 編集中はページ保存を拒否し（updatePage を呼ばず遷移しない）、閉じれば保存できる', async () => {
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
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')

    // 編集中は「ページを保存」が無効化され、submit しても保存・遷移しない（finding#1）。
    const saveButton = screen.getByRole('button', { name: 'ページを保存' })
    expect(saveButton).toBeDisabled()
    await user.click(saveButton)
    expect(updatePage).not.toHaveBeenCalled()
    expect(screen.queryByTestId('view')).toBeNull()

    // 「描画編集を閉じる」→ 未保存なし exit で閉じると、ページ保存が有効化され保存できる。
    dispatchDrawioMessage({ event: 'exit', modified: false })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })
    const saveButtonAfter = screen.getByRole('button', { name: 'ページを保存' })
    expect(saveButtonAfter).toBeEnabled()
    await user.click(saveButtonAfter)
    expect(updatePage).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByTestId('view')).toBeInTheDocument()
    })
  })

  it('draw.io 編集中は追加・セレクト・編集が無効化され、別セッションへ切り替えられない（finding#1/B-6）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      // 既存 :::drawio ブロックを 1 つ持つ本文（セレクト＋「描画を編集」が出る）。
      getPage: vi.fn(async () =>
        makePage({ body: ':::drawio\n```\n<mxGraphModel>X</mxGraphModel>\n```\n:::\n' }),
      ),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    // セッション開始前は追加・セレクト・編集とも有効。
    expect(screen.getByRole('button', { name: '描画を追加' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: '編集する描画を選択' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '描画を編集' })).toBeEnabled()

    // 「描画を編集」で全画面オーバーレイが開く。全画面を解除して背景ボタンを操作可能にする。
    await user.click(screen.getByRole('button', { name: '描画を編集' }))
    await screen.findByTitle('drawio 描画エディタ')
    await user.click(screen.getByRole('button', { name: '全画面を解除' }))

    // active セッション中は追加・セレクト・編集とも無効化され、別セッションへ切り替えられない。
    expect(screen.getByRole('button', { name: '描画を追加' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '編集する描画を選択' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '描画を編集' })).toBeDisabled()

    // 「描画編集を閉じる」→ export 応答（最新 XML）回収後に閉じると再び有効化される。
    await user.click(screen.getByRole('button', { name: '描画編集を閉じる' }))
    dispatchDrawioMessage({ event: 'export', xml: '<mxGraphModel>X</mxGraphModel>', format: 'xml' })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })
    expect(screen.getByRole('button', { name: '描画を追加' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: '編集する描画を選択' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '描画を編集' })).toBeEnabled()
  })

  it('「マップを追加」でマップ編集モーダル（dialog, aria-label=マップ編集）がフォーム外に開く', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
      // モーダルがマウント時に呼ぶ非同期（アセット一覧）をスタブで解決する。
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByDisplayValue('既存の本文')).toBeInTheDocument()
    })

    // 開く前はモーダルが無い。
    expect(screen.queryByRole('dialog', { name: 'マップ編集' })).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'マップを追加' }))

    // MapEditorModal が開く。
    expect(await screen.findByRole('dialog', { name: 'マップ編集' })).toBeInTheDocument()
    // 旧インライン展開（本文へ反映 / マップ編集をやめる）は存在しない。
    expect(screen.queryByRole('button', { name: 'マップを本文へ反映' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'マップ編集をやめる' })).toBeNull()
  })

  it('マップ編集中はページ保存を拒否し（保存を呼ばず遷移しない）、破棄して閉じれば保存できる', async () => {
    const updatePage = vi.fn(async () => makePage())
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage()),
      updatePage,
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByDisplayValue('既存の本文')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'マップを追加' }))
    await screen.findByRole('dialog', { name: 'マップ編集' })

    // 編集中は「ページを保存」が無効化され、submit しても保存・遷移しない（drawio と同じ二重ガード）。
    const saveButton = screen.getByRole('button', { name: 'ページを保存' })
    expect(saveButton).toBeDisabled()
    await user.click(saveButton)
    expect(updatePage).not.toHaveBeenCalled()
    expect(screen.queryByTestId('view')).toBeNull()

    // 「破棄して閉じる」でモーダルを閉じると、ページ保存が有効化され保存できる。
    await user.click(screen.getByRole('button', { name: '破棄して閉じる' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'マップ編集' })).toBeNull()
    })
    // 破棄なので本文は不変。
    expect(screen.getByDisplayValue('既存の本文')).toBeInTheDocument()

    const saveButtonAfter = screen.getByRole('button', { name: 'ページを保存' })
    expect(saveButtonAfter).toBeEnabled()
    await user.click(saveButtonAfter)
    expect(updatePage).toHaveBeenCalledTimes(1)
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
    await user.click(screen.getByRole('button', { name: 'ページを保存' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('同一パスのページが既に存在します')
    })
    expect(screen.queryByTestId('view')).toBeNull()
  })

  it('title を持つマップブロックのセレクト option ラベルが「〈title〉」になる（作業2）', async () => {
    const body = [
      ':::custom-map{filename="plan.svg" title="現場図"}',
      '',
      '- x=10 y=20 label="入口"',
      ':::',
    ].join('\n')
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body })),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    const select = await screen.findByRole('combobox', { name: '編集するマップを選択' })
    expect(within(select).getByRole('option', { name: '現場図' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'マップ 1' })).toBeNull()
  })

  it('title が無いマップブロックのセレクト option ラベルは「マップ N」のまま（作業2・後方互換）', async () => {
    const body = [':::custom-map{filename="plan.svg"}', '', '- x=10 y=20', ':::'].join('\n')
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body })),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    const select = await screen.findByRole('combobox', { name: '編集するマップを選択' })
    expect(within(select).getByRole('option', { name: 'マップ 1' })).toBeInTheDocument()
  })

  it('複数ブロック（title あり/なし混在）で各 option ラベルが独立に解決される（作業2）', async () => {
    const body = [
      ':::custom-map{filename="a.svg"}',
      '',
      '- x=1 y=2',
      ':::',
      '',
      ':::custom-map{filename="b.svg" title="二番目"}',
      '',
      '- x=3 y=4',
      ':::',
    ].join('\n')
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body })),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    const select = await screen.findByRole('combobox', { name: '編集するマップを選択' })
    expect(within(select).getByRole('option', { name: 'マップ 1' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: '二番目' })).toBeInTheDocument()
  })

  it('新規追加で開いたモーダルの見出しが「マップ 〈既存数+1〉 を編集」になる（作業2）', async () => {
    const body = [':::custom-map{filename="a.svg"}', '', '- x=1 y=2', ':::'].join('\n')
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body })),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')
    await screen.findByRole('combobox', { name: '編集するマップを選択' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'マップを追加' }))
    const dialog = await screen.findByRole('dialog', { name: 'マップ編集' })
    // 既存 1 ブロック → 新規は番号 2。title 未設定なのでフォールバック表示。
    expect(within(dialog).getByTestId('map-editor-heading')).toHaveTextContent('マップ 2 を編集')
  })

  it('既存ブロック編集で開いたモーダルの見出しが対象タイトルになる（作業2）', async () => {
    const body = [
      ':::custom-map{filename="plan.svg" title="現場図"}',
      '',
      '- x=10 y=20',
      ':::',
    ].join('\n')
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body })),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    const user = userEvent.setup()
    await screen.findByRole('combobox', { name: '編集するマップを選択' })
    await user.click(screen.getByRole('button', { name: 'マップを編集' }))
    const dialog = await screen.findByRole('dialog', { name: 'マップ編集' })
    expect(within(dialog).getByTestId('map-editor-heading')).toHaveTextContent('現場図 を編集')
  })

  it('対象 0 個のときセレクトも編集ボタンも非表示で、追加ボタンのみ表示される（B-3）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body: '本文だけ（ブロックなし）' })),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })
    // 追加ボタンは表示。
    expect(screen.getByRole('button', { name: 'マップを追加' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '描画を追加' })).toBeInTheDocument()
    // セレクト・編集ボタンは非表示。
    expect(screen.queryByRole('combobox', { name: '編集するマップを選択' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: '編集する描画を選択' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'マップを編集' })).toBeNull()
    expect(screen.queryByRole('button', { name: '描画を編集' })).toBeNull()
  })

  it('対象 1 個のときセレクトと編集ボタンが表示され、唯一の対象を編集で開ける（B-3）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () =>
        makePage({ body: ':::drawio\n```\n<mxGraphModel>ONE</mxGraphModel>\n```\n:::\n' }),
      ),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })
    const select = screen.getByRole('combobox', { name: '編集する描画を選択' }) as HTMLSelectElement
    // 唯一の対象（index 0）が選択済み。
    expect(select.value).toBe('0')
    expect(within(select).getByRole('option', { name: '描画 1' })).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を編集' }))
    expect(await screen.findByTitle('drawio 描画エディタ')).toBeInTheDocument()
  })

  it('対象複数のときセレクトで 2 番目を選び編集すると 2 番目のブロックが開く（B-3/B-5）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () =>
        makePage({
          body:
            ':::drawio{title="一番目"}\n```\n<mxGraphModel>A</mxGraphModel>\n```\n:::\n\n' +
            ':::drawio{title="二番目"}\n```\n<mxGraphModel>B</mxGraphModel>\n```\n:::\n',
        }),
      ),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })
    const select = screen.getByRole('combobox', { name: '編集する描画を選択' })
    expect(within(select).getByRole('option', { name: '一番目' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: '二番目' })).toBeInTheDocument()

    const user = userEvent.setup()
    await user.selectOptions(select, '1')
    await user.click(screen.getByRole('button', { name: '描画を編集' }))
    await screen.findByTitle('drawio 描画エディタ')
    // 2 番目のタイトルが初期値として入っていること（= 2 番目のブロックが開いた）。
    const dialog = screen.getByRole('dialog', { name: 'drawio 描画エディタ（全画面）' })
    expect((within(dialog).getByLabelText('タイトル') as HTMLInputElement).value).toBe('二番目')
  })

  it('drawio title を編集→描画編集を閉じる→export 応答で本文に :::drawio{title="..."} が入る（C-6）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body: '' })),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')
    await user.type(
      within(screen.getByRole('dialog', { name: 'drawio 描画エディタ（全画面）' })).getByLabelText('タイトル'),
      '現場レイアウト',
    )

    await user.click(screen.getByRole('button', { name: '描画編集を閉じる' }))
    dispatchDrawioMessage({ event: 'export', xml: '<mxGraphModel>DONE</mxGraphModel>', format: 'xml' })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })

    const bodyField = screen.getByLabelText('本文（Markdown）') as HTMLTextAreaElement
    expect(bodyField.value).toContain(':::drawio{title="現場レイアウト"}')
    expect(bodyField.value).toContain('DONE')
  })

  it('新規描画で XML 空＋title のみでも export で title 付きブロックが入る（C-6(3)）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body: '' })),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')
    await user.type(
      within(screen.getByRole('dialog', { name: 'drawio 描画エディタ（全画面）' })).getByLabelText('タイトル'),
      'タイトルのみ',
    )

    await user.click(screen.getByRole('button', { name: '描画編集を閉じる' }))
    // export は空 XML を返す（未作図）。|| hasTitle 分岐で反映されること。
    dispatchDrawioMessage({ event: 'export', xml: '', format: 'xml' })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })

    const bodyField = screen.getByLabelText('本文（Markdown）') as HTMLTextAreaElement
    expect(bodyField.value).toContain(':::drawio{title="タイトルのみ"}')
  })

  it('新規描画で XML・title とも空のときは空ブロックを作らない（C-6(3)）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () => makePage({ body: '初期本文' })),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByDisplayValue('初期本文')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '描画を追加' }))
    await screen.findByTitle('drawio 描画エディタ')
    // 何も入力せず閉じる。
    await user.click(screen.getByRole('button', { name: '描画編集を閉じる' }))
    dispatchDrawioMessage({ event: 'export', xml: '', format: 'xml' })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })

    const bodyField = screen.getByLabelText('本文（Markdown）') as HTMLTextAreaElement
    // ブロックは追加されず本文は不変。
    expect(bodyField.value).toBe('初期本文')
    expect(bodyField.value).not.toContain(':::drawio')
  })

  it('既存 drawio の title 編集→export で対象ブロックの title が置換され他ブロックは不変（C-6）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () =>
        makePage({
          body:
            ':::drawio{title="一番目"}\n```\n<mxGraphModel>A</mxGraphModel>\n```\n:::\n\n' +
            ':::drawio{title="二番目"}\n```\n<mxGraphModel>B</mxGraphModel>\n```\n:::\n',
        }),
      ),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    // 2 番目を開いて title を変更する。
    await user.selectOptions(screen.getByRole('combobox', { name: '編集する描画を選択' }), '1')
    await user.click(screen.getByRole('button', { name: '描画を編集' }))
    await screen.findByTitle('drawio 描画エディタ')
    const titleInput = within(
      screen.getByRole('dialog', { name: 'drawio 描画エディタ（全画面）' }),
    ).getByLabelText('タイトル')
    await user.clear(titleInput)
    await user.type(titleInput, '二番目改')

    await user.click(screen.getByRole('button', { name: '描画編集を閉じる' }))
    dispatchDrawioMessage({ event: 'export', xml: '<mxGraphModel>B</mxGraphModel>', format: 'xml' })
    await waitFor(() => {
      expect(screen.queryByTitle('drawio 描画エディタ')).toBeNull()
    })

    const bodyField = screen.getByLabelText('本文（Markdown）') as HTMLTextAreaElement
    expect(bodyField.value).toContain(':::drawio{title="二番目改"}')
    expect(bodyField.value).toContain(':::drawio{title="一番目"}')
    expect(bodyField.value).not.toContain(':::drawio{title="二番目"}')
    // ブロック数は 2 のまま（追記なし）。
    expect((bodyField.value.match(/:::drawio/g) ?? []).length).toBe(2)
  })

  it('マップモーダル中はマップ・描画の両系統（追加/セレクト/編集）が無効化される（B-6）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () =>
        makePage({
          body:
            ':::custom-map{filename="a.svg"}\n\n- x=1 y=2\n:::\n\n' +
            ':::drawio\n```\n<mxGraphModel>X</mxGraphModel>\n```\n:::\n',
        }),
      ),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'マップを追加' }))
    await screen.findByRole('dialog', { name: 'マップ編集' })

    // マップモーダル中は両系統の追加・セレクト・編集が無効化される。
    expect(screen.getByRole('button', { name: 'マップを追加' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '編集するマップを選択' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'マップを編集' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '描画を追加' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '編集する描画を選択' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '描画を編集' })).toBeDisabled()
  })

  it('追加・編集ボタンにアイコンが付いても aria-hidden でアクセシブル名はテキストのまま（A-2）', async () => {
    const client = createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPage: vi.fn(async () =>
        makePage({
          body:
            ':::custom-map{filename="a.svg"}\n\n- x=1 y=2\n:::\n\n' +
            ':::drawio\n```\n<mxGraphModel>X</mxGraphModel>\n```\n:::\n',
        }),
      ),
      listFolders: vi.fn(async () => []),
      listAssets: vi.fn(async () => []),
    })
    renderEdit(client, '/edit/docs/intro')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ページ編集' })).toBeInTheDocument()
    })
    // アクセシブル名はテキストのまま引ける（アイコンは aria-hidden で名前に寄与しない）。
    const addMap = screen.getByRole('button', { name: 'マップを追加' })
    const editMap = screen.getByRole('button', { name: 'マップを編集' })
    const addDrawio = screen.getByRole('button', { name: '描画を追加' })
    const editDrawio = screen.getByRole('button', { name: '描画を編集' })
    // アイコン SVG が aria-hidden で描画されている。
    for (const btn of [addMap, editMap, addDrawio, editDrawio]) {
      expect(btn.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })
})
