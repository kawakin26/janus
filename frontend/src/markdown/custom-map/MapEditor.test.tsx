// @vitest-environment jsdom

// MapEditor の最小テスト（設計 §7.4/§8）。
// jsdom では画像の実レイアウトが得られないため、ピクセル座標依存のクリック配置は
// getBoundingClientRect をスタブして検証する。写真添付は uploadAsset をスタブする。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MapEditor from './MapEditor'
import { StorageProvider } from '../../storage/StorageProvider'
import { AuthProvider } from '../../auth/AuthContext'
import { createStubStorage } from '../../test/stub-storage'
import type { Asset, Folder } from '../../storage/types'
import type { MapData } from './types'
import { readMode } from '../../storage/mode'

// 動作モード判定はモジュールをモックして制御する（capture 属性の分岐検証用）。
vi.mock('../../storage/mode', () => ({ readMode: vi.fn() }))
const readModeMock = vi.mocked(readMode)

const folder: Folder = { id: 1, parentId: null, name: '図面', created_at: '', updated_at: '' }
const mapAsset: Asset = {
  id: 2,
  folderId: null,
  filename: 'plan.svg',
  alias: 'floor-plan',
  url: '/media/assets/plan.svg',
  content_type: 'image/svg+xml',
  created_at: '',
  updated_at: '',
}
const photoAsset: Asset = {
  id: 3,
  folderId: null,
  filename: 'entrance.jpg',
  alias: '',
  url: '/media/assets/entrance.jpg',
  content_type: 'image/jpeg',
  created_at: '',
  updated_at: '',
}

/** onChange スタブに渡された最新の MapData を取り出す（.at() を使わず lib 互換）。 */
function lastMapData(onChange: ReturnType<typeof vi.fn>): MapData {
  const calls = onChange.mock.calls
  return calls[calls.length - 1][0] as MapData
}

function baseMapData(overrides: Partial<MapData> = {}): MapData {
  return {
    assetRef: { specifiers: [{ kind: 'filename', value: 'plan.svg' }] },
    cx: 50,
    cy: 50,
    scale: 1,
    restore: 15,
    rotate: 0,
    link: '',
    pinSize: 12,
    labelSize: 12,
    markers: [],
    ...overrides,
  }
}

