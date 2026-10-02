// @vitest-environment jsdom
// 地図ビューア CustomMapViewer の描画テスト（タスク 11 / 要件 3-1, 3-3, 3-5）。
// StorageProvider にスタブを注入し、開くボタン・モーダル・画像/マーカー描画・
// 解決失敗の日本語メッセージ・マーカー最小化トグルを検証する。

import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StorageProvider } from '../../storage/StorageProvider'
import { createStubStorage } from '../../test/stub-storage'
import CustomMapViewer from './CustomMapViewer'
import type { MapData } from './types'

const mapData: MapData = {
  file: 'plan.png',
  src: '/map-library',
  cx: 50,
  cy: 50,
  scale: 1,
  restore: 15,
  rotate: 0,
  link: '',
  pinSize: 12,
  labelSize: 12,
  markers: [
    { x: 10, y: 20, label: '入口', photo: '', photoSrc: '', desc: '', color: '#ff3b30', photos: [] },
    { x: 30, y: 40, label: '出口', photo: '', photoSrc: '', desc: '', color: '#00ff00', photos: [] },
  ],
}

function renderViewer(resolveAssetUrl: (name: string, candidates: string[]) => Promise<string | null>) {
  const storage = createStubStorage({ resolveAssetUrl })
  return render(
    <StorageProvider client={storage}>
      <CustomMapViewer mapData={mapData} currentPagePath="/pages/here" />
    </StorageProvider>,
  )
}

describe('CustomMapViewer', () => {
  it('初期表示では「マップを開く」ボタンのみ表示する', () => {
    renderViewer(async () => 'https://cdn/plan.png')
    expect(screen.getByRole('button', { name: 'マップを開く' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('link 属性があればボタン文言に使う', () => {
    const storage = createStubStorage({ resolveAssetUrl: async () => 'https://cdn/plan.png' })
    render(
      <StorageProvider client={storage}>
        <CustomMapViewer mapData={{ ...mapData, link: '現場見取り図を開く' }} currentPagePath="/pages/here" />
      </StorageProvider>,
    )
    expect(screen.getByRole('button', { name: '現場見取り図を開く' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'マップを開く' })).not.toBeInTheDocument()
  })

  it('ボタン押下でモーダルが開き、解決した画像とマーカーを描画する', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))

    const dialog = await screen.findByRole('dialog', { name: '地図ビューア' })
    await waitFor(() => {
      expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://cdn/plan.png')
    })
    // マーカーは markers の数だけ描画される。
    const markers = container.querySelectorAll('[data-map-marker="true"]')
    expect(markers).toHaveLength(2)
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

  it('マーカークリックで最小化状態に切り替わる', async () => {
    const user = userEvent.setup()
    const { container } = renderViewer(async () => 'https://cdn/plan.png')
    await user.click(screen.getByRole('button', { name: 'マップを開く' }))
    await screen.findByRole('dialog', { name: '地図ビューア' })

    const pin = container.querySelector('[data-marker-pin="true"]') as HTMLElement
    expect(pin.getAttribute('data-minimized')).toBe('false')
    await user.click(pin)
    await waitFor(() => {
      const after = container.querySelector('[data-marker-pin="true"]') as HTMLElement
      expect(after.getAttribute('data-minimized')).toBe('true')
    })
  })
})
