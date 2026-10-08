import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { StorageProvider, createStorageClient } from './storage/StorageProvider'
import { LocalClient } from './storage/local-client'
import { AuthProvider } from './auth/AuthContext'
import { ThemeProvider } from './theme/ThemeProvider'
import { ModeGate } from './components/ModeGate'
import PwaUpdatePrompt from './components/PwaUpdatePrompt'
import { readMode } from './storage/mode'
import type { Mode } from './storage/mode'
import type { StorageClient } from './storage/types'
import './index.css'

// 選択済みモードに応じた StorageClient を生成する（design.md §2.3）。
// ローカルモードでは IndexedDB 保存の永続化を要求する（§7.5・結果は使わず、存在時のみ呼ぶ）。
function createClientForMode(mode: Mode): StorageClient {
  if (mode === 'local') {
    void navigator.storage?.persist?.()
    return new LocalClient()
  }
  return createStorageClient()
}

// アプリ本体（モード判定込み）。テスト可能にするため named export。
// モード未設定なら起動時選択画面（ModeGate）を出し、選択済みなら対応する client を
// StorageProvider に注入してアプリを描画する。AuthProvider/App 以降は従来どおり。
export function Root() {
  const mode = readMode()
  const app = mode === null ? (
    <ModeGate />
  ) : (
    <StorageProvider client={createClientForMode(mode)}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StorageProvider>
  )

  return (
    <>
      {/* モード選択前から登録を始め、初回選択後の reload 前に app shell を準備する。 */}
      <PwaUpdatePrompt />
      {app}
    </>
  )
}

// アプリのエントリポイント。
// Provider の入れ子順は ThemeProvider > BrowserRouter > Root（Root 内で StorageProvider 以降）。
// ThemeProvider は配色テーマ（system/light/dark）のみを扱い他 Provider に依存しないため、
// 既存の順序・挙動を変えないよう最外に 1 枚だけ足す（設計 §3.2）。
// Root（ModeGate を含む）は useNavigate / useLocation 等を使う子を抱えるため BrowserRouter の内側に置く。
// ブートストラップは #root 存在時のみ実行し、main.test.tsx が Root を import しても
// render 副作用が走らないようにガードする。
const rootEl = document.getElementById('root')
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
      </ThemeProvider>
    </React.StrictMode>,
  )
}
