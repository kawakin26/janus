// 長押し閾値（マーカー追加）の永続化＋優先順位解決（design.md §6.3）。
// storage/mode.ts と同じ防御運用の純粋関数モジュール。
// localStorage の読み書き失敗・不正値はすべて握りつぶして既定へフォールバックする。
// 優先順位: ユーザー設定(localStorage) > env 既定(VITE_MAP_LONGPRESS_MS) > ハードコード 500。
// どの経路でも最後に Math.max(値, 500) で下限 500 を保証する。

// 永続化キー（既存流儀 janus-<機能>）。
export const LONGPRESS_MS_KEY = 'janus-map-longpress-ms'

// ハードコード既定・下限（要件 2）。下限 = 最小値 500ms。
export const LONGPRESS_MS_MIN = 500
export const LONGPRESS_MS_HARDCODED_DEFAULT = 500

// 環境変数既定（Vite）。ミリ秒。
// import.meta.env.VITE_MAP_LONGPRESS_MS を Number 化し、有限かつ正なら採用。
// 未設定・非数・0 以下は null。
export function readEnvDefaultMs(): number | null {
  const raw = import.meta.env.VITE_MAP_LONGPRESS_MS
  if (raw === undefined || raw === null || raw === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

// システム既定値（env > ハードコード 500）。下限 500 へ切り上げる。
export function resolveDefaultMs(): number {
  const env = readEnvDefaultMs()
  const base = env !== null ? env : LONGPRESS_MS_HARDCODED_DEFAULT
  return Math.max(base, LONGPRESS_MS_MIN)
}

// ユーザー設定（localStorage）を読む。未設定・不正・例外は null。
// 「有限かつ > 0」なら採用、それ以外（非数・0・負・NaN・Infinity・例外）は null。
// ここでは下限 500 の判定はしない（保存時に正規化済み・読み取りは素直に返す）。
export function readUserLongPressMs(): number | null {
  try {
    const raw = window.localStorage.getItem(LONGPRESS_MS_KEY)
    if (raw === null) {
      return null
    }
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

// ユーザー設定を書く。保存前に必ず Math.max(ms, LONGPRESS_MS_MIN) で 500 へ切り上げてから保存する
// （＝localStorage に入る値は常に 500 以上）。書き込み例外は握りつぶす。
export function writeUserLongPressMs(ms: number): void {
  try {
    const normalized = Math.max(ms, LONGPRESS_MS_MIN)
    window.localStorage.setItem(LONGPRESS_MS_KEY, String(normalized))
  } catch {
    // プライベートモード等で setItem が例外を投げても致命的でないため握りつぶす。
    console.warn('[janus-map-longpress-ms] 長押し閾値の保存に失敗しました。')
  }
}

// ユーザー設定を削除（＝既定に戻す）。削除失敗は握りつぶす。
export function clearUserLongPressMs(): void {
  try {
    window.localStorage.removeItem(LONGPRESS_MS_KEY)
  } catch {
    // 握りつぶし（致命的でない）。
    console.warn('[janus-map-longpress-ms] 長押し閾値の削除に失敗しました。')
  }
}

// 実効閾値の解決。優先順位: ユーザー設定(localStorage) > env 既定 > 500。
// どの経路でも最後に Math.max(値, LONGPRESS_MS_MIN) で下限 500 を保証する。
export function resolveLongPressMs(): number {
  const user = readUserLongPressMs()
  if (user !== null) {
    return Math.max(user, LONGPRESS_MS_MIN)
  }
  const env = readEnvDefaultMs()
  if (env !== null) {
    return Math.max(env, LONGPRESS_MS_MIN)
  }
  return Math.max(LONGPRESS_MS_HARDCODED_DEFAULT, LONGPRESS_MS_MIN)
}