function renderEditor(
  mapData: MapData,
  overrides: Parameters<typeof createStubStorage>[0] = {},
) {
  const onChange = vi.fn()
  const client = createStubStorage({
    listFolders: vi.fn(async () => [folder]),
    listAssets: vi.fn(async () => [mapAsset]),
    resolveAssetUrl: vi.fn(async () => 'blob:map'),
    releaseAssetFileUrl: vi.fn(),
    ...overrides,
  })
  const view = render(
    <StorageProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <MapEditor mapData={mapData} onChange={onChange} />
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
  return { onChange, client, ...view }
}

describe('MapEditor', () => {
  beforeEach(() => {
    // 既定はサーバー相当（null）。各テストで必要に応じて上書きする。
    readModeMock.mockReturnValue(null)
  })

  it('画像上クリックでマーカーを追加し onChange に座標付き MapData を返す', async () => {
    const { onChange } = renderEditor(baseMapData())

    const preview = await screen.findByTestId('map-editor-preview')
    // jsdom はレイアウトを持たないため矩形をスタブする。
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    // 中央(100,50)付近をクリック → x=50, y=50。
    await userEvent.pointer({ keys: '[MouseLeft]', target: preview, coords: { clientX: 100, clientY: 50 } })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const next = lastMapData(onChange)
    expect(next.markers).toHaveLength(1)
    expect(next.markers[0]).toMatchObject({ x: 50, y: 50, label: '', color: '#ff3b30' })
  })

  it('ラベル編集で onChange が更新 MapData を返す', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '', desc: '', color: '#ff3b30', photos: [] }],
    })
    const { onChange } = renderEditor(mapData)

    const labelInput = await screen.findByLabelText('ラベル')
    await userEvent.type(labelInput, '入')

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const next = lastMapData(onChange)
    expect(next.markers[0].label).toBe('入')
  })

  it('ファイル選択で uploadAsset が呼ばれ写真子リストへ紐付く', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    const uploadAsset = vi.fn(async () => photoAsset)
    const { onChange } = renderEditor(mapData, { uploadAsset })

    expect(screen.getByRole('button', { name: 'カメラで撮影' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ファイルを選択' })).toBeInTheDocument()
    const fileInput = await screen.findByLabelText('ファイルを選択')
    const file = new File(['img'], 'entrance.jpg', { type: 'image/jpeg' })
    await userEvent.upload(fileInput, file)

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledWith({ folderId: null, file }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(fileInput).toHaveValue('')
    const next = lastMapData(onChange)
    expect(next.markers[0].photos).toEqual([
      { assetRef: { specifiers: [{ kind: 'filename', value: 'entrance.jpg' }] }, desc: '' },
    ])
  })

  it('カメラ撮影で uploadAsset が呼ばれ写真子リストへ紐付く', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    const uploadAsset = vi.fn(async () => photoAsset)
    const { onChange } = renderEditor(mapData, { uploadAsset })

    const cameraInput = await screen.findByLabelText('カメラで撮影')
    const file = new File(['img'], 'camera.jpg', { type: 'image/jpeg' })
    await userEvent.upload(cameraInput, file)

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledWith({ folderId: null, file }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(cameraInput).toHaveValue('')
    const next = lastMapData(onChange)
    expect(next.markers[0].photos).toEqual([
      { assetRef: { specifiers: [{ kind: 'filename', value: 'entrance.jpg' }] }, desc: '' },
    ])
  })

  it('カメラとファイル選択のボタンが対応する input を起動する', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderEditor(mapData)

    const cameraInput = await screen.findByLabelText('カメラで撮影')
    const fileInput = await screen.findByLabelText('ファイルを選択')
    const cameraClick = vi.spyOn(cameraInput, 'click')
    const fileClick = vi.spyOn(fileInput, 'click')

    await userEvent.click(screen.getByRole('button', { name: 'カメラで撮影' }))
    expect(cameraClick).toHaveBeenCalledTimes(1)
    expect(fileClick).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択' }))
    expect(fileClick).toHaveBeenCalledTimes(1)
    expect(cameraClick).toHaveBeenCalledTimes(1)
  })

  it('マップ未選択ではプレースホルダを表示する', async () => {
    renderEditor(baseMapData({ assetRef: { specifiers: [] } }), {
      resolveAssetUrl: vi.fn(async () => null),
    })
    expect(
      await screen.findByText('マップ画像を選択すると、画像上をクリックしてマーカーを配置できます。'),
    ).toBeInTheDocument()
  })

  it('ローカルモードではカメラ input だけが capture="environment" を持つ', async () => {
    readModeMock.mockReturnValue('local')
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderEditor(mapData)

    expect(screen.getByRole('button', { name: 'カメラで撮影' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ファイルを選択' })).toBeInTheDocument()
    const cameraInput = await screen.findByLabelText('カメラで撮影')
    const fileInput = await screen.findByLabelText('ファイルを選択')
    expect(cameraInput.getAttribute('capture')).toBe('environment')
    expect(fileInput.getAttribute('capture')).toBeNull()
  })

  it('サーバーモードではカメラとファイルの input に capture 属性を持たない', async () => {
    readModeMock.mockReturnValue('server')
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderEditor(mapData)

    const cameraInput = await screen.findByLabelText('カメラで撮影')
    const fileInput = await screen.findByLabelText('ファイルを選択')
    expect(cameraInput.getAttribute('capture')).toBeNull()
    expect(fileInput.getAttribute('capture')).toBeNull()
  })

  it('モード未設定（null）ではカメラとファイルの input に capture 属性を持たない', async () => {
    readModeMock.mockReturnValue(null)
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderEditor(mapData)

    const cameraInput = await screen.findByLabelText('カメラで撮影')
    const fileInput = await screen.findByLabelText('ファイルを選択')
    expect(cameraInput.getAttribute('capture')).toBeNull()
    expect(fileInput.getAttribute('capture')).toBeNull()
  })
})
