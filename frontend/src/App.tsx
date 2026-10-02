import { Routes, Route, useNavigate } from 'react-router-dom'
import PageListPage from './pages/PageListPage'
import PageViewPage from './pages/PageViewPage'
import PageEditPage from './pages/PageEditPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import { RequireAuth } from './auth/RequireAuth'
import { useAuth } from './auth/AuthContext'

// ログイン済みのときだけ表示する最小のログアウト導線。
// 独立したレイアウトコンポーネントは作らず App 内に最小の header を置く（過剰設計を避ける）。
// user が null（未ログイン / 復元中）のときは何も表示しないので /login や 404 では出ない。
function LogoutBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (user === null) {
    return null
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <header>
      <span>{user.username}</span>
      <button type="button" onClick={handleLogout}>
        ログアウト
      </button>
    </header>
  )
}

// ルート骨組み（要件 2-6）。
// 保護ルート（/ , /view/* , /edit/*）は RequireAuth でラップし、未認証は /login へ誘導する。
// /login と 404（*）はガード対象外で素のまま。
function App() {
  return (
    <>
      <LogoutBar />
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
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}

export default App
