// マップ画像・写真のアセット解決ヘルパ（タスク 11 / 要件 3-3, 3-5）。
//
// 出典: GROWI プラグイン growi-plugin-custom-map v0.3.1 の src/viewer.ts の
// resolveMapImageUrl / getMapCandidatePages / getPhotoCandidatePages の思想を移植。
// GROWI の /_api/v3 添付 API・登録アセット API・CAD 変換 API 依存は除去し、
// Janus の StorageClient.resolveAssetUrl（内部で listAssets の多段フォールバック）へ一本化する。
// CAD ファイル（.dxf/.jww）でも変換 API は呼ばず、画像として解決を試みる（フェーズ 1 は画像のみ）。

import type { AssetClient } from '../../storage/types'
import type { MapData, MarkerData } from './types'
import { DEFAULT_STOCK_PAGE } from './config'

/**
 * マップ画像の候補ページ（探索順）を返す。
 * src= 指定を最優先し、無ければ既定ストックページへフォールバックする。
 * 空文字・重複は除去する。
 */
export function getMapCandidatePages(
  mapData: Pick<MapData, 'src'>,
  defaultStock: string = DEFAULT_STOCK_PAGE,
): string[] {
  const pages: string[] = []
  if (mapData.src) pages.push(mapData.src)
  if (defaultStock) pages.push(defaultStock)
  return Array.from(new Set(pages.filter(Boolean)))
}

/**
 * マーカー写真の候補ページ（探索順）を返す。
 * 設計方針: 参考写真は「そのマップ記法を書いたページ」の添付として保存する運用。
 * よって現在表示中ページを基点にする。photoSrc（写真の格納ページ明示指定）があれば先に見る。
 * 空文字・重複は除去する。
 */
export function getPhotoCandidatePages(
  marker: Pick<MarkerData, 'photoSrc'>,
  currentPagePath?: string,
): string[] {
  const pages: string[] = []
  if (marker.photoSrc) pages.push(marker.photoSrc)
  if (currentPagePath) pages.push(currentPagePath)
  return Array.from(new Set(pages.filter(Boolean)))
}

/**
 * マップ画像の URL を解決する。候補ページ順に StorageClient.resolveAssetUrl を呼ぶ。
 * CAD でも変換 API は呼ばず画像として解決を試みる。見つからなければ null。
 */
export function resolveMapImageUrl(
  storage: Pick<AssetClient, 'resolveAssetUrl'>,
  mapData: MapData,
  defaultStock: string = DEFAULT_STOCK_PAGE,
): Promise<string | null> {
  if (!mapData.file) return Promise.resolve(null)
  return storage.resolveAssetUrl(mapData.file, getMapCandidatePages(mapData, defaultStock))
}

/**
 * マーカー 1 枚の写真 URL を解決する。候補ページ順に resolveAssetUrl を呼ぶ。
 * 見つからなければ null。
 */
export function resolvePhotoUrl(
  storage: Pick<AssetClient, 'resolveAssetUrl'>,
  photoName: string,
  marker: Pick<MarkerData, 'photoSrc'>,
  currentPagePath?: string,
): Promise<string | null> {
  if (!photoName) return Promise.resolve(null)
  return storage.resolveAssetUrl(photoName, getPhotoCandidatePages(marker, currentPagePath))
}
