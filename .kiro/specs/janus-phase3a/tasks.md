# Janus 実装計画（フェーズ 3a・サーバーモードのコンテンツ機能）

本タスクリストは `janus-phase3a/design.md`（ユーザー確定事項 CONFIRMED-1/2/3 を反映した改訂版・§17 参照）を実装順に分解したもの。各タスクは前のタスクの成果に積み上がり、各タスク完了時にコードベースがビルド可能な状態を保つ。チェックを付けながら進める。設計の章番号・擬似コード・失敗表（§3.1／§3.2／§5.5）・テスト観点（§12）に忠実に実装すること。**CAD 変換はブラウザ（フロントエンド）で完結し、サーバーは変換に一切関与しない。draw.io はセルフホスト同梱**（旧「サーバー ezdxf 変換・CAD 変換エンドポイント・公開 embed.diagrams.net」は廃止、設計 §5/§6.3/§17）。

## 全体方針（着手前に必ず読む）

- **フェーズ 1/2 非破壊（最優先）**: 既存 `Page`/`Folder`/`Asset`/`PagePermission`/`Revision` のスキーマ・既存 API レスポンスの必須フィールド・既定挙動を変えない。新規は **追加のみ**（新規モデル `Comment`・追加マイグレーション `0005`・別エンドポイント・契約の追加メソッド・新規フロントユーティリティ/コンポーネント）で構成する（設計 §13、非機能 1）。既存の約 145（backend）/ 約 132（frontend）テストを回帰ゼロで通し続ける（検証項目 17）。
- **サーバーがセキュリティ境界**: 可否判定の最終決定は Python 層（`require_page_permission`・`check_permission`・`can_modify_comment` ほかビュー内判定）。フロントの表示制御は補助（設計 §4、非機能 2）。
- **権限ロジックは流用のみ**: 新しい権限判定規則を作らない。既存 `permissions.py`/`permissions_logic.py`（superuser バイパス・階層継承・Deny 優先・edit→view 含意）をそのまま使う。Django superuser が閲覧拒否を受けないのは仕様（ユーザー確認済み）であり維持する（設計 §4）。
- **本文を変える操作は `save_page_body` 単一経路**: 地図 GUI 編集・draw.io 保存・写真紐付けは既存 `updatePage`/`createPage`（内部 `save_page_body`）を通し、新しい本文保存経路を作らない（不変条件: 最新リビジョン body == `Page.body`、設計 §4/§13）。コメントは本文ではないため `save_page_body` を通さず専用ビューで扱う（本文・リビジョン非干渉）。
- **記法仕様 `:::custom-map` の正は foundation**: `parse-map.ts`/`CustomMapViewer` は変更しない。GUI 編集は `buildMapData` が読める記法だけを生成する（設計 §7、非機能 6）。
- **SQLite 必須・PostgreSQL は後回し**: 新規スキーマ・クエリは SQLite で成立させ SQLite 固有機能に依存しない（非機能 4、ユーザー方針）。
- **PATH の正規化**: path は既存 `api/utils.normalize_path` で正規化してから扱う（既存流儀）。
- **検証コマンド**:
  - backend（`backend/` から実行）: `../.venv/bin/python manage.py check` / `../.venv/bin/python manage.py makemigrations --check --dry-run` / `../.venv/bin/python manage.py migrate` / `../.venv/bin/python manage.py test`
  - frontend（`frontend/` から実行）: `npx tsc --noEmit` / `npm run test:run` / `npm run build` / `npm run lint`

## 実装順の根拠（タスク依存）

**実装初手のスパイクを最優先タスク（タスク 0）に置く**: CAD ブラウザ変換（`ezjww`/WASM が Vite・Web Worker 上で読み込めるか、`dxf-parser`/`iconv-lite` がブラウザで動くか）と draw.io セルフホスト同梱（同梱 `GraphViewer` の XML 単体描画・同梱 webapp の自オリジン起動・配信サイズ）の実機成立を最初に確認し、不成立なら設計 §14 の代替へ戻す。以降は: **コメントが最も独立**（既存モデル/権限の流用で完結）→ **地図 GUI 編集**は既存 `:::custom-map`（`parse-map.ts`）の逆関数実装に依存 → **CAD 変換**はフロント変換ユーティリティ + 既存 `uploadAsset`（サーバー追加なし）→ **draw.io** は本文保持形式（`:::drawio` ディレクティブ/シリアライザ）を固めてから同梱エディタ/ビューアへ。契約（`StorageClient`）追加は**コメントのみ**（CAD は契約に載せない。設計 §9.2）。

## スコープ外（本フェーズで扱わない。設計 §13・要件スコープ外）

- ローカルモードの実装そのもの（IndexedDB 版 `uploadAsset`・PWA・オフライン基盤・端末カメラ撮影）→ フェーズ 3b。ただし 3a で作る CAD ブラウザ変換ユーティリティ・draw.io セルフホスト同梱は 3b がそのまま再利用できる形で実装する（端末内変換・オフライン作図を 3b で追加実装なしに成立させるのが設計目標。設計 §5 冒頭・§6.3）。
- アセット単位の閲覧/配信権限（P2-5-7・U-3A-2）→ 将来の専用課題。CAD 変換後 SVG の登録・写真も既存 `uploadAsset` 経由で認証のみ。
- フェーズ 2 後続改善（権限付与 UI のユーザー名/グループ名指定、新規ページ作成フロー内の初期権限設定）→ 本フェーズでは扱わない（参照のみ）。
- 全文検索 → フェーズ 4。

