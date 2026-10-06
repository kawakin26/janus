# Janus ローカルモード（フェーズ 3b）設計書

本書は `janus-local-mode/requirements.md`（要件 LM-1〜LM-7 と非機能要件）を実装レベルに具体化する設計書である。Janus に**完全独立のローカル専用モード**を追加する。サーバー無しでブラウザだけで完結し、IndexedDB を唯一の保存先とする。既存のサーバーモード（Django + DRF + `RestClient`）と**同一ビルドで共存**し、起動時にモードを選択する。本機能はさらに (1) 全データエクスポート/インポート（ZIP・双方向）、(2) アセットの IndexedDB Blob 保存、(3) MapEditor のカメラ撮影（ローカル専用）、(4) PWA 化（Service Worker + manifest）を含む。本書の段階ではアプリケーションコードを変更せず、設計の確定のみを行う。実装・コミットは後続ステップで行う。

本設計は事前調査レポート（`backend/.agents/tasks/phase3b-local-mode-investigation.md`、以下「調査」）の findings に厳密に接地する。調査で**未確認（unverified）**な想定は各章で『未確認』と明示し、設計で確定した判断は根拠付きで記す。推測で埋めない。

設計の大原則は 5 つ。(1) **非破壊（最優先）** — 既存の `StorageClient` 契約 31 メソッドのシグネチャ・保存経路・権限・記法・デザイントークンを変えず、ローカルモードは**クライアント差し替え＋加算**で成立させる。backend は変更しない。(2) **契約への接地** — ローカルモードは `StorageProvider.tsx` の `client` prop（調査 §2 で「LocalClient 差し替えを設計時点で想定済み」と明記）に `LocalClient` を注入するだけで成立する。画面・`AuthProvider`・`RequireAuth`・サイドバーツリーは `useStorage()` 契約型にのみ依存するため**コード変更なしまたは最小変更**で動く。(3) **ダミーで契約を満たす** — Auth/Permission はローカルの単一ユーザー前提をダミー実装で表現し、`currentUser()` が固定ユーザーを即返すことで既存ガードを自然にバイパスする（調査 §6）。(4) **純粋関数への切り出し** — IndexedDB アクセスとドメインロジック（ツリー構築・差分・ZIP 整形）を分離し、`fake-indexeddb` と純粋関数で単体テスト可能にする（非機能要件 8）。(5) **外部依存の最小化** — 新規依存は `JSZip`・`diff`・`vite-plugin-pwa` の 3 つに限定する（非機能要件 6）。

技術スタックは本機能で**ロック**する。フロント: React 18 + TypeScript + react-router-dom v6 + Tailwind CSS v4（CSS-first）+ Vite 8。永続化: ブラウザ標準 IndexedDB（ラッパーライブラリは導入しない。素の `IDBDatabase` API を薄い Promise ラッパーで扱う）。追加ライブラリは **`jszip`（ZIP 生成/展開）・`diff`（行単位差分・`diffRevisions` 用）・`vite-plugin-pwa`（manifest + Service Worker 生成・ビルド時のみ）** の 3 つのみ。テストは Vitest + Testing Library（per-file `// @vitest-environment jsdom`）＋ `fake-indexeddb`（devDependency・IndexedDB モック）。backend（Django + DRF）は**本機能では変更しない**（将来のサーバー取り込み API は §3.6 で仕様のみ記録）。UI フレームワーク・状態管理ライブラリ・HTTP クライアント・ORM 風 IndexedDB ラッパー（Dexie 等）は導入しない。

> IndexedDB ラッパー選択（確定）: Dexie 等の高機能ラッパーは導入せず、**素の IndexedDB API を自前の薄い Promise ラッパー**（`idb.ts`）で扱う。理由: 本機能のクエリは「ストア全走査」「キー/インデックス単純検索」「`put`/`delete`」に限られ、Dexie のクエリ DSL を必要としない。大原則 (5) の依存最小化に沿い、ランタイム依存を 1 つ減らす。将来クエリが複雑化したらラッパー層（`idb.ts`）の内部だけ差し替えればよい（`LocalClient` の各メソッドはラッパー経由で IndexedDB に触れ、生 API を直接触らない）。

---

## 1. 全体像

```
                    ┌─────────────────────────── main.tsx ───────────────────────────┐
                    │ resolveMode(): localStorage 'janus-mode' を読む                 │
                    │   - 未設定           → <ModeGate> がモード選択画面を描画          │
                    │   - 'local'          → client = new LocalClient()               │
                    │   - 'server'         → client = createStorageClient()            │
                    └───────────────────────────────┬────────────────────────────────┘
                                                     │ <StorageProvider client={client}>
   ThemeProvider > BrowserRouter > StorageProvider > AuthProvider > App（既存ネスト不変）
                                                     │
                 useStorage()（Context・StorageClient 契約型のみに依存）
                                                     │
         ┌───────────────────────────┬──────────────┴───────────────┬────────────────────┐
         ▼                           ▼                              ▼                    ▼
   RestClient（server）        LocalClient（local・新規）      画面コンポーネント      AuthProvider
   fetch /api/...              IndexedDB（janus-local DB）     （変更なし）          RequireAuth
                                 ├ pages / revisions                              （変更なし。
                                 ├ comments                                        currentUser() が
                                 ├ folders / assets(Blob)                          固定ユーザーを即返す
                                 └ meta                                            → /login へ飛ばない）
                                     │
         ┌───────────────────────────┼───────────────────────────────┐
         ▼                           ▼                               ▼
   Export（JSZip）             Import（JSZip）                  Asset Blob 参照
   manifest.json / pages/      ZIP → 全クリア → 復元            URL.createObjectURL
   assets/ / folders.json      （確認ダイアログ）               （getAssetFileUrl）

   ─────────────────────────── PWA（vite-plugin-pwa・ビルド時のみ）───────────────────────────
   Service Worker（Workbox precache）: app shell（index.html/JS/CSS/font）
                                     + public/drawio/webapp/（約 19MB・maximumFileSizeToCacheInBytes 引上げ）
   manifest.webmanifest: name/short_name/start_url=/ /display=standalone/theme_color/icons
```

データフロー要約: `main.tsx` が `localStorage['janus-mode']` でモードを決め、対応する `StorageClient` 実装を `StorageProvider` の `client` prop に注入する。これより下（Provider ネスト・画面・認証ガード・サイドバーツリー）は既存コードのまま、`useStorage()` が返すクライアントの振る舞いだけが変わる。ローカルモードでは全データが `janus-local` IndexedDB に入り、ネットワークは一切使わない。PWA の Service Worker はアプリシェルと draw.io webapp をプリキャッシュし、オフライン起動と draw.io のオフライン動作を成立させる。

---

## 2. モード切替（§LM-1）

### 2.1 概要

同一ビルドで「ローカルモード」と「サーバーモード」を切り替える。ビルド時フラグ（`VITE_MODE` 等）や URL ベース（`/local/...`）は採用しない（要件 LM-1-3）。起動時に `localStorage` キー `janus-mode` を参照し、未設定なら**モード選択画面**（`ModeGate`）を表示する。選択後は `localStorage` に記録してアプリ本体へ遷移する。

### 2.2 localStorage キーと値

| キー | 値 | 意味 |
|---|---|---|
| `janus-mode` | `'local'` | ローカルモード選択済み |
| `janus-mode` | `'server'` | サーバーモード選択済み |
| `janus-mode` | 存在しない / 不正値 | 未選択 → モード選択画面を表示 |

読み出し/書き込みは `theme-core.ts` と同じ防御運用（try/catch・不正値フォールバック・キー定数）に倣う。プライベートモードで localStorage が使えない場合は、毎回モード選択画面を表示する（致命エラーにはしない）。

### 2.3 `main.tsx` の変更

現在の `main.tsx`:
```tsx
<StorageProvider>           // client 未指定 → 内部で RestClient を生成
  <AuthProvider>
    <App />
  </AuthProvider>
</StorageProvider>
```

変更後:
```tsx
function Root() {
  const mode = readMode()  // localStorage 'janus-mode' を読む
  if (mode === null) {
    return <ModeGate />    // 未選択 → モード選択画面
  }
  const client = mode === 'local' ? new LocalClient() : createStorageClient()
  return (
    <StorageProvider client={client}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StorageProvider>
  )
}
```

`Root` を `BrowserRouter` の内側（`<ThemeProvider>` > `<BrowserRouter>` > `Root`）に置く。`ModeGate` は `BrowserRouter` の内側にあるが、ルーティングには依存せず、モード選択後に `location.reload()` で再起動する（`StorageProvider` の `useState` 遅延初期化はマウント時 1 回だけ実行されるため、`client` をリアクティブに差し替えるよりリロードが素直）。

**`ModeGate` コンポーネント**: `frontend/src/components/ModeGate.tsx`（新規）。

- 2 択ボタン（「ローカルモード — サーバー不要」/「サーバーモード — ログインして使う」）を表示。
- ボタン押下で `writeMode('local' | 'server')` → `location.reload()`。
- デザイントークン準拠（`bg-surface`・`text-fg`・`Button` variant `normal`/`primary`）。アイコンなし。
- テスト: `ModeGate.test.tsx`（jsdom）で「ボタン押下 → localStorage 書込 → reload 呼出」を検証。`location.reload` は `vi.fn()` でモック。

### 2.4 モード切替（再選択）

設定画面（`/settings` — 新規ページ）またはモード選択画面への再アクセスから可能とする。実装は最小構成:

- `AppLayout` のヘッダーのユーザー名近くに「モード切替」リンクを追加。クリックで `clearMode()` → `location.reload()` → `ModeGate` が表示される。
- 切替時は `localStorage['janus-mode']` を削除 → リロード → モード選択画面が表示される。ローカル → サーバーの切替でも IndexedDB のデータは消さない（データは残る。サーバーモードでは使われないだけ）。
- 将来: 切替前の確認ダイアログ（「ローカルのデータはブラウザに残ります」）を追加可能。初期実装では省略。

### 2.5 認証バイパス（LocalClient + 既存ガード）

調査 §6 で確認済み: `AuthProvider` は `storage.currentUser()` の戻りで `user` state を設定し、`RequireAuth` は `user !== null` でパスする。**既存コード変更なし**で以下が成立:

