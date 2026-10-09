// @vitest-environment jsdom
// マップビューアの回帰テスト（画像解決・link・未解決表示・最小化）。

import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StorageProvider } from '../../storage/StorageProvider'
import { AuthProvider } from '../../auth/AuthContext'
import { createStubStorage } from '../../test/stub-storage'
import CustomMapViewer from './CustomMapViewer'
import type { MapData } from './types'

const mapData: MapData = {
  assetRef: {
    baseFolderPath: 'maps',
    specifiers: [{ kind: 'filename', value: 'plan.png' }],
  },
  cx: 50,
  cy: 50,
  scale: 1,
  restore: 15,
  rotate: 0,
  link: '',
  title: '',
  pinSize: 12,
  labelSize: 12,
  markers: [
    // 詳細（desc）を持つマーカー。左クリックで詳細ポップアップが開く。
    { x: 10, y: 20, label: '入口', desc: '入口の説明', color: '#ff3b30', photos: [] },
    { x: 30, y: 40, label: '出口', desc: '', color: '#00ff00', photos: [] },
  ],
}

/** 1 件目のマーカーのピン要素を返す。 */
function firstPin(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-marker-pin="true"]') as HTMLElement
}

function renderViewer(resolveAssetUrl: (ref: MapData['assetRef']) => Promise<string | null>) {
  const storage = createStubStorage({ resolveAssetUrl })
  return render(
    <StorageProvider client={storage}>
      <MemoryRouter>
        <AuthProvider>
          <CustomMapViewer mapData={mapData} />
        </AuthProvider>
      </MemoryRouter>
    </StorageProvider>,
  )
}

