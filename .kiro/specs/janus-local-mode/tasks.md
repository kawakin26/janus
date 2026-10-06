# Janus 実装計画（ローカルモード・フェーズ 3b）

本タスクリストは `janus-local-mode/design.md`（設計）を実装順に分解したもの。設計 §1 の全体像と依存関係に従い、**依存ライブラリ追加 → IndexedDB アクセス層 → 純粋ロジック（パス正規化・ツリー構築・差分）→ LocalClient（6 サブインターフェース・31 メソッド）→ モード切替注入 + 起動時選択画面 → エクスポート/インポート（ZIP 双方向）→ アセット Blob 保存の仕上げ → カメラ capture 属性 → 設定画面統合 → PWA → サーバー側取り込み（記載のみ）→ 全体検証** の順に積み上げる。各タスクは前のタスクの成果に積み上がり、各タスク完了時にコードベースがビルド可能・テスト緑を保つ粒度にする。

## 全体方針（着手前に必ず読む）

- **非破壊（最優先）**: フェーズ 1/2/3a・デザインシステム・サイドバーページツリーの機能・API・保存形式・権限・記法・ARIA・デザイントークン・`StorageClient` 契約の既存メソッドのシグネチャを**一切変えない**。ローカルモードは `StorageProvider.tsx` の `client` prop への `LocalClient` 注入＋加算のみで成立させる（設計 大原則 (1)(2)）。**backend は本機能で変更しない**（将来のサーバー取り込みは §3.10 の仕様記録のみ）。既存 frontend テスト（311 passed）・backend テスト（172 passed）を**回帰ゼロ**で通し続ける。
- **契約への接地**: `LocalClient` は `types.ts` の `StorageClient` 契約（`AuthClient` 3 + `PageClient` 10 + `AssetClient` 8 + `SearchClient` 1 + `PermissionClient` 5 + `CommentClient` 4 = **31 メソッド**）を `implements StorageClient` で型レベルに満たす。requirements.md / investigation.md の「34 メソッド」は `AssetClient` を 7 と誤算した表記ゆれであり、**本計画は設計 §4.1 の 31 を master とする**（実装すべきメソッド集合は `types.ts` で一意に確定）。
- **純粋関数への切り出し**: IndexedDB アクセス（`idb.ts`）とドメインロジック（`path-normalize.ts`・`page-tree-build.ts`・`diff-revisions.ts`・`export-import.ts`）を分離し、`fake-indexeddb` と純粋関数で単体テスト可能にする（非機能要件 8）。
- **追加ライブラリ（確定・設計 大原則 (5)/非機能要件 6）**: `jszip`（ZIP 生成/展開・ランタイム依存）・`diff`（行単位差分・`diffRevisions` 用・ランタイム依存）・`vite-plugin-pwa`（manifest + Service Worker 生成・ビルド時のみ）の 3 つ。加えて `fake-indexeddb`（devDependency・IndexedDB モック）。これ以外の新規依存（Dexie 等の ORM 風ラッパー・状態管理・HTTP クライアント）は導入しない。素の IndexedDB API を自前の薄い Promise ラッパー（`idb.ts`）で扱う。
- **デザイン整合**: 新規 UI（`ModeGate`・`SettingsPage`・`PwaUpdatePrompt`）は Tailwind v4 ユーティリティのみ・既存トークン厳守（`bg-surface`/`bg-surface-raised`/`text-fg`/`text-fg-muted`/`border-border` 等）。フォーカスリングは既存全コンポーネントと一致の `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring`。アイコンライブラリ非導入。ダークは `data-theme` 自動追従（`dark:` 手書き禁止）。
- **モード判定の保存**: `localStorage` キー `janus-mode`（値 `'local'`/`'server'`/未設定）。`theme-core.ts` と同じ防御運用（try/catch・不正値フォールバック・キー定数）に倣う（設計 §2.2）。
- **検証コマンド**:
  - frontend（`frontend/` から実行）: `npx tsc --noEmit` / `npm run test:run` / `npm run build`（PWA 成果物含む）/ `npm run lint`（0 errors）。
  - backend（`backend/` から実行・変更なし確認）: `../.venv/bin/python manage.py check` / `../.venv/bin/python manage.py makemigrations --check --dry-run`（差分なし）/ `../.venv/bin/python manage.py test api`（172 passed）。
