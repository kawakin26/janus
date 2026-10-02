# Janus 設計書（フェーズ 1）

本設計書は `requirements.md` のフェーズ 1（サーバーモード基盤）を対象とする。フェーズ 2 以降に影響する構造的決定（統一 API 契約、データモデルの拡張余地）は、将来を見据えて設計に織り込むが、実装はフェーズ 1 の範囲に限定する。

---

## 1. 全体アーキテクチャ

Janus は「1 つのフロントエンド」と「差し替え可能なバックエンド（ストレージアダプタ）」で構成する。

```
┌───────────────────────────────────────────────┐
│  フロントエンド（React + TypeScript / PWA）        │
│  ・ページ閲覧/編集（Markdown）                    │
│  ・地図ビューア（既存プラグイン viewer を移植）      │
│  ・認証 UI（ログイン/ログアウト）                  │
│                                                 │
│  すべてのデータ操作は StorageClient 契約を経由する  │
└───────────────┬─────────────────────────────────┘
                │  StorageClient（統一 API 契約・TypeScript interface）
                │
     ┌──────────┴───────────┐
     ▼                      ▼
┌──────────────┐   ┌──────────────────────────────┐
│ RestClient    │   │ LocalClient（フェーズ 3）       │
│ （フェーズ 1）  │   │  IndexedDB 実装                │
│ fetch → REST  │   │  ※本設計の実装対象外            │
└──────┬────────┘   └──────────────────────────────┘
       │ HTTP(JSON)
       ▼
┌───────────────────────────────────────────────┐
│  バックエンド（Django + Django REST Framework）   │
│  ・認証（セッション or トークン）                  │
│  ・ページ / 添付（アセット）の CRUD               │
│  ・Markdown は本文を保持（レンダリングはフロント）   │
│  DB: SQLite（既定） / PostgreSQL（設定切替）        │
└───────────────────────────────────────────────┘
```

### 設計上の要の決定

- **フロントは `StorageClient` インターフェースだけに依存する。** フェーズ 1 ではその実装は `RestClient` のみ。フェーズ 3 で `LocalClient`（IndexedDB）を追加しても、画面コードは変更しない（要件 1）。
- **Markdown のレンダリングはフロント側で行う。** サーバーは本文（テキスト）を保持するだけ。これにより、同じレンダラをローカルモードでも使い回せ、サーバーを軽量に保てる（要件 13）。
- **地図記法はフロントのレンダラ拡張として実装する。** 既存プラグインの `viewer.ts` を、GROWI API 依存部分だけ `StorageClient` 経由に差し替えて移植する（後述 7 章）。

---

## 2. 技術スタック

### バックエンド（フェーズ 1 実装対象）

| 項目 | 採用 | 理由 |
|------|------|------|
| 言語/FW | Python 3.11+ / Django 5.x | 要件 12。成熟・軽量に運用可能 |
| API | Django REST Framework (DRF) | REST 契約の実装に標準的 |
| DB | SQLite（既定）/ PostgreSQL（切替） | 要件 12-2。環境変数で切替 |
| 認証 | DRF Token 認証（フェーズ 1）＋ Django 標準 User | 要件 4。SPA から扱いやすく、Cookie セッションより CORS が単純 |
| 本文保存 | TextField（Markdown 生テキスト） | レンダリングはフロント |

### フロントエンド（フェーズ 1 実装対象）

| 項目 | 採用 | 理由 |
|------|------|------|
| 言語/FW | TypeScript / React 18 | 既存プラグイン資産と整合 |
| ビルド | Vite | 既存プラグインと同じ |
| ルーティング | React Router | ページパス階層の表現 |
| Markdown | remark/rehype 系 + remark-directive | 既存記法 `:::custom-map` が remark-directive 前提 |
| 地図 | 既存 `viewer.ts` 移植（依存は StorageClient 経由に置換） | 要件 3 |
| PWA | （フェーズ 3）Vite PWA プラグイン | 本設計では土台のみ意識 |

> **採用しないもの**: Elasticsearch（要件 11-5）、MongoDB、重量級全文検索基盤。全文検索はフェーズ 4。

---

## 3. データモデル（フェーズ 1）

フェーズ 1 で定義する最小スキーマ。`revision` と `permission` はフェーズ 2 で拡張するが、`Page` と本文の持ち方は後方互換を壊さない形にしておく。

### User（Django 標準 `auth.User` を利用）

