// 地図ビューアのドメイン型（タスク 11 / 要件 3-1, 3-2）。
//
// 出典: GROWI プラグイン growi-plugin-custom-map v0.3.1 の src/viewer.ts からの移植。
// GROWI 非依存のデータ構造のみを移植し、記法仕様（属性名・既定値）は不変に保つ。

/** 1 マーカーに紐づく参考写真 1 枚。photo は添付ファイル名、desc はその写真のコメント。 */
export interface PhotoData {
  photo: string
  desc: string
}

/** マーカー 1 件（マップ画像上の 1 点）。 */
export interface MarkerData {
  x: number
  y: number
  label: string
  /** 後方互換（旧記法の単一 photo）。新記法では photos を使う。 */
  photo: string
  photoSrc: string
  /** マーカー全体の説明/注意。 */
  desc: string
  color: string
  /** 参考写真（0 枚以上）。 */
  photos: PhotoData[]
}

/** `:::custom-map` コンテナ 1 件のパース結果。 */
export interface MapData {
  file: string
  src: string
  cx: number
  cy: number
  scale: number
  restore: number
  rotate: number
  /** マップを開くボタンの表示文言（link 属性）。未指定時は空文字。 */
  link: string
  /** ピン径（px）。マップ全体共通。 */
  pinSize: number
  /** ラベル文字サイズ（px）。マップ全体共通。 */
  labelSize: number
  markers: MarkerData[]
}