1. `LocalClient.currentUser()` → 固定ユーザー（`{ id: 1, username: 'local', is_staff: true, is_superuser: true }`）を即座に `Promise.resolve` で返す。
2. `AuthProvider` の `useEffect` → `setUser(固定ユーザー)` → `setLoading(false)`。即座に完了。
3. `RequireAuth` → `user !== null` → 子要素をそのまま描画。`/login` へのリダイレクトは発生しない。
4. `LoginPage` → ローカルモードでルーティングから除外する必要はない。仮にユーザーが URL 直打ちで `/login` に来ても、`LoginPage` は `useAuth().login()` を呼ぶだけで `LocalClient.login()` が即座に固定ユーザーを返し、ホームへ遷移する（害はない）。

### 2.6 エラーハンドリング

| 失敗条件 | 回復可否 | ユーザーが受け取るもの | ログ |
|---|---|---|---|
| `localStorage` 読み書き不可（プライベートモード等） | 回復可 | 毎回モード選択画面が表示される（localStorage に保存できないため） | `console.warn` |
| 不正な `janus-mode` 値 | 回復可 | 無視してモード選択画面を表示 | なし |
| `LocalClient()` コンストラクタで IndexedDB 接続失敗 | 致命的 | エラー画面（「ブラウザがローカルストレージをサポートしていません」）。`ModeGate` への「やり直す」リンク | `console.error` |

### 2.7 テスト観点

- **`readMode` / `writeMode` / `clearMode`**: 純粋関数。localStorage モック（`vi.spyOn(Storage.prototype, ...)`）で正常値・不正値・例外をテスト。
- **`ModeGate`**: ボタン描画・押下→localStorage→reload 呼出。
- **`Root`（main.tsx の統合）**: `mode='local'` 時に `LocalClient` が Provider に渡る、`mode='server'` 時に `RestClient` が渡る、`mode=null` 時に `ModeGate` が描画される。

---

## 3. エクスポート/インポート（§LM-3 / §LM-4）

### 3.1 概要

ローカル全データを ZIP ファイルとして書き出し（エクスポート）、ZIP から IndexedDB へ復元する（インポート）。双方向。ZIP 生成/展開には `jszip` を使用する。

### 3.2 ZIP レイアウト

```
janus-export-20250110-143000.zip
├── manifest.json
├── pages/
│   ├── _root_.json              ← path="/" のページ（'/' は ファイル名不可のためエンコード）
│   ├── docs.json                ← path="/docs"
│   ├── docs%2Fintro.json        ← path="/docs/intro"
│   └── ...
├── assets/
│   ├── 1.png                    ← asset id=1, 拡張子は元ファイルから
│   ├── 1.meta.json              ← asset id=1 のメタデータ
│   ├── 2.jpg
│   ├── 2.meta.json
│   └── ...
└── folders.json
```

### 3.3 `manifest.json`

```json
{
  "version": 1,
  "exportedAt": "2025-01-10T14:30:00.000Z",
  "pageCount": 42,
  "assetCount": 15,
  "generator": "janus-local-export"
}
```

- `version`: スキーマバージョン。初期は `1`。インポート時にこの値を検証し、非互換バージョンはエラーにする。将来のスキーマ変更時にインクリメント。
- `exportedAt`: ISO 8601 UTC。
- `pageCount` / `assetCount`: 完全性チェック用。インポート時に実数と比較し、不一致は警告（エラーにはしない）。

### 3.4 ページ JSON（`pages/<encoded-path>.json`）

```json
{
  "path": "/docs/intro",
  "title": "Intro",
  "body": "# Introduction\n...",
  "created_at": "2025-01-01T00:00:00.000Z",
  "updated_at": "2025-01-05T12:00:00.000Z",
  "revisions": [
    {
      "number": 1,
      "title": "Intro",
      "body": "# Introduction\n...",
      "author": { "id": 1, "username": "local", "is_staff": true, "is_superuser": true },
      "created_at": "2025-01-01T00:00:00.000Z"
    },
    {
      "number": 2,
      "title": "Intro (updated)",
      "body": "# Introduction\nUpdated content...",
      "author": { "id": 1, "username": "local", "is_staff": true, "is_superuser": true },
      "created_at": "2025-01-05T12:00:00.000Z"
    }
  ],
  "comments": [
    {
      "body": "Good start!",
      "author": { "id": 1, "username": "local", "is_staff": true, "is_superuser": true },
      "created_at": "2025-01-02T10:00:00.000Z",
      "updated_at": "2025-01-02T10:00:00.000Z"
    }
  ]
}
```

- パスのファイル名エンコード: `/` → `%2F`、先頭 `/` を除去。ルートページ `path="/"` は `_root_` に変換。デコードは `decodeURIComponent` + `_root_` 判定。
- リビジョン・コメントはページ JSON に内包する（ページ単位での可搬性）。
- **`author` の往復規約（確定）**: revision・comment の `author` は `User` オブジェクト（`{ id, username, is_staff, is_superuser }`）で出力する。これは §4.2 の author 一本化規約と整合する。**インポート時の補完ルール**: `author` フィールドが欠落しているか `null` の場合は固定ユーザー `LOCAL_USER` を補完する。`author` が文字列（旧フォーマット互換）の場合は `LOCAL_USER` に変換する。これにより、インポート後に `getRevision`/`listComments` が返す値が型契約（`Revision.author: User | null`、`Comment.author: User | null`）に適合することを保証する。
- **ページの `created_by`/`updated_by` の往復規約（確定）**: エクスポート JSON にはページの `created_by`/`updated_by` を含めない（内部値扱い。`Page.id` と同方針）。**インポート時、ページの `created_by`/`updated_by` は常に `LOCAL_USER` を補完する**。これにより、インポート後の `getPage()` が返す `Page.created_by`/`Page.updated_by` が `User` オブジェクトであることを保証し、型契約（`Page.created_by: User | null`）に適合する。

### 3.5 アセットファイル（`assets/<id>.<ext>` + `assets/<id>.meta.json`）

バイナリ:
- ファイル名は `<id>.<ext>`。`ext` は `filename` から取得。拡張子がない場合は `.bin`。
- ZIP 内には非圧縮（`{compression: 'STORE'}`）で格納（画像は既に圧縮済みで再圧縮しても縮まず、CPU を無駄にする）。

メタデータ:
```json
{
  "id": 1,
  "folderId": 3,
  "filename": "floor-plan.png",
  "alias": "間取り図",
  "content_type": "image/png"
}
```

### 3.6 フォルダ構造（`folders.json`）

```json
[
  { "id": 1, "parentId": null, "name": "photos" },
  { "id": 2, "parentId": null, "name": "documents" },
  { "id": 3, "parentId": 1,    "name": "2025-01" }
]
```

- フォルダの ID は IndexedDB の auto-increment 値。インポート時は新 ID を振り直し、アセットの `folderId` を付け替える（ID マッピングテーブル）。

### 3.7 エクスポート処理フロー

1. IndexedDB から全データを読み出す（`pages`・`revisions`・`comments`・`folders`・`assets` の全レコード）。
2. `JSZip` インスタンスを生成し、上記レイアウトでファイルを追加。
3. `zip.generateAsync({ type: 'blob' })` で Blob を生成。
4. `URL.createObjectURL(blob)` → `<a download="janus-export-YYYYMMDD-HHmmss.zip" href={...}>` を動的生成してクリック → ブラウザダウンロード。
5. Blob URL を解放。

**進捗表示**: アセット数が多い場合に「エクスポート中… (42/100)」のテキスト進捗を表示。`JSZip.generateAsync` の `onUpdate` コールバックを使う。

### 3.8 インポート処理フロー

1. ファイル選択（`<input type="file" accept=".zip">`）で ZIP を受け取る。
2. `JSZip.loadAsync(file)` で展開。
3. `manifest.json` を読み、`version` を検証。非互換（`version > 1`）ならエラーメッセージを表示して中断。
4. **確認ダイアログ**: 「既存のローカルデータをすべて削除して、インポートデータで置き換えます。よろしいですか？」— ユーザーが「はい」を選択した場合のみ続行。
5. **ZIP 全エントリをメモリへ読み切る（非同期フェーズ）**: `folders.json`・全ページ JSON・全アセットのバイナリ（`blob`）とメタ JSON を、`zip.file(...).async(...)` の `await` をすべてこの段階で完了させ、プレーンな JS オブジェクト配列（`pages[]`・`revisions[]`・`comments[]`・`folders[]`・`assets[]`、`author` 補完済み・`folderId` 付替え済み・ID マッピング解決済み）に組み立てる。この段階では IndexedDB にまだ触れない。**メモリ組み立て時にページごとの revisions の `number` 一意性を検証する**: `revisions` ストアには複合一意インデックス `[path, number]`（§4.2）が張られるため、同一 `path` 内に重複する `number` があると、後続ステップ 6 の `put` が制約違反で原子トランザクション全体を abort させる（＝インポート不能）。壊れた/手編集された ZIP を早期に弾くため、この段階で各ページの revisions の `number` 一意性を検証し、違反時は専用メッセージ「エクスポートファイルのリビジョン番号が不正です」で中断する（IndexedDB にはまだ触れていないため既存データは無傷）。
6. **単一の `readwrite` トランザクションで同期書き込み（原子フェーズ）**: 全 6 ストアを対象にした 1 つの `readwrite` トランザクションを開き、その中で `store.clear()`（全ストア）→ メモリ上のレコードを `put` で書き込む。**トランザクション内では `await`（特に非同期 ZIP 読み出し）を一切挟まない**。IndexedDB のトランザクションはイベントループのタスクをまたぐと自動コミットで閉じるため、クリアと復元を単一トランザクションに保つにはステップ 5 で読み切ってから同期的に書く必要がある（これが原子性担保の肝）。トランザクションが `complete` すれば全書き込みが確定し、`abort`/`error` なら IndexedDB は自動ロールバックして元の全データ（クリア前）が保たれる。
7. `manifest.json` の `pageCount` / `assetCount` と実インポート数を比較し、不一致なら警告（致命エラーにはしない）。
8. 完了メッセージ + ページリロード（`location.reload()`）で UI を最新データで再描画。

