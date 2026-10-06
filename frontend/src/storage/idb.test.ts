import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { clearStore, getAllByIndex, getByKey, openDb, put, tx } from './idb'

afterEach(() => {
  // 後始末: テスト間干渉を防ぐため DB を削除する。
  indexedDB.deleteDatabase('janus-local')
})

describe('openDb — スキーマ構築', () => {
  it('6 ストアを作成する', async () => {
    const db = await openDb()
    const names = Array.from(db.objectStoreNames)
    expect(names).toEqual(
      expect.arrayContaining(['pages', 'revisions', 'comments', 'folders', 'assets', 'meta']),
    )
    expect(names).toHaveLength(6)
    db.close()
  })

  it('pages の keyPath が path で autoIncrement が false', async () => {
    const db = await openDb()
    const info = db.transaction('pages', 'readonly').objectStore('pages')
    expect(info.keyPath).toBe('path')
    expect(info.autoIncrement).toBe(false)
    db.close()
  })

  it('revisions が autoIncrement で path / path_number インデックスを持つ', async () => {
    const db = await openDb()
    const store = db.transaction('revisions', 'readonly').objectStore('revisions')
    expect(store.autoIncrement).toBe(true)

    const pathIdx = store.index('path')
    expect(pathIdx.unique).toBe(false)

    const pnIdx = store.index('path_number')
    expect(pnIdx.unique).toBe(true)
    expect(pnIdx.keyPath).toEqual(['path', 'number'])
    db.close()
  })

  it('comments がインデックス path を持つ', async () => {
    const db = await openDb()
    const store = db.transaction('comments', 'readonly').objectStore('comments')
    expect(store.autoIncrement).toBe(true)
    expect(store.index('path').unique).toBe(false)
    db.close()
  })

  it('folders がインデックス parentId を持つ', async () => {
    const db = await openDb()
    const store = db.transaction('folders', 'readonly').objectStore('folders')
    expect(store.autoIncrement).toBe(true)
    expect(store.index('parentId').unique).toBe(false)
    db.close()
  })

  it('assets がインデックス folderId を持つ', async () => {
    const db = await openDb()
    const store = db.transaction('assets', 'readonly').objectStore('assets')
    expect(store.autoIncrement).toBe(true)
    expect(store.index('folderId').unique).toBe(false)
    db.close()
  })

  it('meta の keyPath が key', async () => {
    const db = await openDb()
    const store = db.transaction('meta', 'readonly').objectStore('meta')
    expect(store.keyPath).toBe('key')
    db.close()
  })
})

describe('ヘルパー — ラウンドトリップ', () => {
  it('put → getByKey で同値が返る（meta ストア）', async () => {
    const db = await openDb()
    const record = { key: 'schema', value: 1 }

    await tx(db, 'meta', 'readwrite', (t) => {
      put(t.objectStore('meta'), record)
    })

    const result = await tx(db, 'meta', 'readonly', (t) =>
      getByKey<typeof record>(t.objectStore('meta'), 'schema'),
    )
    expect(result).toEqual(record)
    db.close()
  })

  it('getAllByIndex が revisions の path インデックスで該当行のみ返す', async () => {
    const db = await openDb()
    const rev1 = { path: '/docs', number: 1, body: 'v1' }
    const rev2 = { path: '/docs', number: 2, body: 'v2' }
    const rev3 = { path: '/other', number: 1, body: 'x' }

    await tx(db, 'revisions', 'readwrite', (t) => {
      const store = t.objectStore('revisions')
      put(store, rev1)
      put(store, rev2)
      put(store, rev3)
    })

    const docs = await tx(db, 'revisions', 'readonly', (t) =>
      getAllByIndex<typeof rev1>(t.objectStore('revisions'), 'path', '/docs'),
    )
    expect(docs).toHaveLength(2)
    expect(docs.map((r) => r.body)).toEqual(expect.arrayContaining(['v1', 'v2']))
    db.close()
  })

  it('clearStore がストアを空にする', async () => {
    const db = await openDb()
    await tx(db, 'meta', 'readwrite', (t) => {
      put(t.objectStore('meta'), { key: 'a', value: 1 })
    })

    await tx(db, 'meta', 'readwrite', (t) => {
      clearStore(t.objectStore('meta'))
    })

    const result = await tx(db, 'meta', 'readonly', (t) =>
      getByKey(t.objectStore('meta'), 'a'),
    )
    expect(result).toBeUndefined()
    db.close()
  })
})
