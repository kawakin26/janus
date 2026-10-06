import 'fake-indexeddb/auto'

import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  decodePagePath,
  encodePagePath,
  EXPORT_GENERATOR,
  EXPORT_VERSION,
  exportToZip,
  extForFilename,
  importFromZip,
  makeExportFilename,
  normalizeAuthor,
  remapFolders,
  downloadZip,
} from './export-import'
import type { ExportManifest } from './export-import'
import { openDb, tx, put, getAll } from './idb'
import { LocalClient, LOCAL_USER } from './local-client'

afterEach(() => {
  indexedDB.deleteDatabase('janus-local')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 直接 IDB にレコードを投入するヘルパ（内部形状のまま seed する）。
// ---------------------------------------------------------------------------

interface SeedPage {
  id: number
  path: string
  title: string
  body: string
  created_at: string
  updated_at: string
}

async function seed(db: IDBDatabase, data: {
  pages?: SeedPage[]
  revisions?: unknown[]
  comments?: unknown[]
  folders?: unknown[]
  assets?: unknown[]
  pageSeq?: number
}): Promise<void> {
  await tx(
    db,
    ['pages', 'revisions', 'comments', 'folders', 'assets', 'meta'],
    'readwrite',
    (t) => {
      for (const p of data.pages ?? []) {
        put(t.objectStore('pages'), {
          ...p,
          created_by: LOCAL_USER,
          updated_by: LOCAL_USER,
        })
      }
      for (const r of data.revisions ?? []) put(t.objectStore('revisions'), r)
      for (const c of data.comments ?? []) put(t.objectStore('comments'), c)
      for (const f of data.folders ?? []) put(t.objectStore('folders'), f)
      for (const a of data.assets ?? []) put(t.objectStore('assets'), a)
      if (data.pageSeq !== undefined) {
        put(t.objectStore('meta'), { key: 'page_seq', value: data.pageSeq })
      }
    },
  )
}

const ISO = '2025-01-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// 純粋関数
// ---------------------------------------------------------------------------

describe('encodePagePath / decodePagePath', () => {
  it.each([
    ['/', '_root_'],
    ['/docs', 'docs'],
    ['/docs/intro', 'docs%2Fintro'],
    ['/a/b/c', 'a%2Fb%2Fc'],
  ])('round-trip %s <-> %s', (path, encoded) => {
    expect(encodePagePath(path)).toBe(encoded)
    expect(decodePagePath(encoded)).toBe(path)
  })
})

describe('extForFilename', () => {
  it('拡張子を返す', () => {
    expect(extForFilename('floor-plan.png')).toBe('png')
    expect(extForFilename('archive.tar.gz')).toBe('gz')
  })
  it('拡張子なし / 末尾ドットは bin', () => {
    expect(extForFilename('README')).toBe('bin')
    expect(extForFilename('name.')).toBe('bin')
  })
})

describe('normalizeAuthor', () => {
  it('欠落 / null / 文字列は LOCAL_USER', () => {
    expect(normalizeAuthor(undefined)).toEqual(LOCAL_USER)
    expect(normalizeAuthor(null)).toEqual(LOCAL_USER)
    expect(normalizeAuthor('local')).toEqual(LOCAL_USER)
  })
  it('User 形状でも LOCAL_USER へ一本化', () => {
    expect(
      normalizeAuthor({ id: 9, username: 'x', is_staff: false, is_superuser: false }),
    ).toEqual(LOCAL_USER)
  })
})

describe('remapFolders', () => {
  it('1 始まり昇順の新 ID を振り、parentId を付け替える', () => {
    const { records, idMap } = remapFolders([
      { id: 10, parentId: null, name: 'photos' },
      { id: 20, parentId: 10, name: '2025-01' },
      { id: 5, parentId: null, name: 'documents' },
    ])
    // 旧 id 昇順 (5, 10, 20) に 1,2,3 を割り当て。
    expect(idMap.get(5)).toBe(1)
    expect(idMap.get(10)).toBe(2)
    expect(idMap.get(20)).toBe(3)
    const byName = Object.fromEntries(records.map((r) => [r.name, r]))
    expect(byName['photos'].id).toBe(2)
    expect(byName['photos'].parentId).toBe(null)
    expect(byName['2025-01'].id).toBe(3)
    expect(byName['2025-01'].parentId).toBe(2)
  })
})

describe('makeExportFilename', () => {
  it('固定 Date でゼロ埋め形式', () => {
    const d = new Date(2025, 0, 10, 9, 5, 3)
    expect(makeExportFilename(d)).toBe('janus-export-20250110-090503.zip')
  })
})

// ---------------------------------------------------------------------------
// エクスポート構造・内容
// ---------------------------------------------------------------------------

describe('exportToZip', () => {
  it('manifest / ページ JSON / アセット / folders.json の構造と内容', async () => {
    const db = await openDb()
    const png = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    await seed(db, {
      pages: [
        { id: 1, path: '/', title: 'Root', body: 'root body', created_at: ISO, updated_at: ISO },
        { id: 2, path: '/docs', title: 'Docs', body: 'docs body', created_at: ISO, updated_at: ISO },
      ],
      revisions: [
        { path: '/docs', number: 1, title: 'Docs', body: 'v1', author: LOCAL_USER, created_at: ISO },
        { path: '/docs', number: 2, title: 'Docs', body: 'v2', author: LOCAL_USER, created_at: ISO },
      ],
      comments: [
        { path: '/docs', body: 'nice', author: LOCAL_USER, created_at: ISO, updated_at: ISO },
      ],
      folders: [{ id: 1, parentId: null, name: 'photos', created_at: ISO, updated_at: ISO }],
      assets: [
        {
          id: 1,
          folderId: 1,
          filename: 'floor-plan.png',
          alias: '間取り図',
          blob: png,
          content_type: 'image/png',
          created_at: ISO,
          updated_at: ISO,
        },
      ],
    })

    const blob = await exportToZip(db)
    const zip = await JSZip.loadAsync(blob)

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as ExportManifest
    expect(manifest.version).toBe(EXPORT_VERSION)
    expect(manifest.generator).toBe(EXPORT_GENERATOR)
    expect(manifest.pageCount).toBe(2)
    expect(manifest.assetCount).toBe(1)

    // ページ JSON: id / created_by / updated_by は含まない。author は User。
    const docsJson = JSON.parse(await zip.file('pages/docs.json')!.async('string'))
    expect(docsJson.path).toBe('/docs')
    expect('id' in docsJson).toBe(false)
    expect('created_by' in docsJson).toBe(false)
    expect('updated_by' in docsJson).toBe(false)
    expect(docsJson.revisions).toHaveLength(2)
    expect(docsJson.revisions[0].number).toBe(1)
    expect(docsJson.revisions[0].author).toEqual(LOCAL_USER)
    expect(docsJson.comments[0].author).toEqual(LOCAL_USER)

    // ルートページは _root_.json。
    expect(zip.file('pages/_root_.json')).not.toBeNull()

    // アセットバイナリ（非圧縮 STORE）とメタ。
    // 再ロード後は options.compression が null 化されるため、内部 _data の
    // 圧縮マジック（STORE は "\x00\x00"）で非圧縮格納を確認する。
    const assetFile = zip.file('assets/1.png')!
    const compression = (assetFile as unknown as { _data: { compression: { magic: string } } })._data
      .compression
    expect(compression.magic).toBe('\x00\x00')
    const restored = new Uint8Array(await assetFile.async('arraybuffer'))
    expect(Array.from(restored)).toEqual([1, 2, 3, 4])
    const meta = JSON.parse(await zip.file('assets/1.meta.json')!.async('string'))
    expect(meta).toEqual({
      id: 1,
      folderId: 1,
      filename: 'floor-plan.png',
      alias: '間取り図',
      content_type: 'image/png',
    })

    const folders = JSON.parse(await zip.file('folders.json')!.async('string'))
    expect(folders).toEqual([{ id: 1, parentId: null, name: 'photos' }])

    db.close()
  })
})

// ---------------------------------------------------------------------------
// インポート: 全クリア → 復元 / ID マッピング
// ---------------------------------------------------------------------------

/** テスト用の有効な ZIP Blob を生成する。 */
async function buildZip(parts: {
  manifest?: Partial<ExportManifest> | null
  pages?: Record<string, unknown>[]
  folders?: unknown[]
  assets?: { meta: Record<string, unknown>; ext: string; bytes: number[] }[]
}): Promise<Blob> {
  const zip = new JSZip()
  if (parts.manifest !== null) {
    const manifest: ExportManifest = {
      version: EXPORT_VERSION,
      exportedAt: ISO,
      pageCount: parts.pages?.length ?? 0,
      assetCount: parts.assets?.length ?? 0,
      generator: EXPORT_GENERATOR,
      ...parts.manifest,
    }
    zip.file('manifest.json', JSON.stringify(manifest))
  }
  for (const page of parts.pages ?? []) {
    zip.file(`pages/${encodePagePath(page.path as string)}.json`, JSON.stringify(page))
  }
  zip.file('folders.json', JSON.stringify(parts.folders ?? []))
  for (const a of parts.assets ?? []) {
    zip.file(`assets/${a.meta.id}.${a.ext}`, new Uint8Array(a.bytes), { compression: 'STORE' })
    zip.file(`assets/${a.meta.id}.meta.json`, JSON.stringify(a.meta))
  }
  return zip.generateAsync({ type: 'blob' })
}

describe('importFromZip', () => {
  it('既存データを全クリアして ZIP 内容で置き換える', async () => {
    const db = await openDb()
    // 既存の別データを投入。
    await seed(db, {
      pages: [{ id: 1, path: '/old', title: 'Old', body: 'old', created_at: ISO, updated_at: ISO }],
    })

    const zip = await buildZip({
      pages: [
        {
          path: '/new',
          title: 'New',
          body: 'new body',
          created_at: ISO,
          updated_at: ISO,
          revisions: [{ number: 1, title: 'New', body: 'new body', author: LOCAL_USER, created_at: ISO }],
          comments: [],
        },
      ],
    })

    const result = await importFromZip(db, zip)
    expect(result).toEqual({ pageCount: 1, assetCount: 0 })

    const pages = await tx(db, 'pages', 'readonly', (t) => getAll(t.objectStore('pages')))
    expect(pages).toHaveLength(1)
    expect((pages[0] as { path: string }).path).toBe('/new')
    db.close()
  })

  it('フォルダ ID 振り直し → アセット folderId 付け替え', async () => {
    const db = await openDb()
    const zip = await buildZip({
      pages: [],
      folders: [
        { id: 7, parentId: null, name: 'photos' },
        { id: 9, parentId: 7, name: '2025-01' },
      ],
      assets: [
        { meta: { id: 3, folderId: 9, filename: 'a.png', alias: '', content_type: 'image/png' }, ext: 'png', bytes: [9, 9] },
        { meta: { id: 4, folderId: null, filename: 'b.png', alias: '', content_type: 'image/png' }, ext: 'png', bytes: [8] },
      ],
    })

    await importFromZip(db, zip)

    const folders = (await tx(db, 'folders', 'readonly', (t) => getAll(t.objectStore('folders')))) as {
      id: number
      parentId: number | null
      name: string
    }[]
    const photos = folders.find((f) => f.name === 'photos')!
    const sub = folders.find((f) => f.name === '2025-01')!
    expect(photos.id).toBe(1)
    expect(sub.id).toBe(2)
    expect(sub.parentId).toBe(1)

    const assets = (await tx(db, 'assets', 'readonly', (t) => getAll(t.objectStore('assets')))) as {
      filename: string
      folderId: number | null
    }[]
    const a = assets.find((x) => x.filename === 'a.png')!
    const b = assets.find((x) => x.filename === 'b.png')!
    expect(a.folderId).toBe(sub.id)
    expect(b.folderId).toBe(null)
    db.close()
  })
})

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

describe('importFromZip バリデーション', () => {
  it('壊れ / 非 ZIP', async () => {
    const db = await openDb()
    const notZip = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/octet-stream' })
    await expect(importFromZip(db, notZip)).rejects.toMatchObject({
      message: 'ZIP ファイルを読み込めませんでした',
    })
    db.close()
  })

  it('manifest.json 無し', async () => {
    const db = await openDb()
    const zip = new JSZip()
    zip.file('folders.json', '[]')
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(importFromZip(db, blob)).rejects.toMatchObject({
      message: 'Janus エクスポートファイルではありません',
    })
    db.close()
  })

  it('version 非互換 (>1)', async () => {
    const db = await openDb()
    const zip = await buildZip({ manifest: { version: 2 }, pages: [] })
    await expect(importFromZip(db, zip)).rejects.toMatchObject({
      message: 'このファイルは新しいバージョンの Janus で作成されたため読み込めません',
    })
    db.close()
  })

  it('revision number 重複は中断し IndexedDB を無傷に保つ', async () => {
    const db = await openDb()
    await seed(db, {
      pages: [{ id: 1, path: '/keep', title: 'Keep', body: 'keep', created_at: ISO, updated_at: ISO }],
    })

    const zip = await buildZip({
      pages: [
        {
          path: '/dup',
          title: 'Dup',
          body: 'b',
          created_at: ISO,
          updated_at: ISO,
          revisions: [
            { number: 1, title: 'a', body: 'a', author: LOCAL_USER, created_at: ISO },
            { number: 1, title: 'b', body: 'b', author: LOCAL_USER, created_at: ISO },
          ],
          comments: [],
        },
      ],
    })

    await expect(importFromZip(db, zip)).rejects.toMatchObject({
      message: 'エクスポートファイルのリビジョン番号が不正です',
    })

    // 既存データは無傷。
    const pages = (await tx(db, 'pages', 'readonly', (t) => getAll(t.objectStore('pages')))) as {
      path: string
    }[]
    expect(pages).toHaveLength(1)
    expect(pages[0].path).toBe('/keep')
    db.close()
  })
})

// ---------------------------------------------------------------------------
// round-trip
// ---------------------------------------------------------------------------

/** ZIP の論理内容（manifest の exportedAt を除く）を抽出する。 */
async function zipContents(blob: Blob): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(blob)
  const out: Record<string, string> = {}
  const names = Object.keys(zip.files).sort()
  for (const name of names) {
    const entry = zip.files[name]
    if (entry.dir) continue
    if (name === 'manifest.json') {
      const m = JSON.parse(await entry.async('string')) as ExportManifest
      const rest = { ...m }
      delete (rest as Partial<ExportManifest>).exportedAt
      out[name] = JSON.stringify(rest)
    } else if (name.endsWith('.json')) {
      out[name] = await entry.async('string')
    } else {
      out[name] = Array.from(new Uint8Array(await entry.async('arraybuffer'))).join(',')
    }
  }
  return out
}

describe('round-trip', () => {
  it('export → import → 再 export が論理等価 (manifest.exportedAt 除く)', async () => {
    const db = await openDb()
    const png = new Blob([new Uint8Array([5, 6, 7])], { type: 'image/png' })
    await seed(db, {
      pages: [
        { id: 1, path: '/', title: 'Root', body: 'r', created_at: ISO, updated_at: ISO },
        { id: 2, path: '/docs', title: 'Docs', body: 'd', created_at: ISO, updated_at: ISO },
      ],
      revisions: [
        { path: '/docs', number: 1, title: 'Docs', body: 'd', author: LOCAL_USER, created_at: ISO },
      ],
      comments: [
        { path: '/docs', body: 'c', author: LOCAL_USER, created_at: ISO, updated_at: ISO },
      ],
      folders: [{ id: 1, parentId: null, name: 'photos', created_at: ISO, updated_at: ISO }],
      assets: [
        {
          id: 1,
          folderId: 1,
          filename: 'x.png',
          alias: '',
          blob: png,
          content_type: 'image/png',
          created_at: ISO,
          updated_at: ISO,
        },
      ],
    })

    const first = await exportToZip(db)
    await importFromZip(db, first)
    const second = await exportToZip(db)

    expect(await zipContents(second)).toEqual(await zipContents(first))
    db.close()
  })

  it('復元後の型適合: author=User(id=1), page.created_by/updated_by=LOCAL_USER', async () => {
    const db = await openDb()
    const zip = await buildZip({
      pages: [
        {
          path: '/typed',
          title: 'Typed',
          body: 'body',
          created_at: ISO,
          updated_at: ISO,
          revisions: [{ number: 1, title: 'Typed', body: 'body', author: LOCAL_USER, created_at: ISO }],
          comments: [{ body: 'hi', author: LOCAL_USER, created_at: ISO, updated_at: ISO }],
        },
      ],
    })
    await importFromZip(db, zip)
    db.close()

    const client = new LocalClient()
    const page = await client.getPage('/typed')
    expect(page?.created_by).toEqual(LOCAL_USER)
    expect(page?.updated_by).toEqual(LOCAL_USER)

    const rev = await client.getRevision('/typed', 1)
    expect(rev.author).toEqual(LOCAL_USER)
    expect(rev.author?.id).toBe(1)

    const comments = await client.listComments('/typed')
    expect(comments[0].author).toEqual(LOCAL_USER)
  })

  it('author 欠落 / null / 文字列を LOCAL_USER へ補完', async () => {
    const db = await openDb()
    const zip = await buildZip({
      pages: [
        {
          path: '/backfill',
          title: 'B',
          body: 'b',
          created_at: ISO,
          updated_at: ISO,
          revisions: [
            { number: 1, title: 'B', body: 'b', created_at: ISO }, // author 欠落
            { number: 2, title: 'B', body: 'b2', author: null, created_at: ISO }, // null
            { number: 3, title: 'B', body: 'b3', author: 'legacy', created_at: ISO }, // 文字列
          ],
          comments: [{ body: 'c', author: null, created_at: ISO, updated_at: ISO }],
        },
      ],
    })
    await importFromZip(db, zip)
    db.close()

    const client = new LocalClient()
    for (const number of [1, 2, 3]) {
      const rev = await client.getRevision('/backfill', number)
      expect(rev.author).toEqual(LOCAL_USER)
    }
    const comments = await client.listComments('/backfill')
    expect(comments[0].author).toEqual(LOCAL_USER)
  })
})

// ---------------------------------------------------------------------------
// downloadZip (DOM 副作用・モック)
// ---------------------------------------------------------------------------

describe('downloadZip', () => {
  it('createObjectURL → a.click → revokeObjectURL を呼ぶ', () => {
    const click = vi.fn()
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })

    downloadZip(new Blob(['x']), 'janus-export-20250101-000000.zip')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchor.download).toBe('janus-export-20250101-000000.zip')
    expect(anchor.href).toBe('blob:fake')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})
