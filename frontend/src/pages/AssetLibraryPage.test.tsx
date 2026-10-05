// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AssetLibraryPage from './AssetLibraryPage'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import { ThemeProvider } from '../theme/ThemeProvider'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { Asset, Folder } from '../storage/types'
import { ApiError } from '../storage/types'
import { CadUnsupportedError } from '../markdown/custom-map/cad/convert'

const convertCadToSvgDispatch = vi.hoisted(() => vi.fn())
vi.mock('../markdown/custom-map/cad/convert-dispatch', () => ({
  convertCadToSvgDispatch,
}))

const folder: Folder = {
  id: 4,
  parentId: null,
  name: '図面',
  created_at: '',
  updated_at: '',
}
const asset: Asset = {
  id: 8,
  folderId: null,
  filename: 'plan.png',
  alias: 'floor-plan',
  url: '/media/assets/plan.png',
  content_type: 'image/png',
  created_at: '',
  updated_at: '',
}

function renderPage(overrides: Parameters<typeof createStubStorage>[0] = {}) {
  const client = createStubStorage({
    currentUser: vi.fn(async () => sampleUser),
    listFolders: vi.fn(async () => [folder]),
    listAssets: vi.fn(async () => [asset]),
    ...overrides,
  })
  const view = render(
    <StorageProvider client={client}>
      <AuthProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/assets']}>
          <Routes>
            <Route path="/assets" element={<AssetLibraryPage />} />
          </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </AuthProvider>
    </StorageProvider>,
  )
  return { client, ...view }
}

