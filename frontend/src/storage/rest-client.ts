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
  AssetRef,
  Folder,
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

  async listFolders(parentFolderId: number | null): Promise<Folder[]> {
    const query = parentFolderId === null ? '' : `?parent=${encodeURIComponent(parentFolderId)}`
    const response = await fetch(this.url(`folders${query}`), {
      method: 'GET',
      headers: { ...this.authHeaders() },
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Folder[]
  }

  async createFolder(input: { parentId: number | null; name: string }): Promise<Folder> {
    const response = await fetch(this.url('folders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Folder
  }

  async listAssets(folderId: number | null): Promise<Asset[]> {
    const query = folderId === null ? '' : `?folder=${encodeURIComponent(folderId)}`
    const response = await fetch(this.url(`assets${query}`), {
      method: 'GET',
      headers: { ...this.authHeaders() },
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Asset[]
  }

  async uploadAsset(input: {
    folderId: number | null
    file: File
    alias?: string
  }): Promise<Asset> {
    const query = input.folderId === null ? '' : `?folder=${encodeURIComponent(input.folderId)}`
    const form = new FormData()
    form.append('file', input.file)
    if (input.alias !== undefined) {
      form.append('alias', input.alias)
    }
    const response = await fetch(this.url(`assets${query}`), {
      method: 'POST',
      headers: { ...this.authHeaders() },
      body: form,
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Asset
  }

  async moveAsset(assetId: number, toFolderId: number | null): Promise<Asset> {
    const response = await fetch(this.url(`assets/${encodeURIComponent(assetId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ folderId: toFolderId }),
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return (await response.json()) as Asset
  }

  /**
   * 認証ヘッダ付きでファイルを取得し、img/aから利用できる一時URLを作る。
   * ネイティブ要素のリクエストにはRestClientのAuthorizationヘッダが引き継がれないため、
   * 保護されたfileエンドポイントをBlob URLへ変換して返す。
   */
  async getAssetFileUrl(asset: Asset): Promise<string> {
    const response = await fetch(asset.url, {
      method: 'GET',
      headers: { ...this.authHeaders() },
    })
    if (!response.ok) {
      throw await this.toApiError(response)
    }
    return URL.createObjectURL(await response.blob())
  }

  /** getAssetFileUrlが返したBlob URLを解放する。 */
  releaseAssetFileUrl(url: string): void {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
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

  /** フォルダ木を辿ってIDを解決する。見つからない場合は undefined。 */
  private async findFolderId(path: string | undefined): Promise<number | null | undefined> {
    const segments = this.folderSegments(path)
    let parentId: number | null = null
    for (const segment of segments) {
      const folders = await this.listFolders(parentId)
      const folder = folders.find((candidate) => candidate.name === segment)
      if (folder === undefined) return undefined
      parentId = folder.id
    }
    return parentId
  }

  /**
   * AssetRef の指定子を出現順に試し、指定子値のスラッシュ部分をフォルダパスとして解決する。
   * フォルダが見つからない指定子は次へ進み、APIの認証/その他エラーは呼び出し元へ返す。
   */
  async resolveAssetUrl(ref: AssetRef): Promise<string | null> {
    const baseSegments = this.folderSegments(ref.baseFolderPath)
    const folderCache = new Map<string, number | null | undefined>()
    const resolveFolder = async (segments: string[]): Promise<number | null | undefined> => {
      const key = segments.join('/')
      const cached = folderCache.get(key)
      if (cached !== undefined || folderCache.has(key)) return cached
      const folderId = await this.findFolderId(key ? `/${key}` : '')
      folderCache.set(key, folderId)
      return folderId
    }

    for (const specifier of ref.specifiers) {
      const value = specifier.value.trim()
      if (!value) continue
      const slash = value.lastIndexOf('/')
      const name = slash >= 0 ? value.slice(slash + 1) : value
      if (!name) continue
      const folderSegments = slash >= 0
        ? this.folderSegments(value.slice(0, slash), value.startsWith('/') ? [] : baseSegments)
        : baseSegments
      const folderId = await resolveFolder(folderSegments)
      if (folderId === undefined) continue
      const assets = await this.listAssets(folderId)
      const asset = assets.find((candidate) =>
        specifier.kind === 'filename'
          ? candidate.filename === name
          : candidate.alias === name,
      )
      if (asset !== undefined) return this.getAssetFileUrl(asset)
    }
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