**原子性の担保（確定）**: 「全クリア → 復元」は上記ステップ 6 の**単一 `readwrite` トランザクション**で原子的に行う。ステップ 5 で非同期読み出しを完了させてからステップ 6 を同期実行することで、「クリアはされたが復元前に失敗して空になる」中間状態を防ぐ。トランザクションが `abort`/`error` で失敗した場合、IndexedDB の自動ロールバックによりクリアも取り消され、インポート前の全データがそのまま残る（部分破壊なし）。万一ステップ 6 のトランザクションがブラウザ制約（容量超過 `QuotaExceededError` 等）で失敗した場合は、ロールバック後に `ApiError` を throw し、ユーザーに「インポートに失敗しました。既存データは保持されています。」と伝える。

### 3.9 サーバーモードでのエクスポート

要件 LM-3-6: サーバーモードでも同形式の ZIP エクスポートを可能にしたいが、サーバー側の全データ一括取得 API が存在しない。**サーバーモードのエクスポートは将来対応**とし、ローカルモードを優先する。UI 上、サーバーモード時はエクスポートボタンを非表示にするか、「サーバーモードでは未対応」の表示にする。

### 3.10 サーバー取り込みの将来方式（仕様記録のみ）

エクスポート ZIP をサーバーに取り込む方式として、以下を記録する。**本要件では実装しない。**

- **Django management command**: `python manage.py import_janus_zip <path-to-zip>` で ZIP を読み、`Page`・`Revision`・`Comment`・`Asset`（`FileField` に保存）・`Folder` を一括作成する。既存データとの衝突は `path` の一意制約で検出し、上書き or スキップをオプションで指定。
- **専用インポート API**: `POST /api/import` で ZIP を multipart で受け取り、同上の処理を行う。認証必須・`is_superuser` のみ。

### 3.11 エクスポート/インポートの UI 配置

ローカルモード時に `AppLayout` のヘッダーまたはメニューに「設定」リンクを追加し、設定画面（`/settings` — 新規ページ）にエクスポート/インポートボタンを配置する。設定画面には以下を置く:

- エクスポートボタン（「全データを ZIP で書き出す」）
- インポート（「ZIP からデータを復元する」＋ファイル選択）
- モード切替（「サーバーモードに切り替える」）

### 3.12 エラーハンドリング

| 失敗条件 | 回復可否 | ユーザーが受け取るもの |
|---|---|---|
| ZIP 生成中にメモリ不足 | 致命的 | 「エクスポートに失敗しました」エラーメッセージ |
| ZIP ファイルが壊れている / 非 ZIP | 回復可 | 「ZIP ファイルを読み込めませんでした」 |
| `manifest.json` が無い | 回復可 | 「Janus エクスポートファイルではありません」 |
| `version` が非互換 | 回復可 | 「このファイルは新しいバージョンの Janus で作成されたため読み込めません」 |
| リビジョン `number` 重複（同一 `path` 内） | 回復可 | ステップ 5 のメモリ組み立て段で検出し、IndexedDB に触れる前に中断。「エクスポートファイルのリビジョン番号が不正です」。既存データは無傷 |
| IndexedDB 書き込み中に `[path, number]` 一意制約違反 | 回復可 | 万一ステップ 5 の検証を通過しても、ステップ 6 の `put` が制約違反ならトランザクションが `abort` → IndexedDB が自動ロールバックしてインポート前の全データ（クリア前）が保持される。「インポートに失敗しました。既存データは保持されています。」 |
| IndexedDB 書き込み中にエラー（単一トランザクション内） | 回復可 | トランザクションが自動ロールバックされ、インポート前の全データが保持される。「インポートに失敗しました。既存データは保持されています。再度お試しください。」 |

### 3.13 テスト観点

- **エクスポート**: `fake-indexeddb` でデータを投入 → エクスポート関数 → JSZip で展開 → `manifest.json`/ページ JSON/アセットバイナリ/`folders.json` の構造と内容を検証。パスエンコード（`/` → `%2F`、ルート → `_root_`）の round-trip を検証。
- **インポート**: テスト用 ZIP を JSZip で生成 → インポート関数 → IndexedDB の各ストアのデータを検証。全クリア→復元が正しく行われることを確認。ID マッピング（フォルダ ID 振り直し → アセット `folderId` 付替え）の正しさを検証。
- **バリデーション**: 壊れた ZIP / `manifest.json` 無し / `version` 非互換でエラーが出ることを検証。同一 `path` 内に `number` が重複する revisions を含む ZIP をインポートすると、IndexedDB に触れる前に専用メッセージで中断し、既存データが無傷であることを検証（§3.8 ステップ 5 の一意性検証）。
- **round-trip（ZIP 等価）**: エクスポート → インポート → 再エクスポート → 2 つの ZIP の内容が等価であることを検証。
- **round-trip（復元後の型適合）**: エクスポート ZIP をインポートした後、`getRevision`/`listRevisions`/`listComments` が返す値が型契約（`Revision.author: User | null`・`RevisionSummary.author: User | null`・`Comment.author: User | null`）に適合することを検証する。特に `author` が `User` オブジェクト（`id=1`）であり `undefined`/文字列でないこと、`CommentSection` の `comment.author.id === user.id` 判定が成立することを確認する。`author` 欠落 / `null` / 文字列を含む ZIP をインポートした場合に `LOCAL_USER` へ補完されることも検証する（§3.4 の補完ルール）。`getPage().created_by`/`getPage().updated_by` が `User` オブジェクト（`LOCAL_USER`）であることを検証する（§3.4 のページ `created_by`/`updated_by` 補完ルール）。

---

## 4. LocalClient（IndexedDB 版 StorageClient）（§LM-2）

### 4.1 概要

`LocalClient` は `StorageClient` 契約（調査 §1 で確認した **6 サブインターフェース・31 メソッド**）を IndexedDB で完全実装する新規クラス（`frontend/src/storage/local-client.ts`）。TypeScript コンパイルレベルで `StorageClient` 型に合致する（`implements StorageClient`）。IndexedDB アクセスは薄い Promise ラッパー `frontend/src/storage/idb.ts` に閉じ込め、`LocalClient` はそれ経由でストアに触れる。

> メソッド数の内訳（調査 §1 と types.ts で検証済み）: AuthClient 3 + PageClient 10 + AssetClient 8 + SearchClient 1 + PermissionClient 5 + CommentClient 4 = **31 メソッド**。要件・調査は「34 メソッド」と記すが、これは `AssetClient` を 7 と数えた（`resolveAssetUrl` を除外した）集計で、types.ts の実インターフェース（`AssetClient` は 8 メソッド＝`listFolders`/`createFolder`/`listAssets`/`uploadAsset`/`moveAsset`/`getAssetFileUrl`/`releaseAssetFileUrl`/`resolveAssetUrl`）では合計 31 になる。**本設計は types.ts の実インターフェースを正とし、31 メソッド全てを実装対象とする**（数え方の差であり、実装すべきメソッド集合は types.ts で一意に確定している）。

> **注記（文書整合）**: `requirements.md` および `investigation.md` の「34 メソッド」は `AssetClient` のメソッド数を 7 と誤算した集計であり誤記である。**本設計の 31 が正（master）**であり、実装すべきメソッド集合は `types.ts` で一意に確定している。下流（`tasks.md` 等）は 31 を基準とすること。

### 4.2 IndexedDB スキーマ（DB 名 `janus-local`・version 1）

調査「結論」のスキーマ概略を正とし、以下に確定する。

| オブジェクトストア | keyPath / autoIncrement | インデックス | フィールド |
|---|---|---|---|
| `pages` | `path`（keyPath・一意） | （なし。全走査でツリー構築） | `id`, `path`, `title`, `body`, `created_at`, `updated_at`, `created_by`, `updated_by` |
| `revisions` | `id`（autoIncrement） | `path`（非一意）, `[path, number]`（一意） | `path`, `number`, `title`, `body`, `author`（`User` オブジェクト・固定ユーザー）, `created_at` |
| `comments` | `id`（autoIncrement） | `path`（非一意） | `path`, `body`, `author`（`User` オブジェクト・固定ユーザー）, `created_at`, `updated_at` |
| `folders` | `id`（autoIncrement） | `parentId`（非一意） | `parentId`, `name`, `created_at`, `updated_at` |
| `assets` | `id`（autoIncrement） | `folderId`（非一意） | `folderId`, `filename`, `alias`, `blob`, `content_type`, `created_at`, `updated_at` |
| `meta` | `key`（keyPath） | （なし） | `key`, `value`（スキーマバージョン・将来の設定格納用） |

**設計判断**:

- **`pages` の keyPath は `path`**（auto id を使わない）。理由: ページは `path` で一意に引く（`getPage(path)`）操作が支配的で、`path` を主キーにすれば `store.get(path)` で O(1) 取得できる。types.ts の `Page.id`（number）は `path` のハッシュ的な代替として、`path` から導出した安定数値（後述）を入れる。調査スキーマは「`path`(unique)」としており整合する。
- **`revisions` の複合インデックス `[path, number]`**（一意）: `getRevision(path, number)` の直接引き、および `createPage`/`updatePage` 時の採番整合に使う。`path` 単独インデックスは `listRevisions(path)` の走査に使う。
- **`Page.id` の扱い（確定・根拠付き）**: types.ts は `Page.id: number` を要求するが、IndexedDB では `path` が主キーのため連番 id が自然には存在しない。**フロントエンド全画面での `Page.id` 利用を確認済み**: `PageViewPage`/`PageEditPage`/`PageHistoryPage`/`PagePermissionPage`/`AssetLibraryPage`/`CommentSection` を走査し、`Page.id` を React `key` や URL パラメータ・比較・参照保持に使用している箇所は**無い**（画面は `page.path`/`page.title`/`page.body` を使い、`page.id` はリスト描画の `key` にすら使われていない）。`id` を使うのは `rev.id`（RevisionSummary の key）・`folder.id`/`asset.id`/`comment.id`（それぞれ専用ストアの autoIncrement）であり、`Page.id` は型を満たす以上の役割を持たない。したがってエクスポート JSON に `Page.id` を含めず、インポート時に `meta.page_seq` カウンタから振り直しても往復で壊れる画面は無い。本設計ではページ作成時に `meta` ストアの連番カウンタ（`page_seq`）から安定した正の整数を `Page.id` に格納し、型契約を満たす。**`page_seq` の read-modify-write は `createPage` と同一トランザクション内で行う**（§4.7 のトランザクション境界を参照）。エクスポート ZIP には `Page.id` を含めない（内部値のため）。
- **`created_by` / `updated_by`**: types.ts の `Page` は `created_by: User | null` を持つ。ローカルは常に固定ユーザーを入れる（`{ id: 1, username: 'local', is_staff: true, is_superuser: true }`）。
- **`author` の型（確定・author 一本化規約）**: types.ts では `Comment.author`・`Revision.author`・`RevisionSummary.author` がいずれも `User | null`。**IndexedDB には常に固定ユーザー `User` オブジェクト（`LOCAL_USER`）を格納し、`listComments`/`getRevision`/`listRevisions` は `author: LOCAL_USER` で返す**ことに一本化する。文字列（`username` のみ）での保存はしない（型契約違反になるため）。この規約はエクスポート/インポート（§3.4）とも整合させる。採用理由: `CommentSection.tsx` は `comment.author.id === user.id` でコメントの編集/削除可否を判定しており（調査で確認）、`author` が `User` オブジェクトかつ `id` が `useAuth()` の `user.id`（＝`LOCAL_USER.id = 1`）と一致している必要がある。文字列保存だと実行時に `author.id` 参照が壊れる。したがって `author` は `LOCAL_USER`（`id=1`）で統一する。

