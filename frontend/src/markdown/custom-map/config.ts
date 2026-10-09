// マップビューアの最小アプリ設定（要件 3-3）。

/** 記法でlink属性が未指定のとき、マップを開くボタンに表示する既定文言。 */
export const DEFAULT_OPEN_LABEL = 'マップを開く'

/**
 * 最小化（ラベル非表示・点滅）状態のピン径（px）。ユーザー指定のpinSizeとは
 * 無関係の固定値。ラベルが消えても場所が分かりクリックしやすいよう、やや大きめ。
 */
export const MINIMIZED_PIN_SIZE = 24

/** 最小化ピン径を返す純関数。 */
export function getMinimizedPinSize(): number {
  return MINIMIZED_PIN_SIZE
}
