// ZIP 双方向エクスポート/インポート（design §3）。
//
// 方針（計画 task13-plan.md / 設計 §3.2〜§3.13）:
// - ローカル全データ（IndexedDB の pages/revisions/comments/folders/assets）を ZIP に書き出し、
//   ZIP から IndexedDB へ復元する。
// - IDB アクセスは idb.ts のヘルパ（tx/getAll）に限定する。生の IndexedDB API は直接触らない。
//   例外は原子フェーズの tx() の fn 内で t.objectStore(name).clear()/.put() を同期直呼びする点のみ。
// - インポートの原子性が肝: 非同期フェーズ（ZIP 読み出し・検証・組み立て）を await で読み切ってから、
//   単一の readwrite tx の中で await を挟まず clear()→put() を同期実行する。

import JSZip from 'jszip'

import { getAll, tx } from './idb'
import { LOCAL_USER } from './local-client'
import { ApiError } from './types'
import type { User } from './types'

// ---------------------------------------------------------------------------
// 定数・公開型
// ---------------------------------------------------------------------------

export const EXPORT_VERSION = 1
export const EXPORT_GENERATOR = 'janus-local-export'

/** manifest.json の形状。 */
export interface ExportManifest {
  version: number
  exportedAt: string
  pageCount: number
  assetCount: number
  generator: string
}

/** importFromZip の戻り値（実インポート数）。 */
export interface ImportResult {
  pageCount: number
  assetCount: number
}

/** 進捗コールバック（任意）。UI（タスク15）がテキスト表示に使う。 */
export type ProgressCallback = (message: string) => void

// ---------------------------------------------------------------------------
// IDB レコード形状（local-client.ts の非公開内部型と同形状をローカル再宣言）。
// ---------------------------------------------------------------------------

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

interface IDBRevision {
  id: number
  path: string
  number: number
  title: string
  body: string
  author: User
  created_at: string
}

/** 書き込み前の revision（id は autoIncrement で採番される）。 */
type IDBRevisionInput = Omit<IDBRevision, 'id'>

interface IDBComment {
  id: number
  path: string
  body: string
  author: User
  created_at: string
  updated_at: string
}

/** 書き込み前の comment（id は autoIncrement で採番される）。 */
type IDBCommentInput = Omit<IDBComment, 'id'>

interface IDBFolder {
  id: number
  parentId: number | null
  name: string
  created_at: string
  updated_at: string
}

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

const PAGE_SEQ_KEY = 'page_seq'

/** 全ストア名（原子フェーズで clear→put する対象）。 */
const ALL_STORES = ['pages', 'revisions', 'comments', 'folders', 'assets', 'meta'] as const

// ---------------------------------------------------------------------------
// ZIP 内 JSON の形状（エクスポート出力・インポート入力）。
// ---------------------------------------------------------------------------

interface ExportedAuthor {
  id: number
  username: string
  is_staff: boolean
  is_superuser: boolean
}

interface ExportedRevision {
  number: number
  title: string
  body: string
  author: ExportedAuthor
  created_at: string
}

interface ExportedComment {
  body: string
  author: ExportedAuthor
  created_at: string
  updated_at: string
}

interface ExportedPage {
  path: string
  title: string
  body: string
  created_at: string
  updated_at: string
  revisions: ExportedRevision[]
  comments: ExportedComment[]
}

interface ExportedFolder {
  id: number
  parentId: number | null
  name: string
}

interface ExportedAssetMeta {
  id: number
  folderId: number | null
  filename: string
  alias: string
  content_type: string
}

// ---------------------------------------------------------------------------
// 純粋関数（IDB 非依存・単体テスト対象）
// ---------------------------------------------------------------------------

/**
 * ページパスを ZIP 内ファイル名へエンコードする（design §3.4）。
 * ルート '/' → '_root_'、先頭 '/' を除去、残りの '/' → '%2F'。
 */
export function encodePagePath(path: string): string {
  if (path === '/') {
    return '_root_'
  }
  const stripped = path.startsWith('/') ? path.slice(1) : path
  return stripped.replace(/\//g, '%2F')
}

/** encodePagePath の逆変換（round-trip）。 */
export function decodePagePath(encoded: string): string {
  if (encoded === '_root_') {
    return '/'
  }
  const decoded = encoded.replace(/%2F/g, '/')
  return '/' + decoded
}

/**
 * ファイル名から拡張子（ドット無し・原文の大小文字そのまま）を返す。
 * ドットが無い / 末尾がドットの場合は 'bin'。
 */
export function extForFilename(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) {
    return 'bin'
  }
  return filename.slice(dot + 1)
}