- **コミット運用**: 実装はワークフローへ委譲し、**ワークフロー内ではコミットしない**。各タスク完了ごとにオーケストレータが独立に上記コマンドで検証してからコミットする。実機目視必須項目（ModeGate 表示・PWA インストール・オフライン起動・draw.io オフライン動作・モバイルのカメラ撮影）はユーザー確認後にコミットする。

## スコープ外（本機能で扱わない。要件スコープ外）

- サーバーとローカルの双方向同期・マージ・コンフリクト解決（データ移行はエクスポート/インポート ZIP による手動のみ）。
- サーバーモードでのエクスポート（サーバー側の全データ一括取得 API 不在のため将来対応・UI では非表示または「未対応」表示）。
- サーバー側インポート API / Django management command の**実装**（§3.10 の仕様記録のみ・本計画のタスク 15）。
- 全文検索のローカル実装（`SearchClient.search()` は throw のまま・フェーズ 4）。
- 権限管理画面（`PagePermissionPage`）のローカル非表示化・メッセージ表示（将来対応）。
- `getUserMedia` によるカメラプレビュー UI（`<input capture="environment">` のみ）。
- PWA のプッシュ通知・バックグラウンド同期（Service Worker はキャッシュのみ）。
- 複数ユーザーのローカル切替・マルチプロファイル（常に単一固定ユーザー）。
- IndexedDB のマイグレーション機構（version 1 のみ確定・version 2+ は `onupgradeneeded` に予約）。
- Android Chrome の `capture` 制約対応（カメラ/ファイル選択ボタン分離）・`navigator.storage.persist()` 拒否時の警告 UI（将来対応・設計 §11）。

---

## 依存ライブラリと基盤

- [ ] 1. 依存ライブラリ（JSZip / diff / vite-plugin-pwa / fake-indexeddb）を追加する
  - `frontend/package.json` の `dependencies` に `jszip`・`diff`（+ 型が別パッケージの場合 `@types/diff` を `devDependencies`）、`devDependencies` に `vite-plugin-pwa`・`fake-indexeddb` を追加し、`npm install` でロックファイルを更新する。バージョンはピン（開レンジを避ける）。この段階ではまだ import しない（後続タスクで使う）。設計 大原則 (5)・非機能要件 6・§7.2。
  - ファイル: `frontend/package.json`, `frontend/package-lock.json`
  - 検証: `frontend/` で `npx tsc --noEmit`（型解決が通る）→ `npm run test:run`（既存 311 件回帰ゼロ）→ `npm run build`（既存ビルドが壊れない）が成功する。
  - _要件: 非機能 6, LM-3-1, LM-7-1_

