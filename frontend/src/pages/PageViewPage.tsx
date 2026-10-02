import { useParams } from 'react-router-dom'

// ページ閲覧（要件 2-6）。ワイルドカード（splat）部分をページパスとして受け取る。
// 例: /view/docs/intro → ページパス /docs/intro
// Markdown レンダリングや地図記法の表示は後続タスク（タスク 10/11）で実装する。
function PageViewPage() {
  const splat = useParams()['*'] ?? ''
  return (
    <main>
      <h1>ページ閲覧</h1>
      <p>ページパス: /{splat}</p>
      <p>このページは後続タスク（タスク 8/10/11）で実装します。</p>
    </main>
  )
}

export default PageViewPage