---

## 実装初手スパイク（CAD ブラウザ変換 / draw.io セルフホスト同梱の実機成立確認）

- [ ] 0. CAD ブラウザ変換・draw.io 同梱の実現可能性スパイク（最優先・不成立なら設計 §14 の代替へ）
  - **CAD（設計 §5.1/§5.6）**: `frontend/` に `ezjww`・`dxf-parser`・`iconv-lite` を試験導入し、(a) `dxf-parser` が代表 `.dxf`（Shift-JIS/UTF-8 両方）をブラウザ/Vitest でパースできる、(b) `ezjww`（WASM）が Vite のビルド・開発サーバーで読み込め初期化できる（`?url`/`vite-plugin-wasm`/ライブラリ提供の初期化 API のいずれで成立するか）、(c) `ezjww` が **Web Worker 上で**初期化できる（成立すれば Worker 既定、不成立ならメインスレッド + ローディング表示にフォールバック）、(d) `iconv-lite` のブラウザバンドルが過大でないか（CP932 中心に絞れるか、`TextDecoder` ベースで代替できるか）を確認する。
  - **draw.io（設計 §6.3）**: diagrams.net の配布物（閲覧 `GraphViewer`／編集 webapp・Apache-2.0）を `frontend/public/` 等に同梱し、(a) 同梱 `GraphViewer` が代表 mxGraph XML 単体（外部参照ゼロ）から図を描画できる、(b) 同梱 webapp が自オリジンから `embed=1&proto=json` で `iframe` 起動し `postMessage` 往復（`init`/`load`/`save`/`exit`）で XML を保存/読込できる、(c) 追加配信サイズ（閲覧ビューア・編集 webapp を独立に実測）が許容範囲、を確認する。NOTICE（Apache-2.0）同梱方法も確認。
  - いずれか不成立なら、該当機能を warning で停止し設計 §14 の代替（CAD: 代替変換ライブラリ/対応縮小、draw.io: 代替軽量 mxGraph ビューア。いずれも保存形式・サーバー非関与の方針は維持）へ戻す。スパイク用の一時コード/依存は確認後に整理し、確定した依存のみ `package.json` へ残す。
  - ファイル: `frontend/package.json`（確定依存の追記）、`frontend/public/`（同梱配布物の配置可否判断）、`frontend/vite.config.ts`（WASM/静的配信設定の要否判断）。確認用の一時コードは破棄。
  - 検証: `frontend/` で `npm run build` が成功し WASM/同梱配布物がビルド成果物に含まれること、代表 DXF 変換と代表 XML 描画・webapp 起動がスパイクで確認できること。配信サイズを実測し記録する。
  - _要件: 3A-CAD-1, 3A-CAD-6, 3A-CAD-9, 3A-DRAW-1, 3A-DRAW-4, DECISION-NEEDED D-CAD/D-DRAW-HOST/D-DRAW-VIEW, 非機能 3_

---

## バックエンド: コメント機能（最も独立。既存モデル/権限/シリアライザ流儀の流用で完結する）

- [ ] 1. `Comment` モデル・マイグレーション・admin
  - `backend/api/models.py` に `Comment` を追加する（設計 §2.1）: `page`（FK Page, `on_delete=CASCADE`, `related_name="comments"`）、`body`（TextField）、`author`（FK auth.User, `null=True, blank=True, on_delete=SET_NULL, related_name="comments"`）、`created_at`（`auto_now_add=True, db_index=True`）、`updated_at`（`auto_now=True`）。`Meta.ordering = ["created_at", "id"]`。既存 `Page`/`Folder`/`Asset`/`PagePermission`/`Revision` は一切変更しない。`page`=CASCADE／`author`=SET_NULL は既存 `Revision` と同方針。
  - `backend/api/admin.py` に `Comment` を登録する（既存 `list_display` 流儀）。
  - `backend/api/migrations/0005_comment.py` を `CreateModel` のみで生成する（additive-only、既存 `0001`〜`0004` は変更しない。設計 §10）。
  - ファイル: `backend/api/models.py`, `backend/api/admin.py`, `backend/api/migrations/0005_comment.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py makemigrations --check --dry-run`（未生成差分なし）→ `../.venv/bin/python manage.py migrate`（既存 db.sqlite3 に適用成功・既存データ保持）→ `../.venv/bin/python manage.py check` が成功する。
  - _要件: 3A-C-1, 3A-C-5, 3A-C-6, 非機能 1, 非機能 4, 統合受入 18_