### 4.3 `idb.ts`（薄い Promise ラッパー）

```ts
// 概念設計（実装は後続ステップ）
export function openDb(): Promise<IDBDatabase>  // onupgradeneeded でストア/インデックス作成
export function tx<T>(db, stores, mode, fn: (tx) => Promise<T>): Promise<T>
export function getByKey<T>(store, key): Promise<T | undefined>
export function getAll<T>(store): Promise<T[]>
export function getAllByIndex<T>(store, index, query): Promise<T[]>
export function put<T>(store, value): Promise<IDBValidKey>
export function del(store, key): Promise<void>
export function clearStore(store): Promise<void>
```

- `openDb` は `onupgradeneeded`（version 1）で 6 ストアとインデックスを作成する。将来のスキーマ変更は version を上げ、`onupgradeneeded` 内で差分マイグレーションする（初期は version 1 のみ・非機能要件「スキーマは version 1 のみ、マイグレーション機構は予約」）。
- 全ての IDB リクエストを `Promise` に包み、`onsuccess`/`onerror` を resolve/reject にブリッジする。
- `LocalClient` は DB 接続を遅延初期化（最初のメソッド呼出時に `openDb` を 1 回だけ実行し、`Promise<IDBDatabase>` をキャッシュ）。

### 4.4 AuthClient 実装（ダミー・3 メソッド）

固定ユーザー定数 `LOCAL_USER = { id: 1, username: 'local', is_staff: true, is_superuser: true }`。

| メソッド | 実装 |
|---|---|
| `currentUser()` | `Promise.resolve(LOCAL_USER)` を即返す（§2.5 の認証バイパスの要）。 |
| `login(username, password)` | 引数を無視し `Promise.resolve({ token: 'local', user: LOCAL_USER })`。実質 no-op。 |
| `logout()` | `Promise.resolve()`（no-op）。 |

### 4.5 PermissionClient 実装（ダミー・5 メソッド）

単一ユーザー・全権限許可。

| メソッド | 実装 |
|---|---|
| `getEffectivePermission(path)` | `Promise.resolve({ view: true, edit: true })` 固定。 |
| `listPermissions(path)` | `Promise.resolve([])`（空配列）。 |
| `grantPermission(input)` | ローカルでは権限概念が無いため、ダミーの `PermissionEntry` を即返す（画面が戻り値を使う場合に型を満たす）。副作用なし。 |
| `updatePermission(id, effect)` | 同上。ダミー `PermissionEntry` を返す。 |
| `revokePermission(id)` | `Promise.resolve()`（no-op）。 |

> `grantPermission`/`updatePermission` を no-op ではなくダミー戻り値にする理由: 戻り値型が `Promise<PermissionEntry>` のため、`undefined` を返すと型違反。画面（`PagePermissionPage`）はローカルモードでは実質無意味だが、呼ばれても型安全に動くよう、入力をエコーした `PermissionEntry` を合成して返す。権限管理画面の非表示化は将来対応（要件スコープ外）。

### 4.6 SearchClient 実装（1 メソッド）

| メソッド | 実装 |
|---|---|
| `search(query)` | `throw new Error('search() はフェーズ 4 で実装します')`。`RestClient` と同一挙動（調査 §1）。 |

### 4.7 PageClient 実装（10 メソッド）

| メソッド | 実装 |
|---|---|
| `getPage(path)` | `pages` ストアを `normalize(path)` で `get`。無ければ `null`。 |
| `listChildren(parentPath)` | 全 `pages` を走査し、`parentPath` の直下 1 階層（プレフィックス一致かつ深さ +1）を `PageSummary[]`（`path`/`title`）で返す。`RestClient` の `/api/pages/children` と同契約。パス昇順。 |
| `getPageTree(root?)` | 全 `pages` の `path` を走査してネストツリーを構築（§4.8）。 |
| `createPage({path, title, body})` | `path` を正規化。既存チェック（既にあれば `ApiError(409)` 相当を throw）。`pages` に `put` + リビジョン #1 を `revisions` に `put`。`created_by`/`updated_by`=固定ユーザー。戻り値 `Page`。 |
| `updatePage(path, {title, body})` | `pages` を更新 + 新リビジョン（現在の最大 number + 1）を `revisions` に追加。`updated_at` を現在時刻に。戻り値 `Page`。無ければ `ApiError(404)` 相当を throw。**本文不変最適化（サーバー `save_page_body` と同一）**: 最新リビジョンの body と新 body が同一なら新リビジョンを作らない。title のみ変化時は `Page.title`/`updated_at` を更新（`updated_by` も更新）。body も title も不変なら `updated_at` を動かさない。 |
| `deletePage(path)` | `pages` から削除 + `revisions`（`path` インデックス）+ `comments`（`path` インデックス）の関連レコードを 1 トランザクションで削除。 |
| `listRevisions(path, {limit, offset})` | `revisions` の `path` インデックスで取得し `number` 降順。`limit`/`offset` でスライス。`RevisionSummary[]`（body/title を含まない軽量形）。各要素の `author` は `LOCAL_USER` で返す（§4.2 の author 規約）。**返却オブジェクトは `revisions` ストアの autoIncrement `id` をそのまま含める**（`RevisionSummary.id` を満たす。`PageHistoryPage.tsx` L210/L262/L277 が `rev.id` を React `key` に使うため、一覧内で安定かつ一意な `id` が必須）。 |
| `getRevision(path, number)` | `revisions` の `[path, number]` インデックスで取得。`Revision` の `author` は `LOCAL_USER` で返す。**返却オブジェクトは `revisions` ストアの autoIncrement `id` をそのまま含める**（`Revision.id` を満たす）。無ければ throw（`RestClient` と同じく null にしない）。 |
| `diffRevisions(path, from, to)` | `from`/`to` の本文を取得し、`diff` ライブラリで行差分 → `DiffLine[]`（§4.9）。 |
| `restoreRevision(path, number)` | 指定リビジョンの本文（`body`）**およびタイトル（`title`）**で `updatePage(path, {title, body})` を呼ぶ（新リビジョン化）。戻り値 `Page`。**サーバー版 `RevisionRestoreView` の動作確認済み**: `save_page_body(page, title=revision.title, body=revision.body, author=request.user)` を呼び、title と body の両方を復元する。新リビジョンの `number` は `(最新 number or 0) + 1`。本文が最新と同一の場合はリビジョンを作らない（本文不変最適化）。ローカル版もこの挙動に合わせる（`updatePage` の本文不変最適化は §4.7 `updatePage` の実装に含む）。新リビジョンの `author` は固定ユーザー `LOCAL_USER`。 |

**トランザクション境界**: `createPage` はページ書込・リビジョン書込・`Page.id` 採番を**1 トランザクション**（`['pages', 'revisions', 'meta']` を対象にした `readwrite` tx）で行う。同一トランザクション内で `meta.page_seq` の `get` → `+1` → `put` と `pages`/`revisions` の `put` を**すべて同期的に**完結させ（途中で `await` を挟まない）、ページ書込とカウンタ更新の原子性を担保する。これにより「ページは書けたがカウンタ更新前に失敗して次回同一 `id` を採番する」衝突や、トランザクション分割による read-modify-write の非アトミック化を防ぐ（単一ユーザーでも `createPage` の非同期連続呼出しで競合し得るため必須）。`updatePage` はページ書込とリビジョン書込を**1 トランザクション**（`pages` + `revisions` を含む `readwrite` tx。`Page.id` は既存ページから引き継ぐため `meta` は不要）で行い、途中失敗で片方だけ書かれる不整合を防ぐ（非機能要件 5「トランザクション単位」）。`deletePage` も `pages`/`revisions`/`comments` を 1 トランザクションで。

### 4.8 `getPageTree` のクライアント側ツリー構築

サーバーの `PageTreeView`（janus-sidebar-page-tree 設計 §2.4）と**同等のロジックをクライアント側に移植**する。全 `pages` の `path` を走査して以下を行う:

1. `root`（既定 `/`）配下の全ページを集める（`path.startsWith(prefix)`、`prefix = root==='/' ? '/' : root+'/'`）。
2. 各ページの各セグメント境界で中間ノードを導出し、実ページの無い中間パスは**仮想ノード**（`hasPage=false`）にする。
3. `path` キーの Map でノードを登録し親子接続。`title` は実ページなら `Page.title`、無ければ末尾セグメント。
4. **空仮想ノードのボトムアップ剪定**（janus-sidebar-page-tree 設計 §2.5 手順 7.5 と同一）: `hasPage=false` かつ子なしのノードを除去。ただしローカルは全権限許可のため権限枝刈りは発生せず、空仮想ノードは「中間パスだが実ページも実ページ子孫も無い」ケースでしか生じない。実運用では剪定対象はほぼ無いが、サーバー版と同じ不変条件（`hasPage=false` のノードは必ず子を持つ）を保つため剪定ロジックを入れる。
5. パス昇順に整列し、各ノードの `hasChildren = children.length > 0` を確定。
6. `PageTreeNode[]` を返す。