- [ ] 2. IndexedDB アクセス層 `idb.ts`（スキーマ・DB オープン・Promise ラッパー）を実装する
  - `frontend/src/storage/idb.ts`（新規）に設計 §4.3 の薄い Promise ラッパーを実装する: `openDb()`（`onupgradeneeded`（version 1）で 6 ストア `pages`(keyPath `path`)・`revisions`(autoIncrement `id`・index `path` 非一意・`[path, number]` 一意)・`comments`(autoIncrement `id`・index `path`)・`folders`(autoIncrement `id`・index `parentId`)・`assets`(autoIncrement `id`・index `folderId`)・`meta`(keyPath `key`) を作成）、`tx<T>(db, stores, mode, fn)`、`getByKey`・`getAll`・`getAllByIndex`・`put`・`del`・`clearStore`。全 IDB リクエストを `onsuccess`/`onerror` → resolve/reject でブリッジ。将来のスキーマ変更は version を上げ `onupgradeneeded` で差分マイグレーション（初期は version 1 のみ）。DB 名は `janus-local`。設計 §4.2 のスキーマ表に厳密一致させる。
  - `frontend/src/storage/idb.test.ts`（新規・`fake-indexeddb/auto` を import）で `openDb` が 6 ストア + 期待インデックスを作ることを検証する。
  - ファイル: `frontend/src/storage/idb.ts`, `frontend/src/storage/idb.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（新規 idb テスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-2-2, 非機能 5, 非機能 8_

- [ ] 3. パス正規化 `path-normalize.ts`（純粋関数）を実装する
  - `frontend/src/storage/path-normalize.ts`（新規）に backend `api/utils.normalize_path` の TS 移植（純粋関数）を実装する。過剰スラッシュの畳み込み・`.`/`..` の除去・絶対パス化（先頭 `/`）をサーバーと同等の規則で行う。設計 §4.12（正規化の所有層）。ローカル専用（サーバーモードでは正規化はサーバーが行う）。
  - `frontend/src/storage/path-normalize.test.ts`（新規）で正規化規則（多重スラッシュ・相対セグメント・ルート・末尾スラッシュ）を網羅する。
  - ファイル: `frontend/src/storage/path-normalize.ts`, `frontend/src/storage/path-normalize.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` が成功する。
  - _要件: LM-2-6, 非機能 8_

- [ ] 4. ツリー構築 `page-tree-build.ts`（純粋関数）を実装する
  - `frontend/src/storage/page-tree-build.ts`（新規）に `getPageTree` のツリー構築を純粋関数として実装する（設計 §4.8）。入力は全ページの `{path, title}` 配列と `root`（既定 `/`）。手順: (1) `root` 配下収集（`prefix = root==='/' ? '/' : root+'/'`）、(2) 各セグメント境界で中間ノード導出・実ページ無しは仮想ノード（`hasPage=false`・`title`=末尾セグメント）、(3) `path` キー Map で親子接続、(4) 空仮想ノードのボトムアップ剪定（`hasPage=false` かつ子なしを除去し上位へ伝播）、(5) パス昇順整列・`hasChildren = children.length>0` 確定、(6) `PageTreeNode[]` を返す。**権限枝刈りは行わない**（ローカルは全権限許可・サーバー版との唯一の差分）。サーバー版 `PageTreeView`（janus-sidebar-page-tree 設計 §2.4）と同じレスポンス形状。
  - `frontend/src/storage/page-tree-build.test.ts`（新規）でサーバー版 §2.9 と同等ケース（ネスト・仮想ノード・空ツリー・`hasChildren` 一致・空仮想ノード剪定）を検証する。
  - ファイル: `frontend/src/storage/page-tree-build.ts`, `frontend/src/storage/page-tree-build.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` が成功する。
  - _要件: LM-2-6, 非機能 8_

- [ ] 5. 差分変換 `diff-revisions.ts`（純粋関数・diff ライブラリ）を実装する
  - `frontend/src/storage/diff-revisions.ts`（新規）に `diff` パッケージの `diffLines(oldStr, newStr)` を `DiffLine[]`（`{ op: 'add'|'del'|'equal', line: string }`）へ変換する純粋関数を実装する（設計 §4.9）。`added`→`op:'add'`、`removed`→`op:'del'`、どちらでもない→`op:'equal'` にマップ。各ハンクの `value` を改行で split し末尾の空要素を落とす（空行の過剰生成回避）。サーバー `difflib` とのバイト単位一致は目標にしない（別環境・設計で確定判断）。
  - `frontend/src/storage/diff-revisions.test.ts`（新規）で追加のみ/削除のみ/混在/無変更の各ケースで `op` が正しいことを検証する。
  - ファイル: `frontend/src/storage/diff-revisions.ts`, `frontend/src/storage/diff-revisions.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` が成功する。
  - _要件: LM-2-6, 非機能 8_

---

## LocalClient（IndexedDB 版 StorageClient・31 メソッド）

- [ ] 6. `LocalClient` の骨格・固定ユーザー・ダミー実装（Auth/Permission/Search）を実装する
  - `frontend/src/storage/local-client.ts`（新規）に `class LocalClient implements StorageClient` を宣言し、DB 接続の遅延初期化（最初のメソッド呼出時に `openDb` を 1 回だけ実行し `Promise<IDBDatabase>` をキャッシュ）、固定ユーザー定数 `LOCAL_USER = { id: 1, username: 'local', is_staff: true, is_superuser: true }`、エラー変換（`ApiError` を throw・`QuotaExceededError`→`ApiError(507)`・`openDb` 失敗→`ApiError(500)`）を実装する。この段階では以下のダミー 9 メソッドを実装する（設計 §4.4/§4.5/§4.6/§4.13）:
    - AuthClient 3: `currentUser()`→`LOCAL_USER` を即返す / `login()`→`{ token: 'local', user: LOCAL_USER }` / `logout()`→no-op。
    - PermissionClient 5: `getEffectivePermission()`→`{ view: true, edit: true }` / `listPermissions()`→`[]` / `grantPermission()`・`updatePermission()`→入力をエコーしたダミー `PermissionEntry` / `revokePermission()`→no-op。
    - SearchClient 1: `search()`→`throw new Error('search() はフェーズ 4 で実装します')`（`RestClient` と同一文言・挙動）。
  - 残り 22 メソッド（Page 10・Asset 8・Comment 4）は後続タスク 7-9 で実装するが、**タスク 6 完了時点でも `implements StorageClient` が tsc を通る**よう、未実装メソッドは最小のスタブ（`throw new Error('not implemented')` など）を置き、型シグネチャは `types.ts` に厳密一致させる（後続タスクで中身を埋める）。
  - `frontend/src/storage/local-client.test.ts`（新規・`fake-indexeddb/auto`）に Auth/Permission/Search ダミーのテスト（固定ユーザー・全許可・no-op が throw しない・`search` が throw）と `implements StorageClient` のコンパイル確認を追加する。
  - ファイル: `frontend/src/storage/local-client.ts`, `frontend/src/storage/local-client.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit`（31 メソッドの型適合）→ `npm run test:run`（ダミーテスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-2-1, LM-2-3, LM-2-4, LM-2-5, LM-2-9, 非機能 2_

- [ ] 7. `LocalClient` の PageClient 10 メソッドを実装する
  - タスク 2-5 の `idb.ts`・`path-normalize.ts`・`page-tree-build.ts`・`diff-revisions.ts` を使い、`local-client.ts` の PageClient 10 メソッドを実装する（設計 §4.7）:
    - `getPage(path)`（正規化して `pages.get`・無ければ `null`）、`listChildren(parentPath)`（全走査で直下 1 階層を `PageSummary[]` 昇順）、`getPageTree(root?)`（全ページを `page-tree-build.ts` に渡す）。
    - `createPage`（正規化・重複は `ApiError(409)`・`pages` + リビジョン #1 + `meta.page_seq` からの `Page.id` 採番を**単一 `readwrite` tx `['pages','revisions','meta']` で `await` を挟まず同期実行**・`created_by`/`updated_by`=`LOCAL_USER`）、`updatePage`（無ければ `ApiError(404)`・`pages`+`revisions` の単一 tx・**本文不変最適化**（最新 revision の body と同一なら新 revision を作らない・title のみ変化は `title`/`updated_at`/`updated_by` 更新・両不変なら `updated_at` 据え置き））、`deletePage`（`pages`/`revisions`/`comments` を単一 tx で削除）。
    - `listRevisions`（`path` インデックス・`number` 降順・`limit`/`offset`・各要素は autoIncrement `id` を含み `author`=`LOCAL_USER`）、`getRevision`（`[path, number]` インデックス・無ければ throw・`id` を含み `author`=`LOCAL_USER`）、`diffRevisions`（from/to の body を取得し `diff-revisions.ts` へ）、`restoreRevision`（指定 revision の `title`+`body` で `updatePage` を呼ぶ・新 number は `(最新 or 0)+1`・本文不変最適化・`author`=`LOCAL_USER`。サーバー `RevisionRestoreView`/`save_page_body` と同一挙動）。
  - 設計 §4.7 のトランザクション境界・§4.2 の `Page.id`/author 規約を厳守する。
  - `local-client.test.ts` に PageClient のテスト（`createPage`→`getPage` round-trip、`updatePage` で revision 増加、`deletePage` で関連 revision/comment も消える、`listChildren` が直下のみ、`listRevisions` 降順＋`limit`/`offset`＋各要素一意 `id`、`createPage` 連続作成で `Page.id` 衝突なし、重複 path 409、無しページ更新 404）を追加する。`getPageTree` のロジック検証は `page-tree-build.test.ts`（タスク 4）が担うため、ここでは LocalClient 経由の最小 round-trip のみ。
  - ファイル: `frontend/src/storage/local-client.ts`, `frontend/src/storage/local-client.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（PageClient テスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-2-6, LM-2-9, 非機能 5, 非機能 8_