- [ ] 2. `CommentSerializer` と本文バリデーション
  - `backend/api/serializers.py` に `CommentSerializer` を追加する（既存 `RevisionSerializer`/`UserSerializer` 流儀）。出力は `{id, body, author, created_at, updated_at}`（`author` は既存 `UserSerializer` を流用し `User | null`）。`validate_body` で本文検証を所有する（設計 §2.2）: **上限は `strip()` 前の受領文字列の `len()`（コードポイント数・改行も 1 文字）で 10,000、10,001 以上は 400**。**空判定は別基準で `strip()` 後が空（空文字・空白のみ）なら 400**。両基準を分離して実装する。PATCH 用に `body` のみ書込可の形にする（`created_at`/`author` は不変）。
  - ファイル: `backend/api/serializers.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する（API テストはタスク 5 で網羅）。
  - _要件: 3A-C-7_

- [ ] 3. コメント編集/削除の権限ヘルパ `can_modify_comment`
  - `backend/api/permissions.py` に `can_modify_comment(request, comment) -> bool` を追加する（設計 §3.2 の擬似コードに忠実に）: (1) `request.user.is_superuser` なら True、(2) `comment.author_id is not None and comment.author_id == request.user.id`（投稿者本人）なら True、(3) 既存 `check_permission(request, comment.page.path, "edit")`（応答を生成せず bool を返す純判定）を返す。独自の階層判定は作らない。`require_page_permission` は使わないため拒否は常に固定 403（`JANUS_HIDE_FORBIDDEN` に左右されない）。
  - ファイル: `backend/api/permissions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する。
  - _要件: 3A-C-11, 権限との関係 2/4_

