# Janus ローカルモード（フェーズ 3b）要件定義書

## 概要

本書は Janus に**完全独立のローカル専用モード**を追加する要件を定義する。ローカルモードはサーバー無しでブラウザだけで完結し、IndexedDB を唯一の保存先とするオフライン動作モードである。既存のサーバーモード（Django + DRF バックエンド + RestClient フロントエンド）と同一ビルドで共存し、起動時にモードを選択する。

現在の Janus フロントエンドは `StorageClient` 契約（6 サブインターフェース・34 メソッド）に依存し、`StorageProvider.tsx` の `client` prop で具象クライアントを注入する設計（`main.tsx` で `<StorageProvider client={...}>`）になっている。ローカルモードはこの契約を IndexedDB で再実装した `LocalClient` に差し替えることで、既存の画面コンポーネント・認証フロー・サイドバーツリーを**コード変更なしまたは最小変更で**そのまま動作させる。

本機能はさらに以下を含む: (1) 全データエクスポート/インポート（ZIP 形式・双方向）、(2) アセットファイルの IndexedDB 保存、(3) MapEditor のカメラ撮影対応（ローカルモード専用）、(4) PWA 化（Service Worker + manifest によるオフライン動作・インストール可能化）。

本書は要件定義のみを扱う。設計・実装・コミットは後続ステップで行う。成果物は本 spec（`janus-local-mode`）の `requirements.md` / `design.md` / `tasks.md` のみである。フェーズ 1/2/3a・デザインシステム刷新・サイドバーページツリー（janus-sidebar-page-tree）は完了・コミット済みであり、本機能はそれらの**機能・API・保存形式・権限・記法・デザイントークン・StorageClient 契約を壊さない**。

### 用語

- **ローカルモード（local mode）**: サーバーを使わず、ブラウザ内の IndexedDB のみでデータを永続化する動作モード。単一ユーザー・認証不要・全権限許可。
- **サーバーモード（server mode）**: 既存の Django バックエンドと通信する動作モード。RestClient を使用。認証・権限あり。
- **LocalClient**: `StorageClient` 契約（`AuthClient`・`PageClient`・`AssetClient`・`SearchClient`・`PermissionClient`・`CommentClient` の 6 サブインターフェース・34 メソッド）を IndexedDB で実装する新規クライアント。
- **RestClient**: 既存のサーバーモード用クライアント（`rest-client.ts`）。REST API を呼ぶ。
- **モード選択画面（mode selector）**: 初回アクセス時またはモード未設定時に表示される画面。ローカルモードかサーバーモードを選択し、`localStorage` に記憶する。
- **エクスポート ZIP**: ローカル全データを ZIP にまとめた書き出しファイル。`manifest.json`・ページ JSON・アセットバイナリ・フォルダ構造を含む。
- **インポート ZIP**: エクスポート ZIP をローカル IndexedDB に復元する操作。

### 位置づけ（フェーズとの関係）

- 本機能は引き継ぎメモの「次スレッドの作業: フェーズ3b（ローカルモード）spec 作成【未着手】」に対応する。
- フロントエンドは `StorageClient` 契約の新規実装（`LocalClient`）の追加と、モード切替・エクスポート/インポート・カメラ・PWA 関連の加算のみ。バックエンドの既存コードは変更しない（将来のサーバー取り込み API は除く）。
- サイドバーページツリー（`getPageTree` 含む）は完了済みであり、`LocalClient` はこの契約も満たす。

---

## 要件

### 要件 LM-1: モード選択と切替 〔フロントエンド・UX〕

**ユーザーストーリー:** 利用者として、アプリ起動時にローカルモードかサーバーモードを選びたい。そうすればサーバーが無い環境でもすぐに使い始められ、サーバーがあればこれまで通り使える。

#### 受け入れ基準