- [ ] 8. `LocalClient` の CommentClient 4 メソッドを実装する
  - `local-client.ts` の CommentClient 4 メソッドを実装する（設計 §4.10）: `listComments(path)`（`path` インデックス・`created_at` 昇順・`author`=`LOCAL_USER`）、`addComment(path, body)`（空・空白のみは `ApiError(400)`・`author`=`LOCAL_USER`（`id=1`）で `put`・戻り値 `Comment`）、`updateComment(id, body)`（`id` で取得→`body`/`updated_at` 更新・無ければ throw）、`deleteComment(id)`（`id` で削除）。`CommentSection` の `comment.author.id === user.id` 判定が成立するよう `author.id` を `LOCAL_USER.id=1` に一致させる（§4.2 author 規約）。
  - `local-client.test.ts` に CommentClient のテスト（投稿→一覧（昇順）→更新→削除、空本文で `ApiError(400)`、`author` が `User` オブジェクトで `id=1`）を追加する。
  - ファイル: `frontend/src/storage/local-client.ts`, `frontend/src/storage/local-client.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（CommentClient テスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-2-8, LM-2-9, 非機能 8_

- [ ] 9. `LocalClient` の AssetClient 8 メソッド（Blob 保存・URL 生成・resolveAssetUrl）を実装する
  - `local-client.ts` の AssetClient 8 メソッドを実装する（設計 §4.11/§5）: `listFolders(parentFolderId)`（`parentId` インデックス・`created_at` 昇順）、`createFolder({parentId,name})`（同一 `parentId`+`name` 重複は `ApiError(409)`）、`listAssets(folderId)`（`folderId` インデックス・昇順・`url` は空文字 `''`）、`uploadAsset({folderId,file,alias?})`（`file` を Blob として `assets` に `put`・`filename`/`alias`/`content_type`/`folderId` 併せて保存・同一 `folderId`+`filename` または空でない `alias` 重複は `ApiError(409)`・戻り値 `url` 空文字）、`moveAsset(assetId,toFolderId)`（`folderId` 更新）、`getAssetFileUrl(asset)`（`asset.id` で取得→`blob` から `URL.createObjectURL`）、`releaseAssetFileUrl(url)`（**同期 `void`**・`blob:` 始まりなら `URL.revokeObjectURL`・`async` 化禁止＝型が通らない）、`resolveAssetUrl(ref)`（§5.3 の `folderSegments`/`findFolderId` 相当のヘルパでフォルダ辿り→filename/alias 検索→`getAssetFileUrl`→Blob URL・1 回の呼出し中は `Map` キャッシュ・見つからなければ `null`）。
  - これで `LocalClient` の 31 メソッドが全て実装され、タスク 6 で置いた未実装スタブは全て解消される。
  - `local-client.test.ts` に AssetClient のテスト（`uploadAsset`→`getAssetFileUrl` round-trip で `blob:` URL、`uploadAsset`/`createFolder` の一意制約 409、`resolveAssetUrl` の階層+filename/alias 解決と不一致時 `null`、`moveAsset` 後に新フォルダで見つかる）を追加する。
  - ファイル: `frontend/src/storage/local-client.ts`, `frontend/src/storage/local-client.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit`（31 メソッド全て型適合・未実装スタブ解消）→ `npm run test:run`（AssetClient テスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-2-7, LM-2-9, LM-5-1, LM-5-3, 非機能 8_

---

## モード切替注入と起動時選択画面

- [ ] 10. モード永続化 `mode.ts`（純粋 localStorage 操作）を実装する
  - `frontend/src/storage/mode.ts`（新規）に設計 §2.2 の `MODE_KEY = 'janus-mode'`、`readMode(): 'local' | 'server' | null`（try/catch・不正値/例外は `null`）、`writeMode(mode)`・`clearMode()`（try/catch で握りつぶし）を実装する。`theme-core.ts` の防御運用に倣う。純粋関数。
  - `frontend/src/storage/mode.test.ts`（新規）で正常値・不正値・localStorage 例外（`vi.spyOn(Storage.prototype, ...)`）を検証する。
  - ファイル: `frontend/src/storage/mode.ts`, `frontend/src/storage/mode.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` が成功する。
  - _要件: LM-1-1, LM-1-6, 非機能 8_

- [ ] 11. モード選択画面 `ModeGate` を実装する
  - `frontend/src/components/ModeGate.tsx`（新規）に設計 §2.3 のモード選択画面を実装する: 2 択（「ローカルモード — サーバー不要」/「サーバーモード — ログインして使う」）、押下で `writeMode('local'|'server')`→`location.reload()`。デザイントークン準拠（`bg-surface`/`text-fg`/`Button` variant `normal`/`primary`）・アイコンなし。
  - `frontend/src/components/ModeGate.test.tsx`（新規・`// @vitest-environment jsdom`）でボタン描画・押下→`localStorage` 書込→`location.reload` 呼出（`vi.fn()` でモック）を検証する。
  - ファイル: `frontend/src/components/ModeGate.tsx`, `frontend/src/components/ModeGate.test.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` が成功する。
  - _要件: LM-1-1, LM-1-2_