/**
 * author を正規化する（design §3.4 の補完ルール）。
 * 欠落 / null / 文字列 / User 形状でないオブジェクトは LOCAL_USER。
 * ローカルは常に単一ユーザーのため、User 形状でも LOCAL_USER に倒す。
 */
export function normalizeAuthor(author: unknown): User {
  if (author !== null && typeof author === 'object') {
    const a = author as Record<string, unknown>
    if (
      typeof a.id === 'number' &&
      typeof a.username === 'string' &&
      typeof a.is_staff === 'boolean' &&
      typeof a.is_superuser === 'boolean'
    ) {
      // 形状は満たすが、ローカルは単一ユーザーのため LOCAL_USER に一本化する（§4.2）。
      return LOCAL_USER
    }
  }
  return LOCAL_USER
}

/**
 * folders.json の生レコードから、1 始まり昇順の新 ID へ振り直した
 * IDBFolder 配列と、旧 ID → 新 ID のマッピングを返す（design §3.6）。
 * parentId も新 ID へ付け替える（親がマップに無ければ null）。
 */
export function remapFolders(rawFolders: ExportedFolder[]): {
  records: IDBFolder[]
  idMap: Map<number, number>
} {
  const sorted = [...rawFolders].sort((a, b) => a.id - b.id)
  const idMap = new Map<number, number>()
  sorted.forEach((folder, index) => {
    idMap.set(folder.id, index + 1)
  })

  const now = new Date().toISOString()
  const records: IDBFolder[] = sorted.map((folder, index) => ({
    id: index + 1,
    parentId:
      folder.parentId === null ? null : idMap.get(folder.parentId) ?? null,
    name: folder.name,
    created_at: now,
    updated_at: now,
  }))

  return { records, idMap }
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

/**
 * IndexedDB 全データを ZIP の Blob として生成する（design §3.2〜§3.7）。
 * DOM 副作用（ダウンロード）は downloadZip 側に分離する。
 */
export async function exportToZip(
  db: IDBDatabase,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  // 5 ストアを単一 readonly tx でスナップショット一貫性を保って読み出す。
  const [pages, revisions, comments, folders, assets] = await tx(
    db,
    ['pages', 'revisions', 'comments', 'folders', 'assets'],
    'readonly',
    (t) =>
      Promise.all([
        getAll<IDBPage>(t.objectStore('pages')),
        getAll<IDBRevision>(t.objectStore('revisions')),
        getAll<IDBComment>(t.objectStore('comments')),
        getAll<IDBFolder>(t.objectStore('folders')),
        getAll<IDBAsset>(t.objectStore('assets')),
      ]),
  )

  const zip = new JSZip()

  // revisions / comments を path でグルーピングする。
  const revByPath = new Map<string, IDBRevision[]>()
  for (const rev of revisions) {
    const list = revByPath.get(rev.path) ?? []
    list.push(rev)
    revByPath.set(rev.path, list)
  }
  const comByPath = new Map<string, IDBComment[]>()
  for (const com of comments) {
    const list = comByPath.get(com.path) ?? []
    list.push(com)
    comByPath.set(com.path, list)
  }

  // ページ JSON（id / created_by / updated_by は含めない）。
  for (const page of pages) {
    const pageRevisions = (revByPath.get(page.path) ?? [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((rev) => ({
        number: rev.number,
        title: rev.title,
        body: rev.body,
        author: rev.author,
        created_at: rev.created_at,
      }))
    const pageComments = (comByPath.get(page.path) ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((com) => ({
        body: com.body,
        author: com.author,
        created_at: com.created_at,
        updated_at: com.updated_at,
      }))

    const exported: ExportedPage = {
      path: page.path,
      title: page.title,
      body: page.body,
      created_at: page.created_at,
      updated_at: page.updated_at,
      revisions: pageRevisions,
      comments: pageComments,
    }
    zip.file(`pages/${encodePagePath(page.path)}.json`, JSON.stringify(exported, null, 2))
  }

  // アセット（バイナリは非圧縮 STORE で格納）＋メタ JSON。
  let assetIndex = 0
  for (const asset of assets) {
    assetIndex += 1
    onProgress?.(`エクスポート中… (${assetIndex}/${assets.length})`)
    const ext = extForFilename(asset.filename)
    zip.file(`assets/${asset.id}.${ext}`, asset.blob, { compression: 'STORE' })
    const meta: ExportedAssetMeta = {
      id: asset.id,
      folderId: asset.folderId,
      filename: asset.filename,
      alias: asset.alias,
      content_type: asset.content_type,
    }
    zip.file(`assets/${asset.id}.meta.json`, JSON.stringify(meta, null, 2))
  }

  // folders.json。
  const exportedFolders: ExportedFolder[] = folders.map((f) => ({
    id: f.id,
    parentId: f.parentId,
    name: f.name,
  }))
  zip.file('folders.json', JSON.stringify(exportedFolders, null, 2))

  // manifest.json。
  const manifest: ExportManifest = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    pageCount: pages.length,
    assetCount: assets.length,
    generator: EXPORT_GENERATOR,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return zip.generateAsync({ type: 'blob' })
}

/** 'janus-export-YYYYMMDD-HHmmss.zip' を返す（ローカル時刻・ゼロ埋め）。 */
export function makeExportFilename(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const y = now.getFullYear()
  const mo = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const h = pad(now.getHours())
  const mi = pad(now.getMinutes())
  const s = pad(now.getSeconds())
  return `janus-export-${y}${mo}${d}-${h}${mi}${s}.zip`
}

/** Blob を <a download> でダウンロードさせる（DOM 副作用）。 */
export function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** exportToZip → makeExportFilename → downloadZip をまとめた UI 向け粒度。 */
export async function exportAndDownload(
  db: IDBDatabase,
  onProgress?: ProgressCallback,
): Promise<void> {
  const blob = await exportToZip(db, onProgress)
  downloadZip(blob, makeExportFilename())
}

// ---------------------------------------------------------------------------
// インポート
// ---------------------------------------------------------------------------

/**
 * ZIP から IndexedDB へ全データを復元する（design §3.8）。
 * 確認ダイアログと location.reload は UI（タスク15）側の責務。本関数は
 * version 検証 + データ検証 + 原子的なデータ復元のみを行う。
 */
export async function importFromZip(
  db: IDBDatabase,
  file: Blob | File,
  onProgress?: ProgressCallback,
): Promise<ImportResult> {
  // --- ステップ 2: ZIP 展開 ---
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new ApiError(400, 'ZIP ファイルを読み込めませんでした')
  }

  // --- ステップ 2-3: manifest 検証 ---
  const manifestFile = zip.file('manifest.json')
  if (manifestFile === null) {
    throw new ApiError(400, 'Janus エクスポートファイルではありません')
  }
  let manifest: ExportManifest
  try {
    manifest = JSON.parse(await manifestFile.async('string')) as ExportManifest
  } catch {
    throw new ApiError(400, 'Janus エクスポートファイルではありません')
  }
  if (typeof manifest.version !== 'number') {
    throw new ApiError(400, 'Janus エクスポートファイルではありません')
  }
  if (manifest.version > EXPORT_VERSION) {
    throw new ApiError(
      400,
      'このファイルは新しいバージョンの Janus で作成されたため読み込めません',
    )
  }

  // --- ステップ 5: 全エントリをメモリへ読み切る（非同期フェーズ）---
  onProgress?.('読み込み中…')

  // folders.json → 新 ID 振り直し + マッピング。
  const foldersFile = zip.file('folders.json')
  const rawFolders: ExportedFolder[] = foldersFile
    ? (JSON.parse(await foldersFile.async('string')) as ExportedFolder[])
    : []
  const { records: folderRecords, idMap: folderIdMap } = remapFolders(rawFolders)

  // ページ JSON 全件。
  const pageFiles = zip.file(/^pages\/.+\.json$/)
  const parsedPages: ExportedPage[] = []
  for (const pageFile of pageFiles) {
    const parsed = JSON.parse(await pageFile.async('string')) as ExportedPage
    parsedPages.push(parsed)
  }
  // path 昇順で安定させ、1 始まりの Page.id を振る。
  parsedPages.sort((a, b) => a.path.localeCompare(b.path))

  const now = new Date().toISOString()
  const pageRecords: IDBPage[] = []
  const revisionRecords: IDBRevisionInput[] = []
  const commentRecords: IDBCommentInput[] = []

  parsedPages.forEach((page, index) => {
    const pageId = index + 1
    pageRecords.push({
      id: pageId,
      path: page.path,
      title: page.title,
      body: page.body,
      created_at: page.created_at,
      updated_at: page.updated_at,
      created_by: LOCAL_USER,
      updated_by: LOCAL_USER,
    })

    // revision number の一意性検証（IDB に触れる前）。
    const seenNumbers = new Set<number>()
    for (const rev of page.revisions ?? []) {
      if (seenNumbers.has(rev.number)) {
        throw new ApiError(400, 'エクスポートファイルのリビジョン番号が不正です')
      }
      seenNumbers.add(rev.number)
      revisionRecords.push({
        path: page.path,
        number: rev.number,
        title: rev.title,
        body: rev.body,
        author: normalizeAuthor(rev.author),
        created_at: rev.created_at,
      })
    }

    for (const com of page.comments ?? []) {
      commentRecords.push({
        path: page.path,
        body: com.body,
        author: normalizeAuthor(com.author),
        created_at: com.created_at,
        updated_at: com.updated_at,
      })
    }
  })

  // アセット: meta JSON 全件 → バイナリ Blob を取得 → 新 ID 振り直し + folderId 付け替え。
  const metaFiles = zip.file(/^assets\/.+\.meta\.json$/)
  const parsedMetas: ExportedAssetMeta[] = []
  for (const metaFile of metaFiles) {
    parsedMetas.push(JSON.parse(await metaFile.async('string')) as ExportedAssetMeta)
  }
  parsedMetas.sort((a, b) => a.id - b.id)

  const assetRecords: IDBAsset[] = []
  for (let i = 0; i < parsedMetas.length; i += 1) {
    const meta = parsedMetas[i]
    const ext = extForFilename(meta.filename)
    const binFile = zip.file(`assets/${meta.id}.${ext}`)
    if (binFile === null) {
      // メタはあるがバイナリが無い壊れた ZIP。
      throw new ApiError(400, 'ZIP ファイルを読み込めませんでした')
    }
    const blob = await binFile.async('blob')
    const folderId =
      meta.folderId === null ? null : folderIdMap.get(meta.folderId) ?? null
    assetRecords.push({
      id: i + 1,
      folderId,
      filename: meta.filename,
      alias: meta.alias,
      blob,
      content_type: meta.content_type,
      created_at: now,
      updated_at: now,
    })
  }

  const maxPageId = pageRecords.length
  onProgress?.('復元中…')

  // --- ステップ 6: 単一 readwrite tx で同期書き込み（原子フェーズ）---
  // fn 内では await を一切挟まない。clear()→put() を同期的に積む。
  try {
    await tx(db, [...ALL_STORES], 'readwrite', (t) => {
      for (const name of ALL_STORES) {
        t.objectStore(name).clear()
      }
      const pageStore = t.objectStore('pages')
      for (const rec of pageRecords) {
        pageStore.put(rec)
      }
      const revStore = t.objectStore('revisions')
      for (const rec of revisionRecords) {
        revStore.put(rec)
      }
      const comStore = t.objectStore('comments')
      for (const rec of commentRecords) {
        comStore.put(rec)
      }
      const folderStore = t.objectStore('folders')
      for (const rec of folderRecords) {
        folderStore.put(rec)
      }
      const assetStore = t.objectStore('assets')
      for (const rec of assetRecords) {
        assetStore.put(rec)
      }
      t.objectStore('meta').put({ key: PAGE_SEQ_KEY, value: maxPageId })
    })
  } catch {
    // 容量超過等。自動ロールバックで既存データは保持される。
    throw new ApiError(500, 'インポートに失敗しました。既存データは保持されています。')
  }

  // --- ステップ 7: 件数照合（不一致は警告・致命エラーにしない）---
  const importedPageCount = pageRecords.length
  const importedAssetCount = assetRecords.length
  if (
    typeof manifest.pageCount === 'number' &&
    manifest.pageCount !== importedPageCount
  ) {
    onProgress?.(
      `警告: ページ数が manifest (${manifest.pageCount}) と一致しません (${importedPageCount})`,
    )
  }
  if (
    typeof manifest.assetCount === 'number' &&
    manifest.assetCount !== importedAssetCount
  ) {
    onProgress?.(
      `警告: アセット数が manifest (${manifest.assetCount}) と一致しません (${importedAssetCount})`,
    )
  }

  return { pageCount: importedPageCount, assetCount: importedAssetCount }
}
