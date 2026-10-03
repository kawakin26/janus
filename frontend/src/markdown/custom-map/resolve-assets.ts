// 独立アセットライブラリの参照解決ヘルパ（要件 3-3, 3-5, 14-9〜14-12）。

import type { AssetClient, AssetRef } from '../../storage/types'
import type { MapData, PhotoData } from './types'

/** マップ画像のURLをAssetRefで解決する。 */
export function resolveMapImageUrl(
  storage: Pick<AssetClient, 'resolveAssetUrl'>,
  mapData: MapData,
): Promise<string | null> {
  return storage.resolveAssetUrl(mapData.assetRef)
}

/** マーカー写真1枚のURLをAssetRefで解決する。 */
export function resolvePhotoUrl(
  storage: Pick<AssetClient, 'resolveAssetUrl'>,
  photo: PhotoData,
): Promise<string | null> {
  return storage.resolveAssetUrl(photo.assetRef)
}

/** 未解決表示に使う、人が読める指定子の末尾値。 */
export function assetRefLabel(ref: AssetRef): string {
  return ref.specifiers[0]?.value ?? ''
}
