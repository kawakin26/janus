// パンくずの純粋ロジック（タスク 13 / 要件 2-6）。
//
// 方針:
// - path（例 /docs/guide/intro）を正規化し、先頭から累積したセグメント配列を返す。
// - 返り値の各要素は { label: 最後の 1 語, path: 累積パス（先頭 / 付き） }。
// - / や空文字は空配列（＝一覧のみ、現在地セグメント無し）。
// - コンポーネント（Breadcrumbs.tsx）とは別ファイルにし、react-refresh warning を避ける。

/** パンくずの 1 セグメント。label は表示名、path は累積パス（/view/<path> のリンク先に使う）。 */
export interface BreadcrumbSegment {
  label: string
  path: string
}

/**
 * path を正規化（先頭/末尾/重複スラッシュ除去）して / で分割し、
 * 先頭から累積したセグメント配列を返す。/ と '' は空配列を返す。
 */
export function toBreadcrumbSegments(path: string): BreadcrumbSegment[] {
  // 前後の空白を除き、/ で分割して空セグメント（先頭/末尾/重複スラッシュ由来）を捨てる。
  const parts = path
    .trim()
    .split('/')
    .filter((part) => part.length > 0)

  const segments: BreadcrumbSegment[] = []
  let cumulative = ''
  for (const part of parts) {
    cumulative += '/' + part
    segments.push({ label: part, path: cumulative })
  }
  return segments
}