- フェーズ 1 では Django 標準 User をそのまま使う。
- 「管理者」は `is_staff` / `is_superuser`、「一般」はそれ以外で区別（要件 4-4）。
- 独自プロフィールが必要になればフェーズ 2 で `UserProfile` を追加（本設計では追加しない）。

### Page

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | PK | 内部 ID |
| path | CharField(unique, index) | ページパス（例 `/docs/intro`）。末尾スラッシュ正規化。一意（要件 2-7） |
| title | CharField | 表示タイトル（省略時 path 末尾） |
| body | TextField | Markdown 生テキスト |
| created_at | DateTimeField | 作成日時 |
| updated_at | DateTimeField | 更新日時 |
| created_by | FK(User, null許容) | 作成者 |
| updated_by | FK(User, null許容) | 最終更新者（要件 4-5） |

> フェーズ 2 で `Revision`（body のスナップショット列）を追加する。フェーズ 1 では `Page.body` が常に最新。`Revision` 追加時は「保存のたびに Revision を作り、Page.body は最新のキャッシュ」とする拡張を想定し、`body` を残す設計にしておく。

### Attachment（アセット）

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | PK | 内部 ID |
| page | FK(Page) | 添付先ページ |
| original_name | CharField(index) | アップロード時のファイル名（記法の `file=` / `photo=` 照合に使う。既存仕様踏襲） |
| file | FileField | 実体（MEDIA 配下。保存先は設定で差し替え可能） |
| content_type | CharField | MIME |
| created_at | DateTimeField | 作成日時 |

> 既存プラグインが `originalName` で照合して URL 解決していた仕様（common.ts の `resolveAttachmentUrl`）を、Janus では「Page に紐づく Attachment を original_name で引く」に置き換える（7 章）。

### フェーズ 2 以降で追加予定（本設計では未実装・参考）

- `Revision(page, body, created_at, author)` — 要件 6
- `Comment(page, body, author, created_at)` — 要件 7
- `PagePermission` / `Group` — 要件 5
- CAD 変換連携・draw.io 保存 — 要件 8, 9

---

## 4. 統一 API 契約（StorageClient）

フロントが依存する唯一のデータ操作インターフェース。フェーズ 1 では `RestClient` が実装し、フェーズ 3 で `LocalClient`（IndexedDB）が同じ契約を実装する。

```typescript
// 認証
interface AuthClient {
  login(username: string, password: string): Promise<{ token: string; user: User }>;
  logout(): Promise<void>;
  currentUser(): Promise<User | null>;
}

// ページ操作
interface PageClient {
  getPage(path: string): Promise<Page | null>;
  listChildren(parentPath: string): Promise<PageSummary[]>; // 階層ナビ（要件 2-6）
  createPage(input: { path: string; title?: string; body: string }): Promise<Page>; // 重複は 409（要件 2-7）
  updatePage(path: string, input: { title?: string; body: string }): Promise<Page>;
  deletePage(path: string): Promise<void>;
}

// アセット操作（地図画像・写真の解決に使う）
interface AssetClient {
  listAssets(pagePath: string): Promise<Asset[]>;
  uploadAsset(pagePath: string, file: File): Promise<Asset>;
  // 記法の file=/photo= を URL に解決する（既存 resolveAttachmentUrl 相当）
  resolveAssetUrl(originalName: string, candidatePagePaths: string[]): Promise<string | null>;
}

// 検索（フェーズ 4 で実装。契約だけ先に置く＝要件 1-4, 11-4）
interface SearchClient {
  search(query: string): Promise<SearchHit[]>;
}

interface StorageClient extends AuthClient, PageClient, AssetClient, SearchClient {}
```

> `SearchClient` はフェーズ 1 では「未実装（throws / 空）」で良いが、**契約として先に置く**ことで、後から検索実装を差し替え可能にする（要件 1-4）。

---

## 5. REST エンドポイント（フェーズ 1 / DRF）

`RestClient` が叩く Django 側のエンドポイント。パスは `/api/` 配下。