- [ ] 12. `main.tsx` の `Root` でモード判定 + client 注入 + ModeGate を配線する
  - `frontend/src/main.tsx` に設計 §2.3 の `Root` コンポーネントを追加する: `readMode()` が `null`→`<ModeGate />`、`'local'`→`new LocalClient()`、`'server'`→`createStorageClient()` を `<StorageProvider client={client}>` に注入。既存ネスト順（`ThemeProvider > BrowserRouter > Root`）を保ち、`Root` は `BrowserRouter` の内側に置く。`LocalClient` 初期化時に `navigator.storage?.persist()` を呼ぶ（§7.5・結果は使わない）。既存の Provider ネストと `App` の挙動は変えない。`AuthProvider`/`RequireAuth` は**コード変更なし**で `LocalClient.currentUser()` の固定ユーザーによりバイパスされる（§2.5・検証はタスク 18 の実機/統合で）。
  - `main.tsx` の `Root` を単体テスト可能にする場合は `Root` を named export し、`frontend/src/main.test.tsx`（新規・jsdom）で `mode='local'`→`LocalClient` 注入、`'server'`→`RestClient` 注入、`null`→`ModeGate` 描画を検証する（`readMode` をモック）。
  - ファイル: `frontend/src/main.tsx`, `frontend/src/main.test.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（Root テスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-1-1, LM-1-3, LM-1-4, LM-1-5, LM-1-7, 統合受入 1, 統合受入 12_

---

## エクスポート/インポート（ZIP 双方向）

- [ ] 13. エクスポート/インポートロジック `export-import.ts`（JSZip 双方向）を実装する
  - `frontend/src/storage/export-import.ts`（新規）に設計 §3 のエクスポート/インポートを実装する。
    - **エクスポート（§3.2–§3.7）**: IndexedDB 全ストアを読み出し、JSZip で `manifest.json`（`version:1`/`exportedAt`/`pageCount`/`assetCount`/`generator`）・`pages/<encoded-path>.json`（`path`/`title`/`body`/`created_at`/`updated_at`/`revisions[]`/`comments[]`・各 `author` は `User` オブジェクト・`Page.id`/`created_by`/`updated_by` は含めない）・`assets/<id>.<ext>`（非圧縮 `STORE`）+ `assets/<id>.meta.json`・`folders.json` を構築。パスのファイル名エンコード（`/`→`%2F`・先頭 `/` 除去・ルート `/`→`_root_`）。`generateAsync({type:'blob'})`→`<a download="janus-export-YYYYMMDD-HHmmss.zip">` クリック→Blob URL 解放。`onUpdate` でテキスト進捗。
    - **インポート（§3.8）**: `loadAsync`→`manifest.json` の `version` 検証（`>1` はエラー中断）→**確認ダイアログ同意**→**ステップ 5: ZIP 全エントリをメモリへ読み切る（非同期フェーズ）**（`author` 補完（欠落/`null`/文字列→`LOCAL_USER`）・ページ `created_by`/`updated_by`→`LOCAL_USER`・フォルダ ID マッピング・アセット `folderId` 付替え・**各ページ revisions の `number` 一意性検証**（違反は「エクスポートファイルのリビジョン番号が不正です」で IndexedDB に触れず中断））→**ステップ 6: 6 ストア対象の単一 `readwrite` tx で `clear()`→`put`（内部で `await` を一切挟まない同期書き込み）**（`abort`/`error` は自動ロールバックで既存保持）→`pageCount`/`assetCount` 照合（不一致は警告）→`location.reload()`。
  - 純粋ロジック（パスエンコード・author 補完・ID マッピング）は IndexedDB アクセスから切り出してテスト可能にする（非機能要件 8）。
  - `frontend/src/storage/export-import.test.ts`（新規・`fake-indexeddb/auto`）で設計 §3.13 の観点を検証する: エクスポート構造・内容、パスエンコード round-trip、インポートの全クリア→復元・ID マッピング、バリデーション（壊れ ZIP / `manifest` 無し / `version` 非互換 / `number` 重複で IndexedDB 無傷中断）、round-trip（ZIP 等価）、round-trip（復元後 `getRevision`/`listComments`/`getPage` の型適合・`author`=`LOCAL_USER`・`created_by`/`updated_by`=`LOCAL_USER`）。
  - ファイル: `frontend/src/storage/export-import.ts`, `frontend/src/storage/export-import.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（export-import テスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-3-1, LM-3-2, LM-3-3, LM-3-5, LM-4-1, LM-4-2, LM-4-3, LM-4-4, 非機能 5, 非機能 8_

