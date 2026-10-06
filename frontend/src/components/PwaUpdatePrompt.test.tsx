// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PwaUpdatePrompt from './PwaUpdatePrompt'

// virtual:pwa-register/react の useRegisterSW をモックする（design §7.8）。
// 返り値 { needRefresh: [boolean, setNeedRefresh], updateServiceWorker } の形を再現し、
// needRefresh の真偽を各テストで差し替える。
const updateServiceWorker = vi.hoisted(() => vi.fn())
const setNeedRefresh = vi.hoisted(() => vi.fn())
const useRegisterSW = vi.hoisted(() => vi.fn())

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => useRegisterSW(),
}))

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('needRefresh=true のとき更新プロンプトを表示する', () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker,
    })

    render(<PwaUpdatePrompt />)

    expect(screen.getByText('新しいバージョンが利用可能です')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新する' })).toBeInTheDocument()
  })

  it('「更新する」クリックで updateServiceWorker(true) を呼ぶ', async () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker,
    })

    render(<PwaUpdatePrompt />)
    await userEvent.click(screen.getByRole('button', { name: '更新する' }))

    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('「後で」クリックで needRefresh を下げる（setNeedRefresh(false)）', async () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker,
    })

    render(<PwaUpdatePrompt />)
    await userEvent.click(screen.getByRole('button', { name: '後で' }))

    expect(setNeedRefresh).toHaveBeenCalledWith(false)
  })

  it('needRefresh=false のとき何も描画しない', () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [false, setNeedRefresh],
      updateServiceWorker,
    })

    const { container } = render(<PwaUpdatePrompt />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('新しいバージョンが利用可能です')).not.toBeInTheDocument()
  })
})