- [ ] 4. コメント CRUD ビューと URL 配線
  - `backend/api/views.py` に `CommentListCreateView`（GET/POST）と `CommentDetailView`（PATCH/DELETE）を追加する（既存 `RevisionListView`/`PagePermissionDetailView` 流儀）。設計 §3.1 の判定順序に厳密に従う:
    - GET/POST: `path = normalize_path(query/body)` → `require_page_permission(request, path, "view")`（拒否は既定 403／秘匿時 404、既存ヘルパ所有）→ `Page.objects.filter(path=path).first()`、不在は 404（`PAGE_NOT_FOUND_DETAIL`）。GET は `comments` を作成日時昇順で全件返す（ページングは将来課題）。POST は `CommentSerializer` で `body` 検証し `author=request.user` を注入して作成、201 を返す。
    - PATCH/DELETE: `Comment.objects.filter(pk=pk).first()`、不在は 404（`COMMENT_NOT_FOUND_DETAIL` を定義）→ `can_modify_comment` が False なら固定 403（`PERMISSION_DENIED_DETAIL` 相当）→ PATCH は `body` のみ更新（`updated_at` が動く・`created_at`/`author` 不変）、DELETE は 204。
    - `Comment` ビューは `save_page_body`・`Page.save()` を呼ばない（本文・リビジョン・`Page.updated_at` 非干渉）。
  - `backend/api/urls.py` に `pages/comments/<int:pk>` を `pages/comments` より前、両者を `pages` 単独ルートより前に配線する（既存 `pages/permissions/<pk>` → `pages/permissions` → `pages` の順序規約に倣う）。
  - ファイル: `backend/api/views.py`, `backend/api/urls.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する（API テストはタスク 5）。
  - _要件: 3A-C-1, 3A-C-2, 3A-C-3, 3A-C-4, 3A-C-8, 3A-C-9, 3A-C-10, 3A-C-11_

- [ ] 5. コメント機能の統合テスト
  - `backend/api/tests_comments.py` を新規作成し `APITestCase` で検証する（既存 `tests_assets.py` 流儀、設計 §12 T-C-1〜6）:
    - T-C-1 view 権限で投稿でき body/created_at/author が記録される（201）。
    - T-C-2 一覧が view 権限で作成日時昇順に取れる。**(a) view 権限なし→既定 403／秘匿時 404、(b) view 権限あり・ページ不在→常に 404（`PAGE_NOT_FOUND_DETAIL`）** を分けて検証。
    - T-C-3 投稿者本人・edit 権限者・superuser は編集/削除でき、無関係な一般利用者は 403。`override_settings(JANUS_HIDE_FORBIDDEN=True)` と既定（False）の双方で **常に 403（404 でない）** を固定する。
    - T-C-4 ページ削除でコメント連動削除、投稿者ユーザー削除でコメントが残り author が null 化。
    - T-C-5 コメント操作後に `Page.body`・最新リビジョン・`Page.updated_at` が不変。
    - T-C-6 空・空白のみは 400。境界: `len()` ちょうど 10,000 は 201・10,001 は 400、前後空白込みで上限超過は 400、`strip()` 後空は 400。
  - ファイル: `backend/api/tests_comments.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api.tests_comments` が全合格し、`../.venv/bin/python manage.py test api` も回帰ゼロで合格する。
  - _要件: 3A-C 全般, 統合受入 1,2,3,4,5_

---

## フロントエンド契約: コメント / CAD（追加のみ・以降のフロント実装の前提）

- [ ] 6. `StorageClient` 契約の追加（`Comment`/`CommentClient` のみ・CAD は契約に載せない）
  - `frontend/src/storage/types.ts` に **追加のみ** で拡張する（既存シグネチャ不変、設計 §9.1）: `Comment { id: number; body: string; author: User | null; created_at: string; updated_at: string }`、`CommentClient { listComments(path): Promise<Comment[]>; addComment(path, body): Promise<Comment>; updateComment(id, body): Promise<Comment>; deleteComment(id): Promise<void> }` を定義し `StorageClient` に合成する。**CAD 変換は契約に追加しない**（旧 `uploadCadAsset` は廃止。CAD→SVG はクライアント内ユーティリティ、登録は既存 `uploadAsset`。設計 §9.2）。既存 `AssetClient` は不変。
  - ファイル: `frontend/src/storage/types.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` が成功する。
  - _要件: 3A-C（契約）, StorageClient 追加 1/5, 非機能 5, 統合受入 16_

- [ ] 7. `RestClient` 実装と契約テスト（コメント）
  - `frontend/src/storage/rest-client.ts` に **コメント 4 メソッド**を既存 `url()`/`authHeaders()`/`toApiError()` ヘルパで実装する（既存メソッド不変、設計 §9.1）: `/api/pages/comments?path=`（GET/POST）・`/api/pages/comments/<id>`（PATCH/DELETE）。403/400/409 は `ApiError` に変換（401 と区別）。CAD 変換は契約に載せないため `RestClient` に CAD メソッドを足さない（SVG 登録は既存 `uploadAsset` を使う）。
  - `frontend/src/storage/rest-client.test.ts` に fetch モックで各メソッドの URL・メソッド・body・403/400/409/成功を検証する（設計 §12 T-REST、既存流儀）。
  - ファイル: `frontend/src/storage/rest-client.ts`, `frontend/src/storage/rest-client.test.ts`
  - 検証: `frontend/` で `npm run test:run`（新旧テスト全合格）→ `npx tsc --noEmit` が成功する。
  - _要件: 3A-C（契約）, StorageClient 追加 1, 統合受入 16, 17_

---

## フロントエンド: 地図 GUI 編集（既存 `:::custom-map` パーサの逆関数に依存）

- [ ] 8. 記法シリアライザ `serialize-map.ts`（`parse-map.ts` の逆関数）と往復テスト
  - `frontend/src/markdown/custom-map/serialize-map.ts` を新規作成し `serializeMapData(mapData): string` を実装する（設計 §7.1/§7.2）。**`parse-map.ts`/`map-utils.ts` は変更しない**。実装の確定仕様:
    - コンテナ属性 `:::custom-map{folder=... cx=... cy=... scale=... restore=... rotate=... link=... pinSize=... labelSize=...}`。マップ参照は **等号形式のみ**（`kind:'filename'`→`filename="..."`、`kind:'alias'`→`aliasname="..."`）。コロン形式は使わない（`buildMapData` はコンテナ参照を `node.attributes` から読むため等号形式でなければ往復不成立）。
    - マップ参照は **1 指定子のみ出力**（`specifiers` が複数なら先頭を代表採用し正規化）。`specifiers` が空なら参照属性を一切出力しない（空属性も出さない）。
    - マーカー行 `- x=.. y=.. label="..." desc="..." color="..."`、写真子リスト `- filename="..." desc="..."` / `- alias="..." desc="..."`（一貫性のため等号形式）。
    - エスケープ整合（`readAttrValue`/`unescapeAttr` の逆）: 全属性値をダブルクォートで囲む、値中の `"`/`\` を `\"`/`\\`、改行は `|` に変換。
  - `frontend/src/markdown/custom-map/serialize-map.test.ts` を新規作成し往復（`MapData`→`serializeMapData`→`buildMapData`）無損失を検証する（設計 §12 T-MAP）: (1) 等号形式参照の往復、(2) 複数指定子の代表 1 件正規化、(3) 参照なし（空 specifiers）の往復、(4) ラベルに `"`・改行・`/`・`:`、複数マーカー・写真子リスト、既定値省略の往復。
  - ファイル: `frontend/src/markdown/custom-map/serialize-map.ts`, `frontend/src/markdown/custom-map/serialize-map.test.ts`
  - 検証: `frontend/` で `npm run test:run`（新 serialize-map テストと既存 `parse-map.test.ts` が共に合格）→ `npx tsc --noEmit` が成功する。
  - _要件: 3A-MAP-2, 3A-MAP-3, 3A-MAP-4, 3A-MAP-6, 非機能 6, 統合受入 11, 12_

