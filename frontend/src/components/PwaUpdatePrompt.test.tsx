// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PwaUpdatePrompt from './PwaUpdatePrompt'

// virtual:pwa-register/react の useRegisterSW をモックする（design §7.8）。
// 返り値 { needRefresh: [boolean, setNeedRefresh], offlineReady: [boolean, setOfflineReady],
// updateServiceWorker } の形を再現し、needRefresh/offlineReady の真偽を各テストで差し替える。
const updateServiceWorker = vi.hoisted(() => vi.fn())
const setNeedRefresh = vi.hoisted(() => vi.fn())
const setOfflineReady = vi.hoisted(() => vi.fn())
const useRegisterSW = vi.hoisted(() => vi.fn())
const registerOptions = vi.hoisted(() => vi.fn())

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: unknown) => {
    registerOptions(options)
    return useRegisterSW()
  },
}))

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRegisterSW.mockReturnValue({
      needRefresh: [false, setNeedRefresh],
      offlineReady: [false, setOfflineReady],
      updateServiceWorker,
    })
  })

  it('needRefresh=true のとき更新プロンプトを表示する', () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [true, setNeedRefresh],
      offlineReady: [false, setOfflineReady],
      updateServiceWorker,
    })

    render(<PwaUpdatePrompt />)

    expect(screen.getByText('新しいバージョンが利用可能です')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新する' })).toBeInTheDocument()
  })

  it('「更新する」クリックで updateServiceWorker(true) を呼ぶ', async () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [true, setNeedRefresh],
      offlineReady: [false, setOfflineReady],
      updateServiceWorker,
    })

    render(<PwaUpdatePrompt />)
    await userEvent.click(screen.getByRole('button', { name: '更新する' }))

    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('「後で」クリックで needRefresh を下げる（setNeedRefresh(false)）', async () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [true, setNeedRefresh],
      offlineReady: [false, setOfflineReady],
      updateServiceWorker,
    })

    render(<PwaUpdatePrompt />)
    await userEvent.click(screen.getByRole('button', { name: '後で' }))

    expect(setNeedRefresh).toHaveBeenCalledWith(false)
  })

  it('登録を即時開始し、状態コールバックを登録する', () => {
    render(<PwaUpdatePrompt />)

    expect(registerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        immediate: true,
        onOfflineReady: expect.any(Function),
        onRegistered: expect.any(Function),
        onRegisterError: expect.any(Function),
      }),
    )
  })

  it('offline-ready 通知を表示して閉じられる', () => {
    render(<PwaUpdatePrompt />)
    const options = registerOptions.mock.calls[0][0] as {
      onOfflineReady: () => void
    }

    act(() => options.onOfflineReady())

    expect(screen.getByText('オフライン起動の準備ができました')).toBeInTheDocument()
    screen.getByRole('button', { name: '閉じる' }).click()
    expect(setOfflineReady).toHaveBeenCalledWith(false)
  })

  it('登録エラーを alert で表示し詳細を記録する', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<PwaUpdatePrompt />)
    const error = new Error('registration failed')
    const options = registerOptions.mock.calls[0][0] as {
      onRegisterError: (error: unknown) => void
    }

    act(() => options.onRegisterError(error))

    expect(screen.getByRole('alert')).toHaveTextContent('オフライン起動の準備に失敗しました')
    expect(consoleError).toHaveBeenCalledWith('Service Worker の登録に失敗しました', error)
    consoleError.mockRestore()
  })

  it('offlineReady=true のとき成功通知を表示する', () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [false, setNeedRefresh],
      offlineReady: [true, setOfflineReady],
      updateServiceWorker,
    })

    render(<PwaUpdatePrompt />)

    expect(screen.getByText('オフライン起動の準備ができました')).toBeInTheDocument()
  })

  it('needRefresh=false のとき何も描画しない', () => {
    useRegisterSW.mockReturnValue({
      needRefresh: [false, setNeedRefresh],
      offlineReady: [false, setOfflineReady],
      updateServiceWorker,
    })

    const { container } = render(<PwaUpdatePrompt />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('新しいバージョンが利用可能です')).not.toBeInTheDocument()
  })
})