describe('AssetLibraryPage', () => {
  it('直下のフォルダ・アセットを表示し、認証付きURLを取得する', async () => {
    const getAssetFileUrl = vi.fn(async () => 'blob:asset')
    const releaseAssetFileUrl = vi.fn()
    const { unmount } = renderPage({ getAssetFileUrl, releaseAssetFileUrl })

    await screen.findByText('alice')
    expect(screen.getByRole('heading', { name: 'アセットライブラリ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '図面' })).toBeInTheDocument()
    expect(screen.getByText('floor-plan')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'URLを確認' }))
    await waitFor(() => expect(getAssetFileUrl).toHaveBeenCalledWith(asset))
    expect(screen.getByRole('link', { name: 'URLを確認' })).toHaveAttribute('href', 'blob:asset')
    unmount()
    expect(releaseAssetFileUrl).toHaveBeenCalledWith('blob:asset')
  })

  it('自前ボタンと未選択プレースホルダを表示し、選択後はファイル名へ統合表示する（二重表示なし）', async () => {
    convertCadToSvgDispatch.mockReset()
    renderPage()
    const user = userEvent.setup()

    await screen.findByText('alice')
    // 自前「ファイルを選択」ボタンが描画される。
    expect(screen.getByRole('button', { name: 'ファイルを選択' })).toBeInTheDocument()
    // 未選択時はボタン隣に未選択プレースホルダが 1 つ出て、「選択中:」は存在しない。
    expect(screen.getByText('ファイルが選択されていません')).toBeInTheDocument()
    expect(screen.queryByText(/選択中:/)).not.toBeInTheDocument()

    // 選択後はファイル名表示へ切り替わり、未選択プレースホルダは消える（統合＝二重表示なし）。
    const file = new File(['image'], 'plan.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), file)
    expect(screen.getByText('選択中: plan.png')).toBeInTheDocument()
    expect(screen.queryByText('ファイルが選択されていません')).not.toBeInTheDocument()
  })

  it('フォルダ作成とalias付き画像アップロードを統合フォームから実行する', async () => {
    convertCadToSvgDispatch.mockReset()
    const createFolder = vi.fn(async () => folder)
    const uploadAsset = vi.fn(async () => asset)
    const { client } = renderPage({ createFolder, uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    await user.type(screen.getByLabelText('新しいフォルダ名'), '図面')
    await user.click(screen.getByRole('button', { name: 'フォルダ作成' }))
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ parentId: null, name: '図面' }))

    const file = new File(['image'], 'plan.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), file)
    expect(screen.getByText('選択中: plan.png')).toBeInTheDocument()
    await user.type(screen.getByLabelText('alias（任意）'), 'floor-plan')
    await user.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() =>
      expect(uploadAsset).toHaveBeenCalledWith({ folderId: null, file, alias: 'floor-plan' }),
    )
    // 画像分岐では CAD 変換を通らない。
    expect(convertCadToSvgDispatch).not.toHaveBeenCalled()
    expect(await screen.findByText('登録URL:', { exact: false })).toBeInTheDocument()
    expect(client).not.toHaveProperty('restClient')
  })

  it('CAD変換成功時はimage/svg+xmlの.svgファイルをuploadAssetへ渡す', async () => {
    convertCadToSvgDispatch.mockReset()
    convertCadToSvgDispatch.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      filename: 'plan.svg',
    })
    let uploadedFile: File | null = null
    const uploadAsset = vi.fn(async (input: { folderId: number | null; file: File; alias?: string }) => {
      uploadedFile = input.file
      return asset
    })
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const cadFile = new File(['dxf-bytes'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('ファイル'), cadFile)
    await user.selectOptions(screen.getByLabelText('回転'), '90')
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1))
    expect(convertCadToSvgDispatch).toHaveBeenCalledWith(cadFile, 90)
    const file = uploadedFile as File | null
    expect(file).toBeInstanceOf(File)
    expect(file?.type).toBe('image/svg+xml')
    expect(file?.name.endsWith('.svg')).toBe(true)
  })

  it('同じCADファイルを2回続けてアップロードしても2回目の変換が走る', async () => {
    convertCadToSvgDispatch.mockReset()
    convertCadToSvgDispatch.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      filename: 'plan.svg',
    })
    const uploadAsset = vi.fn(async () => asset)
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const input = screen.getByLabelText('ファイル')
    const cadFile = new File(['dxf-bytes'], 'plan.dxf', { type: 'application/dxf' })

    await user.upload(input, cadFile)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => expect(convertCadToSvgDispatch).toHaveBeenCalledTimes(1))

    // 同一ファイルを選び直しても onChange が発火する（value クリアによる）。
    await user.upload(input, cadFile)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => expect(convertCadToSvgDispatch).toHaveBeenCalledTimes(2))
  })

  it('409時はリネーム案内をフォーム内赤文字（role=alert）で表示し、重複登録を繰り返さない', async () => {
    convertCadToSvgDispatch.mockReset()
    convertCadToSvgDispatch.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      filename: 'plan.svg',
    })
    const uploadAsset = vi.fn(async () => {
      throw new ApiError(409, '同一フォルダ内に同名のファイルまたは別名が既に存在します。')
    })
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const cadFile = new File(['dxf-bytes'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('ファイル'), cadFile)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/登録ファイル名または alias を変えて再登録/)
    expect(uploadAsset).toHaveBeenCalledTimes(1)
  })

  it('エラー時は選択中ファイルを維持し、リネームして再登録できる', async () => {
    convertCadToSvgDispatch.mockReset()
    convertCadToSvgDispatch.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      filename: 'plan.svg',
    })
    let callCount = 0
    const uploadAsset = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        throw new ApiError(409, '同一フォルダ内に同名のファイルまたは別名が既に存在します。')
      }
      return asset
    })
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const cadFile = new File(['dxf-bytes'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('ファイル'), cadFile)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    // 409 後も選択中表示が残り、再選択不要で送信ボタンが有効なまま。
    await screen.findByRole('alert')
    expect(screen.getByText('選択中: plan.dxf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アップロード' })).toBeEnabled()

    // 登録ファイル名を変えて再送（再選択不要）。
    await user.type(screen.getByLabelText('登録ファイル名（任意）'), 'plan-rev2')
    await user.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('登録URL:', { exact: false })).toBeInTheDocument()
  })

  it('成功時は選択がクリアされ、送信ボタンが無効に戻る', async () => {
    convertCadToSvgDispatch.mockReset()
    const uploadAsset = vi.fn(async () => asset)
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const file = new File(['image'], 'plan.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), file)
    await user.type(screen.getByLabelText('alias（任意）'), 'floor-plan')
    expect(screen.getByText('選択中: plan.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('選択中: plan.png')).not.toBeInTheDocument())
    expect(screen.getByLabelText('alias（任意）')).toHaveValue('')
    expect(screen.getByLabelText('登録ファイル名（任意）')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'アップロード' })).toBeDisabled()
  })

  it('登録ファイル名を指定するとそのファイル名でuploadAssetへ渡す（CAD）', async () => {
    convertCadToSvgDispatch.mockReset()
    convertCadToSvgDispatch.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      filename: 'plan.svg',
    })
    let uploadedFile: File | null = null
    const uploadAsset = vi.fn(
      async (input: { folderId: number | null; file: File; alias?: string }) => {
        uploadedFile = input.file
        return asset
      },
    )
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const cadFile = new File(['dxf-bytes'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('ファイル'), cadFile)
    await user.type(screen.getByLabelText('登録ファイル名（任意）'), 'plan-rev2')
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1))
    expect((uploadedFile as File | null)?.name).toBe('plan-rev2.svg')
  })

  it('CAD変換失敗時は誘導メッセージをフォーム内赤文字で表示し、選択を維持しuploadAssetを呼ばない', async () => {
    convertCadToSvgDispatch.mockReset()
    convertCadToSvgDispatch.mockRejectedValue(new CadUnsupportedError('bad'))
    const uploadAsset = vi.fn(async () => asset)
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const cadFile = new File(['nope'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('ファイル'), cadFile)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/通常の画像\/SVG アップロードフォーム/)
    expect(uploadAsset).not.toHaveBeenCalled()
    // 変換失敗後も選択を維持する。
    expect(screen.getByText('選択中: plan.dxf')).toBeInTheDocument()
  })

  it('回転selectは未選択・画像選択時は無効、CAD選択時のみ有効', async () => {
    convertCadToSvgDispatch.mockReset()
    renderPage()
    const user = userEvent.setup()

    await screen.findByText('alice')
    // 未選択: 無効。
    expect(screen.getByLabelText('回転')).toBeDisabled()

    // 画像選択: 無効。
    const image = new File(['image'], 'plan.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), image)
    expect(screen.getByLabelText('回転')).toBeDisabled()

    // CAD 選択: 有効。
    const cadFile = new File(['dxf-bytes'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('ファイル'), cadFile)
    expect(screen.getByLabelText('回転')).toBeEnabled()
  })

  it('SVG（画像分岐）は変換を通らずそのままuploadAssetへ渡す', async () => {
    convertCadToSvgDispatch.mockReset()
    let uploadedFile: File | null = null
    const uploadAsset = vi.fn(
      async (input: { folderId: number | null; file: File; alias?: string }) => {
        uploadedFile = input.file
        return asset
      },
    )
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const svgFile = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    await user.upload(screen.getByLabelText('ファイル'), svgFile)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1))
    expect(convertCadToSvgDispatch).not.toHaveBeenCalled()
    expect((uploadedFile as File | null)?.name).toBe('logo.svg')
  })

  it('送信開始時に前回のページメッセージ（フォルダ作成status）がクリアされる', async () => {
    convertCadToSvgDispatch.mockReset()
    const createFolder = vi.fn(async () => folder)
    const uploadAsset = vi.fn(async () => asset)
    renderPage({ createFolder, uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    // 先にフォルダ作成で旧メッセージを出す。
    await user.type(screen.getByLabelText('新しいフォルダ名'), '図面')
    await user.click(screen.getByRole('button', { name: 'フォルダ作成' }))
    expect(await screen.findByText('フォルダを作成しました')).toBeInTheDocument()

    // 画像アップロードを送信すると、旧メッセージが消えて成功 status だけになる。
    const file = new File(['image'], 'plan.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), file)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    expect(await screen.findByText('アセットを登録しました')).toBeInTheDocument()
    expect(screen.queryByText('フォルダを作成しました')).not.toBeInTheDocument()
  })

  it('画像で登録ファイル名を拡張子なし入力すると元拡張子を補完し、既に拡張子付きなら二重付与しない', async () => {
    convertCadToSvgDispatch.mockReset()
    let uploadedFile: File | null = null
    const uploadAsset = vi.fn(
      async (input: { folderId: number | null; file: File; alias?: string }) => {
        uploadedFile = input.file
        return asset
      },
    )
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')

    // 拡張子なし入力 → 元拡張子 .png を補完。
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), file)
    await user.type(screen.getByLabelText('登録ファイル名（任意）'), '現場A')
    await user.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1))
    expect(convertCadToSvgDispatch).not.toHaveBeenCalled()
    expect((uploadedFile as File | null)?.name).toBe('現場A.png')

    // 既に正しい拡張子付きなら二重付与しない。
    const file2 = new File(['image'], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), file2)
    await user.type(screen.getByLabelText('登録ファイル名（任意）'), '現場A.png')
    await user.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(2))
    expect((uploadedFile as File | null)?.name).toBe('現場A.png')
  })

  it('変換中は入力・ボタンがdisabledになりスピナーが出て、完了後に解除される', async () => {
    convertCadToSvgDispatch.mockReset()
    let resolveConvert: (value: { svg: string; filename: string }) => void = () => {}
    convertCadToSvgDispatch.mockImplementation(
      () =>
        new Promise<{ svg: string; filename: string }>((resolve) => {
          resolveConvert = resolve
        }),
    )
    const uploadAsset = vi.fn(async () => asset)
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const cadFile = new File(['dxf-bytes'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('ファイル'), cadFile)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    // 変換中: 各入力・ボタンが disabled、スピナー表示。
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('変換中...'))
    expect(screen.getByLabelText('登録ファイル名（任意）')).toBeDisabled()
    expect(screen.getByLabelText('alias（任意）')).toBeDisabled()
    expect(screen.getByLabelText('回転')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ファイルを選択' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'アップロード' })).toBeDisabled()

    // 変換完了 → アップロード完了後に解除される。
    resolveConvert({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', filename: 'plan.svg' })
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ファイルを選択' })).toBeEnabled(),
    )
    expect(screen.getByLabelText('alias（任意）')).toBeEnabled()
    expect(screen.getByLabelText('登録ファイル名（任意）')).toBeEnabled()
  })

  it('成功メッセージはrole=status（赤文字でない）で表示する', async () => {
    convertCadToSvgDispatch.mockReset()
    const uploadAsset = vi.fn(async () => asset)
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const file = new File(['image'], 'plan.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('ファイル'), file)
    await user.click(screen.getByRole('button', { name: 'アップロード' }))

    const status = await screen.findByText('アセットを登録しました')
    expect(status).toHaveAttribute('role', 'status')
    // エラーの role=alert は出ていない。
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