---

## アセット仕上げ・カメラ・設定画面統合

- [ ] 14. MapEditor にローカルモード時のカメラ `capture` 属性を追加する
  - `frontend/src/markdown/custom-map/MapEditor.tsx` の写真添付 `<input type="file" accept="image/*">`（`attachPhoto` を呼ぶ既存 input・1 箇所）に `capture={isLocalMode ? 'environment' : undefined}` を追加する（設計 §6.2）。`isLocalMode` は `mode.ts` の `readMode()` を直読みして判定（`readMode() === 'local'`・レンダー時 1 回で十分・Context や契約変更は行わない・§6.3）。`readMode()` が `null` の場合も `undefined`（＝サーバー相当・capture なし）に安全に倒れる。既存 `attachPhoto`→`uploadAsset` 経路は変更しない。サーバーモードは従来どおり `capture` なし。
  - 既存 MapEditor テスト（または新規 `MapEditor` のカメラ観点テスト）で `isLocalMode` モック時に `input` が `capture="environment"` を持ち、サーバーモード時は持たないことを `getAttribute('capture')` で検証する。既存テストは回帰ゼロ。
  - ファイル: `frontend/src/markdown/custom-map/MapEditor.tsx`, `frontend/src/markdown/custom-map/MapEditor.test.tsx`（既存に追記 or 新規）
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（capture テスト合格・既存回帰ゼロ）が成功する。
  - _要件: LM-6-1, LM-6-2, LM-6-3, LM-6-4, LM-6-5_