**権限枝刈りは不要**（要件 LM-2-6「全権限許可のため」）。これはサーバー版との唯一の差分で、サーバー版の「`require_page_permission` フィルタ」ステップをスキップするだけ。ツリー構築の純粋ロジック（中間ノード導出・剪定・整列）は共通のため、`frontend/src/storage/page-tree-build.ts`（純粋関数）に切り出し、単体テスト可能にする。

> サーバー版ロジックの重複についての判断: サーバー（Python・`PageTreeView`）とクライアント（TS・`page-tree-build.ts`）で同じツリー構築ロジックを**二重に持つ**ことになる。共通化（例: WASM 共有）は過剰であり、両者は言語もランタイムも異なるため、**TS 側に独立実装を持ち、両者が同じレスポンス形状（`PageTreeNode`）を返すことを型とテストで担保する**方針を採る。サーバー版の振る舞い（仮想ノード・剪定・昇順）を仕様として踏襲し、`page-tree-build.ts` のテストでサーバー版 §2.9 と同等のケース（ネスト・仮想ノード・空ツリー・`hasChildren` 一致）を検証する。

### 4.9 `diffRevisions` の差分ライブラリ採用

サーバーは Python `difflib.unified_diff` 相当を使う（調査「結論」）。クライアントは **`diff` パッケージ（npm `diff`）** を採用する。

- 採用理由: `diff` は最も広く使われる JS 差分ライブラリ（週 4000 万 DL 超・MIT）で、`diffLines(oldStr, newStr)` が行単位の差分を `{ added, removed, value }[]` で返す。これを `DiffLine[]`（`{ op: 'add'|'del'|'equal', line: string }`）へ変換するのは単純なマッピングで済む。自前実装（Myers 法等）は車輪の再発明でテスト負担が大きく、大原則 (5) に反しない範囲（単一・軽量・保守されている）で既存ライブラリを使う方が堅牢。
- 変換ロジック: `diffLines(from.body, to.body)` の各ハンクを行に分解し、`added`→`op:'add'`、`removed`→`op:'del'`、どちらでもない→`op:'equal'` にマップ。末尾改行の扱いはサーバー版の出力に合わせる（空行の過剰生成を避けるため、`value` を改行で split し末尾の空要素を落とす）。
- **サーバー版との完全一致は保証しない（確定判断）**: サーバーの `difflib` とクライアントの `diff` はアルゴリズムが異なり、同じ入力でもハンク分割が微妙に違い得る。ローカルモードとサーバーモードは**別環境**であり、同一ページの差分を両モードで突き合わせる要件は無い。したがって「行単位で add/del/equal を正しく返す」ことを満たせば十分とし、サーバーとのバイト単位一致は目標にしない。この判断を確定事項とする。

### 4.10 CommentClient 実装（4 メソッド）

| メソッド | 実装 |
|---|---|
| `listComments(path)` | `comments` の `path` インデックスで取得し `created_at` 昇順（`RestClient` と同契約）。`author` は `User` オブジェクト（`LOCAL_USER`）で返す（§4.2 の author 規約）。 |
| `addComment(path, body)` | バリデーション（空・空白のみは `ApiError(400)` 相当を throw）後、`author` に固定ユーザー `User` オブジェクト（`LOCAL_USER`、`id=1`）を入れて `put`。戻り値 `Comment`（`author: LOCAL_USER`）。`CommentSection` の `comment.author.id === user.id` 判定が成立するよう、`author.id` は `useAuth()` の `user.id` と一致させる。 |
| `updateComment(id, body)` | `comments` を `id` で取得 → `body`/`updated_at` を更新。無ければ throw。 |
| `deleteComment(id)` | `comments` から `id` で削除。 |

### 4.11 AssetClient 実装（8 メソッド）→ §5 で詳説

`listFolders`/`createFolder`/`listAssets`/`uploadAsset`/`moveAsset`/`getAssetFileUrl`/`releaseAssetFileUrl`/`resolveAssetUrl`。Blob 保存・URL 生成・`resolveAssetUrl` の複合ロジック移植は §5 で詳述。

### 4.12 入力バリデーション（LocalClient 全般）

| 入力 | 必須/任意 | 型・制約 | 失敗時の挙動 |
|---|---|---|---|
| `createPage.path` | 必須 | 文字列。`normalize_path` 相当のフロント正規化（過剰スラッシュ・`.`/`..` 除去・絶対パス化）。 | 正規化後に既存チェック。重複は `ApiError(409)` 相当を throw。 |
| `createPage.body` | 必須 | 文字列。 | 省略時は空文字扱い（`RestClient`/サーバーの既定に合わせる）。 |
| `createPage.title` | 任意 | 文字列。 | 省略時は末尾セグメントを既定タイトルに。 |
| `addComment.body` | 必須 | 空・空白のみ不可。長さ上限はサーバー同等。 | `ApiError(400)` 相当を throw。 |
| `uploadAsset.file` | 必須 | `File`。 | 無指定は `ApiError(400)` 相当。 |
| `getPageTree.root` | 任意（既定 `/`） | 文字列。正規化。 | 不正値は `/` に畳む（サーバー版と同じ）。 |

> パス正規化の所有層: サーバー版は `normalize_path`（Python・`utils.py`）が所有する。ローカルでは**フロント側に同等の正規化関数** `frontend/src/storage/path-normalize.ts`（新規・純粋関数）を置き、`LocalClient` のページ系メソッドが呼ぶ。これはサーバーの Python 実装の移植だが、ローカルモードはサーバーと通信しないため TS 側に独立して持つ必要がある。`RestClient` 経由（サーバーモード）では正規化はサーバーが行うため、この関数はローカル専用。

### 4.13 エラーハンドリング（LocalClient）

`RestClient` が `ApiError(status, message, detail)` を throw する契約（types.ts）に合わせ、`LocalClient` も**同じ `ApiError` を throw**して画面側のエラー処理（`usePageError` 等）を変更不要にする。

| 操作 | 失敗条件 | 可否 | 呼び出し側が受け取るもの | ログ |
|---|---|---|---|---|
| `openDb` | IndexedDB 非対応 / 容量不可 | 致命的 | `ApiError(500, 'ローカルストレージを開けません')` | `console.error` |
| `getPage` | 存在しない | 正常系 | `null`（throw しない。`RestClient` と同契約） | なし |
| `getRevision` | 存在しない | 回復可 | `ApiError(404)` を throw（`RestClient` と同じく null にしない） | なし |
| `createPage` | path 重複 | 回復可 | `ApiError(409)` を throw | なし |
| `updatePage`/`deletePage` | 対象ページ無し | 回復可 | `ApiError(404)` を throw | なし |
| `addComment` | 空本文 | 回復可 | `ApiError(400)` を throw | なし |
| 書込系全般 | QuotaExceededError（容量超過） | 致命的 | `ApiError(507, '保存容量が不足しています')` を throw | `console.error` |
| `search` | 常に | — | `Error`（フェーズ 4 未実装・`RestClient` と同一） | なし |

QuotaExceededError は IndexedDB の `transaction.onabort` / リクエストの `onerror` で検出し、`ApiError(507)` に変換する。これは画面側がストレージ逼迫をユーザーに伝えられるようにするため（容量管理は PWA の `navigator.storage.persist()` 推奨とあわせて非機能要件 3 に接地）。

### 4.14 型レベル適合（LM-2-9）

`class LocalClient implements StorageClient` と宣言し、`npx tsc --noEmit` で 31 メソッド全ての型一致を強制する。これにより、types.ts の契約変更時にコンパイルエラーで気付ける。`StorageProvider` の `client` prop は `StorageClient` 型のため、`new LocalClient()` を渡すのも型安全。

### 4.15 テスト観点（LocalClient）

`fake-indexeddb`（devDependency 追加）で IndexedDB をメモリ上にモックし、Vitest（node 環境でも可・`fake-indexeddb/auto` を import）で検証する。

- **スキーマ**: `openDb` が 6 ストア + 期待インデックスを作る。
- **PageClient**: `createPage`→`getPage` round-trip、`updatePage` でリビジョンが増える、`deletePage` で関連リビジョン・コメントも消える、`listChildren` が直下 1 階層のみ、`listRevisions` が降順＋ `limit`/`offset`。`listRevisions` の各要素が一意な `id`（autoIncrement 由来）を持つ。`createPage` が `meta.page_seq` から `Page.id` を採番し、連続作成で `id` が衝突しない。
- **`getPageTree`（`page-tree-build.ts` 純粋関数）**: ネスト構造・仮想ノード（中間パスに実ページ無し）・空ツリー・`hasChildren == (children.length>0)`・剪定（空仮想ノードが現れない）。サーバー版 §2.9 と同等ケース。
- **`diffRevisions`（差分変換）**: 追加のみ/削除のみ/混在/無変更で `DiffLine[]` の `op` が正しい。純粋関数（`diff` ラップ）として単体テスト。
- **CommentClient**: 投稿→一覧（昇順）→更新→削除。空本文で `ApiError(400)`。
- **AuthClient/PermissionClient ダミー**: 固定ユーザー/全許可を返す、no-op が throw しない。
- **`search`**: throw する。
- **エラー**: 重複 path で 409、無しページ更新で 404。
- **型適合**: `implements StorageClient` がコンパイルを通る（tsc）。
- **非破壊**: 既存 frontend テスト（311 passed）が回帰ゼロ。`stub-storage.ts` は変更不要（LocalClient は実クライアントでありスタブとは別）。

---

## 5. アセットの Blob 保存（§LM-5）

### 5.1 概要

`LocalClient` の `AssetClient` 実装 8 メソッドを詳述する。アセットのバイナリは IndexedDB の `assets` ストアに `Blob` として直接保存する（`FileField` → `MEDIA_ROOT` の代替）。URL 生成は `URL.createObjectURL` で行い、`RestClient` の「認証付き fetch → Blob URL」パターン（調査 §5、`rest-client.ts` L570-580）と同じ最終出力（Blob URL）を返す。

### 5.2 各メソッドの実装

