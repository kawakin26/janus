// 独立アセット参照解決ヘルパのユニットテスト。

import { describe, expect, it, vi } from 'vitest'
import { assetRefLabel, resolveMapImageUrl, resolvePhotoUrl } from './resolve-assets'
import type { MapData } from './types'

const baseMap: MapData = {
  assetRef: {
    baseFolderPath: '本館/2F',
    specifiers: [
      { kind: 'filename', value: 'plan.svg' },
      { kind: 'alias', value: 'floor-plan' },
    ],
  },
  cx: 50,
  cy: 50,
  scale: 1,
  restore: 15,
  rotate: 0,
  link: '',
  title: '',
  pinSize: 12,
  labelSize: 12,
  markers: [],
}

describe('resolveMapImageUrl', () => {
  it('MapDataのAssetRefをそのままStorageClientへ渡す', async () => {
    const resolveAssetUrl = vi.fn(async () => 'https://cdn/plan.svg')
    await expect(resolveMapImageUrl({ resolveAssetUrl }, baseMap)).resolves.toBe('https://cdn/plan.svg')
    expect(resolveAssetUrl).toHaveBeenCalledWith(baseMap.assetRef)
  })

  it('未解決ならnullを返す', async () => {
    const resolveAssetUrl = vi.fn(async () => null)
    await expect(resolveMapImageUrl({ resolveAssetUrl }, { ...baseMap, assetRef: { specifiers: [] } })).resolves.toBeNull()
  })
})

describe('resolvePhotoUrl', () => {
  it('写真のAssetRefをStorageClientへ渡す', async () => {
    const resolveAssetUrl = vi.fn(async () => 'https://cdn/photo.jpg')
    const photo = { assetRef: { baseFolderPath: '本館/2F', specifiers: [{ kind: 'alias' as const, value: '入口' }] }, desc: '' }
    await expect(resolvePhotoUrl({ resolveAssetUrl }, photo)).resolves.toBe('https://cdn/photo.jpg')
    expect(resolveAssetUrl).toHaveBeenCalledWith(photo.assetRef)
  })
})

describe('assetRefLabel', () => {
  it('未解決表示用に最初の指定子値を返す', () => {
    expect(assetRefLabel(baseMap.assetRef)).toBe('plan.svg')
    expect(assetRefLabel({ specifiers: [] })).toBe('')
  })
})
