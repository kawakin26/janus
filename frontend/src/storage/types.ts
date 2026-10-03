// StorageClient 契約（design 4 章）とそれに連なる型定義。

// ---------------------------------------------------------------------------
// データ型（backend JSON に忠実な snake_case/camelCase）
// ---------------------------------------------------------------------------

/** ユーザー表現（login / currentUser が返す）。UserSerializer に一致。 */
export interface User {
  id: number
  username: string
  is_staff: boolean
  is_superuser: boolean
}

/** ページの詳細表現。PageSerializer に一致。 */
export interface Page {
  id: number
  path: string
  title: string
  body: string
  created_at: string
  updated_at: string
  created_by: User | null
  updated_by: User | null
}

/** ページの軽量表現（listChildren が返す）。PageSummarySerializer に一致。 */
export interface PageSummary {
  path: string
  title: string
}

/** 論理アセットフォルダ。FolderSerializer の parentId に一致。 */
export interface Folder {
  id: number
  parentId: number | null
  name: string
  created_at: string
  updated_at: string
}

/** 独立アセット。AssetSerializer の folderId に一致。 */
export interface Asset {
  id: number
  folderId: number | null
  filename: string
  alias: string
  url: string
  content_type: string
  created_at: string
  updated_at: string
}

export type AssetSpecifier =
  | { kind: 'filename'; value: string }
  | { kind: 'alias'; value: string }

/** 基準フォルダと、記法中の出現順を保持したアセット参照。 */
export interface AssetRef {
  baseFolderPath?: string
  specifiers: AssetSpecifier[]
}

/**
 * 検索ヒット（SearchClient が返す）。
 * design に厳密な定義が無いため最小形で仮定義する。フェーズ 4 で確定する。
 */
export interface SearchHit {
  path: string
  title: string
  snippet?: string
}

// ---------------------------------------------------------------------------
// 契約（interface）。design 4 章に忠実。
// ---------------------------------------------------------------------------

/** 認証契約。 */
export interface AuthClient {
  login(username: string, password: string): Promise<{ token: string; user: User }>
  logout(): Promise<void>
  currentUser(): Promise<User | null>
}

/** ページ契約。 */
export interface PageClient {
  getPage(path: string): Promise<Page | null>
  listChildren(parentPath: string): Promise<PageSummary[]>
  createPage(input: { path: string; title?: string; body: string }): Promise<Page>
  updatePage(path: string, input: { title?: string; body: string }): Promise<Page>
  deletePage(path: string): Promise<void>
}

/** 独立アセットライブラリ契約。 */
export interface AssetClient {
  listFolders(parentFolderId: number | null): Promise<Folder[]>
  createFolder(input: { parentId: number | null; name: string }): Promise<Folder>
  listAssets(folderId: number | null): Promise<Asset[]>
  uploadAsset(input: { folderId: number | null; file: File; alias?: string }): Promise<Asset>
  moveAsset(assetId: number, toFolderId: number | null): Promise<Asset>
  /** 認証付きでAsset.fileを取得し、ブラウザで表示できる一時URLを返す。 */
  getAssetFileUrl(asset: Asset): Promise<string>
  /** getAssetFileUrlが返した一時URLの所有権を解放する。 */
  releaseAssetFileUrl(url: string): void
  resolveAssetUrl(ref: AssetRef): Promise<string | null>
}

/** 検索契約（フェーズ 4 で実装。フェーズ 1 では契約のみ）。 */
export interface SearchClient {
  search(query: string): Promise<SearchHit[]>
}

/** ストレージ全体の契約（design 4 章）。 */
export interface StorageClient
  extends AuthClient,
    PageClient,
    AssetClient,
    SearchClient {}

// ---------------------------------------------------------------------------
// エラー型（design 9 章）
// ---------------------------------------------------------------------------

/** RestClient が非 2xx レスポンスを変換するAPIエラー。 */
export class ApiError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}
