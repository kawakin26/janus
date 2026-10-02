import { Routes, Route } from 'react-router-dom'
import PageListPage from './pages/PageListPage'
import PageViewPage from './pages/PageViewPage'
import PageEditPage from './pages/PageEditPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'

// ルート骨組み（要件 2-6）。各画面の中身は後続タスクで実装する。
// /view/* と /edit/* はワイルドカード（splat）でページパスを受ける。
function App() {
  return (
    <Routes>
      <Route path="/" element={<PageListPage />} />
      <Route path="/view/*" element={<PageViewPage />} />
      <Route path="/edit/*" element={<PageEditPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
