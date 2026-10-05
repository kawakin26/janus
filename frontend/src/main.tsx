import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { StorageProvider } from './storage/StorageProvider'
import { AuthProvider } from './auth/AuthContext'
import { ThemeProvider } from './theme/ThemeProvider'
import './index.css'

// アプリのエントリポイント。
// Provider の入れ子順は ThemeProvider > BrowserRouter > StorageProvider > AuthProvider > App。
// ThemeProvider は配色テーマ（system/light/dark）のみを扱い他 Provider に依存しないため、
// 既存の順序・挙動を変えないよう最外に 1 枚だけ足す（設計 §3.2）。
// AuthProvider は useStorage() を使うので StorageProvider の内側、
// RequireAuth / LoginPage が useNavigate / useLocation を使うので BrowserRouter の内側に置く。
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <StorageProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </StorageProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
