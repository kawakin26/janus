// Vitest の共通セットアップ。
// @testing-library/jest-dom のカスタムマッチャ（toBeInTheDocument / toHaveValue 等）を
// 全テストで使えるように登録する。node 環境のテスト（rest-client.test.ts）でも
// import 自体は副作用でマッチャを足すだけで、DOM を要求しないため無害。
import '@testing-library/jest-dom/vitest'

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// 各テスト後にレンダリングした DOM を破棄する（テスト間で要素が残って
// 「複数一致」になるのを防ぐ）。globals を無効にしているため自動 cleanup が
// 働かないので、ここで明示的に登録する。jsdom が無い node 環境のテストでは
// マウント済みコンテナが無いだけで cleanup は無害に no-op となる。
afterEach(() => {
  cleanup()
})
