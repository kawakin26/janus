// @vitest-environment jsdom

// MapEditor の最小テスト（設計 §7.4/§8）。
// jsdom では画像の実レイアウトが得られないため、ピクセル座標依存のクリック配置は
// getBoundingClientRect をスタブして検証する。写真添付は uploadAsset をスタブする。

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MapEditor from './MapEditor'
import { StorageProvider } from '../../storage/StorageProvider'
import { AuthProvider } from '../../auth/AuthContext'
import { createStubStorage } from '../../test/stub-storage'
import type { Asset, Folder } from '../../storage/types'
import type { MapData } from './types'

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

  it('写真選択で uploadAsset が呼ばれ写真子リストへ紐付く', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    const uploadAsset = vi.fn(async () => photoAsset)
    const { onChange } = renderEditor(mapData, { uploadAsset })

    const fileInput = await screen.findByLabelText('参考写真を追加')
    const file = new File(['img'], 'entrance.jpg', { type: 'image/jpeg' })
    await userEvent.upload(fileInput, file)

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledWith({ folderId: null, file }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const next = lastMapData(onChange)
    expect(next.markers[0].photos).toEqual([
      { assetRef: { specifiers: [{ kind: 'filename', value: 'entrance.jpg' }] }, desc: '' },
    ])
  })

  it('マップ未選択ではプレースホルダを表示する', async () => {
    renderEditor(baseMapData({ assetRef: { specifiers: [] } }), {
      resolveAssetUrl: vi.fn(async () => null),
    })
    expect(
      await screen.findByText('マップ画像を選択すると、画像上をクリックしてマーカーを配置できます。'),
    ).toBeInTheDocument()
  })
})