- [ ] 9. 地図 GUI 編集コンポーネントと保存経路（写真添付を含む）
  - `frontend/src/markdown/custom-map/MapEditor.tsx`（+ `.module.css`、素の CSS Modules）を新規作成する（設計 §7.4/§8）。マップ画像を `AssetClient.listFolders`/`listAssets`/`resolveAssetUrl` で選択・プレビューし、画像上クリックでマーカー配置・ドラッグ移動・削除、各マーカーの `label`/`color`/`desc`/`x`/`y` を編集する。座標系・クランプ・色は既存 `map-utils.ts` を流用。マーカーの参考写真は `<input type="file">` でファイル選択し既存 `AssetClient.uploadAsset`（新規アップロード経路を増やさない）で登録、写真子リストに紐付ける。撮影 UI（`capture`・カメラ起動）は作らない（3b へ）。
  - `frontend/src/pages/PageEditPage.tsx` に地図 GUI 編集の導線を追加し、編集対象 `:::custom-map` ブロックを `buildMapData` で取り込み（ブロック境界オフセットを保持）、保存時はそのブロックだけを `serializeMapData` 出力で置換し本文の他テキストを保持する。保存は既存 `updatePage`/`createPage`（内部 `save_page_body`）を通す。既存 `CustomMapViewer`/`parse-map.ts` は変更しない。
  - ファイル: `frontend/src/markdown/custom-map/MapEditor.tsx`, `frontend/src/markdown/custom-map/MapEditor.module.css`, `frontend/src/pages/PageEditPage.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（`MapEditor` の最小テストと既存テスト全合格）→ `npm run build` → `npm run lint` が成功する。
  - _要件: 3A-MAP-1, 3A-MAP-5, 3A-MAP-7, 3A-MAP-8, 3A-PHOTO-1, 3A-PHOTO-2, 3A-PHOTO-3, 3A-PHOTO-4, 3A-PHOTO-5, 統合受入 11, 13, 14_

---

## フロントエンド: CAD ブラウザ変換（サーバー非関与。参考実装の移植）

**バックエンド追加なし**: CAD 変換はブラウザ内で完結し、変換後 SVG の登録は既存 `uploadAsset`（`/api/assets`）を使う。したがって `backend/` への CAD 変換タスク（旧 `cad.py`・`AssetCadConvertView`・`/api/assets/convert`・`JANUS_CAD_CONVERTER`・`tests_cad.py`）は**すべて削除**した（設計 §3.3/§5/§17）。依存の実機成立はタスク 0（スパイク）で確認済みを前提とする。

- [ ] 10. CAD 変換の設定移植とユーティリティ（JWW/DXF → SVG・向き焼き込み・上限）
  - `frontend/src/markdown/custom-map/cad/config.ts` を新規作成し、参考実装の `config.js` 相当（`lightColors`/`darkColors`・線種ダッシュ・`maxEntities`・`maxFileBytes`・stroke/dash divisor 等）を Janus 側に定義する（設計 §5.1）。値は参考実装 `temp/jww-to-svg.js`/`temp/dxf-to-svg.js` が参照していた意味に合わせる。
  - `frontend/src/markdown/custom-map/cad/dxf-to-svg.ts` を新規作成し、`temp/dxf-to-svg.js` を TypeScript へ移植する（`dxf-parser` パース、`iconv-lite`/`TextDecoder` による Shift-JIS/UTF-8 判定デコード、LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC/ELLIPSE/TEXT/MTEXT/POINT、Y 反転・向き焼き込み・viewBox 外接矩形算出）。Node `Buffer` 依存は `Uint8Array`+`TextDecoder` に置換（設計 §5.1）。
  - `frontend/src/markdown/custom-map/cad/jww-to-svg.ts` を新規作成し、`temp/jww-to-svg.js` を TypeScript へ移植する（`ezjww` の `isJwwFile`/`readDocument`、ペン色クラス・線種・SOLID 塗り・TEXT・Y 反転・向き焼き込み・`<style>` prefers-color-scheme）。
  - `frontend/src/markdown/custom-map/cad/convert.ts` を新規作成し、統一入口 `convertCadToSvg(file, orientation): Promise<{ svg, filename }>` と型付きエラー（`CadUnsupportedError`/`CadTooLargeError`/`CadTooManyEntitiesError`/`CadConversionError`/`CadEngineUnavailableError`）を実装する（設計 §5.2）。処理順序: サイズ上限 → `ArrayBuffer`→`Uint8Array` → JWW/DXF 振り分け（`ezjww.isJwwFile`/拡張子、いずれでもなければ `CadUnsupportedError`）→ 変換（エンティティ上限・破損・WASM 初期化不能を各エラーに）→ filename `.svg` 正規化。向き焼き込みは参考実装どおり外側 `<g transform="rotate(θ) scale(1,-1)">` + 回転後 4 隅の外接矩形 viewBox で**どの向きもクリップしない**（設計 §5.3）。生成 SVG は `<script>`/`foreignObject`/外部参照を含めない（§5.7）。
  - （スパイクで Worker 成立時）`frontend/src/markdown/custom-map/cad/convert-worker.ts` を追加し、変換を Web Worker 上で実行する。不成立ならメインスレッド実行 + ローディング表示にフォールバック（設計 §5.6）。
  - 単体テスト `cad/convert.test.ts`・`cad/dxf-to-svg.test.ts`（および可能なら `jww-to-svg.test.ts`）を追加する（設計 §12 T-CAD-1/T-CAD-2）: 既知寸法 DXF で SVG 生成・`.svg` 正規化・向き 0/90/180/270 のクリップ非発生（回転後 viewBox が内容境界を包含）・生成 SVG にスクリプト/外部参照なし、失敗分岐が正しい型のエラー、`<script>` 非出力。JWW/WASM 依存部はスパイク結果に応じて単体 or 手動確認。
  - ファイル: `frontend/src/markdown/custom-map/cad/config.ts`, `cad/dxf-to-svg.ts`, `cad/jww-to-svg.ts`, `cad/convert.ts`, `cad/convert-worker.ts`（採用時）, `cad/convert.test.ts`, `cad/dxf-to-svg.test.ts`
  - 検証: `frontend/` で `npm run test:run`（新 CAD テスト・既存テスト全合格）→ `npx tsc --noEmit` → `npm run build`（WASM/依存がビルドに含まれる）→ `npm run lint` が成功する。
  - _要件: 3A-CAD-1, 3A-CAD-2, 3A-CAD-3, 3A-CAD-4, 3A-CAD-6, 3A-CAD-7, 3A-CAD-9, 3A-CAD-10, 非機能 2, 非機能 3_

- [ ] 11. CAD 変換アップロード導線（`AssetLibraryPage` ＋ 既存 `uploadAsset`）
  - `frontend/src/pages/AssetLibraryPage.tsx` に「CAD を変換して登録」導線を追加する（設計 §5.5/§5.6 のエントリポイント 1）: `<input type="file" accept=".jww,.dxf">` + 向き選択（0/90/180/270）、変換中の**ローディング表示**。選択 → `convertCadToSvg(file, orientation)` → 成功 SVG を `new File([svg], filename, { type: 'image/svg+xml' })` に包み、**既存 `storage.uploadAsset({ folderId, file, alias? })`** で登録（既存の成功/409 ハンドリングを再利用）。失敗（`CadUnsupportedError`/`CadTooLargeError`/`CadTooManyEntitiesError`/`CadConversionError`/`CadEngineUnavailableError`）は**明確なエラー表示 + 通常画像/SVG アップロードへの案内**を出す（設計 §5.5 の表）。失敗時に `uploadAsset` を呼ばない（サーバー副作用ゼロ）。素の CSS Modules を維持。
  - テスト `AssetLibraryPage.test.tsx` に、変換成功で `uploadAsset` が `image/svg+xml`・`.svg` filename で呼ばれること、失敗で案内表示が出て `uploadAsset` が呼ばれないこと（`convertCadToSvg` をモック）を追加（設計 §12 T-CAD-2/T-CAD-3/T-ASSET-PERM）。
  - ファイル: `frontend/src/pages/AssetLibraryPage.tsx`, `frontend/src/pages/AssetLibraryPage.module.css`, `frontend/src/pages/AssetLibraryPage.test.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（新旧全合格）→ `npm run build` → `npm run lint` が成功する。
  - _要件: 3A-CAD-1, 3A-CAD-3, 3A-CAD-5, 3A-CAD-9, 3A-CAD-11, 統合受入 6, 7, 8, 15_