| メソッド | 実装 |
|---|---|
| `listFolders(parentFolderId)` | `folders` の `parentId` インデックスで取得。`created_at` 昇順。`Folder[]` を返す。 |
| `createFolder({parentId, name})` | 一意チェック（同一 `parentId` + `name` の既存フォルダ → `ApiError(409)`）後、`folders` に `put`。auto ID 付与。戻り値 `Folder`。 |
| `listAssets(folderId)` | `assets` の `folderId` インデックスで取得。`created_at` 昇順。戻り値 `Asset[]`。各アセットの `url` フィールドは空文字（`''`）を入れる（後述）。 |
| `uploadAsset({folderId, file, alias?})` | `file.arrayBuffer()` で Blob データを取得し、`assets` ストアに `{ folderId, filename: file.name, alias: alias ?? '', blob: file, content_type: file.type, ... }` として `put`。auto ID 付与。戻り値 `Asset`（`url` は空文字）。**一意制約チェック**: 同一 `folderId` + `filename` の既存アセットがあれば `ApiError(409)` を throw する。`alias` が空でなく、同一 `folderId` + `alias` の既存アセットがあれば同様に `ApiError(409)`（サーバー `Asset` の `(folder, filename)`/`(folder, alias)` 一意制約と同等）。重複チェックは `assets` の `folderId` インデックスで同一フォルダ内を走査し、`filename`/`alias` を比較する。 |
| `moveAsset(assetId, toFolderId)` | `assets` を `assetId` で取得 → `folderId` を更新 → `put`。戻り値 `Asset`。 |
| `getAssetFileUrl(asset)` | `assets` を `asset.id` で取得 → `blob` フィールドから `URL.createObjectURL(blob)` を生成して返す。 |
| `releaseAssetFileUrl(url)` | `url.startsWith('blob:')` なら `URL.revokeObjectURL(url)`（`RestClient` と同一）。**注意: このメソッドは同期 `void` を返す（`Promise<void>` ではない）**。types.ts で唯一の同期メソッドであり、`async` 化すると `implements StorageClient` の型が通らない。 |
| `resolveAssetUrl(ref)` | §5.3 |

**`Asset.url` の扱い**: types.ts の `Asset` は `url: string` を持ち、`RestClient` ではサーバーの `GET /api/assets/:pk/file` URL が入る。ローカルでは認証付きエンドポイントが無いため `url` は空文字 `''` とする。画面はアセット表示時に `getAssetFileUrl(asset)` を呼んで Blob URL を取得する（`AssetLibraryPage` の L264: `storage.getAssetFileUrl(asset)`）ため、`asset.url` を直接使う経路は `AssetLibraryPage.tsx` L425（「登録URL」表示）のみ。ローカルモードでは空文字表示になるが実害なし（将来: ローカル固有の表示に差し替え可能）。

### 5.3 `resolveAssetUrl` の移植

`RestClient.resolveAssetUrl`（L620-652）は以下のロジック:
1. `ref.baseFolderPath` のセグメントから開始し、各 `specifier` のパスを解決してフォルダ ID を特定。
2. 特定フォルダ内のアセットを `filename` または `alias` で検索。
3. 見つかったら `getAssetFileUrl(asset)` を呼んで Blob URL を返す。
4. 全指定子を試して見つからなければ `null`。

`LocalClient` でも同等のロジックを持つ。違いは「`this.listFolders`/`this.listAssets` がローカル IndexedDB に向く」だけで、ロジック構造は同じ。`RestClient` のプライベートヘルパ `folderSegments`・`findFolderId` に相当するメソッドを `LocalClient` 内に実装する。

- **パス解決（`folderSegments`）**: `/` 区切りセグメント化。`.` は無視、`..` は `pop`。絶対パス（`/` 始まり）は base をリセット。
- **フォルダ ID 解決（`findFolderId`）**: セグメントを上から辿り、各レベルで `listFolders(parentId)` → `name` 一致を検索。見つからなければ `undefined`。
- **キャッシュ**: `resolveAssetUrl` 1 回の呼出し中でフォルダ走査を重複実行しないよう `Map<string, number|null|undefined>` でキャッシュ（`RestClient` と同じパターン）。

### 5.4 IndexedDB での Blob 保存の注意点

- IndexedDB は `File`/`Blob` の直接格納をサポートする（Structured Clone Algorithm）。Firefox / Chrome ともにモダンバージョンで問題なし（対象ブラウザ・非機能要件 7）。
- 大容量ファイル（例: 50MB の CAD ファイル）は IndexedDB のストレージ容量に影響する。PWA の `navigator.storage.persist()` リクエスト（§7.5）で eviction を防ぐ。
- `URL.createObjectURL` で生成した Blob URL は `releaseAssetFileUrl` で明示的に解放する必要がある（メモリリーク防止）。画面側（`AssetLibraryPage`・`CustomMapViewer`）は既に解放パターンを実装済み（`unmount` 時に `releaseAssetFileUrl` を呼ぶ）。

### 5.5 テスト観点

- **`uploadAsset` → `getAssetFileUrl` round-trip**: `fake-indexeddb` + `File` オブジェクト → Blob URL が `blob:` で始まる。
- **`uploadAsset` 一意制約**: 同一 `folderId` + `filename` の重複アップロードで `ApiError(409)`。空でない `alias` の重複でも `ApiError(409)`。
- **`resolveAssetUrl`**: フォルダ階層 + filename/alias 指定の組合せで正しいアセットを解決する。見つからなければ `null`。
- **`createFolder` 一意制約**: 同一親 + 同名で `ApiError(409)`。
- **`moveAsset`**: 移動後に `listAssets(newFolderId)` で見つかる。

---

## 6. カメラ撮影（§LM-6）

### 6.1 概要

MapEditor の写真添付 `<input type="file" accept="image/*">`（調査 §4 確認済み: `MapEditor.tsx` L406-414）に、ローカルモード時のみ `capture="environment"` 属性を追加する。これによりモバイルブラウザでカメラ撮影 UI が直接開く。`getUserMedia` API は使わない（要件 LM-6-4）。

### 6.2 変更箇所

**ファイル**: `frontend/src/markdown/custom-map/MapEditor.tsx`

変更前:
```tsx
<input
  id={`marker-${i}-photo`}
  className={PHOTO_INPUT_CLASS}
  type="file"
  accept="image/*"
  onChange={...}
/>
```

変更後:
```tsx
<input
  id={`marker-${i}-photo`}
  className={PHOTO_INPUT_CLASS}
  type="file"
  accept="image/*"
  capture={isLocalMode ? 'environment' : undefined}
  onChange={...}
/>
```

### 6.3 モード判定の取得方法

`MapEditor` は `useStorage()` 経由で `StorageClient` を取得するが、`StorageClient` にはモード判定メソッドが無い。モード判定を `MapEditor` に伝える方法として以下を選択する:

**選択: `localStorage` 直読み**。`readMode()` 関数（§2 で定義）を直接呼ぶ。理由: `capture` 属性の出し分けはレンダー時 1 回だけで十分で、リアクティブ性は不要。新たな Context や prop drilling を避け、最小変更で済む。`readMode()` は純粋な localStorage 読みなので副作用もない。

**前提と既定（モード確定の保証）**: `MapEditor` が描画される時点では必ずモード選択済みである（§2 のフロー上、`janus-mode` が未設定なら `ModeGate` が描画され App 本体＝ページ閲覧/編集画面には到達しないため）。したがって `MapEditor` 到達時の `readMode()` は常に `'local'`/`'server'` を返す。仮に将来 `ModeGate` を介さない経路が増えて `readMode()` が `null` を返す場合でも、`capture={isLocalMode ? 'environment' : undefined}` の判定は `null !== 'local'` → `undefined`（＝ `capture` 属性なし・サーバー相当）に倒れるため安全に既定動作する。

代替案（不採用）:
- StorageClient に `isLocal(): boolean` メソッドを追加 → 契約変更（非破壊原則に違反）。
- Context でモード配布 → 過剰設計（1 箇所のためだけに Provider を追加する必要なし）。

### 6.4 Android Chrome の `capture` 属性挙動（未確認）

調査 §4 にて「`capture` を付けるとファイル選択が撮影のみに制限されるブラウザがある（Android Chrome 等）」と記載。この挙動は**未確認**（実機検証未実施）。

**本設計での対処**: 最小スコープとして `capture="environment"` を条件付きで 1 属性足すだけにする（要件 LM-6「最小対応」に合致）。Android Chrome で撮影のみに制限される場合は、将来対応としてカメラボタンとファイル選択ボタンを分離する（調査 §4 推奨案 2）。初期実装では分離しない。

### 6.5 テスト観点

- **条件付き `capture` 属性**: `isLocalMode` のモック → `input` 要素に `capture="environment"` がある / ない。Testing Library の `getAttribute('capture')` で検証。
- **既存 `attachPhoto` 経路不変**: カメラ撮影で取得した画像も通常の `File` オブジェクトとして `uploadAsset` に渡される（`attachPhoto` 関数の変更なし）。既存テストが回帰ゼロ。

---

## 7. PWA 化（§LM-7）

### 7.1 概要

`vite-plugin-pwa` を新規追加し、(1) manifest 生成、(2) Service Worker（Workbox precache）生成、(3) 自動登録を行う。draw.io webapp（約 19MB）を含む全静的ファイルをプリキャッシュし、オフラインでアプリ起動・draw.io 編集を可能にする。

### 7.2 `vite-plugin-pwa` 設定（`vite.config.ts`）

```ts
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',     // 更新があればユーザーにプロンプト表示
      includeAssets: ['drawio/webapp/**/*'],  // public 配下の draw.io を precache に含める
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,  // 25MB（draw.io app.min.js 等対応）
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],  // /api/ はサーバーモード時に SW がインターセプトしない
      },
      manifest: {
        name: 'Janus',
        short_name: 'Janus',
        start_url: '/',
        display: 'standalone',
        theme_color: '#171717',       // --color-bg（dark テーマ基調に合わせる）
        background_color: '#171717',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        enabled: false,  // 開発時は SW 無効（要件 LM-7-6）
      },
    }),
  ],
  // ... 既存の server.proxy / test 設定は不変
})
```

### 7.3 設定判断の詳細