| メソッド | パス | 対応契約 | 認証 | 備考 |
|---------|------|---------|------|------|
| POST | `/api/auth/login` | login | 不要 | token を返す |
| POST | `/api/auth/logout` | logout | 要 | token 無効化 |
| GET | `/api/auth/me` | currentUser | 任意 | 未認証は null |
| GET | `/api/pages?path=` | getPage | 設定次第 | 1 件取得 |
| GET | `/api/pages/children?parent=` | listChildren | 設定次第 | 直下の子（common.ts の listChildPages 相当のフィルタ） |
| POST | `/api/pages` | createPage | 要 | 重複パスは 409 |
| PUT | `/api/pages?path=` | updatePage | 要 | 本文更新 |
| DELETE | `/api/pages?path=` | deletePage | 要 | |
| GET | `/api/pages/assets?path=` | listAssets | 設定次第 | ページの添付一覧 |
| POST | `/api/pages/assets?path=` | uploadAsset | 要 | multipart |
| GET | `/api/assets/<id>` | （配信） | 設定次第 | 実体配信 |

### 認証方式（要件 4）とセキュリティ移行方針

認証は「初期は簡易、最終的に堅牢」へ無理なく移行できるよう、**実装を `AuthClient` 契約の裏に隠す**ことを原則とする。フロントは `login/logout/currentUser` としか対話しないため、裏側の方式（トークン / Cookie セッション）を切り替えても画面コードは変わらない。

- **フェーズ 1（初期）**: **DRF の TokenAuthentication**。ログインで token を発行し、以降 `Authorization: Token <...>` ヘッダで送る。SPA から扱いやすく、開発・テスト公開を素早く始められる。
- **既定で全エンドポイントを認証必須**にできる設定（`JANUS_REQUIRE_AUTH`）を入れる（要件 4-2。ネット公開時の不用意アクセス防止）。
- パスワードは Django のハッシュ機構に委ねる（要件 4-3）。
- CORS は許可オリジンを環境変数で明示（開発時のみ緩める）。

**最終的な堅牢化（フェーズ 2 以降で切替可能にしておく）**:

- **HttpOnly + Secure + SameSite Cookie によるセッション認証 ＋ CSRF 保護**への移行を想定する。トークンを JS から読めるストレージに置かないため、XSS によるトークン奪取リスクを下げられる。
- 移行時に変わるのは `RestClient` の認証ヘッダ/クッキー送出と Django 側の認証クラスのみ。`AuthClient` 契約と画面は不変。
- 併せて、将来の堅牢化オプションとして **レート制限（ログイン試行）、HTTPS 前提（Secure Cookie）、ログイン失敗ロックアウト、監査ログ、（必要なら）OIDC/外部 IdP 連携** を検討対象として残す。
- トークン方式を残す場合も、長期保存トークンから **短命アクセストークン + リフレッシュ**（JWT 等）への差し替え余地を `AuthClient` の裏に閉じ込める。

> 要点: フェーズ 1 のトークン認証は「捨てやすい初期実装」として位置づけ、`AuthClient` 契約を安定させることで、堅牢な方式への移行コストをフロント非改修に抑える。

### フォールバック解決（既存仕様の踏襲）

- `resolveAssetUrl` は、候補ページ（記法ページ → ストック相当ページ）の順に `listAssets` を見て `original_name` 一致を探す。既存 common.ts の多段フォールバックの思想を踏襲するが、**GROWI の `/_api/v3/...` 依存は除去**し、Janus の `/api/pages/assets` に一本化する。

---

## 6. 設定による DB / 公開範囲の切替（要件 12, 13）

- `DATABASE_URL` 環境変数で SQLite / PostgreSQL を切替（未設定なら SQLite のファイル 1 個）。
- `JANUS_REQUIRE_AUTH`（既定 true）で全体を認証必須に。
- `JANUS_MEDIA_ROOT` でアセット保存先を指定（ローカルディスク既定）。
- 最小構成は「`python manage.py runserver 8000` + SQLite ファイル」。root 不要・上位ポート（要件 12-5, 13-1）。

---

## 7. 既存プラグイン（地図）の移植方針（要件 3）

既存 `src/viewer.ts` / `src/common.ts` の地図ロジックを Janus フロントへ移植する。GROWI 固有依存を 2 点に切り分ける。

### そのまま流用できる（GROWI 非依存）

- 記法パース（`:::custom-map{...}` とマーカー箇条書きの属性解釈）。
- モーダル描画・パン/ズーム/90 度回転・マーカー最小化/復帰・写真/説明ポップアップ。
- ラベル文字色の自動選択（`textColorForBg`）、ピン径/ラベルサイズのクランプ、`normalizeForSearch` 等のユーティリティ。
- 記法の仕様（コンテナ属性 `file/src/cx/cy/scale/rotate/link/restore/pinSize/labelSize`、マーカー属性 `x/y/label/photo/photoSrc/desc/color`）は**そのまま維持**（利用者の記法資産を変えない）。

