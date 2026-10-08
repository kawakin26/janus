// @vitest-environment jsdom
// main.tsx の Root のテスト。
// readMode をモックして mode='local'/'server' → ModeGate 非描画（App 本体が出る）、
// mode=null → ModeGate 描画、を検証する。
// App は全ルートを抱えて重いためスタブ化し、LocalClient も実インスタンス生成を避けてスタブ化する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('./storage/mode', () => ({
  readMode: vi.fn(),
}))

vi.mock('./App', () => ({
  default: () => <div data-testid="app-body" />,
}))

vi.mock('./storage/local-client', () => ({
  LocalClient: class {},
}))

vi.mock('./components/PwaUpdatePrompt', () => ({
  default: () => null,
}))

import { Root } from './main'
import { readMode } from './storage/mode'

const mockedReadMode = vi.mocked(readMode)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderRoot() {
  render(
    <BrowserRouter>
      <Root />
    </BrowserRouter>,
  )
}

describe('Root', () => {
  it('mode=null のとき ModeGate を描画する', () => {
    mockedReadMode.mockReturnValue(null)
    renderRoot()
    expect(screen.getByRole('button', { name: /ローカルモード/ })).toBeInTheDocument()
    expect(screen.queryByTestId('app-body')).toBeNull()
  })

  it("mode='local' のとき ModeGate を描画せずアプリ本体を出す", () => {
    mockedReadMode.mockReturnValue('local')
    renderRoot()
    expect(screen.queryByRole('button', { name: /ローカルモード/ })).toBeNull()
    expect(screen.getByTestId('app-body')).toBeInTheDocument()
  })

  it("mode='server' のとき ModeGate を描画せずアプリ本体を出す", () => {
    mockedReadMode.mockReturnValue('server')
    renderRoot()
    expect(screen.queryByRole('button', { name: /ローカルモード/ })).toBeNull()
    expect(screen.getByTestId('app-body')).toBeInTheDocument()
  })
})
