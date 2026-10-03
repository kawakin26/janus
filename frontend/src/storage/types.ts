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

/** 履歴一覧の軽量表現（RevisionSummarySerializer に一致）。body/title を含まない。 */
export interface RevisionSummary {
  id: number
  number: number
  created_at: string
  author: User | null
}

/** リビジョン 1 件の詳細表現（RevisionSerializer に一致）。本文・タイトルを含む。 */
export interface Revision {
  id: number
  number: number
  created_at: string
  author: User | null
  body: string
  title: string
}

/** 行単位差分の 1 行（RevisionDiffView に一致）。replace は del 群+add 群に分解済み。 */
export interface DiffLine {
  op: 'add' | 'del' | 'equal'
  line: string
}

/** 権限エントリ（PagePermissionSerializer に一致）。指定子はすべて number。 */
export interface PermissionEntry {
  id: number
  path: string
  principalType: 'user' | 'group'
  principalId: number
  action: 'view' | 'edit'
  effect: 'allow' | 'deny'
}

/** 現在ユーザーの path に対する実効権限（PageEffectivePermissionView に一致）。 */
export interface EffectivePermission {
  view: boolean
  edit: boolean
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
  /** ページ履歴一覧（新しい順）。limit/offset でページングする。指定子は number。 */
  listRevisions(
    path: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<RevisionSummary[]>
  /** リビジョン 1 件の本文取得。存在しない number/別ページは 404（throw）。 */
  getRevision(path: string, number: number): Promise<Revision>
  /** 2 リビジョンの行単位差分。指定子は number。 */
  diffRevisions(path: string, from: number, to: number): Promise<DiffLine[]>
  /** 指定リビジョンへ復元（新リビジョン化）。復元後の Page を返す。 */
  restoreRevision(path: string, number: number): Promise<Page>
}

/** ページ権限管理契約（design 5.3/5.4）。指定子はすべて number。 */
export interface PermissionClient {
  /** path の権限エントリ一覧（0 件は空配列）。 */
  listPermissions(path: string): Promise<PermissionEntry[]>
  /** 権限エントリを付与する。重複 (path,主体,action) は 409（throw）。 */
  grantPermission(input: {
    path: string
    principalType: 'user' | 'group'
    principalId: number
    action: 'view' | 'edit'
    effect: 'allow' | 'deny'
  }): Promise<PermissionEntry>
  /** 権限エントリの effect のみ更新する。存在しない id は 404（throw）。 */
  updatePermission(id: number, effect: 'allow' | 'deny'): Promise<PermissionEntry>
  /** 権限エントリを取消す。 */
  revokePermission(id: number): Promise<void>
  /** 現在ユーザーの path に対する実効権限。認証済みは常に 200・401 のみ throw。 */
  getEffectivePermission(path: string): Promise<EffectivePermission>
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
    SearchClient,
    PermissionClient {}

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
