import { useParams } from 'react-router-dom'

// ページ編集（要件 2-6）。ワイルドカード（splat）部分をページパスとして受け取る。
// 例: /edit/docs/intro → ページパス /docs/intro
// エディタ・保存処理は後続タスク（タスク 8 以降）で実装する。
function PageEditPage() {
  const splat = useParams()['*'] ?? ''
  return (
    <main>
      <h1>ページ編集</h1>
      <p>ページパス: /{splat}</p>
      <p>このページは後続タスク（タスク 8 以降）で実装します。</p>
    </main>
  )
}

export default PageEditPage
