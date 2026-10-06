// IndexedDB ベースの StorageClient 実装（ローカル専用モード・design §4）。
//
// 方針:
// - サーバー無し。IndexedDB が唯一の保存先。RestClient と同一の StorageClient 契約を満たす。
// - 認証・権限はローカル単一ユーザー想定: 常に LOCAL_USER として全権限を許可する。
// - IDB アクセスは idb.ts のヘルパ（openDb/tx/getByKey/getAll/getAllByIndex/put/del）に限定し、
//   生の IndexedDB API は直接触らない。
// - readwrite tx の fn 内では await を挟まない（IDB は microtask 境界で auto-commit するため）。
//   read-then-write が必要な処理は「readonly tx で読む → readwrite tx で書く」の 2 段構成にする。
//   単一ユーザー・ローカルのため read と write の間の競合窓は実質問題にならない。

import { computeDiff } from './diff-revisions'
import { getAll, getAllByIndex, getByKey, openDb, put, tx, del } from './idb'
import { buildPageTree } from './page-tree-build'
import { normalizePath } from './path-normalize'
import { ApiError } from './types'
import type {
  Asset,
  AssetRef,
  Comment,
  DiffLine,
  EffectivePermission,
  Folder,
  Page,
  PageSummary,
  PageTreeNode,
  PermissionEntry,
  Revision,
  RevisionSummary,
  SearchHit,
  StorageClient,
  User,
} from './types'

/** ローカルモードの単一ユーザー。全権限を持つ扱いにする。 */
export const LOCAL_USER: User = {
  id: 1,
  username: 'local',
  is_staff: true,
  is_superuser: true,
}

// ---------------------------------------------------------------------------
// IDB レコード形状（内部型・非公開）。idb.ts の各ストアに対応する。
// ---------------------------------------------------------------------------

/** IDB pages ストアのレコード形状（keyPath=path）。 */
interface IDBPage {
  id: number
  path: string
  title: string
  body: string
  created_at: string
  updated_at: string
  created_by: User
  updated_by: User
}

/** IDB revisions ストアのレコード形状（id=autoIncrement）。 */
interface IDBRevision {
  id: number
  path: string
  number: number
  title: string
  body: string
  author: User
  created_at: string
}

/** 書き込み前の revision レコード（id は autoIncrement で採番される）。 */
type IDBRevisionInput = Omit<IDBRevision, 'id'>

/** IDB comments ストアのレコード形状（id=autoIncrement）。 */
interface IDBComment {
  id: number
  path: string
  body: string
  author: User
  created_at: string
  updated_at: string
}

/** IDB folders ストアのレコード形状（id=autoIncrement）。 */
interface IDBFolder {
  id: number
  parentId: number | null
  name: string
  created_at: string
  updated_at: string
}

/** IDB assets ストアのレコード形状（id=autoIncrement・blob は Blob/File）。 */
interface IDBAsset {
  id: number
  folderId: number | null
  filename: string
  alias: string
  blob: Blob
  content_type: string
  created_at: string
  updated_at: string
}

/** meta ストアの page_seq カウンタレコード。 */
interface MetaSeq {
  key: string
  value: number
}

const PAGE_SEQ_KEY = 'page_seq'

export class LocalClient implements StorageClient {
  /** 遅延オープンした DB。初回アクセス時に openDb() を 1 度だけ呼ぶ。 */
  private dbPromise: Promise<IDBDatabase> | null = null

