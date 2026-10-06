// IndexedDB アクセス層 — 薄い Promise ラッパー（design §4.3）。
//
// DB 名: janus-local / version 1
// ストア: pages, revisions, comments, folders, assets, meta

const DB_NAME = 'janus-local'
const DB_VERSION = 1

/** DB を開き、初回は version 1 でスキーマを構築する。 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result

      // pages: keyPath = path
      if (!db.objectStoreNames.contains('pages')) {
        db.createObjectStore('pages', { keyPath: 'path' })
      }

      // revisions: autoIncrement id + index path (non-unique), [path, number] (unique)
      if (!db.objectStoreNames.contains('revisions')) {
        const store = db.createObjectStore('revisions', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('path', 'path', { unique: false })
        store.createIndex('path_number', ['path', 'number'], { unique: true })
      }

      // comments: autoIncrement id + index path (non-unique)
      if (!db.objectStoreNames.contains('comments')) {
        const store = db.createObjectStore('comments', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('path', 'path', { unique: false })
      }

      // folders: autoIncrement id + index parentId (non-unique)
      if (!db.objectStoreNames.contains('folders')) {
        const store = db.createObjectStore('folders', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('parentId', 'parentId', { unique: false })
      }

      // assets: autoIncrement id + index folderId (non-unique)
      if (!db.objectStoreNames.contains('assets')) {
        const store = db.createObjectStore('assets', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('folderId', 'folderId', { unique: false })
      }

      // meta: keyPath = key
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * トランザクションを開いて fn(tx) を実行し、complete で結果を resolve する。
 *
 * 注意: IndexedDB は microtask 境界で auto-commit するため、readwrite の
 * 原子操作では fn 内で await を挟まず同期的にリクエストを積むこと。
 */
export function tx<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode)
    let result: T
    try {
      result = fn(transaction)
    } catch (err) {
      transaction.abort()
      reject(err)
      return
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Transaction aborted'))
    transaction.onerror = () => reject(transaction.error)
  })
}

/** 単一キーでレコードを取得する。 */
export function getByKey<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

/** ストア内の全レコードを取得する。 */
export function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

/** インデックス経由で該当レコードを取得する。 */
export function getAllByIndex<T>(
  store: IDBObjectStore,
  indexName: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const idx = store.index(indexName)
    const req = idx.getAll(query)
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

/** レコードを書き込む（upsert）。 */
export function put<T>(store: IDBObjectStore, value: T): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const req = store.put(value)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** レコードを削除する。 */
export function del(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** ストアを全クリアする。 */
export function clearStore(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
