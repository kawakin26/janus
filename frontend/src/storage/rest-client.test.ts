// RestClient の契約充足ユニットテスト（design 5 章）。
//
// 方針:
// - fetch を vi.stubGlobal でモックし、実バックエンドには一切接続しない。
// - 各ケースでリクエストの URL・メソッド・ヘッダ・本文を検証し、
//   レスポンスをモックして戻り値 / 例外を検証する。
// - globals は使わず vitest から明示 import する（tsconfig を触らない方針）。

import { afterEach, describe, expect, it, vi } from 'vitest'

import { RestClient } from './rest-client'
import { ApiError } from './types'
import type { Asset, Page, PageSummary, User } from './types'

// --- テスト用フィクスチャ -----------------------------------------------------

const sampleUser: User = {
  id: 1,
  username: 'alice',
  is_staff: true,
  is_superuser: false,
}

const samplePage: Page = {
  id: 10,
  path: '/docs/intro',
  title: 'Intro',
  body: 'hello',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  created_by: sampleUser,
  updated_by: sampleUser,
}

// --- fetch モックのヘルパ -----------------------------------------------------

/** Response 風のモックを作る（json() と ok/status を備える）。 */
function mockResponse(
  status: number,
  body: unknown,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** fetch モックを設置して返す。 */
function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// --- AuthClient ---------------------------------------------------------------

describe('login', () => {
  it('200 で token/user を返し、以降のリクエストに Authorization が付く', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { token: 'tok123', user: sampleUser }),
      )
      // login 後の currentUser 用（認証ヘッダ検証）。
      .mockResolvedValueOnce(mockResponse(200, sampleUser))

    const client = new RestClient()
    const result = await client.login('alice', 'secret')

    expect(result).toEqual({ token: 'tok123', user: sampleUser })
    // login リクエストの中身を検証。
    const [loginUrl, loginInit] = fetchMock.mock.calls[0]
    expect(loginUrl).toBe('/api/auth/login')
    expect(loginInit.method).toBe('POST')
    expect(JSON.parse(loginInit.body)).toEqual({
      username: 'alice',
      password: 'secret',
    })

    // 後続リクエストに Authorization: Token <token> が付くこと。
    await client.currentUser()
    const [, meInit] = fetchMock.mock.calls[1]
    expect(meInit.headers.Authorization).toBe('Token tok123')
  })

  it('認証失敗（400）は ApiError を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(
      mockResponse(400, { detail: 'invalid' }),
    )
    const client = new RestClient()
    await expect(client.login('x', 'y')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('logout', () => {
  it('204 で token を破棄する（以降 Authorization が付かない）', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { token: 'tok123', user: sampleUser }),
      )
      .mockResolvedValueOnce(mockResponse(204, null))
      .mockResolvedValueOnce(mockResponse(200, null))

    const client = new RestClient()
    await client.login('alice', 'secret')
    await client.logout()

    const [logoutUrl, logoutInit] = fetchMock.mock.calls[1]
    expect(logoutUrl).toBe('/api/auth/logout')
    expect(logoutInit.method).toBe('POST')

    // logout 後は token が破棄され Authorization が付かない。
    await client.currentUser()
    const [, meInit] = fetchMock.mock.calls[2]
    expect(meInit.headers.Authorization).toBeUndefined()
  })
})

describe('currentUser', () => {
  it('本文 null のとき null を返す', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, null))
    const client = new RestClient()
    await expect(client.currentUser()).resolves.toBeNull()
  })

  it('本文 User のとき User を返す', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, sampleUser))
    const client = new RestClient()
    await expect(client.currentUser()).resolves.toEqual(sampleUser)
  })
})

// --- PageClient ---------------------------------------------------------------

describe('getPage', () => {
  it('200 のとき Page を返す（?path= でエンコードされる）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, samplePage))
    const client = new RestClient()
    const page = await client.getPage('/docs/intro')
    expect(page).toEqual(samplePage)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('GET')
  })

  it('404 のとき null を返す（例外にしない）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(404, { detail: 'nope' }))
    const client = new RestClient()
    await expect(client.getPage('/missing')).resolves.toBeNull()
  })
})

describe('listChildren', () => {
  it('200 のとき PageSummary[] を返す（?parent= でエンコードされる）', async () => {
    const summaries: PageSummary[] = [
      { path: '/docs/a', title: 'A' },
      { path: '/docs/b', title: 'B' },
    ]
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, summaries))
    const client = new RestClient()
    const result = await client.listChildren('/docs')
    expect(result).toEqual(summaries)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/children?parent=%2Fdocs')
  })
})

