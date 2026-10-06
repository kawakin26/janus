import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalClient, LOCAL_USER } from './local-client'
import { ApiError } from './types'
import type { StorageClient } from './types'

afterEach(() => {
  // テスト間干渉を防ぐため DB を削除する。
  indexedDB.deleteDatabase('janus-local')
})

/** 作成日時昇順/降順が区別できるよう、イベントループを少し進める。 */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2))
}

// ---------------------------------------------------------------------------
// Task 6: Auth / Permission / Search ダミー
// ---------------------------------------------------------------------------

describe('AuthClient ダミー', () => {
  it('currentUser() が LOCAL_USER を返す', async () => {
    const client = new LocalClient()
    await expect(client.currentUser()).resolves.toEqual(LOCAL_USER)
  })

  it('login() は入力によらず token と LOCAL_USER を返す', async () => {
    const client = new LocalClient()
    await expect(client.login('whoever', 'whatever')).resolves.toEqual({
      token: 'local',
      user: LOCAL_USER,
    })
  })

  it('logout() はエラーなく解決する', async () => {
    const client = new LocalClient()
    await expect(client.logout()).resolves.toBeUndefined()
  })
})

describe('PermissionClient ダミー', () => {
  it('getEffectivePermission() が全許可を返す', async () => {
    const client = new LocalClient()
    await expect(client.getEffectivePermission('/x')).resolves.toEqual({
      view: true,
      edit: true,
    })
  })

  it('listPermissions() が空配列を返す', async () => {
    const client = new LocalClient()
    await expect(client.listPermissions('/x')).resolves.toEqual([])
  })

  it('grantPermission() が入力を全フィールド付きの PermissionEntry として返す', async () => {
    const client = new LocalClient()
    const result = await client.grantPermission({
      path: '/docs',
      principalType: 'group',
      principalId: 42,
      action: 'edit',
      effect: 'deny',
    })
    expect(result).toEqual({
      id: 0,
      path: '/docs',
      principalType: 'group',
      principalId: 42,
      action: 'edit',
      effect: 'deny',
    })
    expect(typeof result.id).toBe('number')
  })

  it('updatePermission() が指定 id と effect を持つ PermissionEntry を返す', async () => {
    const client = new LocalClient()
    const result = await client.updatePermission(7, 'allow')
    expect(result.id).toBe(7)
    expect(result.effect).toBe('allow')
    // 全フィールドが埋まっている。
    expect(result).toEqual({
      id: 7,
      path: '/',
      principalType: 'user',
      principalId: 0,
      action: 'view',
      effect: 'allow',
    })
  })

  it('revokePermission() はエラーなく解決する', async () => {
    const client = new LocalClient()
    await expect(client.revokePermission(1)).resolves.toBeUndefined()
  })
})

describe('SearchClient', () => {
  it('search() は Error を投げる', () => {
    const client = new LocalClient()
    expect(() => client.search('q')).toThrow('search() はフェーズ 4 で実装します')
  })
})

describe('型適合', () => {
  it('LocalClient を StorageClient として代入できる', () => {
    const client: StorageClient = new LocalClient()
    expect(client).toBeInstanceOf(LocalClient)
  })
})

// ---------------------------------------------------------------------------
// Task 7: PageClient
// ---------------------------------------------------------------------------