- [ ] 15. 設定画面 `SettingsPage`（エクスポート/インポート/モード切替）を実装し `/settings` ルートを追加する
  - `frontend/src/pages/SettingsPage.tsx`（新規）に設計 §3.11 の設定画面を実装する: エクスポートボタン（`export-import.ts` のエクスポート呼出・進捗テキスト表示）、インポート（`<input type="file" accept=".zip">`→確認ダイアログ→`export-import.ts` のインポート呼出）、モード切替（`clearMode()`→`location.reload()`）。サーバーモード時はエクスポート/インポートを非表示または「サーバーモードでは未対応」表示（§3.9）。`AppLayout` でラップし既存ページと同体裁。デザイントークン準拠。**サーバー側取り込みは実装しない**（§3.10 の仕様はコメント/docstring として記録のみ・将来 Django management command `import_janus_zip` または `POST /api/import`）。
  - `frontend/src/App.tsx` に `/settings` ルート（`RequireAuth` ラップ）を追加する。`AppLayout`（またはヘッダー）にローカルモード時の「設定」導線を追加する（既存 `NAV_ITEMS` 2 項目は維持・既存グローバル導線不変）。
  - `frontend/src/pages/SettingsPage.test.tsx`（新規・jsdom）でエクスポート/インポートボタン描画・押下でロジック呼出（`export-import.ts` をモック）・モード切替で `clearMode`+`reload` 呼出・サーバーモード時のエクスポート非表示を検証する。
  - ファイル: `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/SettingsPage.test.tsx`, `frontend/src/App.tsx`, `frontend/src/components/AppLayout.tsx`（設定導線追加）
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（SettingsPage テスト合格・既存 AppLayout/App 回帰ゼロ）が成功する。
  - _要件: LM-3-4, LM-4-5, LM-1-6, LM-3-6, LM-4-6_

---

## PWA

- [ ] 16. PWA アイコンを配置する
  - `frontend/public/icons/icon-192.png`（192×192）と `frontend/public/icons/icon-512.png`（512×512）を配置する（設計 §7.4）。既存ロゴがあれば流用、無ければ単色プレースホルダー PNG（デザイントークンのテーマカラー基調）を生成して置く。これらが無いと LM-7-4（manifest icons）・LM-7-5（インストール可能）が未達になるため、PWA 設定（タスク 17）より前に配置する。
  - ファイル: `frontend/public/icons/icon-192.png`, `frontend/public/icons/icon-512.png`
  - 検証: `frontend/` で `npm run build` 後、`dist/icons/icon-192.png`・`dist/icons/icon-512.png` が存在する（`public/` は `dist/` へコピーされる）。
  - _要件: LM-7-4, LM-7-5_

