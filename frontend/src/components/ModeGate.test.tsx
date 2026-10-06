// @vitest-environment jsdom
// ModeGate のテスト。2 ボタン描画 / ローカル押下→localStorage 'local' + reload /
// サーバー押下→'server' + reload を検証する。
// jsdom の location.reload は読み取り専用のため、reload: vi.fn() を持つ location に差し替える。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModeGate from './ModeGate'
import { MODE_KEY } from '../storage/mode'

const originalLocation = window.location

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: vi.fn() },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ModeGate', () => {
  it('ローカル / サーバーの 2 ボタンを描画する', () => {
    render(<ModeGate />)
    expect(screen.getByRole('button', { name: /ローカルモード/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /サーバーモード/ })).toBeInTheDocument()
  })

  it("ローカル押下で 'local' を保存し reload する", async () => {
    const user = userEvent.setup()
    render(<ModeGate />)
    await user.click(screen.getByRole('button', { name: /ローカルモード/ }))
    expect(localStorage.getItem(MODE_KEY)).toBe('local')
    expect(window.location.reload).toHaveBeenCalled()
  })

  it("サーバー押下で 'server' を保存し reload する", async () => {
    const user = userEvent.setup()
    render(<ModeGate />)
    await user.click(screen.getByRole('button', { name: /サーバーモード/ }))
    expect(localStorage.getItem(MODE_KEY)).toBe('server')
    expect(window.location.reload).toHaveBeenCalled()
  })
})
