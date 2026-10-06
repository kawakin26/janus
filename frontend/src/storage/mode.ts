// 動作モード（ローカル / サーバー）の永続化（design.md §2.2/§2.3）。
// theme-core.ts の防御運用に倣い、localStorage の read/write 失敗や不正値を
// 握りつぶして null へ正規化する純粋関数のみを置く。UI 層はこの関数だけに依存する。

// 永続化キー（design §2.2 で確定）。起動時のモード判定・ModeGate・テストはこの値を参照する。
export const MODE_KEY = 'janus-mode'

// 動作モード。localStorage に格納するのはこの 2 値のみ。
export type Mode = 'local' | 'server'

// 許可リスト（§11 の入力バリデーションに相当）。これ以外は不正値として null 扱い。
const MODE_ALLOWLIST: readonly Mode[] = ['local', 'server']

// localStorage からモードを読む。
// 読み取り失敗（プライベートモード等の例外）・未設定・不正値はすべて null にフォールバックする。
export function readMode(): Mode | null {
  try {
    const value = window.localStorage.getItem(MODE_KEY)
    return MODE_ALLOWLIST.includes(value as Mode) ? (value as Mode) : null
  } catch {
    return null
  }
}

// localStorage へモードを書く。
// 書き込み失敗は握りつぶす（起動フローを壊さない）。
export function writeMode(mode: Mode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode)
  } catch {
    // プライベートモード等で setItem が例外を投げても致命的でないため握りつぶす。
    console.warn('[janus-mode] モードの保存に失敗しました。')
  }
}

// localStorage からモードを削除する。
// 削除失敗は握りつぶす。
export function clearMode(): void {
  try {
    window.localStorage.removeItem(MODE_KEY)
  } catch {
    // 握りつぶし（致命的でない）。
    console.warn('[janus-mode] モードの削除に失敗しました。')
  }
}
