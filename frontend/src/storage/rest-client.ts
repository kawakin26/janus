// fetch ベースの StorageClient 実装（design 5 章）。
//
// 方針（計画の確定判断に接地）:
// - HTTP は標準 fetch のみ（axios 等は入れない）。
// - baseUrl 既定は空文字。各リクエストは `${baseUrl}/api/...` を組み立てる。
//   空文字なら同一オリジンの /api/... を叩き、dev プロキシ（vite.config.ts の
//   /api → http://localhost:8000）が backend へ転送する。
// - トークンの読み書き（loadToken / storeToken / clearToken）と authHeaders() を
//   RestClient 内 1 箇所に閉じ込める。将来 Cookie セッション方式へ移行する際は
//   この箇所だけ差し替えれば済む（design 5 章「認証実装を契約の裏に隠す」）。
//   既定はメモリ保持のみ。options.persistToken=true のときのみ localStorage を併用する
//   （SSR/テスト等で localStorage が無い環境でも落ちないよう存在チェックする）。
// - 非 2xx は ApiError へ変換する（design 9 章）。ただし getPage の 404 は null を返す。
// - 401 は画面遷移せず ApiError(status=401) を throw する（画面遷移は UI 層＝タスク 9 の責務）。

import { ApiError } from './types'
import type {
  Asset,
  Page,
  PageSummary,
  SearchHit,
  StorageClient,
  User,
} from './types'

/** RestClient のコンストラクタオプション。 */
export interface RestClientOptions {
  /** true のとき token を localStorage にも永続化する（既定 false＝メモリのみ）。 */
  persistToken?: boolean
}

/** localStorage に保存する際のキー（永続化を有効にした場合のみ使用）。 */
const TOKEN_STORAGE_KEY = 'janus.authToken'

export class RestClient implements StorageClient {
  private readonly baseUrl: string
  private readonly persistToken: boolean
  /** メモリ上の token 保持。永続化無効時はこれだけを使う。 */
  private token: string | null = null

  constructor(baseUrl = '', options: RestClientOptions = {}) {
    this.baseUrl = baseUrl
    this.persistToken = options.persistToken ?? false
    // 永続化が有効なら起動時に既存 token を読み込む。
    this.token = this.loadToken()
  }

  // -------------------------------------------------------------------------
  // トークン保持（この 3 メソッド + authHeaders に認証実装を閉じ込める）
  // -------------------------------------------------------------------------

  /** localStorage が利用可能なら返す。無い環境（SSR/テスト等）では null。 */
  private getStorage(): Storage | null {
    if (!this.persistToken) {
      return null
    }
    try {
      // localStorage 不在・アクセス不可（プライベートモード等）でも落ちないようガードする。
      if (typeof localStorage !== 'undefined') {
        return localStorage
      }
    } catch {
      // アクセス自体が例外になる環境ではメモリのみにフォールバック。
    }
    return null
  }

  /** 保持中の token を取得する（永続化有効なら localStorage を優先）。 */
  private loadToken(): string | null {
    const storage = this.getStorage()
    if (storage !== null) {
      return storage.getItem(TOKEN_STORAGE_KEY)
    }
    return this.token
  }

  /** token を保持する（メモリ + 永続化有効なら localStorage）。 */
  private storeToken(token: string): void {
    this.token = token
    const storage = this.getStorage()
    if (storage !== null) {
      storage.setItem(TOKEN_STORAGE_KEY, token)
    }
  }

  /** token を破棄する（メモリ + 永続化有効なら localStorage）。 */
  private clearToken(): void {
    this.token = null
    const storage = this.getStorage()
    if (storage !== null) {
      storage.removeItem(TOKEN_STORAGE_KEY)
    }
  }

  /** 認証ヘッダを組む。token 保持時のみ Authorization: Token <token> を付与する。 */
  private authHeaders(): Record<string, string> {
    if (this.token === null) {
      return {}
    }
    return { Authorization: `Token ${this.token}` }
  }

  // -------------------------------------------------------------------------
  // 共通ヘルパ
  // -------------------------------------------------------------------------

  /** `${baseUrl}/api/<path>` を組み立てる。 */
  private url(path: string): string {
    return `${this.baseUrl}/api/${path}`
  }

  /**
   * 非 2xx レスポンスを ApiError へ変換する。
   * DRF の標準エラー本文 { detail } があれば detail に拾う。
   */
  private async toApiError(response: Response): Promise<ApiError> {
    let detail: string | undefined
    try {
      const body = await response.json()
      if (body !== null && typeof body === 'object' && 'detail' in body) {
        const value = (body as { detail?: unknown }).detail
        if (typeof value === 'string') {
          detail = value
        }
      }
    } catch {
      // 本文が JSON でない / 空の場合は detail 無しで扱う。
    }
    const message = detail ?? `API error: ${response.status}`
    return new ApiError(response.status, message, detail)
  }

