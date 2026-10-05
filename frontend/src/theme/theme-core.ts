// テーマ解決の中核ロジック（設計 §3.1/§3.2/§11）。
// FOUC 回避のインラインスクリプト（index.html <head>）と useTheme（React 層）が
// 完全に同一のルール（キー名・3 値・不正値正規化・matchMedia 不在ガード）を参照できるよう、
// 純粋関数としてここに集約する。DOM 副作用を持つ関数のみ document/window に触れる。

// 永続化キー（設計 §3.2 で確定）。FOUC スクリプト・useTheme・テストはすべてこの値を参照する。
export const THEME_STORAGE_KEY = 'janus-theme'

// ユーザーの設定値（preference）。localStorage に格納するのはこの 3 値のみ。
export type ThemePreference = 'system' | 'light' | 'dark'

// 実際に <html data-theme> に書く解決済みテーマ（system は書かない）。
export type EffectiveTheme = 'light' | 'dark'

// preference の許可リスト（設計 §11 の入力バリデーション）。
const PREFERENCE_ALLOWLIST: readonly ThemePreference[] = ['system', 'light', 'dark']

// 任意の入力を preference に正規化する（設計 §11）。
// 許可リスト外（null/空/旧残骸/"dark-blue" 等）はすべて "system"（OS 追従）とみなす。
export function normalizePreference(value: unknown): ThemePreference {
  return PREFERENCE_ALLOWLIST.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : 'system'
}

// matchMedia が使えるかのガード（設計 §11・SSR/テスト環境対策）。
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

// OS の配色設定（prefers-color-scheme）を見て light/dark を返す。
// matchMedia 不在時は "light" 既定（設計 §11）。
export function getSystemTheme(): EffectiveTheme {
  if (!hasMatchMedia()) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// preference から実効テーマ（light/dark）を解決する（設計 §3.1）。
// system のときのみ OS 設定を見る。それ以外は preference そのもの。
export function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  return preference === 'system' ? getSystemTheme() : preference
}

// localStorage から preference を読む（設計 §11）。
// 読み取り失敗（プライベートモード等の例外）や不正値は "system" にフォールバックする。
export function readStoredPreference(): ThemePreference {
  try {
    return normalizePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

// localStorage へ preference を書く（設計 §11）。
// 書き込み失敗は握りつぶして実効テーマ適用のみ継続する（UI を壊さない）。
export function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // プライベートモード等で setItem が例外を投げても致命的でないため握りつぶす。
    console.warn('[janus-theme] テーマ設定の保存に失敗しました（実効テーマの適用は継続します）。')
  }
}

// <html data-theme> に解決済みテーマを反映する（設計 §3.1）。
export function applyEffectiveTheme(effective: EffectiveTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = effective
}