**`registerType: 'prompt'`**（確定）: 新バージョンが利用可能な場合にユーザーに更新プロンプトを表示する（要件 LM-7-8）。`'autoUpdate'`（自動更新）だとユーザーが作業中にアプリが差し変わるリスクがあり、ローカルモードのデータ編集中に望ましくない。`'prompt'` で「新しいバージョンがあります。更新しますか？」を表示し、ユーザーが承認したらリロードする。更新プロンプトの UI は `vite-plugin-pwa` の `useRegisterSW` フックで最小実装する。

**`maximumFileSizeToCacheInBytes: 25MB`**（確定）: draw.io webapp は約 19MB。個別ファイルで最大のものは `app.min.js`（推定数 MB）。Workbox のデフォルト上限は 2MB のため引き上げが必須（調査 §3、要件 LM-7-3）。25MB は「19MB 全体 + マージン」で十分。

**`includeAssets`（確定）**: `['drawio/webapp/**/*']` で `public/drawio/webapp/` 配下の全ファイルを precache 対象にする。Vite の build は `public/` を `dist/` にそのままコピーするため、build 後の `dist/drawio/webapp/` が SW のキャッシュ対象になる。

**`navigateFallbackDenylist: [/^\/api\//]`**（確定）: サーバーモード時に `fetch('/api/...')` が SW の navigate fallback（`index.html` 返却）にすり替わらないようにする。ローカルモードでは `/api/` は呼ばないため影響なし。サーバーモードの API 通信を壊さないための防御。

**draw.io iframe のオフライン動作**: draw.io webapp は `<iframe src="/drawio/webapp/index.html?embed=1&...">` で読み込まれる（調査 §3 確認済み）。iframe 内の HTML/JS/CSS もすべて同一オリジンの precache 対象に入るため、Service Worker が介在しオフラインで配信される。draw.io webapp は外部 API を呼ばない（embed=1 モード・調査 §3 確認済み）ため、完全オフラインで動作する。

**`devOptions.enabled: false`**（確定）: 開発中は SW を無効にする。理由: HMR と SW のキャッシュが競合すると開発効率が落ちる。PWA の動作検証は `npm run build && npm run preview` で行う。

### 7.4 アイコン

`frontend/public/icons/` に以下を配置する:
- `icon-192.png`（192×192）
- `icon-512.png`（512×512）

既存のロゴアセットがあれば流用。無ければシンプルなプレースホルダーを生成する（設計段階では確定しない。実装時にアイコン画像を作成・配置する）。**アイコン未準備だと要件 LM-7-4（manifest の icons）と LM-7-5（インストール可能）が未達になる。** `tasks.md` にアイコン作成タスクを明示的に起票し、PWA ビルド前にアイコンファイルが存在することを検証すること。最小要件として 192×192 と 512×512 の 2 サイズの PNG が必須。プレースホルダーでも PWA インストール要件は満たせるため、初期実装では単色アイコンを SVG から生成して配置する。

### 7.5 永続ストレージリクエスト

ローカルモード選択時（`LocalClient` 初期化時）に `navigator.storage.persist()` を呼び、ブラウザに永続ストレージを要求する（非機能要件 3）。これにより、ブラウザのストレージ逼迫時に IndexedDB が eviction（自動削除）される可能性を低減する。

```ts
// LocalClient コンストラクタまたは初期化時
if (navigator.storage?.persist) {
  void navigator.storage.persist()  // 非同期。結果は使わない（拒否されても動作に支障なし）
}
```

### 7.6 更新プロンプト UI

`frontend/src/components/PwaUpdatePrompt.tsx`（新規）。`vite-plugin-pwa` の virtual module `virtual:pwa-register/react` が提供する `useRegisterSW` フックを使う。

```tsx
// 概念設計
function PwaUpdatePrompt() {
  const { needRefresh, updateServiceWorker } = useRegisterSW()
  if (!needRefresh[0]) return null
  return (
    <div className="fixed bottom-4 right-4 bg-surface-raised border border-border rounded p-4 shadow">
      <p className="text-fg text-sm">新しいバージョンが利用可能です</p>
      <button onClick={() => updateServiceWorker(true)} className="...">更新する</button>
      <button onClick={() => needRefresh[1](false)} className="...">後で</button>
    </div>
  )
}
```

`App.tsx` または `main.tsx` の Root コンポーネント内に配置する。デザイントークン準拠。

### 7.7 エラーハンドリング

| 失敗条件 | 回復可否 | ユーザーが受け取るもの |
|---|---|---|
| SW 登録失敗（非 HTTPS 等） | 回復可 | アプリは通常通り動作する（SW なしのフォールバック）。`console.warn` |
| SW 更新チェック失敗 | 回復可 | プロンプトが出ないだけ。次回チェックでリトライ |
| `navigator.storage.persist()` 拒否 | 回復可 | IndexedDB は使えるが eviction リスクがある。ユーザーへの警告は将来対応 |

### 7.8 テスト観点

- **ビルド検証**: `npm run build` 後に `dist/` に `sw.js`（または `registerSW.js`）と `manifest.webmanifest` が生成される。
- **draw.io precache**: SW の precache manifest に `drawio/webapp/` 配下のファイルが含まれる（ビルド成果物を検査）。
- **`navigateFallbackDenylist`**: `/api/` パスが SW で intercept されない（手動検証・または integration test）。
- **更新プロンプト**: `PwaUpdatePrompt.test.tsx` で `useRegisterSW` をモックし、`needRefresh` が true 時にプロンプトが表示される / 「更新する」ボタンで `updateServiceWorker(true)` が呼ばれる。
- **既存テスト非破壊**: PWA 設定追加で既存 311 テストが回帰ゼロ。`devOptions.enabled: false` のため開発時テスト環境に SW が介入しない。

---

## 8. ファイル構成（新規・変更）

| ファイル | 新規/変更 | 内容 |
|---|---|---|
| `frontend/src/storage/local-client.ts` | 新規 | `LocalClient implements StorageClient`。31 メソッド。 |
| `frontend/src/storage/idb.ts` | 新規 | IndexedDB 薄い Promise ラッパー。`openDb`/`tx`/`getByKey`/`getAll` 等。 |
| `frontend/src/storage/path-normalize.ts` | 新規 | `normalize_path` の TS 移植。純粋関数。 |
| `frontend/src/storage/page-tree-build.ts` | 新規 | `getPageTree` のツリー構築。純粋関数。 |
| `frontend/src/storage/diff-revisions.ts` | 新規 | `diffLines` → `DiffLine[]` 変換。純粋関数。 |
| `frontend/src/storage/export-import.ts` | 新規 | エクスポート/インポートロジック。JSZip 使用。 |
| `frontend/src/storage/mode.ts` | 新規 | `readMode`/`writeMode`/`clearMode`。localStorage 操作。 |
| `frontend/src/components/ModeGate.tsx` | 新規 | モード選択画面。 |
| `frontend/src/components/PwaUpdatePrompt.tsx` | 新規 | PWA 更新プロンプト。 |
| `frontend/src/pages/SettingsPage.tsx` | 新規 | 設定画面（エクスポート/インポート/モード切替）。 |
| `frontend/src/main.tsx` | 変更 | `Root` コンポーネント（モード判定 + client 注入 + ModeGate）。 |
| `frontend/src/App.tsx` | 変更 | `/settings` ルート追加。`PwaUpdatePrompt` 配置。 |
| `frontend/src/markdown/custom-map/MapEditor.tsx` | 変更 | `capture` 属性追加（1 箇所）。 |
| `frontend/vite.config.ts` | 変更 | `vite-plugin-pwa` 追加。 |
| `frontend/package.json` | 変更 | `jszip`/`diff`/`vite-plugin-pwa` 追加。`fake-indexeddb`（devDep）追加。 |
| `frontend/public/icons/icon-192.png` | 新規 | PWA アイコン。 |
| `frontend/public/icons/icon-512.png` | 新規 | PWA アイコン。 |
| テストファイル群（`*.test.ts`/`*.test.tsx`） | 新規 | 各コンポーネント・ロジックのテスト。 |

**backend は変更しない。**

---

## 9. 検証コマンド

- **frontend**（`frontend/` から実行）:
  - `npx tsc --noEmit`（`LocalClient implements StorageClient` の型適合含む）
  - `npm run test:run`（新規テスト + 既存 311 件回帰ゼロ）
  - `npm run build`（PWA 成果物含む）
  - `npm run lint`（0 errors）
- **backend**（`backend/` から実行）:
  - `../.venv/bin/python manage.py test api`（172 passed・変更なし確認）

---

## 10. 不変条件の所有層（まとめ）

| 不変条件 | 所有層 | 根拠 |
|---|---|---|
| `StorageClient` 契約の 31 メソッドシグネチャ | `types.ts`（型定義） | `implements StorageClient` でコンパイル時に強制 |
| パス正規化 | `path-normalize.ts`（TS 純粋関数）| ローカル専用。サーバーは `utils.py` が所有 |
| ツリー構築「空仮想ノードを出力しない」 | `page-tree-build.ts`（TS 純粋関数） | サーバーは `PageTreeView` が所有 |
| IndexedDB スキーマ | `idb.ts`（`onupgradeneeded`） | version 番号で管理 |
| モード選択の永続化 | `mode.ts`（localStorage） | `readMode`/`writeMode` |
| 認証バイパス（ローカル固定ユーザー） | `LocalClient.currentUser()` | `AuthProvider` は変更なし。クライアントの振る舞いで自然にバイパス |
| ZIP スキーマバージョン | `manifest.json.version` | エクスポート時に書込、インポート時に検証 |
| 「全データ削除→復元」の原子性 | `export-import.ts` のインポート処理 | ZIP 全エントリをメモリへ読み切ってから、6 ストア対象の単一 `readwrite` トランザクションでクリア+書き込み。トランザクション内で `await` を挟まない。`abort`/`error` 時は IndexedDB が自動ロールバック（部分破壊なし）。 |

---

## 11. 将来拡張（設計で予約・本イテレーションでは実装しない）