describe('PageClient', () => {
  it('createPage → getPage ラウンドトリップ', async () => {
    const client = new LocalClient()
    const created = await client.createPage({ path: '/docs', title: 'Docs', body: 'hello' })
    expect(created.id).toBe(1)
    expect(created.path).toBe('/docs')
    expect(created.title).toBe('Docs')
    expect(created.body).toBe('hello')
    expect(created.created_at).toBeTruthy()
    expect(created.updated_at).toBeTruthy()
    expect(created.created_by).toEqual(LOCAL_USER)
    expect(created.updated_by).toEqual(LOCAL_USER)

    const fetched = await client.getPage('/docs')
    expect(fetched).toEqual(created)
  })

  it('createPage が連番 Page.id を採番する', async () => {
    const client = new LocalClient()
    const a = await client.createPage({ path: '/a', body: '' })
    const b = await client.createPage({ path: '/b', body: '' })
    const c = await client.createPage({ path: '/c', body: '' })
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3])
  })

  it('createPage の重複パスは 409', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/dup', body: '' })
    await expect(client.createPage({ path: '/dup', body: '' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('createPage でタイトル未指定なら最終セグメントを使う', async () => {
    const client = new LocalClient()
    const page = await client.createPage({ path: '/docs/intro', body: '' })
    expect(page.title).toBe('intro')
  })

  it('getPage は存在しないパスで null を返す', async () => {
    const client = new LocalClient()
    await expect(client.getPage('/nonexistent')).resolves.toBeNull()
  })

  it('updatePage は本文更新で新リビジョンを作る', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', title: 'P', body: 'v1' })
    const updated = await client.updatePage('/p', { body: 'v2' })
    expect(updated.body).toBe('v2')

    const page = await client.getPage('/p')
    expect(page?.body).toBe('v2')

    const revs = await client.listRevisions('/p')
    expect(revs).toHaveLength(2)
  })

  it('updatePage 本文不変なら新リビジョンを作らない', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', title: 'P', body: 'same' })
    await client.updatePage('/p', { body: 'same' })
    const revs = await client.listRevisions('/p')
    expect(revs).toHaveLength(1)
  })

  it('updatePage 本文不変・タイトル変更はリビジョン無し・タイトル更新', async () => {
    const client = new LocalClient()
    const created = await client.createPage({ path: '/p', title: 'Old', body: 'same' })
    await tick()
    const updated = await client.updatePage('/p', { title: 'New', body: 'same' })
    expect(updated.title).toBe('New')
    expect(updated.updated_at).not.toBe(created.updated_at)

    const revs = await client.listRevisions('/p')
    expect(revs).toHaveLength(1)
  })

  it('updatePage 両方不変なら updated_at を変えない', async () => {
    const client = new LocalClient()
    const created = await client.createPage({ path: '/p', title: 'T', body: 'b' })
    await tick()
    const updated = await client.updatePage('/p', { title: 'T', body: 'b' })
    expect(updated.updated_at).toBe(created.updated_at)
  })

  it('updatePage は存在しないパスで 404', async () => {
    const client = new LocalClient()
    await expect(client.updatePage('/missing', { body: 'x' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('deletePage はページ・リビジョン・コメントを削除する', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', body: 'b' })
    await client.updatePage('/p', { body: 'b2' })
    await client.addComment('/p', 'hi')

    await client.deletePage('/p')

    await expect(client.getPage('/p')).resolves.toBeNull()
    await expect(client.listRevisions('/p')).resolves.toEqual([])
    await expect(client.listComments('/p')).resolves.toEqual([])
  })

  it('listChildren は直下の子のみを返す', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/a', body: '' })
    await client.createPage({ path: '/a/b', body: '' })
    await client.createPage({ path: '/a/b/c', body: '' })
    await client.createPage({ path: '/a/d', body: '' })

    const children = await client.listChildren('/a')
    expect(children.map((c) => c.path)).toEqual(['/a/b', '/a/d'])
  })

  it('listChildren はルート直下を返す', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/x', body: '' })
    await client.createPage({ path: '/y', body: '' })
    const children = await client.listChildren('/')
    expect(children.map((c) => c.path)).toEqual(['/x', '/y'])
  })

  it('getPageTree 最小ラウンドトリップ', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/a', title: 'A', body: '' })
    await client.createPage({ path: '/a/b', title: 'B', body: '' })

    const tree = await client.getPageTree()
    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('/a')
    expect(tree[0].hasPage).toBe(true)
    expect(tree[0].hasChildren).toBe(true)
    expect(tree[0].children[0].path).toBe('/a/b')
  })

  it('listRevisions は number 降順で limit/offset を適用する', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', body: 'v1' })
    await client.updatePage('/p', { body: 'v2' })
    await client.updatePage('/p', { body: 'v3' })
    await client.updatePage('/p', { body: 'v4' })
    await client.updatePage('/p', { body: 'v5' })

    const revs = await client.listRevisions('/p', { limit: 2, offset: 1 })
    expect(revs.map((r) => r.number)).toEqual([4, 3])
  })

  it('listRevisions の各項目は一意の id を持つ', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', body: 'v1' })
    await client.updatePage('/p', { body: 'v2' })
    await client.updatePage('/p', { body: 'v3' })
    const revs = await client.listRevisions('/p')
    const ids = revs.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getRevision が正しいリビジョンを返す', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', title: 'T1', body: 'v1' })
    await client.updatePage('/p', { title: 'T2', body: 'v2' })

    const rev1 = await client.getRevision('/p', 1)
    expect(rev1.body).toBe('v1')
    expect(rev1.title).toBe('T1')
    expect(rev1.author).toEqual(LOCAL_USER)

    const rev2 = await client.getRevision('/p', 2)
    expect(rev2.body).toBe('v2')
    expect(rev2.title).toBe('T2')
  })

  it('getRevision は不正な number で 404', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', body: 'v1' })
    await expect(client.getRevision('/p', 99)).rejects.toMatchObject({ status: 404 })
  })

  it('diffRevisions は DiffLine 配列を返す', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', body: 'a\nb' })
    await client.updatePage('/p', { body: 'a\nc' })
    const diff = await client.diffRevisions('/p', 1, 2)
    expect(diff.some((l) => l.op === 'del' && l.line === 'b')).toBe(true)
    expect(diff.some((l) => l.op === 'add' && l.line === 'c')).toBe(true)
    expect(diff.some((l) => l.op === 'equal' && l.line === 'a')).toBe(true)
  })

  it('restoreRevision は復元内容で新リビジョンを作る', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', title: 'T1', body: 'v1' })
    await client.updatePage('/p', { title: 'T2', body: 'v2' })
    const restored = await client.restoreRevision('/p', 1)
    expect(restored.body).toBe('v1')
    expect(restored.title).toBe('T1')

    const revs = await client.listRevisions('/p')
    expect(revs).toHaveLength(3)
    expect(revs[0].number).toBe(3)
  })

  it('restoreRevision は最新と同一本文ならリビジョンを増やさない', async () => {
    const client = new LocalClient()
    await client.createPage({ path: '/p', title: 'T1', body: 'v1' })
    const restored = await client.restoreRevision('/p', 1)
    expect(restored.body).toBe('v1')
    const revs = await client.listRevisions('/p')
    expect(revs).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Task 8: CommentClient
// ---------------------------------------------------------------------------

describe('CommentClient', () => {
  it('addComment → listComments ラウンドトリップ', async () => {
    const client = new LocalClient()
    const added = await client.addComment('/p', 'hello')
    expect(typeof added.id).toBe('number')
    expect(added.body).toBe('hello')
    expect(added.author).toEqual(LOCAL_USER)

    const list = await client.listComments('/p')
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(added)
  })

  it('listComments は created_at 昇順で返す', async () => {
    const client = new LocalClient()
    const first = await client.addComment('/p', 'first')
    await tick()
    const second = await client.addComment('/p', 'second')
    const list = await client.listComments('/p')
    expect(list.map((c) => c.id)).toEqual([first.id, second.id])
  })

  it('addComment は空本文で 400', async () => {
    const client = new LocalClient()
    await expect(client.addComment('/p', '')).rejects.toBeInstanceOf(ApiError)
    await expect(client.addComment('/p', '   ')).rejects.toMatchObject({ status: 400 })
  })

  it('updateComment は本文と updated_at を変える', async () => {
    const client = new LocalClient()
    const added = await client.addComment('/p', 'old')
    await tick()
    const updated = await client.updateComment(added.id, 'new')
    expect(updated.body).toBe('new')
    expect(updated.created_at).toBe(added.created_at)
    expect(updated.updated_at).not.toBe(added.updated_at)
  })

  it('updateComment は存在しない id で 404', async () => {
    const client = new LocalClient()
    await expect(client.updateComment(999, 'x')).rejects.toMatchObject({ status: 404 })
  })

  it('deleteComment はコメントを削除する', async () => {
    const client = new LocalClient()
    const added = await client.addComment('/p', 'bye')
    await client.deleteComment(added.id)
    await expect(client.listComments('/p')).resolves.toEqual([])
  })

  it('author は id=1 の User オブジェクト', async () => {
    const client = new LocalClient()
    const added = await client.addComment('/p', 'hi')
    expect(added.author).toEqual(LOCAL_USER)
    expect(added.author?.id).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Task 9: AssetClient
// ---------------------------------------------------------------------------

describe('AssetClient', () => {
  beforeEach(() => {
    // Node には URL.createObjectURL / revokeObjectURL が無いためモックする。
    globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random()}`)
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  function makeFile(name: string, type = 'text/plain', content = 'x'): File {
    return new File([content], name, { type })
  }

  it('createFolder → listFolders ラウンドトリップ（root）', async () => {
    const client = new LocalClient()
    const folder = await client.createFolder({ parentId: null, name: 'photos' })
    expect(typeof folder.id).toBe('number')
    const list = await client.listFolders(null)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('photos')
    expect(list[0].parentId).toBeNull()
  })

  it('createFolder は同一親内の同名で 409', async () => {
    const client = new LocalClient()
    await client.createFolder({ parentId: null, name: 'dup' })
    await expect(client.createFolder({ parentId: null, name: 'dup' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('createFolder は親が異なれば同名を許す', async () => {
    const client = new LocalClient()
    const parent = await client.createFolder({ parentId: null, name: 'a' })
    await client.createFolder({ parentId: null, name: 'shared' })
    await expect(
      client.createFolder({ parentId: parent.id, name: 'shared' }),
    ).resolves.toBeTruthy()
  })

  it('uploadAsset → listAssets ラウンドトリップ（url は空）', async () => {
    const client = new LocalClient()
    const asset = await client.uploadAsset({ folderId: null, file: makeFile('pic.jpg') })
    expect(asset.url).toBe('')
    const list = await client.listAssets(null)
    expect(list).toHaveLength(1)
    expect(list[0].filename).toBe('pic.jpg')
    expect(list[0].url).toBe('')
  })

  it('uploadAsset → getAssetFileUrl が blob: URL を返す', async () => {
    const client = new LocalClient()
    const asset = await client.uploadAsset({ folderId: null, file: makeFile('pic.jpg') })
    const url = await client.getAssetFileUrl(asset)
    expect(url.startsWith('blob:')).toBe(true)
  })

  it('uploadAsset は同一フォルダ内の同名ファイルで 409', async () => {
    const client = new LocalClient()
    await client.uploadAsset({ folderId: null, file: makeFile('a.png') })
    await expect(
      client.uploadAsset({ folderId: null, file: makeFile('a.png') }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('uploadAsset は同一フォルダ内の同エイリアスで 409', async () => {
    const client = new LocalClient()
    await client.uploadAsset({ folderId: null, file: makeFile('a.png'), alias: 'logo' })
    await expect(
      client.uploadAsset({ folderId: null, file: makeFile('b.png'), alias: 'logo' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('moveAsset は folderId を変える', async () => {
    const client = new LocalClient()
    const folderA = await client.createFolder({ parentId: null, name: 'A' })
    const folderB = await client.createFolder({ parentId: null, name: 'B' })
    const asset = await client.uploadAsset({ folderId: folderA.id, file: makeFile('x.png') })

    await client.moveAsset(asset.id, folderB.id)
    await expect(client.listAssets(folderA.id)).resolves.toEqual([])
    const inB = await client.listAssets(folderB.id)
    expect(inB).toHaveLength(1)
    expect(inB[0].id).toBe(asset.id)
  })

  it('releaseAssetFileUrl は同期 void で revokeObjectURL を呼ぶ', () => {
    const client = new LocalClient()
    const result = client.releaseAssetFileUrl('blob:something')
    expect(result).toBeUndefined()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:something')
  })

  it('releaseAssetFileUrl は blob: 以外では何もしない', () => {
    const client = new LocalClient()
    client.releaseAssetFileUrl('http://example.com/x.png')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('resolveAssetUrl はファイル名でアセットを見つける', async () => {
    const client = new LocalClient()
    const folder = await client.createFolder({ parentId: null, name: 'photos' })
    await client.uploadAsset({ folderId: folder.id, file: makeFile('pic.jpg') })
    const url = await client.resolveAssetUrl({
      specifiers: [{ kind: 'filename', value: 'photos/pic.jpg' }],
    })
    expect(url).not.toBeNull()
    expect(url?.startsWith('blob:')).toBe(true)
  })

  it('resolveAssetUrl はエイリアスでアセットを見つける', async () => {
    const client = new LocalClient()
    const folder = await client.createFolder({ parentId: null, name: 'photos' })
    await client.uploadAsset({ folderId: folder.id, file: makeFile('pic.jpg'), alias: 'hero' })
    const url = await client.resolveAssetUrl({
      specifiers: [{ kind: 'alias', value: 'photos/hero' }],
    })
    expect(url?.startsWith('blob:')).toBe(true)
  })

  it('resolveAssetUrl は baseFolderPath を解釈する', async () => {
    const client = new LocalClient()
    const parent = await client.createFolder({ parentId: null, name: 'docs' })
    const child = await client.createFolder({ parentId: parent.id, name: 'img' })
    await client.uploadAsset({ folderId: child.id, file: makeFile('pic.jpg') })
    const url = await client.resolveAssetUrl({
      baseFolderPath: '/docs/img',
      specifiers: [{ kind: 'filename', value: 'pic.jpg' }],
    })
    expect(url?.startsWith('blob:')).toBe(true)
  })

  it('resolveAssetUrl は見つからなければ null を返す', async () => {
    const client = new LocalClient()
    const url = await client.resolveAssetUrl({
      specifiers: [{ kind: 'filename', value: 'nope/missing.jpg' }],
    })
    expect(url).toBeNull()
  })

  it('listAssets / listFolders は null の親/フォルダを扱える', async () => {
    const client = new LocalClient()
    await client.createFolder({ parentId: null, name: 'root-folder' })
    await client.uploadAsset({ folderId: null, file: makeFile('root-asset.png') })

    const folders = await client.listFolders(null)
    expect(folders.map((f) => f.name)).toEqual(['root-folder'])

    const assets = await client.listAssets(null)
    expect(assets.map((a) => a.filename)).toEqual(['root-asset.png'])
  })
})
