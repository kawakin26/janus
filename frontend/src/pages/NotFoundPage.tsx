// 404 画面。定義済みルート以外にマッチした場合に表示する。
function NotFoundPage() {
  return (
    <main>
      <h1>ページが見つかりません</h1>
      <p>指定された URL に対応するページはありません。</p>
    </main>
  )
}

export default NotFoundPage