1. THE アプリ SHALL 起動時に `localStorage` キー（例 `janus-mode`）を参照し、モードが未設定（初回アクセス時）の場合は**モード選択画面**を表示する。
2. THE モード選択画面 SHALL 「ローカルモード」と「サーバーモード」の 2 択を提示し、選択結果を `localStorage` に保存してアプリ本体へ遷移する。
3. THE モード選択 SHALL 同一ビルドで両モードを利用可能にする。ビルド時フラグ（`VITE_MODE` 等）や URL ベース（`/local/...`）による切替は採用しない。
4. WHEN ローカルモードが選択された THEN システム SHALL `main.tsx` の `StorageProvider` に `LocalClient` インスタンスを `client` prop として注入する。
5. WHEN サーバーモードが選択された THEN システム SHALL 既存の `RestClient` を注入する（現行の既定動作と同一）。
6. THE モード切替 SHALL 設定画面またはモード選択画面への再アクセスから可能とする。切替時は `localStorage` の `janus-mode` を更新し、ページリロード（`location.reload()`）で反映する。
7. THE `AuthProvider`・`RequireAuth` SHALL ローカルモードでも**コード変更なし**で動作する。`LocalClient` の `currentUser()` が固定ユーザーを即座に返すことで、`RequireAuth` の `/login` リダイレクトは発生せず、`AuthProvider` の `loading` が即座に `false` になる。

### 要件 LM-2: IndexedDB 版 StorageClient（LocalClient） 〔フロントエンド・データ層〕

**ユーザーストーリー:** 開発者として、既存の `StorageClient` 契約と同一のインターフェースでローカルデータを読み書きしたい。そうすれば画面コンポーネントは `useStorage()` 経由だけでサーバーモードと同じように動作し、クライアント差し替えだけでローカルモードが成立する。

#### 受け入れ基準

1. THE `LocalClient` SHALL `StorageClient` インターフェース（`AuthClient`・`PageClient`・`AssetClient`・`SearchClient`・`PermissionClient`・`CommentClient` の 6 サブインターフェース・34 メソッド）を完全に実装する。
2. THE `LocalClient` SHALL IndexedDB をデータストアとして使用し、以下のオブジェクトストアを持つ:
   - `pages`（キー: `path`）: `id`(auto), `path`, `title`, `body`, `created_at`, `updated_at`
   - `revisions`（複合キー: `[path, number]`）: `id`(auto), `path`, `number`, `title`, `body`, `created_at`
   - `comments`（キー: `id`(auto)、インデックス: `path`）: `path`, `body`, `author`, `created_at`, `updated_at`
   - `folders`（キー: `id`(auto)、インデックス: `parentId`）: `parentId`, `name`, `created_at`, `updated_at`
   - `assets`（キー: `id`(auto)、インデックス: `folderId`）: `folderId`, `filename`, `alias`, `blob`, `content_type`, `created_at`, `updated_at`
3. THE `AuthClient` 実装 SHALL ダミーとする:
   - `currentUser()` → 固定ユーザー（例 `{ id: 1, username: 'local', is_staff: true, is_superuser: true }`）を即座に返す
   - `login()` → 固定トークン `'local'` + 固定ユーザーを即座に返す（実質 no-op）
   - `logout()` → no-op（`Promise<void>` を返すだけ）
4. THE `PermissionClient` 実装 SHALL ダミーとする（単一ユーザー・全権限許可）:
   - `getEffectivePermission()` → `{ view: true, edit: true }` 固定
   - `listPermissions()` → 空配列
   - `grantPermission()`/`updatePermission()`/`revokePermission()` → no-op
5. THE `SearchClient` 実装 SHALL `search()` で例外を throw する（`RestClient` と同じ未実装扱い。フェーズ 4）。
6. THE `PageClient` 実装 SHALL IndexedDB の `pages` ストアで CRUD を行い、以下を満たす:
   - `getPage(path)` → 該当ページを返す。存在しなければ `null`
   - `listChildren(parentPath)` → `path` がプレフィックス一致する直下 1 階層の子を返す
   - `getPageTree(root?)` → 全ページの `path` を走査してネストツリーを組み立てる（サーバー版 `PageTreeView` と同等のクライアント側ロジック。仮想ノード・空仮想ノード剪定を含む）。権限枝刈りは不要（全権限許可のため）
   - `createPage` → ページ保存 + リビジョン #1 自動作成
   - `updatePage` → ページ更新 + 新リビジョン自動作成
   - `deletePage` → ページ + 関連リビジョン + 関連コメントの削除
   - `listRevisions`/`getRevision` → `revisions` ストアからの取得（`number` 降順）
   - `diffRevisions` → JS の差分ライブラリ（`diff` パッケージ等）で行単位差分を算出し、`DiffLine[]`（`{ op: 'add' | 'del' | 'equal', line: string }`）を返す
   - `restoreRevision` → 指定リビジョンの本文で `updatePage` を呼ぶ（新リビジョン化）