### 置き換えが必要（GROWI API 依存部分）

| 既存（GROWI 依存） | Janus での置換 |
|---|---|
| `apiv3Get('/page')`, `getPageIdByPath` | `StorageClient.getPage(path)` |
| `getAttachmentsForPage`, `resolveAttachmentUrl` | `AssetClient.listAssets` / `resolveAssetUrl` |
| `/_api/v3/attachment`（アップロード） | `AssetClient.uploadAsset` |
| `GROWI_CUSTOM_MAP_CONFIG`（グローバル設定） | Janus のアプリ設定（defaultSrc 相当・CAD API はフェーズ 3） |
| `window.GROWI_CONTEXT` / `__NEXT_DATA__`（現在ページ解決） | React Router の現在ルート |
| CAD 変換 API 連携（register.ts） | **フェーズ 3** に送る（フェーズ 1 は画像のみ） |

> フェーズ 1 の地図は「画像アセットの上にマーカー表示」まで。CAD 自動変換・GUI 編集・現場写真添付はフェーズ 3（要件 3-4,5 / 8 / 10）。

---

## 8. ディレクトリ構成（新規リポジトリ）

```
/home/kawakin/git/knowledge-base/janus/
├── README.md
├── backend/                      # Django プロジェクト
│   ├── manage.py
│   ├── pyproject.toml / requirements.txt
│   ├── janus/                    # settings, urls, wsgi/asgi
│   └── api/                      # app: models, serializers, views, urls
│       ├── models.py             # Page, Attachment
│       ├── serializers.py
│       ├── views.py              # auth, pages, assets
│       └── urls.py
├── frontend/                     # React + Vite + TS
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── storage/              # StorageClient 契約 + RestClient
│       │   ├── types.ts          # インターフェース定義
│       │   └── rest-client.ts
│       ├── pages/                # 画面（一覧/閲覧/編集/ログイン）
│       ├── markdown/             # レンダラ + 地図ディレクティブ
│       │   └── custom-map/       # 既存 viewer 移植（GROWI 依存を除去）
│       └── auth/
└── .kiro/specs/janus-foundation/ # 本 Spec
```

> backend と frontend を 1 リポジトリに同居（モノレポ）。フェーズ 3 で frontend を PWA 化し、同じ frontend をローカルモードでも配布する。

---

## 9. エラーハンドリング

- **API エラー**は DRF 標準の `{ detail }` / バリデーションエラー形式に統一し、`RestClient` が例外へ変換してフロントで表示。
- **パス重複（要件 2-7）**は 409 Conflict を返し、フロントで「同一パスが既に存在」を通知。
- **認証切れ**は 401 を返し、フロントはログイン画面へ誘導。
- **アセット解決失敗（地図）**は既存同様フォールバックし、最終的に見つからなければ「マップ/画像が見つかりません」を表示（既存メッセージの思想を踏襲）。

---

## 10. テスト戦略（フェーズ 1）

- **バックエンド**: DRF の APITestCase で各エンドポイント（認証必須/重複拒否/CRUD/アセット解決）を検証。
- **フロント**: StorageClient 契約に対する RestClient のユニットテスト（モック fetch）。地図記法パースは既存ロジックのテストを移植。
- **統合の最小確認**: ログイン → ページ作成 → 閲覧（Markdown + 地図記法表示）→ 編集 → 削除、の一連を手動シナリオ化。

> テストは「新機能・バグ修正時」に書く方針（要件外の網羅テストは作らない）。

---

## 11. フェーズ境界で先送りする決定（記録）

- リビジョンの持ち方（差分保存か全文スナップショットか）→ フェーズ 2 で決定。全文スナップショット＋表示時に差分計算を第一候補とする。
- 権限モデル（ページ単位か階層継承か、グループ設計）→ フェーズ 2。
- draw.io 埋め込みの保存形式（Markdown 埋め込みか別アセットか）→ フェーズ 3。XML を本文中のコードフェンス or 専用ディレクティブで保持する案を軸に検討。
- 全文検索の N-gram 実装詳細（FTS5 トークナイザ設定、ブラウザ側インデックス）→ フェーズ 4。
- ローカル ⇔ サーバー同期（B 案）→ スコープ外。描画・ページのデータ形式は同期を阻害しない JSON 中心で保持。