- **全文検索のローカル実装（フェーズ 4）**: `search()` は throw のまま。将来 `Fuse.js` 等を使ったフロント内テキスト検索を検討。
- **サーバーモードでのエクスポート**: サーバー側の全データ一括取得 API を新設し、同形式 ZIP を生成。
- **サーバー側インポート API / management command**: §3.10 の仕様を実装。
- **IndexedDB マイグレーション**: version 2 以降のスキーマ変更時に `onupgradeneeded` で差分マイグレーション。
- **権限管理画面のローカル非表示化**: PermissionClient がダミーのため実質無意味。UI 上で非表示にするか「ローカルモードでは不要です」メッセージ表示。
- **Android Chrome の capture 制約対応**: カメラボタンとファイル選択ボタンの分離。
- **`navigator.storage.persist()` 拒否時の警告 UI**: ストレージ永続化が拒否された場合にユーザーに知らせる。
- **エクスポートの暗号化・パスワード保護**: セキュリティ要件が出た場合の拡張。

---

## 12. 設計レビュー指摘への対応（revision 2）

`design-review.json`（CHANGES_REQUESTED・HIGH 2 / MEDIUM 4 / NIT 5）の全 11 findings への対応を記す。すべて要件（LM-1〜LM-7・非機能要件）と整合する範囲で解消した。

| # | 重大度 | 指摘 | 対応 | 変更箇所 |
|---|---|---|---|---|
| 1 | HIGH | エクスポート ZIP のページ JSON が revision/comment の `author` を落とし round-trip が型契約違反 | **解消**。ページ JSON の revision・comment の `author` を `User` オブジェクトで出力し、インポート時に欠落/`null`/文字列は `LOCAL_USER` へ補完する往復規約を確定（§3.4）。round-trip テストに「復元後 `getRevision`/`listComments` が型契約に適合する」検証を追加（§3.13） | §3.4, §3.13 |
| 2 | HIGH | `comments.author` の型が設計内で 3 通りに矛盾 | **解消**。「IndexedDB の `comments.author`・`revisions.author` は常に `User`（`LOCAL_USER`）オブジェクトで保持し、`listComments`/`getRevision`/`listRevisions` は `User` で返す」に一本化（§4.2 の author 規約）。`CommentSection` の `comment.author.id === user.id` 判定（確認済み）が成立するよう `id=1` に固定。§3.4・§4.7・§4.10 を整合 | §4.2, §4.7, §4.10, §3.4 |
| 3 | MEDIUM | §1 全体図の `createStorageClient()(RestClient)` が実 API と不一致 | **解消**。図を `client = createStorageClient()` に修正（引数・二重呼び出しを削除） | §1 全体図 |
| 4 | MEDIUM | `Page.id` の採番根拠が未確認で往復の id 整合が未定義 | **解消**。フロント全画面を走査し `Page.id` が key/URL/比較/参照保持のいずれにも使われていないことを確認（`rev.id`/`folder.id`/`asset.id`/`comment.id` は別ストアの id）。往復で `Page.id` を振り直しても無害と根拠付きで確定。エクスポート JSON に `Page.id` を含めない方針を維持 | §4.2 |
| 5 | MEDIUM | `restoreRevision` のセマンティクスがサーバー実装と一致するか未検証 | **解消**。サーバー `RevisionRestoreView`/`save_page_body` を確認。title+body の両方を復元し、新 number は `(最新 or 0)+1`、本文不変時はリビジョンを作らない最適化があることを確認。ローカル版も同一挙動に合わせることを明記。`updatePage` に本文不変最適化を追記 | §4.7 |
| 6 | MEDIUM | インポートの全クリア→復元の原子性が IndexedDB 制約と整合不明 | **解消**。ZIP 全エントリを先にメモリへ読み切ってから（非同期フェーズ）、6 ストア対象の単一 `readwrite` トランザクションでクリア+書き込みを `await` を挟まず同期実行する戦略を確定（§3.8）。失敗時は IndexedDB 自動ロールバックで既存データ保持（部分破壊なし）。§3.12・§10 の表現を実保証に合わせて修正 | §3.8, §3.12, §10 |
| 7 | NIT | メソッド数 34 対 31 の表記ゆれ | **解消**。31 を master と明記し、requirements.md/investigation.md の 34 は誤記である旨を §4.1 に追記。大原則 (1) の「34」も「31」に修正 | §4.1, 冒頭大原則 |
| 8 | NIT | `releaseAssetFileUrl` の同期 `void` が設計表で曖昧 | **解消**。「同期 `void`（`Promise` にしない）。types.ts で唯一の同期メソッドで `async` 化すると型が通らない」と §5.2 に注記 | §5.2 |
| 9 | NIT | `uploadAsset` のフォルダ内一意制約が未定義 | **解消**。同一 `folderId`+`filename`（および空でない `alias`）の既存があれば `ApiError(409)` を throw する一意ルールを §5.2 に明記。重複アップロードのテスト観点を §5.5 に追加 | §5.2, §5.5 |
| 10 | NIT | カメラ `capture` のモード判定前提が未記述 | **解消**。`MapEditor` 到達時はモード確定済みで `readMode()` は `'local'`/`'server'` を返す前提、`null` の場合も `capture` なし（サーバー相当）に安全に倒れる旨を §6.3 に明記 | §6.3 |
| 11 | NIT | PWA アイコンが未確定で LM-7-4/5 の充足が保留 | **解消**。アイコン未準備だと LM-7-4/5 未達になる旨を §7.4 に追記し、tasks.md にアイコン作成タスクを明示起票する指示を記載。初期実装は単色プレースホルダー PNG で要件充足 | §7.4 |

**未確認（unverified）のまま残す想定**（レビューの Unverified Assumptions のうち、設計判断として許容されたもの）:

- **Android Chrome の `capture` 属性制約**: 実機未検証（§6.4 で明示）。要件 LM-6「最小対応」に沿い、`capture="environment"` を 1 属性足すのみ。制限が顕在化した場合のカメラ/ファイル選択分離は将来対応。
- **draw.io webapp 内の最大個別ファイルサイズ（`app.min.js`）**: 推定のみ（§7.3 で明示）。19MB 全体 < 25MB 上限のため見積りは妥当だが、実装時に `maximumFileSizeToCacheInBytes` がビルド後の最大ファイルを下回らないか確認する（§7.8 のビルド検証に含む）。

---

## 13. 設計レビュー指摘への対応（revision 3）

`design-review.json`（revision 2 への再レビュー・CHANGES_REQUESTED・HIGH 0 / MEDIUM 2 / NIT 3）の全 5 findings への対応を記す。すべて要件（LM-1〜LM-7・非機能要件）と整合する範囲で解消した。前回（revision 2）の 11 findings は実ソース照合により妥当に解消済みであることを再レビューが確認している。

| # | 重大度 | 指摘 | 対応 | 変更箇所 |
|---|---|---|---|---|
| 1 | MEDIUM | `createPage` の `Page.id` 採番（`meta.page_seq`）がトランザクション境界（`pages`+`revisions`）から漏れ、原子性が未定義 | **解消**。採番方式を「`meta.page_seq` カウンタ」に一本化したうえで、§4.7 のトランザクション境界を「`createPage` は `['pages', 'revisions', 'meta']` を対象にした単一 `readwrite` tx で、`meta.page_seq` の get→+1→put と `pages`/`revisions` の put を `await` を挟まず同期的に完結させる」に修正。id 衝突・read-modify-write の非アトミック化を防ぐ旨を明記。§4.2 本文にも「`page_seq` の read-modify-write は `createPage` と同一トランザクション内」と追記。`updatePage` は既存ページから id を引き継ぐため `meta` 不要と明示 | §4.2, §4.7 |
| 2 | MEDIUM | `listRevisions`/`getRevision` が返す `RevisionSummary.id`/`Revision.id` の供給が未明記（`PageHistoryPage` の React `key` が壊れる懸念） | **解消**。§4.7 の `listRevisions`/`getRevision` に「返却オブジェクトは `revisions` ストアの autoIncrement `id` をそのまま含める（`RevisionSummary.id`/`Revision.id` を満たす）」と明記。`PageHistoryPage.tsx` L210/L262/L277 が `rev.id` を `key` に使う根拠も記載。§4.15 のテスト観点に「`listRevisions` の各要素が一意な `id` を持つ」「`createPage` の連続作成で `Page.id` が衝突しない」を追加 | §4.7, §4.15 |
| 3 | NIT | §4.2 の `pages` スキーマ表に `id`/`created_by`/`updated_by` が未列挙（本文との不整合） | **解消**。`pages` 行のフィールド欄を `id`, `path`, `title`, `body`, `created_at`, `updated_at`, `created_by`, `updated_by` に補った（keyPath は `path` のまま） | §4.2 スキーマ表 |
| 4 | NIT | エクスポート ZIP のページ JSON に `created_by`/`updated_by` が無く、インポート後の供給ルールが未記載 | **解消**。§3.4 に「ページの `created_by`/`updated_by` はエクスポートに含めない内部値扱い。インポート時は常に `LOCAL_USER` を補完する（`Page.id` と同方針）」の往復規約を追加。§3.13 の round-trip テストに「`getPage().created_by`/`updated_by` が `User` オブジェクト（`LOCAL_USER`）である」検証を追加 | §3.4, §3.13 |
| 5 | NIT | インポート時のリビジョン `number` 一意性・採番整合の検証が未記載（壊れた ZIP で `[path, number]` 制約違反時に一般エラーに丸められる） | **解消**。§3.8 ステップ 5（メモリ組み立て段）に「各ページの revisions の `number` 一意性を検証し、違反時は専用メッセージ『エクスポートファイルのリビジョン番号が不正です』で IndexedDB に触れる前に中断」を追記。§3.12 に `number` 重複検出時と `[path, number]` 制約違反（abort→自動ロールバック→既存保持）の 2 行を追加。§3.13 のバリデーションテストに同観点を追加 | §3.8, §3.12, §3.13 |

**未確認（unverified）のまま残す想定**（本再レビューでも設計判断として許容されたもの、変更なし）:

- **Android Chrome の `capture` 属性制約**（§6.4）: 実機未検証。要件 LM-6「最小対応」に沿い `capture="environment"` を 1 属性足すのみ。
- **draw.io webapp 内の最大個別ファイルサイズ（`app.min.js`）**（§7.3）: 推定のみ。19MB 全体 < 25MB 上限のため見積りは妥当。実装時に §7.8 のビルド検証で実測確認する。
- **IndexedDB の `File`/`Blob` 直接格納の対応ブラウザ**（§5.4）: Structured Clone の一般的事実に基づく。対象ブラウザ（非機能要件 7）前提として許容。
