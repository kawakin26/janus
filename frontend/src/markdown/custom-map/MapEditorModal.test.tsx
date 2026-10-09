// @vitest-environment jsdom

// MapEditorModal の結合テスト（設計 §10.3 / FEAT-003）。
// jsdom はレイアウトを持たないため viewport の getBoundingClientRect と img の
// naturalWidth/Height をスタブする。長押しタイマーは vi.useFakeTimers() で進める。
// readMode はモジュールモックで制御する（capture 分岐）。resolveLongPressMs はスパイして
// マウント時に呼ばれることを確認する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MapEditorModal from './MapEditorModal'
import { StorageProvider } from '../../storage/StorageProvider'
import { AuthProvider } from '../../auth/AuthContext'
import { createStubStorage } from '../../test/stub-storage'
import type { Asset, Folder } from '../../storage/types'
import type { MapData } from './types'
import { readMode } from '../../storage/mode'
import * as longpressConfig from './longpress-config'
import * as mapViewport from './map-viewport'

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

const THRESHOLD = 500
const NATURAL_W = 200
const NATURAL_H = 100
const VIEWPORT_W = 200
const VIEWPORT_H = 100

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

/** 画像の naturalWidth/Height を全 HTMLImageElement にスタブする。 */
function stubImageNaturalSize(): void {
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => NATURAL_W,
  })
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get: () => NATURAL_H,
  })
}

/** viewport 要素の矩形と clientWidth/Height をスタブする。 */
function stubViewportRect(viewport: HTMLElement): void {
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: VIEWPORT_W,
    height: VIEWPORT_H,
    right: VIEWPORT_W,
    bottom: VIEWPORT_H,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => VIEWPORT_W })
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => VIEWPORT_H })
}

function renderModal(
  mapData: MapData,
  overrides: Parameters<typeof createStubStorage>[0] = {},
) {
  const onSave = vi.fn()
  const onDiscard = vi.fn()
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
          <MapEditorModal mapData={mapData} onSave={onSave} onDiscard={onDiscard} />
        </MemoryRouter>
      </AuthProvider>
    </StorageProvider>,
  )
  return { onSave, onDiscard, client, ...view }
}

/** viewport を取得し矩形スタブを適用、画像ロード完了を待つ（fit 計算を確定させる）。 */
async function setupViewport(): Promise<HTMLElement> {
  const viewport = await screen.findByTestId('map-editor-viewport')
  stubViewportRect(viewport)
  // 画像の onLoad を発火させて fit を確定する。
  const img = viewport.querySelector('img')
  if (img) act(() => img.dispatchEvent(new Event('load')))
  return viewport
}

function lastSave(onSave: ReturnType<typeof vi.fn>): MapData {
  const calls = onSave.mock.calls
  return calls[calls.length - 1][0] as MapData
}