describe('CustomMapViewer', () => {
  it('初期表示では「マップを開く」ボタンのみ表示する', () => {
    renderViewer(async () => 'https://cdn/plan.png')
    expect(screen.getByRole('button', { name: 'マップを開く' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('link属性があればボタン文言に使う', () => {
    const storage = createStubStorage({ resolveAssetUrl: async () => 'https://cdn/plan.png' })
    render(
      <StorageProvider client={storage}>
        <MemoryRouter>
          <AuthProvider>
            <CustomMapViewer mapData={{ ...mapData, link: '現場見取り図を開く' }} />
          </AuthProvider>
        </MemoryRouter>
      </StorageProvider>,
    )
    expect(screen.getByRole('button', { name: '現場見取り図を開く' })).toBeInTheDocument()
  })

  it('ボタン押下で画像とマーカーを描画する', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    const dialog = await screen.findByRole('dialog', { name: 'マップビューア' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'マップビューア')
    await waitFor(() => expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://cdn/plan.png'))
    expect(container.querySelectorAll('[data-map-marker="true"]')).toHaveLength(2)
    expect(within(dialog).getByText('入口')).toBeInTheDocument()
    expect(within(dialog).getByText('出口')).toBeInTheDocument()
  })

  it('マップが解決できないと日本語メッセージを表示する', async () => {
    const user = userEvent.setup()
    renderViewer(async () => null)
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    expect(await screen.findByText('マップ/画像が見つかりません')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('マップ取得のネットワークエラーは未解決表示に変換しない', async () => {
    const user = userEvent.setup()
    renderViewer(async () => {
      throw new Error('network offline')
    })
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('マップ画像の取得に失敗しました')
    expect(screen.queryByText('マップ/画像が見つかりません')).not.toBeInTheDocument()
  })

  it('通常表示マーカーの左クリックで詳細ポップアップが開く', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    const pin = firstPin(container)
    expect(pin.getAttribute('data-minimized')).toBe('false')
    await user.click(pin)
    expect(await screen.findByRole('dialog', { name: 'マーカー詳細' })).toBeInTheDocument()
    // 詳細を開いても非表示化はされない。
    expect(firstPin(container).getAttribute('data-minimized')).toBe('false')
  })

  it('通常表示マーカーの右クリックで非表示化（点滅）する（詳細は開かない）', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    const pin = firstPin(container)
    expect(pin.getAttribute('data-minimized')).toBe('false')
    fireEvent.contextMenu(pin)
    await waitFor(() => expect(firstPin(container).getAttribute('data-minimized')).toBe('true'))
    expect(screen.queryByRole('dialog', { name: 'マーカー詳細' })).not.toBeInTheDocument()
  })

  it('点滅中マーカーの左クリックで復帰する', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    const pin = firstPin(container)
    // まず右クリックで非表示化する。
    fireEvent.contextMenu(pin)
    await waitFor(() => expect(firstPin(container).getAttribute('data-minimized')).toBe('true'))
    // 左クリックで復帰する（詳細は開かない）。
    await user.click(firstPin(container))
    await waitFor(() => expect(firstPin(container).getAttribute('data-minimized')).toBe('false'))
    expect(screen.queryByRole('dialog', { name: 'マーカー詳細' })).not.toBeInTheDocument()
  })

  it('点滅中マーカーの右クリックで復帰する（詳細は開かない）', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    const pin = firstPin(container)
    fireEvent.contextMenu(pin)
    await waitFor(() => expect(firstPin(container).getAttribute('data-minimized')).toBe('true'))
    fireEvent.contextMenu(firstPin(container))
    await waitFor(() => expect(firstPin(container).getAttribute('data-minimized')).toBe('false'))
    expect(screen.queryByRole('dialog', { name: 'マーカー詳細' })).not.toBeInTheDocument()
  })

  it('詳細ポップアップを閉じてもマップビューは残る', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    // 左クリックで詳細を開く。
    await user.click(firstPin(container))
    const detail = await screen.findByRole('dialog', { name: 'マーカー詳細' })
    // 詳細の背景クリックで閉じる。
    await user.click(detail)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'マーカー詳細' })).not.toBeInTheDocument())
    // マップビューは残る（要件3 回帰）。
    expect(screen.getByRole('dialog', { name: 'マップビューア' })).toBeInTheDocument()
  })

  it('title があれば開いたモーダル内にタイトル見出しを表示する（作業2）', async () => {
    const user = userEvent.setup()
    const storage = createStubStorage({ resolveAssetUrl: async () => 'https://cdn/plan.png' })
    render(
      <StorageProvider client={storage}>
        <MemoryRouter>
          <AuthProvider>
            <CustomMapViewer mapData={{ ...mapData, title: '現場図' }} />
          </AuthProvider>
        </MemoryRouter>
      </StorageProvider>,
    )
    // 本文側の開くボタンは link（既定文言）のままで、タイトルは近傍に出ない。
    expect(screen.getByRole('button', { name: 'マップを開く' })).toBeInTheDocument()
    expect(screen.queryByTestId('map-viewer-title')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    const dialog = await screen.findByRole('dialog', { name: 'マップビューア' })
    expect(within(dialog).getByTestId('map-viewer-title')).toHaveTextContent('現場図')
  })

  it('title が空ならモーダル内にタイトル見出しを出さない（作業2）', async () => {
    const user = userEvent.setup()
    renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    expect(screen.queryByTestId('map-viewer-title')).toBeNull()
  })

  it('点滅 keyframes は minimized 用に opacity:0 の滞留区間を持ち hasDetail 用の薄い点滅を別クラスで残す', async () => {
    const user = userEvent.setup()
    renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    const css = document.getElementById('janus-custom-map-blink-style')?.textContent ?? ''
    // minimized 用（完全消去）: opacity:0 の消灯滞留区間（20%〜60%）を持つ。
    expect(css).toContain('janus-custom-map-blink-strong')
    expect(css).toMatch(/20%\s*\{\s*opacity:\s*0;\s*\}/)
    expect(css).toMatch(/60%\s*\{\s*opacity:\s*0;\s*\}/)
    // hasDetail 用（従来どおり薄い点滅）: opacity:0.3 が別クラスで残る。
    expect(css).toMatch(/50%\s*\{\s*opacity:\s*0\.3;\s*\}/)
  })
})
