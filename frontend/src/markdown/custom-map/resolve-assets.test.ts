// アセット解決ヘルパのユニットテスト（タスク 11 / 要件 3-3, 3-5）。

import { describe, expect, it, vi } from 'vitest'
import {
  getMapCandidatePages,
  getPhotoCandidatePages,
  resolveMapImageUrl,
  resolvePhotoUrl,
} from './resolve-assets'
import type { MapData, MarkerData } from './types'

const baseMap: MapData = {
  file: 'plan.png',
  src: '',
  cx: 50,
  cy: 50,
  scale: 1,
  restore: 15,
  rotate: 0,
  link: '',
  pinSize: 12,
  labelSize: 12,
  markers: [],
}

describe('getMapCandidatePages', () => {
  it('src を最優先し、既定ストックページへフォールバックする', () => {
    expect(getMapCandidatePages({ src: '/foo' }, '/map-library')).toEqual(['/foo', '/map-library'])
  })
  it('src 未指定なら既定ストックページのみ', () => {
    expect(getMapCandidatePages({ src: '' }, '/map-library')).toEqual(['/map-library'])
  })
  it('src と既定が同じなら重複を除去する', () => {
    expect(getMapCandidatePages({ src: '/map-library' }, '/map-library')).toEqual(['/map-library'])
  })
})

describe('getPhotoCandidatePages', () => {
  it('photoSrc を先に、現在ページを後に並べる', () => {
    expect(getPhotoCandidatePages({ photoSrc: '/p' }, '/current')).toEqual(['/p', '/current'])
  })
  it('空文字は除去し重複も除去する', () => {
    expect(getPhotoCandidatePages({ photoSrc: '' }, '/current')).toEqual(['/current'])
    expect(getPhotoCandidatePages({ photoSrc: '/x' }, '/x')).toEqual(['/x'])
    expect(getPhotoCandidatePages({ photoSrc: '' }, undefined)).toEqual([])
  })
})

describe('resolveMapImageUrl', () => {
  it('最初の候補で見つかればその URL を返す', async () => {
    const resolveAssetUrl = vi.fn(async () => 'https://cdn/plan.png')
    const url = await resolveMapImageUrl({ resolveAssetUrl }, { ...baseMap, src: '/foo' }, '/map-library')
    expect(url).toBe('https://cdn/plan.png')
    expect(resolveAssetUrl).toHaveBeenCalledWith('plan.png', ['/foo', '/map-library'])
  })

  it('見つからなければ null（resolveAssetUrl の多段フォールバックに委譲）', async () => {
    const resolveAssetUrl = vi.fn(async () => null)
    const url = await resolveMapImageUrl({ resolveAssetUrl }, baseMap)
    expect(url).toBeNull()
  })

  it('file が空なら解決を試みず null', async () => {
    const resolveAssetUrl = vi.fn(async () => 'x')
    const url = await resolveMapImageUrl({ resolveAssetUrl }, { ...baseMap, file: '' })
    expect(url).toBeNull()
    expect(resolveAssetUrl).not.toHaveBeenCalled()
  })

  it('CAD ファイルでも変換 API を呼ばず画像として解決を試みる', async () => {
    const resolveAssetUrl = vi.fn(async () => 'https://cdn/plan.svg')
    const url = await resolveMapImageUrl({ resolveAssetUrl }, { ...baseMap, file: 'plan.dxf' })
    expect(url).toBe('https://cdn/plan.svg')
    expect(resolveAssetUrl).toHaveBeenCalledWith('plan.dxf', expect.any(Array))
  })
})

describe('resolvePhotoUrl', () => {
  const marker: Pick<MarkerData, 'photoSrc'> = { photoSrc: '/photos' }

  it('候補ページ順で resolveAssetUrl を呼ぶ', async () => {
    const resolveAssetUrl = vi.fn(async () => 'https://cdn/a.png')
    const url = await resolvePhotoUrl({ resolveAssetUrl }, 'a.png', marker, '/current')
    expect(url).toBe('https://cdn/a.png')
    expect(resolveAssetUrl).toHaveBeenCalledWith('a.png', ['/photos', '/current'])
  })

  it('写真名が空なら null', async () => {
    const resolveAssetUrl = vi.fn(async () => 'x')
    const url = await resolvePhotoUrl({ resolveAssetUrl }, '', marker, '/current')
    expect(url).toBeNull()
    expect(resolveAssetUrl).not.toHaveBeenCalled()
  })
})