（CAD 変換の地図 GUI 編集からの起動は、タスク 9 の `MapEditor` 内で同じ `convertCadToSvg` → `uploadAsset` 経路を使う。設計 §5.6 エントリポイント 2。）

---

## フロントエンド: draw.io 描画機能（本文保持形式を先に固めてから閲覧へ）

- [ ] 14. draw.io セルフホスト同梱配布物の配置と Vite 配信（タスク 0 のスパイク確定を実装化）
  - 設計 §6.3/§14（D-DRAW-HOST/D-DRAW-VIEW）。タスク 0 で成立確認した構成に基づき、diagrams.net（Apache-2.0）のセルフホスト配布物をフロントに同梱する: (1) **閲覧ビューア `GraphViewer`（`viewer.min.js` 相当・軽量）**、(2) **編集 webapp（`drawio-webapp` 相当・自オリジン起動用）**。`frontend/public/`（または専用の静的ディレクトリ）に配置し Vite ビルドに含める（モジュールグラフに載せず静的ファイルとして配信し、アプリ本体 JS バンドルを膨らませない）。Apache-2.0 の NOTICE/LICENSE を同梱する。**公開 `embed.diagrams.net` は使わない**（実行時に外部ドメインへ接続しない）。配信サイズを実測し、閲覧ビューア・編集 webapp を独立に記録する。
  - ファイル: `frontend/public/drawio/`（同梱配布物・NOTICE/LICENSE）, 必要に応じ `frontend/vite.config.ts`（静的配信設定）
  - 検証: `frontend/` で `npm run build` が成功し、同梱配布物がビルド成果物に含まれる（外部 CDN 参照がない）こと。配信サイズを記録する。
  - _要件: 3A-DRAW-1, 3A-DRAW-4, 3A-DRAW-5, 3A-DRAW-6, DECISION-NEEDED D-DRAW-HOST/D-DRAW-VIEW, 非機能 3_

