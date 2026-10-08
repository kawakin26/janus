import { Routes, Route } from 'react-router-dom'
import PageListPage from './pages/PageListPage'
import PageViewPage from './pages/PageViewPage'
import PageEditPage from './pages/PageEditPage'
import PageHistoryPage from './pages/PageHistoryPage'
import PagePermissionPage from './pages/PagePermissionPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import AssetLibraryPage from './pages/AssetLibraryPage'
import SettingsPage from './pages/SettingsPage'
import { RequireAuth } from './auth/RequireAuth'

// ルート骨組み（要件 2-6）。
// 保護ルート（/ , /view/* , /edit/* , /history/* , /permissions/* , /assets）は
// RequireAuth でラップし、未認証は /login へ誘導する。
// 共通ヘッダー（ログアウト導線・グローバルナビ）は各保護ページが内部で AppLayout により描画する。
// /login と 404（*）はガード対象外・レイアウト外なのでヘッダーは出ない（従来挙動を維持）。
function App() {
  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <PageListPage />
            </RequireAuth>
          }
        />
        <Route
          path="/view/*"
          element={
            <RequireAuth>
              <PageViewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/edit/*"
          element={
            <RequireAuth>
              <PageEditPage />
            </RequireAuth>
          }
        />
        <Route
          path="/history/*"
          element={
            <RequireAuth>
              <PageHistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/permissions/*"
          element={
            <RequireAuth>
              <PagePermissionPage />
            </RequireAuth>
          }
        />
        <Route
          path="/assets"
          element={
            <RequireAuth>
              <AssetLibraryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}

export default App
