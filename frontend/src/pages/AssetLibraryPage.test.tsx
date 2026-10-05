// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AssetLibraryPage from './AssetLibraryPage'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { Asset, Folder } from '../storage/types'
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
        <MemoryRouter initialEntries={['/assets']}>
          <Routes>
            <Route path="/assets" element={<AssetLibraryPage />} />
          </Routes>
        </MemoryRouter>
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

  it('フォルダ作成とalias付きアップロードをStorageClient経由で実行する', async () => {
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
    await user.type(screen.getByLabelText('alias（任意）'), 'floor-plan')
    await user.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() =>
      expect(uploadAsset).toHaveBeenCalledWith({ folderId: null, file, alias: 'floor-plan' }),
    )
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
    await user.upload(screen.getByLabelText('CADファイル（.jww / .dxf）'), cadFile)
    await user.selectOptions(screen.getByLabelText('回転'), '90')
    await user.click(screen.getByRole('button', { name: '変換して登録' }))

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1))
    expect(convertCadToSvgDispatch).toHaveBeenCalledWith(cadFile, 90)
    const file = uploadedFile as File | null
    expect(file).toBeInstanceOf(File)
    expect(file?.type).toBe('image/svg+xml')
    expect(file?.name.endsWith('.svg')).toBe(true)
  })

  it('CAD変換失敗時は誘導メッセージを表示しuploadAssetを呼ばない', async () => {
    convertCadToSvgDispatch.mockReset()
    convertCadToSvgDispatch.mockRejectedValue(new CadUnsupportedError('bad'))
    const uploadAsset = vi.fn(async () => asset)
    renderPage({ uploadAsset })
    const user = userEvent.setup()

    await screen.findByText('alice')
    const cadFile = new File(['nope'], 'plan.dxf', { type: 'application/dxf' })
    await user.upload(screen.getByLabelText('CADファイル（.jww / .dxf）'), cadFile)
    await user.click(screen.getByRole('button', { name: '変換して登録' }))

    expect(await screen.findByText(/通常の画像\/SVG アップロードフォーム/)).toBeInTheDocument()
    expect(uploadAsset).not.toHaveBeenCalled()
  })
})
