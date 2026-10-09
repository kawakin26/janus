// @vitest-environment jsdom
// マップビューアの回帰テスト（画像解決・link・未解決表示・最小化）。

import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  pinSize: 12,
  labelSize: 12,
  markers: [
    { x: 10, y: 20, label: '入口', desc: '', color: '#ff3b30', photos: [] },
    { x: 30, y: 40, label: '出口', desc: '', color: '#00ff00', photos: [] },
  ],
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

  it('マーカークリックで最小化状態に切り替わる', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: 'マップビューア' })
    const pin = container.querySelector('[data-marker-pin="true"]') as HTMLElement
    expect(pin.getAttribute('data-minimized')).toBe('false')
    await user.click(pin)
    await waitFor(() => expect((container.querySelector('[data-marker-pin="true"]') as HTMLElement).getAttribute('data-minimized')).toBe('true'))
  })
})
