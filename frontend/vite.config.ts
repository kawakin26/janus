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
})