describe('createPage', () => {
  it('201 のとき Page を返す', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(201, samplePage))
    const client = new RestClient()
    const page = await client.createPage({
      path: '/docs/intro',
      title: 'Intro',
      body: 'hello',
    })
    expect(page).toEqual(samplePage)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      path: '/docs/intro',
      title: 'Intro',
      body: 'hello',
    })
  })

  it('409 のとき ApiError(status=409) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(
      mockResponse(409, { detail: 'duplicate' }),
    )
    const client = new RestClient()
    await expect(
      client.createPage({ path: '/docs/intro', body: 'x' }),
    ).rejects.toMatchObject({ status: 409, detail: 'duplicate' })
  })
})

describe('updatePage', () => {
  it('200 のとき Page を返す（PUT・?path=）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, samplePage))
    const client = new RestClient()
    const page = await client.updatePage('/docs/intro', { body: 'new' })
    expect(page).toEqual(samplePage)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ body: 'new' })
  })

  it('404 のとき ApiError(status=404) を throw する（null にしない）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(404, { detail: 'nope' }))
    const client = new RestClient()
    await expect(
      client.updatePage('/missing', { body: 'x' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('deletePage', () => {
  it('204 のとき正常終了する（DELETE・?path=）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(204, null))
    const client = new RestClient()
    await expect(client.deletePage('/docs/intro')).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('DELETE')
  })

  it('404 のとき ApiError(status=404) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(404, { detail: 'nope' }))
    const client = new RestClient()
    await expect(client.deletePage('/missing')).rejects.toMatchObject({
      status: 404,
    })
  })
})

// --- AssetClient --------------------------------------------------------------

const sampleAsset: Asset = {
  id: 5,
  original_name: 'diagram.png',
  url: 'http://localhost:8000/media/x/diagram.png',
  content_type: 'image/png',
  created_at: '2024-01-01T00:00:00Z',
}

describe('listAssets', () => {
  it('200 のとき Asset[] を返す（?path=）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
    const client = new RestClient()
    const assets = await client.listAssets('/docs/intro')
    expect(assets).toEqual([sampleAsset])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/assets?path=%2Fdocs%2Fintro')
  })
})

describe('uploadAsset', () => {
  it('FormData にフィールド名 "file" が載り、Content-Type を自前指定しない', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(201, sampleAsset))
    const client = new RestClient()
    const file = new File(['data'], 'diagram.png', { type: 'image/png' })
    const asset = await client.uploadAsset('/docs/intro', file)
    expect(asset).toEqual(sampleAsset)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/assets?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('POST')
    // body は FormData で、フィールド "file" にファイルが載っていること。
    expect(init.body).toBeInstanceOf(FormData)
    const sent = (init.body as FormData).get('file')
    expect(sent).toBeInstanceOf(File)
    expect((sent as File).name).toBe('diagram.png')
    // Content-Type は fetch に任せる（手動指定しない）。
    const headers = (init.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers['content-type']).toBeUndefined()
  })
})

describe('resolveAssetUrl', () => {
  it('候補順で original_name 一致の url を返す', async () => {
    const fetchMock = stubFetch()
    // 1 番目候補は不一致、2 番目候補で一致。
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, []))
      .mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
    const client = new RestClient()
    const url = await client.resolveAssetUrl('diagram.png', [
      '/other',
      '/docs/intro',
    ])
    expect(url).toBe(sampleAsset.url)
  })

  it('全候補で不一致なら null を返す', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, []))
      .mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
    const client = new RestClient()
    const url = await client.resolveAssetUrl('missing.png', [
      '/other',
      '/docs/intro',
    ])
    expect(url).toBeNull()
  })

  it('途中の 404 候補はスキップして次候補へ進む', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(mockResponse(404, { detail: 'no page' }))
      .mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
    const client = new RestClient()
    const url = await client.resolveAssetUrl('diagram.png', [
      '/missing',
      '/docs/intro',
    ])
    expect(url).toBe(sampleAsset.url)
  })
})

// --- 401 / search -------------------------------------------------------------

describe('401 の扱い', () => {
  it('保護 API が 401 のとき ApiError(status=401) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(
      mockResponse(401, { detail: 'auth required' }),
    )
    const client = new RestClient()
    await expect(
      client.createPage({ path: '/x', body: 'y' }),
    ).rejects.toMatchObject({ status: 401 })
  })
})

describe('search', () => {
  it('フェーズ 4 未実装のため throw する（実エンドポイントは叩かない）', async () => {
    const fetchMock = stubFetch()
    const client = new RestClient()
    await expect(client.search('q')).rejects.toThrow()
    // fetch は呼ばれない。
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
