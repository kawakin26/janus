// location.pathname から現在のページ path を復元する小ヘルパ（design §3.5）。
// 純粋関数のみ。副作用なし。

const ROUTE_PREFIXES = ['/view/', '/edit/', '/history/', '/permissions/'] as const

/** location.pathname から現在のページ path を復元する。該当しなければ null。 */
export function currentPagePath(pathname: string): string | null {
  for (const prefix of ROUTE_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      // プレフィックスを剥がし、先頭 '/' を 1 つ付けた絶対パスにする。
      const rest = pathname.slice(prefix.length)
      return '/' + rest.replace(/^\/+/, '')
    }
  }
  return null
}
