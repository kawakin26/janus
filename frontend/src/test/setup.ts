// Vitest の共通セットアップ。
// @testing-library/jest-dom のカスタムマッチャ（toBeInTheDocument / toHaveValue 等）を
// 全テストで使えるように登録する。node 環境のテスト（rest-client.test.ts）でも
// import 自体は副作用でマッチャを足すだけで、DOM を要求しないため無害。
import '@testing-library/jest-dom/vitest'

import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom は window.matchMedia を実装しないため、既定のスタブを用意する。
// ThemeProvider（AppLayout 経由でレンダーされる）が system 追従のため matchMedia を購読するので、
// これが無いと AppLayout を描画するページテストが matchMedia 不在で落ちる。
// 詳細な挙動（change 発火等）を検証するテーマ系テストは、各ファイルでこのスタブを上書きする。
// node 環境のテストには window が無いためガードする。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }))
}

// 各テスト後にレンダリングした DOM を破棄する（テスト間で要素が残って
// 「複数一致」になるのを防ぐ）。globals を無効にしているため自動 cleanup が
// 働かないので、ここで明示的に登録する。jsdom が無い node 環境のテストでは
// マウント済みコンテナが無いだけで cleanup は無害に no-op となる。
afterEach(() => {
  cleanup()
})