- [ ] 15. `:::drawio` ディレクティブのパース/シリアライズ（本文保持形式の確定）
  - `frontend/src/markdown/drawio/remark-drawio.ts` を新規作成する（設計 §6.1/§6.2、既存 `remark-custom-map.ts` と同一パターン）。`remark-directive` 後・`remarkDirectiveFallback` 前に差し込み、`containerDirective` かつ `name==='drawio'` のノードを走査、配下最初の `code` ノードから XML を抽出し `data.hName='div'` + `data.hProperties={'data-drawio': <xml>, 'data-directive':'drawio'}` を設定、子を空にする。XML は `:::drawio` 内のコードフェンス（` ```xml ... ``` `）に格納する方式（行頭 `:::` 衝突を無害化）。
  - `frontend/src/markdown/drawio/serialize-drawio.ts` を新規作成し、エディタ返却 XML をフェンス内に埋め込んで `:::drawio` ブロックを生成する。XML 内に ` ``` ` が現れる場合は開閉フェンスを 4 連バッククォートへ拡張する。
  - `frontend/src/markdown/drawio/serialize-drawio.test.ts`（および `remark-drawio` 単体）で往復を検証する（設計 §12 T-DRAW）: (1) **XML 本文に行頭 `:::` を含む**ケースがコンテナを早期終了させず往復で保たれる、(2) **XML 本文に ` ``` ` を含む**ケースで 4 連バッククォート拡張され往復で保たれる、(3) 引用符・改行を含む XML の往復。
  - ファイル: `frontend/src/markdown/drawio/remark-drawio.ts`, `frontend/src/markdown/drawio/serialize-drawio.ts`, `frontend/src/markdown/drawio/serialize-drawio.test.ts`
  - 検証: `frontend/` で `npm run test:run`（新 drawio テスト全合格）→ `npx tsc --noEmit` が成功する。
  - _要件: 3A-DRAW-2, 3A-DRAW-3, 3A-DRAW-5, 統合受入 9_

- [ ] 16. `MarkdownRenderer` への `DrawioViewer` 統合（閲覧レンダリング）
  - `frontend/src/markdown/drawio/DrawioViewer.tsx`（+ `.module.css`）を新規作成し、`data-drawio` の XML をタスク 14 で同梱した `GraphViewer`（セルフホスト・外部ドメイン非依存）で描画する（フロント完結・オフライン可）。
  - `frontend/src/markdown/MarkdownRenderer.tsx` の `remarkPlugins` を `[remarkGfm, remarkDirective, remarkCustomMap, remarkDrawio, remarkDirectiveFallback]` に拡張し（`remarkCustomMap` の後・`remarkDirectiveFallback` の前）、`components.div` に `data-drawio` 検出分岐を 1 本追加する（既存 `data-custom-map` 分岐は不変）。生 HTML 無効（rehype-raw 不採用）を維持。
  - `frontend/src/markdown/MarkdownRenderer.test.tsx` に `:::drawio` と既存 `:::custom-map`・GFM の共存描画が壊れないこと（検証項目 10）を追加する。
  - ファイル: `frontend/src/markdown/drawio/DrawioViewer.tsx`, `frontend/src/markdown/drawio/DrawioViewer.module.css`, `frontend/src/markdown/MarkdownRenderer.tsx`, `frontend/src/markdown/MarkdownRenderer.test.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` → `npm run build` → `npm run lint` が成功する。
  - _要件: 3A-DRAW-4, 3A-DRAW-7, 統合受入 10_

