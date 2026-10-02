import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { StorageProvider } from './storage/StorageProvider'
import { AuthProvider } from './auth/AuthContext'
import './index.css'

// アプリのエントリポイント。
// Provider の入れ子順は BrowserRouter > StorageProvider > AuthProvider > App。
// AuthProvider は useStorage() を使うので StorageProvider の内側、
// RequireAuth / LoginPage が useNavigate / useLocation を使うので BrowserRouter の内側に置く。
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <StorageProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </StorageProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
