// RestClient の契約充足ユニットテスト（design 5 章）。
//
// 方針:
// - fetch を vi.stubGlobal でモックし、実バックエンドには一切接続しない。
// - 各ケースでリクエストの URL・メソッド・ヘッダ・本文を検証し、
//   レスポンスをモックして戻り値 / 例外を検証する。
// - globals は使わず vitest から明示 import する（tsconfig を触らない方針）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RestClient } from './rest-client'
import { ApiError } from './types'
import type { Asset, Folder, Page, PageSummary, User } from './types'

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
    blob: async () => new Blob(['asset']),
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

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset')
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

const sampleFolder: Folder = {
  id: 7,
  parentId: null,
  name: 'maps',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const sampleAsset: Asset = {
  id: 5,
  folderId: 7,
  filename: 'diagram.png',
  alias: 'floor-plan',
  url: '/api/assets/5/file',
  content_type: 'image/png',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

describe('folders', () => {
  it('root/子フォルダ一覧をGETする', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, [sampleFolder]))
    const client = new RestClient()
    await expect(client.listFolders(null)).resolves.toEqual([sampleFolder])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/folders')

    fetchMock.mockResolvedValueOnce(mockResponse(200, []))
    await client.listFolders(7)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/folders?parent=7')
  })

  it('フォルダをJSONで作成する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(201, sampleFolder))
    const client = new RestClient()
    await expect(client.createFolder({ parentId: null, name: 'maps' })).resolves.toEqual(sampleFolder)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ parentId: null, name: 'maps' })
  })
})

describe('assets', () => {
  it('フォルダ直下をGETする', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
    const client = new RestClient()
    await expect(client.listAssets(7)).resolves.toEqual([sampleAsset])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/assets?folder=7')
  })

  it('multipartで登録しaliasも送れる', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(201, sampleAsset))
    const client = new RestClient()
    const file = new File(['data'], 'diagram.png', { type: 'image/png' })
    await expect(client.uploadAsset({ folderId: 7, file, alias: 'floor-plan' })).resolves.toEqual(sampleAsset)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/assets?folder=7')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    expect((init.body as FormData).get('alias')).toBe('floor-plan')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('認証付きでfileを取得しBlob URLを返す', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { token: 'tok123', user: sampleUser }))
      .mockResolvedValueOnce(mockResponse(200, null))
    const client = new RestClient()
    await client.login('alice', 'secret')
    await expect(client.getAssetFileUrl(sampleAsset)).resolves.toBe('blob:asset')
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe(sampleAsset.url)
    expect(init.headers.Authorization).toBe('Token tok123')
  })

  it('Blob URLを明示的な解放契約でrevokeする', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const client = new RestClient()
    client.releaseAssetFileUrl('blob:asset')
    client.releaseAssetFileUrl('https://cdn/asset')
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:asset')
  })
})

describe('resolveAssetUrl', () => {
  it('基準フォルダをIDへ解決しfilenameを検索する', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, [sampleFolder]))
      .mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
      .mockResolvedValueOnce(mockResponse(200, null))
    const client = new RestClient()
    const url = await client.resolveAssetUrl({
      baseFolderPath: 'maps',
      specifiers: [{ kind: 'filename', value: 'diagram.png' }],
    })
    expect(url).toBe('blob:asset')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/folders')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/assets?folder=7')
  })

  it('specifierの出現順でfilename/aliasを試し、失敗時に次へ進む', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, []))
      .mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
      .mockResolvedValueOnce(mockResponse(200, null))
    const client = new RestClient()
    const url = await client.resolveAssetUrl({
      specifiers: [
        { kind: 'filename', value: 'missing.png' },
        { kind: 'alias', value: 'floor-plan' },
      ],
    })
    expect(url).toBe('blob:asset')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/assets', '/api/assets', sampleAsset.url])
  })

  it('指定子の相対フォルダと絶対フォルダを解決する', async () => {
    const fetchMock = stubFetch()
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, [sampleFolder]))
      .mockResolvedValueOnce(mockResponse(200, [{ ...sampleFolder, id: 8, parentId: 7, name: '2F' }]))
      .mockResolvedValueOnce(mockResponse(200, [sampleAsset]))
      .mockResolvedValueOnce(mockResponse(200, null))
    const client = new RestClient()
    await expect(client.resolveAssetUrl({
      baseFolderPath: 'maps',
      specifiers: [{ kind: 'filename', value: '2F/diagram.png' }],
    })).resolves.toBe('blob:asset')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/assets?folder=8')
  })

  it('404フォルダは未解決としてnullを返す', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, []))
    const client = new RestClient()
    await expect(client.resolveAssetUrl({
      baseFolderPath: 'missing',
      specifiers: [{ kind: 'filename', value: 'map.png' }],
    })).resolves.toBeNull()
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