describe('MapEditorModal', () => {
  beforeEach(() => {
    readModeMock.mockReturnValue(null)
    stubImageNaturalSize()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('マウント時に resolveLongPressMs が呼ばれる', async () => {
    const spy = vi.spyOn(longpressConfig, 'resolveLongPressMs')
    renderModal(baseMapData())
    await screen.findByTestId('map-editor-viewport')
    expect(spy).toHaveBeenCalled()
  })

  it('閾値未満のタップでは追加されず、閾値到達の長押しで1件追加され選択される', async () => {
    const { onSave } = renderModal(baseMapData())
    const viewport = await screen.findByTestId('map-editor-viewport')
    stubViewportRect(viewport)
    vi.useFakeTimers()

    // 閾値未満: すぐ離す → 追加なし。
    act(() => {
      viewport.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 50, bubbles: true }),
      )
    })
    act(() => {
      viewport.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true }))
    })
    expect(screen.getByText('マーカー一覧 (0)')).toBeInTheDocument()

    // 閾値到達: 長押しして離す → 1件追加＋選択。
    act(() => {
      viewport.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 2, button: 0, clientX: 100, clientY: 50, bubbles: true }),
      )
    })
    act(() => {
      vi.advanceTimersByTime(THRESHOLD)
    })
    act(() => {
      viewport.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: 100, clientY: 50, bubbles: true }))
    })

    expect(screen.getByText('マーカー一覧 (1)')).toBeInTheDocument()
    // 追加マーカーが選択され、X/Y 入力が出る。
    expect(screen.getByLabelText('X (%)')).toBeInTheDocument()

    // 保存で onSave に座標付き MapData が渡る（中央 → x=50,y=50）。
    vi.useRealTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }))
    const saved = lastSave(onSave)
    expect(saved.markers).toHaveLength(1)
    expect(saved.markers[0]).toMatchObject({ x: 50, y: 50 })
  })

  it('移動（ドラッグ）した場合はパン扱いで追加されない', async () => {
    renderModal(baseMapData())
    const viewport = await screen.findByTestId('map-editor-viewport')
    stubViewportRect(viewport)
    vi.useFakeTimers()

    act(() => {
      viewport.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true }),
      )
    })
    // MOVE_THRESHOLD(5) を超えて移動 → moved=true。
    act(() => {
      viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 60, clientY: 60, bubbles: true }))
    })
    act(() => {
      vi.advanceTimersByTime(THRESHOLD)
    })
    act(() => {
      viewport.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 60, clientY: 60, bubbles: true }))
    })

    expect(screen.getByText('マーカー一覧 (0)')).toBeInTheDocument()
  })

  it('既存マーカーのドラッグ移動で右ペインの X/Y が更新される', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderModal(mapData)
    const viewport = await setupViewport()

    const pin = viewport.querySelector('[data-marker-pin="true"]') as HTMLElement
    act(() => {
      pin.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 20, clientY: 40, bubbles: true }))
    })
    // 中央(100,50)へドラッグ。
    act(() => {
      pin.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true }))
    })
    act(() => {
      pin.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true }))
    })

    const xInput = screen.getByLabelText('X (%)') as HTMLInputElement
    const yInput = screen.getByLabelText('Y (%)') as HTMLInputElement
    expect(Number(xInput.value)).toBeCloseTo(50, 0)
    expect(Number(yInput.value)).toBeCloseTo(50, 0)
  })

  it('既存マーカーのクリック（未移動）で選択される', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderModal(mapData)
    const viewport = await setupViewport()

    const pin = viewport.querySelector('[data-marker-pin="true"]') as HTMLElement
    act(() => {
      pin.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 20, clientY: 40, bubbles: true }))
    })
    act(() => {
      pin.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 20, clientY: 40, bubbles: true }))
    })

    expect(screen.getByText('選択中: #1')).toBeInTheDocument()
    expect((screen.getByLabelText('ラベル') as HTMLInputElement).value).toBe('入口')
  })

  it('ラベルクリックでも対象マーカーが選択される（要件3）', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderModal(mapData)
    const viewport = await setupViewport()

    const label = viewport.querySelector('[data-marker-label="true"]') as HTMLElement
    expect(label).toBeTruthy()
    act(() => {
      label.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 20, clientY: 30, bubbles: true }))
    })
    act(() => {
      label.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 20, clientY: 30, bubbles: true }))
    })

    expect(screen.getByText('選択中: #1')).toBeInTheDocument()
  })

  it('右ペインは選択中1件のみ排他表示し、別マーカーへ切り替わる', async () => {
    const mapData = baseMapData({
      markers: [
        { x: 10, y: 20, label: 'A', desc: '', color: '#ff3b30', photos: [] },
        { x: 30, y: 40, label: 'B', desc: '', color: '#ff3b30', photos: [] },
      ],
    })
    renderModal(mapData)
    await setupViewport()

    // 初期は未選択。
    expect(screen.getByText('マーカーを選択すると編集できます。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '#1 A' }))
    expect(screen.getByText('選択中: #1')).toBeInTheDocument()
    // X/Y 数値入力が存在する（要件4）。
    expect(screen.getByLabelText('X (%)')).toBeInTheDocument()
    expect(screen.getByLabelText('Y (%)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '#2 B' }))
    expect(screen.getByText('選択中: #2')).toBeInTheDocument()
    expect((screen.getByLabelText('ラベル') as HTMLInputElement).value).toBe('B')
    // 排他: 選択中は 1 件分のフィールドのみ。
    expect(screen.getAllByLabelText('ラベル')).toHaveLength(1)
  })

  it('マップ全体設定（cx/cy/scale/link/restore/回転/ピン・ラベルサイズ）を編集し保存に乗る', async () => {
    const refitSpy = vi.spyOn(mapViewport, 'computeFitView')
    const user = (await import('@testing-library/user-event')).default.setup()
    const { onSave } = renderModal(baseMapData())
    await setupViewport()

    // 詳細設定を開く。
    fireEvent.click(screen.getByText('詳細設定'))

    const link = screen.getByLabelText('起動ボタンの文言 (link)')
    await user.clear(link)
    await user.type(link, 'マップを開く')

    // 数値入力はキーごとに clamp が走りキャレットと競合するため、最終値を直接 change で与える。
    fireEvent.change(screen.getByLabelText('自動復帰(秒) (restore)'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('ピンサイズ (px)'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('ラベル文字サイズ (px)'), { target: { value: '16' } })
    fireEvent.change(screen.getByLabelText('初期中心X% (cx)'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('初期中心Y% (cy)'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('初期倍率 (scale)'), { target: { value: '2' } })

    // 回転 90° ボタン。
    refitSpy.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '90°' }))

    // cx/cy/scale/rotate 変更で computeFitView が呼び直される。
    await waitFor(() => expect(refitSpy).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }))
    const saved = lastSave(onSave)
    expect(saved.link).toBe('マップを開く')
    expect(saved.restore).toBe(30)
    expect(saved.pinSize).toBe(20)
    expect(saved.labelSize).toBe(16)
    expect(saved.cx).toBe(40)
    expect(saved.cy).toBe(60)
    expect(saved.scale).toBe(2)
    expect(saved.rotate).toBe(90)
  })

  it('写真を添付し desc を編集すると保存の photos[].desc に反映される（Finding2）', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const uploadAsset = vi.fn(async () => photoAsset)
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    const { onSave } = renderModal(mapData, { uploadAsset })
    await setupViewport()

    fireEvent.click(screen.getByRole('button', { name: '#1 入口' }))

    const fileInput = screen.getByLabelText('ファイルを選択')
    const file = new File(['img'], 'entrance.jpg', { type: 'image/jpeg' })
    await user.upload(fileInput, file)

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledWith({ folderId: null, file }))

    const descInput = await screen.findByLabelText('コメント')
    await user.type(descInput, '玄関の様子')

    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }))
    const saved = lastSave(onSave)
    expect(saved.markers[0].photos).toHaveLength(1)
    expect(saved.markers[0].photos[0].desc).toBe('玄関の様子')
    expect(saved.markers[0].photos[0].assetRef.specifiers).toEqual([
      { kind: 'filename', value: 'entrance.jpg' },
    ])
  })

  it('保存で onSave、破棄で onDiscard のみが呼ばれる', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    const user = (await import('@testing-library/user-event')).default.setup()

    const { onSave, onDiscard } = renderModal(mapData)
    await setupViewport()
    fireEvent.click(screen.getByRole('button', { name: '#1 入口' }))
    const label = screen.getByLabelText('ラベル')
    await user.type(label, '更新')

    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
    expect(lastSave(onSave).markers[0].label).toBe('入口更新')

    fireEvent.click(screen.getByRole('button', { name: '破棄して閉じる' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('背景クリックは無反応、Esc は確認を挟んで破棄する', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onDiscard } = renderModal(baseMapData())
    const dialog = await screen.findByRole('dialog')

    // 背景（オーバーレイ）クリックは無反応。
    fireEvent.click(dialog)
    expect(onDiscard).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(confirmSpy).toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('ローカルモードではカメラ input だけが capture="environment" を持つ', async () => {
    readModeMock.mockReturnValue('local')
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })
    renderModal(mapData)
    await setupViewport()
    fireEvent.click(screen.getByRole('button', { name: '#1 入口' }))

    const cameraInput = await screen.findByLabelText('カメラで撮影')
    const fileInput = await screen.findByLabelText('ファイルを選択')
    expect(cameraInput.getAttribute('capture')).toBe('environment')
    expect(fileInput.getAttribute('capture')).toBeNull()
  })

  it('サーバーモード/未設定ではカメラ・ファイル input に capture を持たない', async () => {
    const mapData = baseMapData({
      markers: [{ x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] }],
    })

    readModeMock.mockReturnValue('server')
    const serverCase = renderModal(mapData)
    await setupViewport()
    fireEvent.click(serverCase.getByRole('button', { name: '#1 入口' }))
    expect((await serverCase.findByLabelText('カメラで撮影')).getAttribute('capture')).toBeNull()
    expect((await serverCase.findByLabelText('ファイルを選択')).getAttribute('capture')).toBeNull()
    serverCase.unmount()

    readModeMock.mockReturnValue(null)
    renderModal(mapData)
    await setupViewport()
    fireEvent.click(screen.getByRole('button', { name: '#1 入口' }))
    const cameraInput = await screen.findByLabelText('カメラで撮影')
    const fileInput = await screen.findByLabelText('ファイルを選択')
    expect(cameraInput.getAttribute('capture')).toBeNull()
    expect(fileInput.getAttribute('capture')).toBeNull()
  })

  it('マップ未選択ではプレースホルダを表示する', async () => {
    renderModal(baseMapData({ assetRef: { specifiers: [] } }), {
      resolveAssetUrl: vi.fn(async () => null),
    })
    expect(
      await screen.findByText('マップ画像を選択すると、長押しでマーカーを配置できます。'),
    ).toBeInTheDocument()
  })
})