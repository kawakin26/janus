// 地図ビューアの最小アプリ設定（タスク 11 / 要件 3-3）。
//
// GROWI の window.GROWI_CUSTOM_MAP_CONFIG（defaultSrc / minimizedPinSize / lang /
// cadConvertApi）依存を除去し、Janus 用の定数へ置き換える（design 7 章）。
// フェーズ 1 は画像のみ・日本語固定のため、グローバル設定の持ち込みはしない。

/**
 * 既定のストック用ページ。マップ画像を集約して置く運用上のページ。
 * 記法で src= が未指定のとき、このページを候補にフォールバックする。
 * （GROWI の DEFAULT_STOCK_PAGE と同値。design の記述に一致。）
 */
export const DEFAULT_STOCK_PAGE = '/map-library'

/** 記法で link 属性が未指定のとき、マップを開くボタンに表示する既定文言。 */
export const DEFAULT_OPEN_LABEL = 'マップを開く'

/**
 * 最小化（ラベル非表示・点滅）状態のピン径（px）。ユーザー指定の pinSize とは
 * 無関係の固定値。ラベルが消えても場所が分かりクリックしやすいよう、やや大きめ。
 * GROWI では設定で上書き可能だったが、Janus では定数に固定する（design 7 章）。
 */
export const MINIMIZED_PIN_SIZE = 24

/** 最小化ピン径を返す純関数（将来の設定差し替え点として関数で公開する）。 */
export function getMinimizedPinSize(): number {
  return MINIMIZED_PIN_SIZE
}