7. THE `AssetClient` 実装 SHALL IndexedDB の `assets`・`folders` ストアで操作を行う:
   - `uploadAsset` → `File` オブジェクトを Blob として `assets` ストアに保存
   - `getAssetFileUrl` → IndexedDB から Blob を取り出し `URL.createObjectURL` で一時 URL を返す
   - `releaseAssetFileUrl` → `URL.revokeObjectURL` で解放
   - `resolveAssetUrl` → `RestClient` と同等の複合ロジック（フォルダ辿り → アセット検索 → URL 生成）をローカルで再実装
   - `listFolders`/`createFolder`/`listAssets`/`moveAsset` → IndexedDB のフォルダ・アセット CRUD
8. THE `CommentClient` 実装 SHALL IndexedDB の `comments` ストアで CRUD を行う:
   - `listComments(path)` → `path` インデックスで取得（作成日時昇順）
   - `addComment`/`updateComment`/`deleteComment` → 固定ユーザーを `author` として操作
9. THE `LocalClient` SHALL 既存の `StorageClient` 型に型レベルで合致する（TypeScript のコンパイルエラーなし）。

### 要件 LM-3: 全データエクスポート 〔フロントエンド・データ移行〕

**ユーザーストーリー:** 利用者として、ローカルに蓄積したデータをファイルに書き出したい。そうすればサーバーモードへの移行やバックアップが可能になる。

#### 受け入れ基準

1. THE エクスポート機能 SHALL ローカルモードの全データを ZIP ファイルとして書き出す。ZIP 生成には JSZip を使用する。
2. THE ZIP SHALL 以下の構造を持つ:
   - `manifest.json`: バージョン番号（スキーマバージョン）、エクスポート日時（ISO 8601）、ページ数、アセット数
   - `pages/<encoded-path>.json`: 各ページの JSON（`path`, `title`, `body`, `comments[]`（本文・作成日時・著者）, `revisions[]`（番号・タイトル・本文・作成日時））
   - `assets/<id>.<ext>`: アセットバイナリファイル（元の拡張子を保持）
   - `assets/<id>.meta.json`: アセットメタデータ（`filename`, `alias`, `folderId`, `content_type`）
   - `folders.json`: フォルダ構造の配列（`id`, `parentId`, `name`）
3. THE エクスポート SHALL ページ・アセット・フォルダ・コメント・リビジョンの全データを含む。権限データ・認証データは含まない（ローカルは単一ユーザーのため不要）。
4. THE エクスポート SHALL ローカルモードの設定画面またはメニューから実行可能とする。
5. WHEN エクスポートが完了した THEN システム SHALL ZIP ファイルをブラウザのダウンロードとしてユーザーに提供する。ファイル名は `janus-export-<YYYYMMDD-HHmmss>.zip` とする。
6. THE エクスポート SHALL サーバーモードでも実行可能とする。サーバーモードの場合は `RestClient` 経由で全データを取得して同形式の ZIP を生成する。ただし、サーバー側の全データ一括取得 API が存在しない場合、サーバーモードでのエクスポートは将来対応（LM-3 のスコープではローカルモードを優先）とする。

### 要件 LM-4: 全データインポート 〔フロントエンド・データ移行〕

**ユーザーストーリー:** 利用者として、エクスポートした ZIP をローカル IndexedDB に復元したい。そうすればデータの移行やバックアップからの復旧ができる。

#### 受け入れ基準