  /** DB を一度だけ開き、以降は同じ Promise を返す。 */
  private ensureDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb()
    }
    return this.dbPromise
  }

  /** ISO 8601 のタイムスタンプを返す。 */
  private now(): string {
    return new Date().toISOString()
  }

  // -------------------------------------------------------------------------
  // AuthClient — ローカルは常に LOCAL_USER
  // -------------------------------------------------------------------------

  login(username: string, password: string): Promise<{ token: string; user: User }> {
    // ローカルは認証不要。シグネチャは契約（design 4 章）に忠実に保つ。
    void username
    void password
    return Promise.resolve({ token: 'local', user: LOCAL_USER })
  }

  logout(): Promise<void> {
    return Promise.resolve()
  }

  currentUser(): Promise<User | null> {
    return Promise.resolve(LOCAL_USER)
  }

  // -------------------------------------------------------------------------
  // PermissionClient — ローカルは全権限許可のダミー
  // -------------------------------------------------------------------------

  getEffectivePermission(path: string): Promise<EffectivePermission> {
    void path
    return Promise.resolve({ view: true, edit: true })
  }

  listPermissions(path: string): Promise<PermissionEntry[]> {
    void path
    return Promise.resolve([])
  }

  grantPermission(input: {
    path: string
    principalType: 'user' | 'group'
    principalId: number
    action: 'view' | 'edit'
    effect: 'allow' | 'deny'
  }): Promise<PermissionEntry> {
    return Promise.resolve({
      id: 0,
      path: input.path,
      principalType: input.principalType,
      principalId: input.principalId,
      action: input.action,
      effect: input.effect,
    })
  }

  updatePermission(id: number, effect: 'allow' | 'deny'): Promise<PermissionEntry> {
    return Promise.resolve({
      id,
      path: '/',
      principalType: 'user',
      principalId: 0,
      action: 'view',
      effect,
    })
  }

  revokePermission(id: number): Promise<void> {
    void id
    return Promise.resolve()
  }

  // -------------------------------------------------------------------------
  // SearchClient — フェーズ 4 で実装
  // -------------------------------------------------------------------------

  search(query: string): Promise<SearchHit[]> {
    void query
    throw new Error('search() はフェーズ 4 で実装します')
  }

  // -------------------------------------------------------------------------
  // PageClient
  // -------------------------------------------------------------------------

  async getPage(path: string): Promise<Page | null> {
    const norm = normalizePath(path)
    const db = await this.ensureDb()
    const record = await tx(db, 'pages', 'readonly', (t) =>
      getByKey<IDBPage>(t.objectStore('pages'), norm),
    )
    if (record === undefined) {
      return null
    }
    return this.toPage(record)
  }

  async listChildren(parentPath: string): Promise<PageSummary[]> {
    const norm = normalizePath(parentPath)
    const db = await this.ensureDb()
    const all = await tx(db, 'pages', 'readonly', (t) => getAll<IDBPage>(t.objectStore('pages')))

    const prefix = norm === '/' ? '/' : norm + '/'
    const children = all.filter((page) => {
      if (!page.path.startsWith(prefix)) return false
      const rest = page.path.slice(prefix.length)
      // 直下のみ: 残りにスラッシュを含まず、かつ空でない。
      return rest.length > 0 && !rest.includes('/')
    })

    children.sort((a, b) => a.path.localeCompare(b.path))
    return children.map((page) => ({ path: page.path, title: page.title }))
  }

  async getPageTree(root: string = '/'): Promise<PageTreeNode[]> {
    const db = await this.ensureDb()
    const all = await tx(db, 'pages', 'readonly', (t) => getAll<IDBPage>(t.objectStore('pages')))
    const mapped = all.map((page) => ({ path: page.path, title: page.title }))
    return buildPageTree(mapped, root)
  }

  async createPage(input: { path: string; title?: string; body: string }): Promise<Page> {
    const norm = normalizePath(input.path)
    const db = await this.ensureDb()

    // 重複チェック（readonly tx で先読み）。
    const existing = await tx(db, 'pages', 'readonly', (t) =>
      getByKey<IDBPage>(t.objectStore('pages'), norm),
    )
    if (existing !== undefined) {
      throw new ApiError(409, 'ページは既に存在します')
    }

    // 連番 id の採番（meta.page_seq を先読み）。
    const seqRec = await tx(db, 'meta', 'readonly', (t) =>
      getByKey<MetaSeq>(t.objectStore('meta'), PAGE_SEQ_KEY),
    )
    const nextId = (seqRec?.value ?? 0) + 1

    const timestamp = this.now()
    const title = input.title ?? norm.split('/').pop() ?? norm
    const page: IDBPage = {
      id: nextId,
      path: norm,
      title,
      body: input.body,
      created_at: timestamp,
      updated_at: timestamp,
      created_by: LOCAL_USER,
      updated_by: LOCAL_USER,
    }
    const revision: IDBRevisionInput = {
      path: norm,
      number: 1,
      title,
      body: input.body,
      author: LOCAL_USER,
      created_at: timestamp,
    }

    // ページ・リビジョン・連番を単一 readwrite tx で書き込む（fn 内で await しない）。
    await tx(db, ['pages', 'revisions', 'meta'], 'readwrite', (t) => {
      put(t.objectStore('pages'), page)
      put(t.objectStore('revisions'), revision)
      put(t.objectStore('meta'), { key: PAGE_SEQ_KEY, value: nextId })
    })

    return this.toPage(page)
  }

  async updatePage(path: string, input: { title?: string; body: string }): Promise<Page> {
    const norm = normalizePath(path)
    const db = await this.ensureDb()

    const existing = await tx(db, 'pages', 'readonly', (t) =>
      getByKey<IDBPage>(t.objectStore('pages'), norm),
    )
    if (existing === undefined) {
      throw new ApiError(404, 'ページが見つかりません')
    }

    const revisions = await tx(db, 'revisions', 'readonly', (t) =>
      getAllByIndex<IDBRevision>(t.objectStore('revisions'), 'path', norm),
    )
    const latestRev = revisions.sort((a, b) => b.number - a.number)[0]

    const newTitle = input.title ?? existing.title
    const bodyChanged = !latestRev || latestRev.body !== input.body
    const titleChanged = newTitle !== existing.title

    // 本文もタイトルも変化なし → 何も触らず現状を返す。
    if (!bodyChanged && !titleChanged) {
      return this.toPage(existing)
    }

    const timestamp = this.now()
    const updatedPage: IDBPage = {
      ...existing,
      title: newTitle,
      updated_at: timestamp,
      updated_by: LOCAL_USER,
    }

    let newRevision: IDBRevisionInput | null = null
    if (bodyChanged) {
      updatedPage.body = input.body
      const maxNumber = latestRev?.number ?? 0
      newRevision = {
        path: norm,
        number: maxNumber + 1,
        title: newTitle,
        body: input.body,
        author: LOCAL_USER,
        created_at: timestamp,
      }
    }

    await tx(db, ['pages', 'revisions'], 'readwrite', (t) => {
      put(t.objectStore('pages'), updatedPage)
      if (newRevision) {
        put(t.objectStore('revisions'), newRevision)
      }
    })

    return this.toPage(updatedPage)
  }

  async deletePage(path: string): Promise<void> {
    const norm = normalizePath(path)
    const db = await this.ensureDb()

    // 削除対象の revision/comment の id を先読みする。
    const revisions = await tx(db, 'revisions', 'readonly', (t) =>
      getAllByIndex<IDBRevision>(t.objectStore('revisions'), 'path', norm),
    )
    const comments = await tx(db, 'comments', 'readonly', (t) =>
      getAllByIndex<IDBComment>(t.objectStore('comments'), 'path', norm),
    )

    await tx(db, ['pages', 'revisions', 'comments'], 'readwrite', (t) => {
      del(t.objectStore('pages'), norm)
      const revStore = t.objectStore('revisions')
      for (const rev of revisions) {
        del(revStore, rev.id)
      }
      const comStore = t.objectStore('comments')
      for (const com of comments) {
        del(comStore, com.id)
      }
    })
  }

  async listRevisions(
    path: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<RevisionSummary[]> {
    const norm = normalizePath(path)
    const db = await this.ensureDb()
    const all = await tx(db, 'revisions', 'readonly', (t) =>
      getAllByIndex<IDBRevision>(t.objectStore('revisions'), 'path', norm),
    )
    all.sort((a, b) => b.number - a.number)

    const offset = opts?.offset ?? 0
    const limit = opts?.limit ?? all.length
    const sliced = all.slice(offset, offset + limit)

    return sliced.map((rev) => ({
      id: rev.id,
      number: rev.number,
      created_at: rev.created_at,
      author: LOCAL_USER,
    }))
  }

  async getRevision(path: string, number: number): Promise<Revision> {
    const norm = normalizePath(path)
    const db = await this.ensureDb()
    const results = await tx(db, 'revisions', 'readonly', (t) =>
      getAllByIndex<IDBRevision>(t.objectStore('revisions'), 'path_number', [norm, number]),
    )
    const rev = results[0]
    if (rev === undefined) {
      throw new ApiError(404, 'リビジョンが見つかりません')
    }
    return {
      id: rev.id,
      number: rev.number,
      created_at: rev.created_at,
      author: LOCAL_USER,
      body: rev.body,
      title: rev.title,
    }
  }

  async diffRevisions(path: string, from: number, to: number): Promise<DiffLine[]> {
    const fromRev = await this.getRevision(path, from)
    const toRev = await this.getRevision(path, to)
    return computeDiff(fromRev.body, toRev.body)
  }

  async restoreRevision(path: string, number: number): Promise<Page> {
    const rev = await this.getRevision(path, number)
    return this.updatePage(path, { title: rev.title, body: rev.body })
  }

  /** IDB レコードを Page 型へ写像する。 */
  private toPage(record: IDBPage): Page {
    return {
      id: record.id,
      path: record.path,
      title: record.title,
      body: record.body,
      created_at: record.created_at,
      updated_at: record.updated_at,
      created_by: record.created_by,
      updated_by: record.updated_by,
    }
  }

  // -------------------------------------------------------------------------
  // CommentClient
  // -------------------------------------------------------------------------

  async listComments(path: string): Promise<Comment[]> {
    const norm = normalizePath(path)
    const db = await this.ensureDb()
    const all = await tx(db, 'comments', 'readonly', (t) =>
      getAllByIndex<IDBComment>(t.objectStore('comments'), 'path', norm),
    )
    all.sort((a, b) => a.created_at.localeCompare(b.created_at))
    return all.map((com) => ({
      id: com.id,
      body: com.body,
      author: LOCAL_USER,
      created_at: com.created_at,
      updated_at: com.updated_at,
    }))
  }

  async addComment(path: string, body: string): Promise<Comment> {
    if (body.trim() === '') {
      throw new ApiError(400, 'コメント本文が空です')
    }
    const norm = normalizePath(path)
    const db = await this.ensureDb()
    const timestamp = this.now()
    const record: Omit<IDBComment, 'id'> = {
      path: norm,
      body,
      author: LOCAL_USER,
      created_at: timestamp,
      updated_at: timestamp,
    }
    const id = await tx(db, 'comments', 'readwrite', (t) =>
      put(t.objectStore('comments'), record),
    )
    return {
      id: id as number,
      body,
      author: LOCAL_USER,
      created_at: timestamp,
      updated_at: timestamp,
    }
  }

  async updateComment(id: number, body: string): Promise<Comment> {
    if (body.trim() === '') {
      throw new ApiError(400, 'コメント本文が空です')
    }
    const db = await this.ensureDb()
    const existing = await tx(db, 'comments', 'readonly', (t) =>
      getByKey<IDBComment>(t.objectStore('comments'), id),
    )
    if (existing === undefined) {
      throw new ApiError(404, 'コメントが見つかりません')
    }
    const timestamp = this.now()
    const updated: IDBComment = { ...existing, body, updated_at: timestamp }
    await tx(db, 'comments', 'readwrite', (t) => {
      put(t.objectStore('comments'), updated)
    })
    return {
      id,
      body,
      author: LOCAL_USER,
      created_at: existing.created_at,
      updated_at: timestamp,
    }
  }

  async deleteComment(id: number): Promise<void> {
    const db = await this.ensureDb()
    await tx(db, 'comments', 'readwrite', (t) => {
      del(t.objectStore('comments'), id)
    })
  }

  // -------------------------------------------------------------------------
  // AssetClient
  // -------------------------------------------------------------------------

  async listFolders(parentFolderId: number | null): Promise<Folder[]> {
    const db = await this.ensureDb()
    let folders: IDBFolder[]
    if (parentFolderId === null) {
      // IDB インデックスは null キーを採らないため全件取得して絞り込む。
      const all = await tx(db, 'folders', 'readonly', (t) =>
        getAll<IDBFolder>(t.objectStore('folders')),
      )
      folders = all.filter((f) => f.parentId === null)
    } else {
      folders = await tx(db, 'folders', 'readonly', (t) =>
        getAllByIndex<IDBFolder>(t.objectStore('folders'), 'parentId', parentFolderId),
      )
    }
    folders.sort((a, b) => a.created_at.localeCompare(b.created_at))
    return folders.map((f) => ({
      id: f.id,
      parentId: f.parentId,
      name: f.name,
      created_at: f.created_at,
      updated_at: f.updated_at,
    }))
  }

  async createFolder(input: { parentId: number | null; name: string }): Promise<Folder> {
    const db = await this.ensureDb()
    const siblings = await this.listFolders(input.parentId)
    if (siblings.some((f) => f.name === input.name)) {
      throw new ApiError(409, '同名フォルダが既に存在します')
    }
    const timestamp = this.now()
    const record: Omit<IDBFolder, 'id'> = {
      parentId: input.parentId,
      name: input.name,
      created_at: timestamp,
      updated_at: timestamp,
    }
    const id = await tx(db, 'folders', 'readwrite', (t) =>
      put(t.objectStore('folders'), record),
    )
    return {
      id: id as number,
      parentId: input.parentId,
      name: input.name,
      created_at: timestamp,
      updated_at: timestamp,
    }
  }

  async listAssets(folderId: number | null): Promise<Asset[]> {
    const db = await this.ensureDb()
    let assets: IDBAsset[]
    if (folderId === null) {
      const all = await tx(db, 'assets', 'readonly', (t) =>
        getAll<IDBAsset>(t.objectStore('assets')),
      )
      assets = all.filter((a) => a.folderId === null)
    } else {
      assets = await tx(db, 'assets', 'readonly', (t) =>
        getAllByIndex<IDBAsset>(t.objectStore('assets'), 'folderId', folderId),
      )
    }
    assets.sort((a, b) => a.created_at.localeCompare(b.created_at))
    return assets.map((a) => this.toAsset(a))
  }

  async uploadAsset(input: {
    folderId: number | null
    file: File
    alias?: string
  }): Promise<Asset> {
    const db = await this.ensureDb()
    const existing = await this.listAssets(input.folderId)
    if (existing.some((a) => a.filename === input.file.name)) {
      throw new ApiError(409, '同名ファイルが既に存在します')
    }
    const alias = input.alias ?? ''
    if (alias && existing.some((a) => a.alias === alias)) {
      throw new ApiError(409, '同じエイリアスのファイルが既に存在します')
    }
    const timestamp = this.now()
    const record: Omit<IDBAsset, 'id'> = {
      folderId: input.folderId,
      filename: input.file.name,
      alias,
      blob: input.file,
      content_type: input.file.type,
      created_at: timestamp,
      updated_at: timestamp,
    }
    const id = await tx(db, 'assets', 'readwrite', (t) =>
      put(t.objectStore('assets'), record),
    )
    return {
      id: id as number,
      folderId: input.folderId,
      filename: input.file.name,
      alias,
      url: '',
      content_type: input.file.type,
      created_at: timestamp,
      updated_at: timestamp,
    }
  }

  async moveAsset(assetId: number, toFolderId: number | null): Promise<Asset> {
    const db = await this.ensureDb()
    const existing = await tx(db, 'assets', 'readonly', (t) =>
      getByKey<IDBAsset>(t.objectStore('assets'), assetId),
    )
    if (existing === undefined) {
      throw new ApiError(404, 'アセットが見つかりません')
    }
    const updated: IDBAsset = {
      ...existing,
      folderId: toFolderId,
      updated_at: this.now(),
    }
    await tx(db, 'assets', 'readwrite', (t) => {
      put(t.objectStore('assets'), updated)
    })
    return this.toAsset(updated)
  }

  async getAssetFileUrl(asset: Asset): Promise<string> {
    const db = await this.ensureDb()
    const record = await tx(db, 'assets', 'readonly', (t) =>
      getByKey<IDBAsset>(t.objectStore('assets'), asset.id),
    )
    if (record === undefined) {
      throw new ApiError(404, 'アセットが見つかりません')
    }
    return URL.createObjectURL(record.blob)
  }

  releaseAssetFileUrl(url: string): void {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }

  async resolveAssetUrl(ref: AssetRef): Promise<string | null> {
    const baseSegments = this.folderSegments(ref.baseFolderPath)
    const folderCache = new Map<string, number | null | undefined>()

    const resolveFolder = async (segs: string[]): Promise<number | null | undefined> => {
      const key = segs.join('/')
      if (folderCache.has(key)) return folderCache.get(key)
      const folderId = await this.findFolderId(segs)
      folderCache.set(key, folderId)
      return folderId
    }

    for (const specifier of ref.specifiers) {
      const value = specifier.value.trim()
      if (!value) continue
      const slash = value.lastIndexOf('/')
      const name = slash >= 0 ? value.slice(slash + 1) : value
      if (!name) continue
      const folderSegs =
        slash >= 0
          ? this.folderSegments(value.slice(0, slash), value.startsWith('/') ? [] : baseSegments)
          : baseSegments
      const folderId = await resolveFolder(folderSegs)
      if (folderId === undefined) continue
      const assets = await this.listAssets(folderId)
      const asset = assets.find((candidate) =>
        specifier.kind === 'filename'
          ? candidate.filename === name
          : candidate.alias === name,
      )
      if (asset !== undefined) {
        return this.getAssetFileUrl(asset)
      }
    }
    return null
  }

  /** IDB アセットレコードを Asset 型へ写像する（url は常に空）。 */
  private toAsset(record: IDBAsset): Asset {
    return {
      id: record.id,
      folderId: record.folderId,
      filename: record.filename,
      alias: record.alias,
      url: '',
      content_type: record.content_type,
      created_at: record.created_at,
      updated_at: record.updated_at,
    }
  }

  /** パスを正規化し、基準フォルダからの相対パスまたはルートからの絶対パスにする。 */
  private folderSegments(path: string | undefined, base: string[] = []): string[] {
    const value = (path ?? '').trim()
    const segments = value.startsWith('/') ? [] : [...base]
    for (const segment of value.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        segments.pop()
      } else {
        segments.push(segment)
      }
    }
    return segments
  }

  /** フォルダ木をセグメント順に辿って ID を解決する。見つからない場合は undefined。 */
  private async findFolderId(segments: string[]): Promise<number | null | undefined> {
    let parentId: number | null = null
    for (const segment of segments) {
      const folders = await this.listFolders(parentId)
      const folder = folders.find((candidate) => candidate.name === segment)
      if (folder === undefined) return undefined
      parentId = folder.id
    }
    return parentId
  }
}
