/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Vite の設定。
// server.proxy は「開発サーバー専用」の設定で、本番ビルド（vite build）の成果物には影響しない。
// 開発中はフロント（既定 http://localhost:5173）から /api へのリクエストを
// Django バックエンド（http://localhost:8000）へ転送し、CORS 設定を触らずに開発できるようにする。
// 実際の API クライアント（RestClient）実装はタスク 8。
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA 化（design §7.2）。manifest 生成 + Service Worker（Workbox precache）生成 + 自動登録。
    // draw.io webapp（約 19MB）を含む全静的ファイルを precache し、オフラインで起動・編集できるようにする。
    VitePWA({
      registerType: 'prompt', // 新バージョンがあればユーザーにプロンプト表示（PwaUpdatePrompt が処理）
      includeAssets: ['drawio/webapp/**/*'], // public 配下の draw.io を precache に含める
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,wasm}'],
        // 25MB 上限は大きな draw.io / wasm ファイルが precache から落ちないために必須
        // （Workbox 既定は 2MB）。
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//], // サーバーモードの /api/ を SW が横取りしない
      },
      manifest: {
        name: 'Janus',
        short_name: 'Janus',
        start_url: '/',
        display: 'standalone',
        // theme/background はアイコン基調（青 / 白）に合わせる（task17-plan.md の判断）。
        theme_color: '#2d64d4',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: false, // 開発 / テスト時は SW 無効（HMR との競合回避・テスト環境保全）
      },
    }),
  ],
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