- [ ] 17. draw.io 編集エディタ連携（セルフホスト同梱 webapp の iframe + postMessage）と保存経路
  - `frontend/src/pages/PageEditPage.tsx` に「描画を追加/編集」導線を追加し、**タスク 14 で同梱した自オリジンの draw.io webapp**（`<iframe src="/drawio/webapp/index.html?embed=1&proto=json&...">` 相当。**公開 `embed.diagrams.net` は使わない**）を開く（設計 §6.3）。embed protocol（`init`/`load`/`save`/`exit`）の `postMessage` ハンドラを実装し、`origin` 検証を**自オリジンに固定**する。保存イベントで受け取った XML を `serialize-drawio` で本文へ差し込む。保存は既存 `updatePage`/`createPage`（内部 `save_page_body`）を通す（新しい保存系契約を増やさない）。権限は既存ページ view/edit がそのまま適用。セルフホスト同梱のためオフラインでも編集が成立する（3b 再利用）。
  - `postMessage` ハンドラ単位の最小テストを追加する（iframe 自体はテスト対象外、`origin` 検証と save ハンドラの XML 受け渡しを単体化。設計 §12 のテスト容易性方針）。
  - ファイル: `frontend/src/pages/PageEditPage.tsx`（+ 必要なら `frontend/src/markdown/drawio/` に postMessage ハンドラユーティリティ）
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` → `npm run build` → `npm run lint` が成功する。
  - _要件: 3A-DRAW-1, 3A-DRAW-2, 3A-DRAW-6, 3A-DRAW-7, DECISION-NEEDED D-DRAW-HOST_

---

## フロントエンド: コメント UI（契約確定後・独立機能）

- [ ] 18. コメント表示/投稿/編集/削除の最小 UI
  - ページ閲覧画面にコメント一覧（作成日時昇順）・投稿フォーム・編集/削除ボタンを追加する（設計 §2.2/§4）。本文は React のテキストノード（`{comment.body}`）として描画し `dangerouslySetInnerHTML` を使わない（プレーンテキスト扱い・XSS 経路を作らない）。編集/削除ボタンは「投稿者本人 or edit」で出し分け（補助、最終判定はサーバー）。空本文の 400・権限 403 は `ApiError.status`/`detail` で分岐（既存 `usePageError`/`PageEditPage` の分岐流儀）。素の CSS Modules を維持。
  - ファイル: `frontend/src/pages/PageViewPage.tsx`（+ 必要なら `CommentSection.tsx`/`.module.css`）
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（コメント UI の最小テストと既存テスト全合格）→ `npm run build` → `npm run lint` が成功する。
  - _要件: 3A-C-1, 3A-C-2, 3A-C-3, 3A-C-4, 3A-C-7, 権限との関係 5_

---

## 統合・回帰（最終確認）

- [ ] 19. フェーズ 3a 全体の統合・回帰確認
  - バックエンド全テスト回帰: `backend/` で `../.venv/bin/python manage.py test`（既存 `tests*.py` が全合格し続ける＝回帰ゼロ、約 145 件＋**新規は `tests_comments.py` のみ**。CAD はブラウザ変換のためバックエンド新規テストなし。SVG 登録は既存 `tests_assets.py` が回帰で担保）。`makemigrations --check --dry-run`（未生成差分なし）・`migrate`（SQLite で `0005` 成立・既存データ保全）・再 `migrate`（冪等）・`check` を通す。
  - フロントエンド: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（既存約 132 件＋新規 CAD/draw.io/地図/コメント/契約テストが全合格）→ `npm run build`（WASM・draw.io 同梱配布物を含み外部 CDN 参照なし）→ `npm run lint` を通す。
  - コメント権限（投稿=view／編集削除=本人・edit・superuser／秘匿非依存 403／view ありページ不在は 404）、CAD ブラウザ変換（焼き込み・クリップ非発生・失敗時 `uploadAsset` 非呼び出しでサーバー副作用ゼロ・既存 `uploadAsset` 経由で認証のみ）、地図 GUI 往復無損失、draw.io セルフホスト同梱の共存描画・保存 XML のみ・外部ドメイン非依存、写真紐付けが `save_page_body` 経由であること、`StorageClient` 契約追加がコメントのみで既存シグネチャ不変であることがテストで検証済みであることを確認する。SQLite で全成立することを明記する。
  - ファイル:（検証のみ・新規変更なし。必要に応じ軽微な修正）
  - 検証: 上記 backend/frontend の全コマンドが成功し、既存フェーズ 1/2 テストの差分がゼロであること。
  - _要件: 非機能 1, 統合受入 16, 17, 18_

---

## 確定事項（設計 §14・§17）と実装中に顕在化しうるスパイク

設計の主要方針はユーザー確認により確定済み（CONFIRMED）。残るのは「確定方針が実機で成立するか」のスパイク（タスク 0 で先行確認）のみ。不成立なら設計 §14 の代替へ戻す。

- **D-CAD / D-CAD-STATUS — CONFIRMED（ブラウザ変換）**（タスク 0・10・11）: CAD→SVG はブラウザで変換（サーバー非関与）、対象 .jww（主）/.dxf、`ezjww`/`dxf-parser`/`iconv-lite`。失敗はフロントのエラー表示（HTTP ステータス不要）。タスク 0 のスパイクで WASM の Vite/Worker 読み込みが不成立なら Worker 不採用やライブラリ代替へ（保存=SVG登録・サーバー非関与は維持）。旧サーバー `ezdxf` 変換は廃止。
- **D-DRAW-FORMAT / D-DRAW-HOST / D-DRAW-VIEW — CONFIRMED（セルフホスト同梱）**（タスク 0・14〜17）: 保持形式 `:::drawio`、編集・閲覧とも diagrams.net をセルフホスト同梱（公開 embed.diagrams.net 不採用）。タスク 0/14 のスパイクで同梱 `GraphViewer` の XML 単体描画・webapp 自オリジン起動・配信サイズを確認。不成立なら保存 XML のみを維持したまま代替軽量ビューアへ。
- **D-COMMENT-RENDER / D-COMMENT-POST — CONFIRMED**（タスク 5・18）: コメント本文はプレーンテキスト、投稿は view 権限で可・編集削除は本人/edit/管理者。
- **D-ASSET-PERM — CONFIRMED（据え置き）**（タスク 11・19）: CAD 変換後 SVG の登録・写真は既存 `uploadAsset` 経由で認証のみ（ページ権限非干渉）。`/api/assets/<id>/file` 直リンク取得の据え置きはセキュリティ上の明示事項。
- **D-MAP-SLASH / D-MAP-PIPE / D-MAP-UNKNOWN / D-MAP-MULTISPEC — CONFIRMED（既定）**（タスク 8・9・影響小）: 基準フォルダ運用のみ・`|` は改行表現優先・未知属性は 1 ブロック往復で GUI 扱い属性のみ再出力・マップ参照は 1 指定子に正規化。既定で進め、必要なら後続で拡張。
