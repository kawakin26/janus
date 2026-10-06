// パス正規化 — backend api/utils.py normalize_path の TS 移植。
//
// 純粋関数。DB・副作用なし。

/**
 * ユーザー入力のページパスを安全な正規形に変換する。
 *
 * 規則:
 * 1. 前後空白を trim。
 * 2. "/" で split し、各セグメントを trim、空・"."・".." を除去。
 *    ".." は親遡上せず単純除去（トラバーサル無効化）。
 * 3. 残セグメントを "/" で join し先頭 "/" 付与（絶対パス化）。
 * 4. 末尾 "/" は付けない。
 * 5. セグメント 0 個なら "/" を返す。
 */
export function normalizePath(path: string): string {
  const text = (path ?? '').trim()
  const segments = text
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..')

  if (segments.length === 0) return '/'
  return '/' + segments.join('/')
}