- [ ] 17. `vite-plugin-pwa` 設定と更新プロンプト `PwaUpdatePrompt` を実装する
  - `frontend/vite.config.ts` に設計 §7.2 の `VitePWA({...})` を既存 `plugins`（`react()`・`tailwindcss()`）へ追加する: `registerType:'prompt'`、`includeAssets:['drawio/webapp/**/*']`、`workbox:{ globPatterns, maximumFileSizeToCacheInBytes: 25*1024*1024, navigateFallback:'index.html', navigateFallbackDenylist:[/^\/api\//] }`、`manifest:{ name:'Janus', short_name:'Janus', start_url:'/', display:'standalone', theme_color/background_color, icons(192/512/maskable) }`、`devOptions:{ enabled:false }`。既存 `server.proxy`・`test` 設定は不変。
  - `frontend/src/components/PwaUpdatePrompt.tsx`（新規）に `virtual:pwa-register/react` の `useRegisterSW` を使う更新プロンプトを実装する（§7.6・`needRefresh` 時のみ表示・「更新する」で `updateServiceWorker(true)`・デザイントークン準拠）。`frontend/src/App.tsx`（または `main.tsx` の `Root`）に配置する。`virtual:pwa-register/react` の型解決のため必要なら `frontend/src/vite-env.d.ts` に `/// <reference types="vite-plugin-pwa/react" />` を追加する。
  - `frontend/src/components/PwaUpdatePrompt.test.tsx`（新規・jsdom）で `useRegisterSW` をモックし、`needRefresh` true 時にプロンプト表示・「更新する」で `updateServiceWorker(true)` 呼出を検証する（§7.8）。
  - ファイル: `frontend/vite.config.ts`, `frontend/src/components/PwaUpdatePrompt.tsx`, `frontend/src/components/PwaUpdatePrompt.test.tsx`, `frontend/src/App.tsx`（or `main.tsx`）, `frontend/src/vite-env.d.ts`（必要時）
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（PwaUpdatePrompt テスト合格・既存回帰ゼロ・`devOptions.enabled:false` によりテスト環境に SW が介入しない）→ `npm run build` 後に `dist/` に Service Worker（`sw.js` 等）・`manifest.webmanifest` が生成され、precache manifest に `drawio/webapp/` 配下が含まれる（最大個別ファイルが `maximumFileSizeToCacheInBytes` を下回る）ことを確認する。
  - _要件: LM-7-1, LM-7-2, LM-7-3, LM-7-4, LM-7-5, LM-7-6, LM-7-7, LM-7-8, 非機能 4_

---

## 全体検証と実機目視

- [ ] 18. 全体回帰・ビルド・lint と実機目視
  - **frontend**（`frontend/` から実行）: `npx tsc --noEmit`（`LocalClient implements StorageClient` の型適合含む）→ `npm run test:run`（新規テスト群 + 既存 311 件回帰ゼロ）→ `npm run build`（PWA 成果物・`manifest.webmanifest`・SW・draw.io precache 含む）→ `npm run lint`（0 errors）。
  - **backend**（`backend/` から実行・変更なし確認）: `../.venv/bin/python manage.py check` → `../.venv/bin/python manage.py makemigrations --check --dry-run`（差分なし）→ `../.venv/bin/python manage.py test api`（172 passed・回帰ゼロ）。
  - **実機目視（ユーザー確認・コミット前）**: Firefox / Chrome 最新で、(1) 初回アクセスで `ModeGate` 表示→ローカル選択→`localStorage` 記録→本体起動・再訪で直接起動、(2) ローカルモードでページ CRUD・リロード後データ保持、(3) サイドバーツリー表示、(4) リビジョン履歴・差分・復元、(5) コメント投稿/編集/削除、(6) アセットアップロード/一覧/参照・フォルダ作成/移動、(7) モバイルで MapEditor カメラ撮影（`capture`）、(8) エクスポート ZIP ダウンロード→インポート復元（確認ダイアログ）、(9) PWA インストール・オフライン起動・draw.io オフライン動作、(10) サーバーモード選択で `RestClient` 従来動作・既存全機能回帰なし、(11) `AuthProvider`/`RequireAuth` がコード変更なしでバイパス動作。
  - 検証: 上記 frontend/backend コマンドが全成功し、既存フェーズ 1/2/3a・デザインシステム・サイドバーツリーのテスト差分がゼロであること。実機目視項目をユーザーが確認してからコミットする。
  - _要件: 非機能 1, 非機能 2, 非機能 4, 統合受入 1〜14_
