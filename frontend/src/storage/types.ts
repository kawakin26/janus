// StorageClient 契約（design 4 章）とそれに連なる型定義。
//
// 方針（計画の確定判断に接地）:
// - 型は backend の JSON レスポンス形に忠実な snake_case で定義し、
//   RestClient 内で camelCase へ変換しない（変換層を作らない）。
//   理由: 変換は全フィールド一貫で行う必要があり、フェーズ 1 の責務
//   （契約の確立）に対して不要な複雑性とバグ面を増やすため。
//   backend/api/serializers.py の実挙動（UserSerializer /
//   PageSerializer / PageSummarySerializer / AssetSerializer）に一致させる。
// - SearchClient はフェーズ 1 では契約のみ置き、RestClient の search() は
//   未実装（throw）とする（要件 1-4, 11-4）。SearchHit は design に厳密な
//   定義が無いため最小形で仮定義し、フェーズ 4 で確定する。
// - interface 名・シグネチャ（引数名含む）は design 4 章に忠実。追加・改名はしない。

// ---------------------------------------------------------------------------
// データ型（backend JSON に忠実な snake_case）
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

/** アセット（添付）の表現。AssetSerializer に一致。 */
export interface Asset {
  id: number
  original_name: string
  url: string
  content_type: string
  created_at: string
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

/** アセット契約。 */
export interface AssetClient {
  listAssets(pagePath: string): Promise<Asset[]>
  uploadAsset(pagePath: string, file: File): Promise<Asset>
  resolveAssetUrl(
    originalName: string,
    candidatePagePaths: string[],
  ): Promise<string | null>
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

/**
 * API エラーを表す例外。RestClient が非 2xx レスポンスをこの例外へ変換する。
 * status を保持することで呼び出し側（UI 層）が 409 / 404 / 401 等を判別できる。
 * detail は backend の DRF エラー本文 { detail } を拾ったもの（無ければ undefined）。
 */
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
