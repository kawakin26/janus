// マップビューアの純粋ユーティリティと定数（タスク 11 / 要件 3-1, 3-2）。
//
// 出典: GROWI プラグイン growi-plugin-custom-map v0.3.1 の src/common.ts / src/viewer.ts
// からの移植。GROWI 非依存（window / API / 言語設定に依存しない）部分のみを取り出し、
// 副作用のない純関数・定数として移植する。記法仕様（既定値・クランプ範囲）は不変。

// ---------------------------------------------------------------------------
// 数値ユーティリティ
// ---------------------------------------------------------------------------

/** 文字列を数値へ。空/非数は fallback を返す。 */
export function toNumber(value: string | null | undefined, fallback: number): number {
  if (value == null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** v を [min, max] に収める。 */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 回転角を 0/90/180/270 のいずれかに正規化する（負値や 360 超も丸める）。 */
export function normalizeRotate(deg: number): number {
  return (((Math.round(deg / 90) * 90) % 360) + 360) % 360
}

// ---------------------------------------------------------------------------
// ピン径・ラベル文字サイズ（px）の既定値と範囲（画面崩れ防止のクランプ用）
// ---------------------------------------------------------------------------

export const PIN_SIZE_DEFAULT = 12
export const PIN_SIZE_MIN = 6
export const PIN_SIZE_MAX = 48
export const LABEL_SIZE_DEFAULT = 12
export const LABEL_SIZE_MIN = 8
export const LABEL_SIZE_MAX = 40

// ---------------------------------------------------------------------------
// CAD 判定（フェーズ 1 は変換しない。画像フォールバック判定にのみ使う）
// ---------------------------------------------------------------------------

const CAD_EXTENSIONS = ['.dxf', '.jww']

/** 拡張子から CAD ファイルかどうかを判定する。 */
export function isCadFile(fileName: string): boolean {
  if (!fileName) return false
  const lower = fileName.toLowerCase()
  return CAD_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

// ---------------------------------------------------------------------------
// 検索照合用の正規化
// ---------------------------------------------------------------------------

/**
 * 検索照合用に文字列を正規化する。NFKC で全角英数字・記号を半角へ統一し、小文字化する。
 * これで「ＡＢＣ」と「abc」を区別せず絞り込める。
 */
export function normalizeForSearch(s: string): string {
  if (!s) return ''
  try {
    return s.normalize('NFKC').toLowerCase()
  } catch {
    return s.toLowerCase()
  }
}

// ---------------------------------------------------------------------------
// ラベル文字色の自動選択
// ---------------------------------------------------------------------------

/** 色文字列を RGB に解釈する。#rgb / #rrggbb / rgb(r,g,b) に対応。解釈不能なら null。 */
function parseColorToRgb(color: string): { r: number; g: number; b: number } | null {
  if (!color) return null
  const c = color.trim().toLowerCase()

  // #rrggbb または #rgb
  const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('')
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgbMatch) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) }
  }

  return null
}

/**
 * 背景色（#rgb / #rrggbb / rgb(...) 等）に対して読みやすい文字色（黒/白）を返す。
 * 輝度が高い（明るい）背景なら黒、暗い背景なら白。解釈不能なら従来どおり白。
 */
export function textColorForBg(bg: string): string {
  const rgb = parseColorToRgb(bg)
  if (!rgb) return '#ffffff'
  const { r, g, b } = rgb
  // 相対輝度（sRGB 近似）。0（暗）〜255（明）。
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 150 ? '#000000' : '#ffffff'
}