1. THE インポート機能 SHALL エクスポート ZIP（LM-3 で定義した形式）を読み取り、ローカル IndexedDB にデータを復元する。
2. THE インポート SHALL `manifest.json` のバージョンを検証し、非互換バージョンの場合はエラーメッセージを表示して中断する。
3. WHEN インポートを実行する THEN システム SHALL 既存のローカルデータを**上書き（全クリア後に復元）**する。インポート前に確認ダイアログを表示し、ユーザーの明示的な同意を得る。
4. THE インポート SHALL ページ・リビジョン・コメント・アセット（バイナリ含む）・フォルダを復元する。
5. THE インポート SHALL ローカルモードの設定画面またはメニューから実行可能とする。
6. THE サーバー側への取り込み SHALL 将来対応とする（Django management command または専用インポート API）。本要件ではサーバー取り込みの仕様を記録するが実装はスコープ外とする。

### 要件 LM-5: アセットファイルのインポート（ローカル保存） 〔フロントエンド・アセット〕

**ユーザーストーリー:** 利用者として、ローカルモードでも画像やファイルをアセットライブラリにアップロードしたい。そうすればサーバーが無くてもページに画像を添付できる。

#### 受け入れ基準

1. THE `LocalClient.uploadAsset` SHALL `File` オブジェクトを受け取り、IndexedDB の `assets` ストアに Blob として保存する。`filename`・`alias`・`content_type`・`folderId` をメタデータとして併せて保存する。
2. THE 既存のアセットライブラリ画面（`AssetLibraryPage`）SHALL `useStorage()` 経由で `LocalClient` のメソッドを呼ぶため、ローカルモードでも**コード変更なし**でアセットのアップロード・一覧・参照が動作する。
3. THE `LocalClient.getAssetFileUrl` SHALL IndexedDB から Blob を取り出し、`URL.createObjectURL` でブラウザ表示可能な一時 URL を返す（`RestClient` の認証付き fetch → Blob URL と同パターン）。
4. THE CAD ファイル（`.jww`/`.dxf`）のブラウザ内 SVG 変換（`convertCadToSvgDispatch`）SHALL ローカルモードでも変更なく動作する（変換はフロント完結のため影響なし）。

### 要件 LM-6: カメラ撮影（ローカルモード専用） 〔フロントエンド・MapEditor〕

**ユーザーストーリー:** 利用者として、ローカルモードで地図マーカーに写真を添付する際、端末のカメラで直接撮影したい。そうすればファイル選択を経由せず素早く現場の写真を取り込める。

#### 受け入れ基準

1. THE MapEditor の写真添付 `<input type="file" accept="image/*">` SHALL ローカルモード時に `capture="environment"` 属性を追加する。これによりモバイルブラウザでカメラ撮影 UI が直接開く。
2. THE カメラ撮影 SHALL 既存の `attachPhoto` 関数（`uploadAsset` 呼び出し → `AssetRef` 紐付け）の経路をそのまま使用する。撮影した画像は通常のファイルアップロードと同じ `uploadAsset` で IndexedDB に保存される。
3. THE サーバーモード SHALL 従来のファイルアップロード（`capture` 属性なし）を維持する。カメラ撮影 UI はローカルモード専用の最小対応とする。
4. THE カメラ撮影 SHALL `getUserMedia` API を使用しない。HTML5 標準の `<input capture="environment">` のみで対応する（独自カメラプレビュー UI は不要）。
5. WHEN 端末がカメラを持たない THEN システム SHALL 通常のファイル選択にフォールバックする（ブラウザの標準動作）。

### 要件 LM-7: PWA 化（オフライン動作・インストール可能） 〔フロントエンド・インフラ〕

**ユーザーストーリー:** 利用者として、Janus をホーム画面に追加してネイティブアプリのように使いたい。そうすればオフラインでもアプリが起動し、ブラウザのアドレスバーなしで操作できる。

#### 受け入れ基準

1. THE ビルド構成 SHALL `vite-plugin-pwa` を新規追加し、manifest 生成・Service Worker 生成・自動登録を行う。
2. THE Service Worker SHALL アプリシェル（`index.html`・JS/CSS バンドル・フォント等）をプリキャッシュし、オフラインでもアプリが起動可能にする。
3. THE Service Worker SHALL `public/drawio/webapp/`（約 19MB）をプリキャッシュ対象に含め、オフラインでも draw.io エディタが動作可能にする。`maximumFileSizeToCacheInBytes` を 19MB 以上に調整する。
4. THE PWA manifest SHALL 以下を定義する:
   - `name`: "Janus"（または適切な正式名）
   - `short_name`: "Janus"
   - `start_url`: "/"
   - `display`: "standalone"
   - テーマカラー・背景色: 既存のデザイントークンに整合
   - アイコン: 必要サイズ（192x192, 512x512 等）を用意
