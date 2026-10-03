// 地図ビューアのドメイン型（要件 3, 14-9〜14-12）。

import type { AssetRef } from '../../storage/types'

/** 1マーカーに紐づく参考写真。 */
export interface PhotoData {
  assetRef: AssetRef
  desc: string
}

/** マーカー1件（マップ画像上の1点）。 */
export interface MarkerData {
  x: number
  y: number
  label: string
  /** マーカー全体の説明/注意。 */
  desc: string
  color: string
  /** 参考写真（0枚以上）。 */
  photos: PhotoData[]
}

/** `:::custom-map` コンテナ1件のパース結果。 */
export interface MapData {
  /** マップ画像の独立アセット参照。指定子は記法上の出現順。 */
  assetRef: AssetRef
  cx: number
  cy: number
  scale: number
  restore: number
  rotate: number
  /** マップを開くボタンの表示文言（link属性）。未指定時は空文字。 */
  link: string
  /** ピン径（px）。マップ全体共通。 */
  pinSize: number
  /** ラベル文字サイズ（px）。マップ全体共通。 */
  labelSize: number
  markers: MarkerData[]
}