  // -------------------------------------------------------------------------
  // AuthClient
  // -------------------------------------------------------------------------

  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: User }> {
    const response = await fetch(this.url('auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    const data = (await response.json()) as { token: string; user: User }
    // 成功時に token を保持し、以降のリクエストに Authorization を付与できるようにする。
    this.storeToken(data.token)
    return data
  }

  async logout(): Promise<void> {
    // ログアウトは「ローカル token を確実に破棄する」ことを最優先する。
    // サーバー応答が 2xx でも非 2xx でも必ず token を破棄し、例外は投げない
    // （ログアウトの冪等性を保つ）。
    try {
      await fetch(this.url('auth/logout'), {
        method: 'POST',
        headers: { ...this.authHeaders() },
      })
    } finally {
      this.clearToken()
    }
  }

  async currentUser(): Promise<User | null> {
    // me は未認証でも 200 で本文 null を返す。200 以外は ApiError、
    // ネットワーク失敗は fetch が throw する（そのまま伝播）。
    const response = await fetch(this.url('auth/me'), {
      method: 'GET',
      headers: { ...this.authHeaders() },
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as User | null
  }

  // -------------------------------------------------------------------------
  // PageClient
  // -------------------------------------------------------------------------

  async getPage(path: string): Promise<Page | null> {
    const response = await fetch(
      this.url(`pages?path=${encodeURIComponent(path)}`),
      { method: 'GET', headers: { ...this.authHeaders() } },
    )
    // ページ未存在（404）は例外ではなく null を返す（design / 計画の方針）。
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Page
  }

  async listChildren(parentPath: string): Promise<PageSummary[]> {
    const response = await fetch(
      this.url(`pages/children?parent=${encodeURIComponent(parentPath)}`),
      { method: 'GET', headers: { ...this.authHeaders() } },
    )
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as PageSummary[]
  }

  async createPage(input: {
    path: string
    title?: string
    body: string
  }): Promise<Page> {
    const response = await fetch(this.url('pages'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(input),
    })
    // 重複パスは 409。呼び出し側が status で判別できるよう ApiError に status を載せる。
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Page
  }

  async updatePage(
    path: string,
    input: { title?: string; body: string },
  ): Promise<Page> {
    const response = await fetch(
      this.url(`pages?path=${encodeURIComponent(path)}`),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify(input),
      },
    )
    // getPage と異なり、更新対象が無い 404 は null にせず ApiError を throw する。
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Page
  }

  async deletePage(path: string): Promise<void> {
    const response = await fetch(
      this.url(`pages?path=${encodeURIComponent(path)}`),
      { method: 'DELETE', headers: { ...this.authHeaders() } },
    )
    // 削除対象が無い 404 は ApiError を throw する（null にしない）。
    if (!response.ok) {
      throw await this.toApiError(response)
    }
  }

  // -------------------------------------------------------------------------
  // AssetClient
  // -------------------------------------------------------------------------

  async listAssets(pagePath: string): Promise<Asset[]> {
    const response = await fetch(
      this.url(`pages/assets?path=${encodeURIComponent(pagePath)}`),
      { method: 'GET', headers: { ...this.authHeaders() } },
    )
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Asset[]
  }

  async uploadAsset(pagePath: string, file: File): Promise<Asset> {
    // multipart/form-data のフィールド名は "file"。
    // Content-Type（boundary 付き）は fetch に委ね、手動で指定しない。
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(
      this.url(`pages/assets?path=${encodeURIComponent(pagePath)}`),
      { method: 'POST', headers: { ...this.authHeaders() }, body: form },
    )
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Asset
  }

  async resolveAssetUrl(
    originalName: string,
    candidatePagePaths: string[],
  ): Promise<string | null> {
    // 候補ページを順に listAssets し、original_name 一致の最初の Asset の url を返す。
    // 解決ロジックはクライアント側（タスク 6 で確定済みの設計判断）。
    for (const pagePath of candidatePagePaths) {
      let assets: Asset[]
      try {
        assets = await this.listAssets(pagePath)
      } catch (error) {
        // ページが存在しない（404）候補は「添付無し」としてスキップし次候補へ進む
        // （多段フォールバックの思想）。それ以外のエラーは呼び出し側へ伝播する。
        if (error instanceof ApiError && error.status === 404) {
          continue
        }
        throw error
      }
      const matched = assets.find((asset) => asset.original_name === originalName)
      if (matched !== undefined) {
        return matched.url
      }
    }
    // 全候補で見つからなければ null。
    return null
  }

  // -------------------------------------------------------------------------
  // SearchClient（フェーズ 4 で実装。フェーズ 1 では未実装）
  // -------------------------------------------------------------------------

  async search(query: string): Promise<SearchHit[]> {
    // 要件 1-4: 契約のみ先に置き、実装はフェーズ 4。実エンドポイントは叩かない。
    // query は未使用だがシグネチャは契約（design 4 章）に忠実に保つ。
    void query
    throw new Error('search() はフェーズ 4 で実装します')
  }
}