5. THE PWA SHALL インストール可能（ブラウザの「ホーム画面に追加」やインストールバナー）にする。
6. THE 開発時（`vite dev`）SHALL Service Worker を無効にすることを推奨する構成とする（開発中のキャッシュ問題回避）。
7. THE draw.io webapp SHALL Service Worker キャッシュにより完全オフラインで動作する（同一オリジンの静的ファイル群であり外部 API 依存なし。embed=1 モード）。
8. WHEN ネットワークが利用可能な場合 THEN Service Worker SHALL キャッシュ済みリソースの更新を確認し、新バージョンが利用可能な場合はユーザーに通知する（stale-while-revalidate またはプロンプト更新）。

---

## 非機能要件

1. **非破壊（最優先）**: フェーズ 1/2/3a・デザインシステム・サイドバーページツリーの機能・API・保存形式・権限・記法・デザイントークン・`StorageClient` 契約の既存 34 メソッドのシグネチャを壊さない。既存の backend テスト群（172 passed）と frontend テスト群（311 passed）を**回帰ゼロ**で通す。
2. **契約準拠**: `LocalClient` は `StorageClient` 型に TypeScript コンパイルレベルで完全合致する。既存画面コンポーネントが `useStorage()` 経由で呼ぶすべてのメソッドが、ローカルモードでも同じ型・同じセマンティクスで動作する。
3. **データ耐久性**: IndexedDB のデータはブラウザを閉じても永続する。ただしブラウザのストレージ制限（容量上限・eviction ポリシー）に依存する。PWA のインストールにより永続ストレージ（`navigator.storage.persist()`）のリクエストを推奨する。
4. **オフライン完結**: ローカルモードはネットワーク接続を一切必要としない。初回インストール後は完全オフラインで動作する。
5. **性能**: IndexedDB の操作はトランザクション単位で行い、大量データ時にもブラウザの UI スレッドをブロックしない。エクスポート/インポートの ZIP 処理は非同期で行い、進捗を表示する。
6. **外部依存の最小化**: 新規依存は `vite-plugin-pwa`（ビルド時のみ）・`JSZip`（ZIP 生成/展開）・`diff`（行単位差分。`diffRevisions` 用）に限定する。ランタイム依存の追加は最小限に抑える。
7. **対象ブラウザ**: 主対象は Firefox 最新 + Chrome 最新。IndexedDB・Service Worker・`<input capture>` はモダンブラウザで広くサポートされている。
8. **テスタビリティ**: `LocalClient` の各メソッドは単体テスト可能とする（`fake-indexeddb` 等でモック可能な構造）。エクスポート/インポートのロジックは純粋関数として切り出し、テスト可能にする。

---

## 受け入れ基準（統合・検証観点のサマリ）

本機能完了時、以下が確認可能であること。

