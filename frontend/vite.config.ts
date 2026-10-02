/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite の設定。
// server.proxy は「開発サーバー専用」の設定で、本番ビルド（vite build）の成果物には影響しない。
// 開発中はフロント（既定 http://localhost:5173）から /api へのリクエストを
// Django バックエンド（http://localhost:8000）へ転送し、CORS 設定を触らずに開発できるようにする。
// 実際の API クライアント（RestClient）実装はタスク 8。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  // Vitest 設定（別ファイルを作らず vite.config.ts に同居させる）。
  // 既定の実行環境は node。RestClient のユニットテスト（rest-client.test.ts）は
  // fetch をモックするだけで DOM 不要なので、既定の node のまま壊さず走り続ける。
  // 一方、認証 UI / ルートガードのコンポーネントテスト（*.test.tsx）は DOM が要るので、
  // 各ファイル先頭の docblock コメント `// @vitest-environment jsdom` で
  // ファイル単位に jsdom を指定する（environmentMatchGlobs は Vitest 3 で非推奨の
  // ため使わず、per-file 指定で node / jsdom を両立させる）。
  // FormData/File/Blob は Node 20 のグローバルに存在するためポリフィル不要。
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // @testing-library/jest-dom のカスタムマッチャ（toBeInTheDocument 等）を有効化する。
    setupFiles: ['src/test/setup.ts'],
  },
})
