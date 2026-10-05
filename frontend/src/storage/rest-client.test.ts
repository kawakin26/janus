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

// --- PageClient（リビジョン系・ブロックC） -----------------------------------

const sampleRevisionSummary = {
  id: 3,
  number: 2,
  created_at: '2024-01-02T00:00:00Z',
  author: sampleUser,
}

const sampleRevision = {
  id: 3,
  number: 2,
  created_at: '2024-01-02T00:00:00Z',
  author: sampleUser,
  body: 'new body',
  title: 'Intro',
}

describe('listRevisions', () => {
  it('200 で RevisionSummary[] を返す（opts 無しは ?path= のみ）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, [sampleRevisionSummary]))
    const client = new RestClient()
    const result = await client.listRevisions('/docs/intro')
    expect(result).toEqual([sampleRevisionSummary])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/revisions?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('GET')
  })

  it('opts.limit/offset をクエリに付与する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, []))
    const client = new RestClient()
    await client.listRevisions('/docs/intro', { limit: 20, offset: 40 })
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/pages/revisions?path=%2Fdocs%2Fintro&limit=20&offset=40',
    )
  })

  it('403 のとき ApiError(status=403) を throw する（401 と区別）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(client.listRevisions('/secret')).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('getRevision', () => {
  it('200 で Revision を返す（?path=&number=）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, sampleRevision))
    const client = new RestClient()
    const result = await client.getRevision('/docs/intro', 2)
    expect(result).toEqual(sampleRevision)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/revisions/detail?path=%2Fdocs%2Fintro&number=2')
    expect(init.method).toBe('GET')
  })

  it('404 のとき ApiError(status=404) を throw する（null にしない）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(404, { detail: 'nope' }))
    const client = new RestClient()
    await expect(client.getRevision('/docs/intro', 99)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('403 のとき ApiError(status=403) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(client.getRevision('/secret', 1)).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('diffRevisions', () => {
  it('200 で DiffLine[] を返す（?from=&to=）', async () => {
    const diff = [
      { op: 'equal', line: 'same' },
      { op: 'del', line: 'old' },
      { op: 'add', line: 'new' },
    ]
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, diff))
    const client = new RestClient()
    const result = await client.diffRevisions('/docs/intro', 1, 2)
    expect(result).toEqual(diff)
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/pages/revisions/diff?path=%2Fdocs%2Fintro&from=1&to=2',
    )
  })

  it('404 のとき ApiError(status=404) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(404, { detail: 'nope' }))
    const client = new RestClient()
    await expect(
      client.diffRevisions('/docs/intro', 1, 99),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('restoreRevision', () => {
  it('200 で Page を返す（POST body {path, number}）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, samplePage))
    const client = new RestClient()
    const result = await client.restoreRevision('/docs/intro', 2)
    expect(result).toEqual(samplePage)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/revisions/restore')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ path: '/docs/intro', number: 2 })
  })

  it('401 のとき ApiError(status=401) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(401, { detail: 'auth' }))
    const client = new RestClient()
    await expect(
      client.restoreRevision('/docs/intro', 2),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('403 のとき ApiError(status=403) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(
      client.restoreRevision('/secret', 2),
    ).rejects.toMatchObject({ status: 403 })
  })
})

// --- PermissionClient（ブロックC） --------------------------------------------

const samplePermission = {
  id: 11,
  path: '/docs/intro',
  principalType: 'user' as const,
  principalId: 1,
  action: 'edit' as const,
  effect: 'allow' as const,
}

describe('listPermissions', () => {
  it('200 で PermissionEntry[] を返す（?path=）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, [samplePermission]))
    const client = new RestClient()
    const result = await client.listPermissions('/docs/intro')
    expect(result).toEqual([samplePermission])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/permissions?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('GET')
  })

  it('200 空配列をそのまま返す', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, []))
    const client = new RestClient()
    await expect(client.listPermissions('/docs/intro')).resolves.toEqual([])
  })

  it('403 のとき ApiError(status=403) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(client.listPermissions('/secret')).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('grantPermission', () => {
  it('201 で PermissionEntry を返す（body 検証）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(201, samplePermission))
    const client = new RestClient()
    const input = {
      path: '/docs/intro',
      principalType: 'user' as const,
      principalId: 1,
      action: 'edit' as const,
      effect: 'allow' as const,
    }
    const result = await client.grantPermission(input)
    expect(result).toEqual(samplePermission)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/permissions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(input)
  })

  it('409 のとき ApiError(status=409) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(409, { detail: 'duplicate' }))
    const client = new RestClient()
    await expect(
      client.grantPermission({
        path: '/docs/intro',
        principalType: 'user',
        principalId: 1,
        action: 'edit',
        effect: 'allow',
      }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('updatePermission', () => {
  it('200 で PermissionEntry を返す（PATCH body {effect}）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { ...samplePermission, effect: 'deny' }),
    )
    const client = new RestClient()
    const result = await client.updatePermission(11, 'deny')
    expect(result.effect).toBe('deny')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/permissions/11')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ effect: 'deny' })
  })

  it('404 のとき ApiError(status=404) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(404, { detail: 'nope' }))
    const client = new RestClient()
    await expect(client.updatePermission(99, 'deny')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('revokePermission', () => {
  it('204 で正常終了する（DELETE）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(204, null))
    const client = new RestClient()
    await expect(client.revokePermission(11)).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/permissions/11')
    expect(init.method).toBe('DELETE')
  })

  it('404 のとき ApiError(status=404) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(404, { detail: 'nope' }))
    const client = new RestClient()
    await expect(client.revokePermission(99)).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('getEffectivePermission', () => {
  it('200 で {view, edit} を返す（?path=）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, { view: true, edit: false }))
    const client = new RestClient()
    const result = await client.getEffectivePermission('/docs/intro')
    expect(result).toEqual({ view: true, edit: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/effective-permission?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('GET')
  })

  it('401 のとき ApiError(status=401) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(401, { detail: 'auth' }))
    const client = new RestClient()
    await expect(
      client.getEffectivePermission('/docs/intro'),
    ).rejects.toMatchObject({ status: 401 })
  })
})

// --- CommentClient（ブロック1・T-REST） --------------------------------------

const sampleComment = {
  id: 42,
  body: '最初のコメント',
  author: sampleUser,
  created_at: '2024-01-03T00:00:00Z',
  updated_at: '2024-01-03T00:00:00Z',
}

describe('listComments', () => {
  it('200 で Comment[] を返す（?path=）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(200, [sampleComment]))
    const client = new RestClient()
    const result = await client.listComments('/docs/intro')
    expect(result).toEqual([sampleComment])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/comments?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('GET')
  })

  it('403 のとき ApiError(status=403) を throw する（401 と区別）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(client.listComments('/secret')).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('addComment', () => {
  it('201 で Comment を返す（POST ?path= / body {body}）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(201, sampleComment))
    const client = new RestClient()
    const result = await client.addComment('/docs/intro', '最初のコメント')
    expect(result).toEqual(sampleComment)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/comments?path=%2Fdocs%2Fintro')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ body: '最初のコメント' })
  })

  it('400 のとき ApiError(status=400) を throw する（空・上限超過）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(400, { detail: 'invalid' }))
    const client = new RestClient()
    await expect(client.addComment('/docs/intro', '')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('403 のとき ApiError(status=403) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(client.addComment('/secret', 'x')).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('updateComment', () => {
  it('200 で Comment を返す（PATCH /id・body {body}）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, { ...sampleComment, body: 'edited' }),
    )
    const client = new RestClient()
    const result = await client.updateComment(42, 'edited')
    expect(result.body).toBe('edited')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/comments/42')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ body: 'edited' })
  })

  it('400 のとき ApiError(status=400) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(400, { detail: 'invalid' }))
    const client = new RestClient()
    await expect(client.updateComment(42, '   ')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('403 のとき ApiError(status=403) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(client.updateComment(42, 'x')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('409 のとき ApiError(status=409) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(409, { detail: 'conflict' }))
    const client = new RestClient()
    await expect(client.updateComment(42, 'x')).rejects.toMatchObject({
      status: 409,
    })
  })
})

describe('deleteComment', () => {
  it('204 で正常終了する（DELETE /id）', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(204, null))
    const client = new RestClient()
    await expect(client.deleteComment(42)).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/pages/comments/42')
    expect(init.method).toBe('DELETE')
  })

  it('403 のとき ApiError(status=403) を throw する', async () => {
    const fetchMock = stubFetch()
    fetchMock.mockResolvedValueOnce(mockResponse(403, { detail: 'forbidden' }))
    const client = new RestClient()
    await expect(client.deleteComment(42)).rejects.toMatchObject({
      status: 403,
    })
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