1. 初回アクセス時にモード選択画面が表示され、「ローカルモード」を選択すると `localStorage` に記録されてアプリ本体が起動する。再訪時は選択済みモードで直接起動する。
2. ローカルモードでページの作成・閲覧・編集・削除ができ、リロード後もデータが保持される（IndexedDB 永続化）。
3. ローカルモードでサイドバーのページツリーが正しく表示される（`getPageTree` の LocalClient 実装）。
4. ローカルモードでリビジョン履歴の閲覧・差分表示（`diffRevisions`）・リビジョン復元が動作する。
5. ローカルモードでコメントの投稿・編集・削除が動作する。
6. ローカルモードでアセットライブラリにファイルをアップロードでき、ページ内で参照・表示できる。フォルダの作成・アセットの移動も動作する。
7. ローカルモードの MapEditor でカメラ撮影（`capture="environment"`）により写真を添付できる（モバイル端末）。
8. エクスポートでローカル全データ（ページ・リビジョン・コメント・アセット・フォルダ）が ZIP にまとまり、ダウンロードできる。
9. インポートでエクスポート ZIP からローカル IndexedDB にデータが復元される（全クリア + 復元。確認ダイアログあり）。
10. PWA としてインストール可能であり、オフラインでアプリが起動・動作する（draw.io エディタ含む）。
11. サーバーモード選択時は従来通り `RestClient` で動作し、既存の全機能に回帰がない。
12. `AuthProvider`・`RequireAuth` がローカルモードでもコード変更なしで動作する（`LocalClient.currentUser()` が固定ユーザーを返すことでバイパス）。
13. frontend `npx tsc --noEmit` / `npm run test:run` / `npm run build` / `npm run lint` が全通過し、既存テスト回帰ゼロ。
14. backend `../.venv/bin/python manage.py test api` が全通過し、既存テスト回帰ゼロ（バックエンドは変更しないため当然だが確認する）。

---

## スコープ外（本機能で扱わないこと）

- **サーバーとローカルの同期**: ローカルモードとサーバーモードのデータ同期（双方向リアルタイム同期・マージ・コンフリクト解決）は対象外。データ移行はエクスポート/インポート ZIP による手動移行のみ。
- **サーバーモードでのエクスポート**: サーバーモードからの全データエクスポートは将来対応。ローカルモードのエクスポートを優先する。
- **サーバー側インポート API**: エクスポート ZIP をサーバーに取り込む Django management command またはインポート API の**実装**は将来対応。仕様の記録のみ行う。
- **全文検索のローカル実装**: `SearchClient.search()` はローカルでも throw（未実装）。フェーズ 4 で対応。
- **権限管理画面のローカル対応**: ローカルモードは単一ユーザー・全権限許可のため、権限管理画面（`PermissionsPage`）は表示されても実質的に無意味。非表示化やメッセージ表示は将来対応でもよい。
- **getUserMedia によるカメラプレビュー**: カメラ撮影は `<input capture="environment">` のみ。独自カメラ UI・リアルタイムプレビューは対象外。
- **PWA のプッシュ通知・バックグラウンド同期**: Service Worker はキャッシュのみ。プッシュ通知やバックグラウンド同期は対象外。
- **複数ユーザーのローカル切替**: ローカルモードは常に単一ユーザー。ユーザー切替やマルチプロファイルは対象外。
- **IndexedDB のマイグレーション**: 初期バージョンのスキーマを確定する。将来のスキーマ変更に備えたマイグレーション機構は設計で予約するが、初期実装はバージョン 1 のみ。

---

## 参照資産（根拠・絶対パス）

- `/home/kawakin/git/knowledge-base/janus/backend/.agents/tasks/phase3b-local-mode-investigation.md`（事前調査レポート・全事実の根拠）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/storage/types.ts`（`StorageClient` 契約・34 メソッド全シグネチャ）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/storage/rest-client.ts`（`RestClient` 実装・エンドポイント対応表）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/storage/StorageProvider.tsx`（クライアント注入機構・`client` prop）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/main.tsx`（Provider ネスト順・モード切替の接地点）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/auth/AuthContext.tsx`（`AuthProvider`・`currentUser()` 復元フロー）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/auth/RequireAuth.tsx`（ルートガード・ローカルモードでのバイパス）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/markdown/custom-map/MapEditor.tsx`（写真添付 `<input type="file">`・`attachPhoto`・カメラ接地点）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/pages/AssetLibraryPage.tsx`（アセット UI・`useStorage()` 経由）
- `/home/kawakin/git/knowledge-base/janus/frontend/package.json`（ビルド構成・PWA プラグイン未導入の確認）
- `/home/kawakin/git/knowledge-base/janus/frontend/vite.config.ts`（Vite プラグイン構成）
- `/home/kawakin/git/knowledge-base/janus/.kiro/specs/janus-sidebar-page-tree/requirements.md`（フォーマット参考・`getPageTree` 契約）
- `/home/kawakin/git/knowledge-base/janus/.kiro/specs/janus-sidebar-page-tree/design.md`（ツリー設計・LocalClient 互換の予約）
