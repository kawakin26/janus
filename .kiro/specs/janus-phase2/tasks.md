# Janus 実装計画（フェーズ 2・権限管理 / リビジョン）

本タスクリストは `janus-phase2/design.md`（確定済み）を実装順に分解したもの。各タスクは前のタスクの成果に積み上がる。チェックを付けながら進める。設計の章番号・擬似コード・真理値表（3.2／3.3／3.3.1）に忠実に実装すること。

## 全体方針（着手前に必ず読む）

- **foundation 非破壊**: 既存 `Page`/`Folder`/`Asset` のスキーマ・既存 API レスポンスの必須フィールド・既存テスト（`tests.py`/`tests_auth.py`/`tests_pages.py`/`tests_assets.py`/`tests_integration.py`）を変えない。本フェーズはすべて **追加**（新規モデル・新規ビュー・新規エンドポイント・新規フロント画面）で構成する（design 12 章、要件 P2-15）。
- **サーバーがセキュリティ境界**: 可否判定の最終決定は Python 層。フロントの表示制御は補助（要件 P2-5-5）。
- **マイグレーション方針（破壊的変更なし・冪等）**: `PagePermission`/`Revision` は新規追加のみで既存テーブルにカラムを足さない。Revision のバックフィル（既存全ページに初回リビジョン生成）は `Revision.objects.filter(page=page).exists()` ガードで**冪等**にする（design 7 章、要件 P2-15-1,2）。既存 `Page`/`Folder`/`Asset` データは保持する。
- **後方互換（最重要制約）**: デフォルトポリシー既定値を view/edit=許可（`JANUS_DEFAULT_PAGE_VIEW`/`JANUS_DEFAULT_PAGE_EDIT` の既定 True）とし、権限エントリを 1 件も設定しない限りフェーズ 1 と同一挙動（全認証ユーザーが全ページ読み書き可、期待値 201/200/401/409/404 不変）を保つ（design 4 章、要件 P2-15-3,4）。
- **SQLite 必須・PostgreSQL は後回し**: 権限合成はアプリ層（Python）で行い DB 固有の再帰 CTE に依存しない。全テストを SQLite で検証する（要件 P2-16、ユーザー方針）。
- **PATH の正規化**: path は既存 `api/utils.normalize_path` で正規化してから扱う（既存流儀）。
- **検証コマンド**:
  - backend（`backend/` から実行）: `../.venv/bin/python manage.py check` / `../.venv/bin/python manage.py makemigrations --check --dry-run` / `../.venv/bin/python manage.py migrate` / `../.venv/bin/python manage.py test`
  - frontend（`frontend/` から実行）: `npx tsc --noEmit` / `npm run test:run` / `npm run build` / `npm run lint`

## スコープ外（本フェーズで扱わない。design 10 章・要件スコープ外）

- アセット（`Folder`/`Asset`、`/api/folders`・`/api/assets` 系）へのページ権限適用。フェーズ 1 挙動を維持する（要件 P2-5-7、U-5）。無権限ユーザーがアセット直リンク（`/api/assets/<id>/file`）で画像取得しうる点は将来課題。
- グループ/ユーザーの本格管理 UI。Django admin + 最小 API に留める（U-3）。
- ローカルモード（IndexedDB、フェーズ 3）での権限・リビジョン実装。本フェーズは `StorageClient` 契約の抽象化のみ担保（要件 P2-13-5）。
- 自分が見える全ページの平坦一覧 API（将来エンドポイントとして追加しうる。本フェーズは `children` の深い path 直接指定で到達保証）。
- PostgreSQL 固有の最適化・本番設定、ページ削除取り消し（ゴミ箱）・リビジョン世代管理、認証方式の堅牢化（Cookie セッション等）。

---

## バックエンド: 権限管理（先行。認可ゲートがページ系ビュー改修の土台になり、保存経路改修の前提にもなる）

- [x] 1. 権限判定の純粋関数と祖先パス導出
  - `api/utils.py` に `ancestor_paths(path: str) -> list[str]` を純粋関数として追加する（`normalize_path` の隣）。近い順に自身を含む祖先列を返し、`ancestor_paths("/") == ["/"]`（ルートは自身のみ）を満たす（design 3.4）。
  - `api/permissions_logic.py` を新規作成し、`PermEntry` 軽量 dataclass（`path, principal_type, principal_id, action, effect`）と純粋関数 `effective_permission(*, path, action, user, entries, default_allow, default_edit_allow) -> bool`、補助関数 `resolve_subject_level(subject_entries, action) -> bool | None` を実装する。合成順序は design 3.2 の擬似コードに厳密に従う（管理者バイパス → view 明示 > edit allow 含意 → 階層的近さ → user 直接 > group → deny 優先 → デフォルト委任時の edit→view 含意）。DB・リクエストに依存しない純粋関数とする。
  - ファイル: `backend/api/utils.py`, `backend/api/permissions_logic.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する（次タスクでユニットテストを追加）。
  - _要件: P2-1-4, P2-1-5, P2-2, P2-3-5, P2-4, P2-16-2, P2-16-3_

- [x] 2. 権限判定ロジックのユニットテスト（真理値表の固定）
  - `api/tests_permissions.py` を新規作成し、`SimpleTestCase`（DB 非依存）で `effective_permission` を検証する。design 3.3 の真理値表 #1〜#10（view-deny+edit-allow、edit-allow-only、edit-deny-only を含む）を `default_allow` 真偽の両方で網羅し、3.3.1 の D1〜D4（特に `JANUS_DEFAULT_PAGE_VIEW=False` かつ `JANUS_DEFAULT_PAGE_EDIT=True` で view=allow）を固定する。管理者バイパス、deny 優先、近いレベル優先、user>group、グループ経由エントリの `principal_id` 変換（3.5 の `principal_id = user_id if type=="user" else group_id`）を個別に検証する。`ancestor_paths`（`"/"` の境界含む）のユニットテストも追加する。
  - ファイル: `backend/api/tests_permissions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api.tests_permissions` が全て合格する。
  - _要件: P2-1-4, P2-2, P2-3, P2-4, 統合受入 6,7,8,9_

- [x] 3. PagePermission / Revision モデルとスキーマ・マイグレーション・admin
  - `api/models.py` に `PagePermission`（design 2.1: `path` 文字列・`principal_type`・`user`/`group`（CASCADE）・`action`・`effect`・監査日時、部分 `UniqueConstraint` `pageperm_user_unique`/`pageperm_group_unique`、user/group 整合の `clean()`）と `Revision`（design 2.2: `page`（CASCADE）・`number`・`body`・`title`・`created_at`（`auto_now_add` を使わず明示代入可）・`author`（SET_NULL）、`revision_page_number_unique`、`Meta.ordering=["-number"]`、`(page, number)` 複合インデックス）を追加する。既存 `Page`/`Folder`/`Asset` は一切変更しない。
  - `api/admin.py` に `PagePermission`/`Revision` を登録する（既存 `admin.py` の `list_display` 流儀）。
  - スキーマ用マイグレーション `backend/api/migrations/0003_phase2_permissions_revisions.py` を生成する（既存 `0001`/`0002` は変更しない）。
  - ファイル: `backend/api/models.py`, `backend/api/admin.py`, `backend/api/migrations/0003_phase2_permissions_revisions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py makemigrations --check --dry-run`（未生成差分なし）→ `../.venv/bin/python manage.py migrate`（既存 db.sqlite3 に適用成功、既存データ保持）→ `../.venv/bin/python manage.py check` が成功する。
  - _要件: P2-1-1, P2-1-2, P2-8-2, P2-12-1, P2-12-2, P2-15-1_

- [x] 4. モデルの単体テスト（制約・整合・連動削除）
  - `api/tests_permissions.py`（または新規 `api/tests_revisions.py`）に `APITestCase`/`TestCase` でモデル検証を追加する: `PagePermission` の (path,主体,action) 部分一意制約が重複登録を弾くこと、user/group 整合の `clean()`、`Revision` の `(page, number)` 一意制約、`Meta.ordering=["-number"]`、ページ削除で Revision が CASCADE 連動削除されること、author ユーザー削除で Revision が残り author が null 化すること（SET_NULL）。
  - ファイル: `backend/api/tests_revisions.py`（新規）または `backend/api/tests_permissions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api` が全て合格する。
  - _要件: P2-1-2, P2-12-1, P2-12-2, 統合受入 17,18_

- [x] 5. デフォルトポリシー・存在秘匿フラグの設定追加
  - `backend/janus/settings.py` に `env_bool` で `JANUS_DEFAULT_PAGE_VIEW`（既定 True）・`JANUS_DEFAULT_PAGE_EDIT`（既定 True）・`JANUS_HIDE_FORBIDDEN`（既定 False）を追加する（既存 `JANUS_REQUIRE_AUTH` と同じ流儀）。既定値はすべてフェーズ 1 挙動を保つ（design 4 章、要件 P2-3-2・P2-7-2）。`DEFAULT_PERMISSION_CLASSES` 等の既存 REST_FRAMEWORK 設定は変えない。
  - ファイル: `backend/janus/settings.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功し、既存テスト `../.venv/bin/python manage.py test api` が引き続き全合格する（既定値で挙動不変）。
  - _要件: P2-3-1, P2-3-2, P2-7-1, P2-7-2_

- [x] 6. 認可ゲート `require_page_permission` ヘルパ
  - `api/permissions.py` を新規作成し、`require_page_permission(request, path, action) -> Response | None` を実装する（design 5.1）。候補エントリを 3.5 の方式で一括取得して `PermEntry` へ変換（`principal_id = user_id if "user" else group_id`）し、`effective_permission` を呼ぶ（`default_allow` は action に応じ `JANUS_DEFAULT_PAGE_VIEW`/`JANUS_DEFAULT_PAGE_EDIT`、`default_edit_allow` は常に `JANUS_DEFAULT_PAGE_EDIT`）。許可なら `None`、拒否なら既定 403／`JANUS_HIDE_FORBIDDEN=True` で 404（本文・メタを含めない固定 detail）。**ページ実在は参照しない**。匿名ユーザー（`request.user.is_authenticated` が偽）は `effective_permission` を呼ばずデフォルトポリシーのみで判定する（design 5.1「匿名ユーザーの扱い」）。固定 detail 文言 `PERMISSION_ENTRY_NOT_FOUND_DETAIL` 等の定数もここか `views.py` に定義する。
  - ファイル: `backend/api/permissions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する（API テストはタスク 8 以降で網羅）。
  - _要件: P2-5-1, P2-5-2, P2-6-1, P2-7-3, P2-7-4_

- [x] 7. 権限エントリのシリアライザ
  - `api/serializers.py` に `PagePermissionSerializer` を追加する（既存 `FolderSerializer` の `parentId`→`parent` 流儀）。入力 `{path, principalType, principalId, action, effect}`（camelCase）を受け、`principalType=="user"` なら `user_id=principalId`・`group=None`・`principal_type="user"`、`"group"` なら `group_id=principalId`・`user=None`・`principal_type="group"` にマップする。`principalType` が enum 外／`principalId` が指す user/group が実在しなければ 400。出力は逆射影（非 null 側 FK を `principalId`、`principal_type` を `principalType`）。PATCH 用に `effect` のみ書込可（他フィールドは受理しても無視）とできる形にする（design 5.3、9.1）。
  - ファイル: `backend/api/serializers.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する。
  - _要件: P2-1-2, P2-13-3_

- [x] 8. 権限管理 API（一覧 / 付与 / 更新 / 取消）
  - `api/views.py` に `PagePermissionView`（GET/POST）と `PagePermissionDetailView`（PATCH/DELETE）を追加する（既存 APIView 流儀）。GET `/api/pages/permissions?path=` は先に `require_page_permission(request, path, "edit")` を評価し拒否なら 403/404、通過後に当該 path のエントリ一覧（0 件は空配列・200）を返す。POST は重複 (path,主体,action) を `IntegrityError`→409（既存アセットの try/`transaction.atomic`/409 流儀）。PATCH は `<id>` 取得（無ければ 404 固定 detail）→ `entry.path` の edit 判定 → `effect` のみ更新（主体・対象・操作変更は DELETE+POST）。DELETE は同順序でエントリ削除（design 5.3）。`api/urls.py` に `pages/permissions`・`pages/permissions/<int:pk>` を既存の「深いものを先に」流儀で追加する（design 5.6）。
  - ファイル: `backend/api/views.py`, `backend/api/urls.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api`（次タスクのテスト追加後に権限管理ケースが合格）。本タスク時点では `../.venv/bin/python manage.py check` 成功を確認する。
  - _要件: P2-1-3, P2-1-6, P2-5-6, P2-13-4_

- [x] 9. 実効権限問い合わせ API
  - `api/views.py` に `PageEffectivePermissionView`（GET `/api/pages/effective-permission?path=`）を追加し、現在ユーザーの当該 path に対する `{view: bool, edit: bool}` を返す（design 5.4）。未認証は既存 `DEFAULT_PERMISSION_CLASSES`（`IsAuthenticated`）で 401。認証済みは任意 path を問い合わせ可で、権限不足でも 403/404 を返さず常に 200 + `{view, edit}`（存在秘匿運用でも `{false,false}` で path 存在を漏らさない）。`api/urls.py` に `pages/effective-permission` を追加する。
  - ファイル: `backend/api/views.py`, `backend/api/urls.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する（API テストはタスク 11）。
  - _要件: P2-13-3, P2-6-1, P2-7_

- [x] 10. ページ系ビューへの権限ゲート適用（GET / children / PUT / DELETE / POST）
  - `api/views.py` の `PageDetailView`・`PageChildrenView` にレスポンス形状を変えずに権限ゲートを追加する（design 5.2）。GET は「権限 → 存在」順（`require_page_permission(..,"view")` 拒否で 403/404、通過後に Page 不在で 404）。PUT/DELETE も「権限（edit）→ 存在」順。POST は作成予定の正規化 path をそのまま `effective_permission(path=new_path, action="edit", default_allow=JANUS_DEFAULT_PAGE_EDIT, default_edit_allow=JANUS_DEFAULT_PAGE_EDIT)` で評価し、**edit 拒否は `JANUS_HIDE_FORBIDDEN` に関わらず常に 403**（design 3「POST での対象 path」・5.2 POST 行・MEDIUM-C）。children は parent の存在・可視性を確認せず常に 200、view 判定を各子にのみ適用、非実在 parent と可視な子ゼロは同じ空配列（design 5.2 children）。保存経路のリビジョン記録接続はタスク 12 で行う（本タスクは認可ゲートの追加のみ）。
  - ファイル: `backend/api/views.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api`（既定ポリシーで既存 `tests_pages.py` が全合格し続けることを確認）。
  - _要件: P2-5-1, P2-5-2, P2-5-3, P2-6-2, P2-6-3, P2-6-4, P2-6-5, P2-7-3, P2-7-4_

- [x] 11. 権限アクセス制御の統合テスト（権限マトリクス・一覧の見え方）
  - `api/tests_permissions.py` に `APITestCase` で統合ケースを追加する: view/edit なしの GET/PUT/DELETE/POST が 403（既定）/404（`JANUS_HIDE_FORBIDDEN=True`、ただし POST は常に 403）、未認証 401 と 403 の区別、`is_superuser` 全通過、デフォルト許可で既存同等。`children` が view 可のページのみ返す／親非公開でも子の明示 allow は返る／無権限ページの存在を漏らさない（非実在 parent と可視子ゼロが同じ空配列）。権限管理 API が edit 権限者/管理者のみ許可・他は 403・重複 POST 409・PATCH 更新。`effective-permission` の 401/200・秘匿運用でも `{false,false}`。アセット API 非干渉（`/api/folders`・`/api/assets` がフェーズ 1 挙動維持）。`override_settings` でポリシーフラグを切り替えて 2 パターン検証する。
  - ファイル: `backend/api/tests_permissions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api` が全て合格する。
  - _要件: P2-5, P2-6, P2-7, 統合受入 1,2,3,4,5,8,9,19,20_

---

## バックエンド: リビジョン機能（権限ゲートの上に乗せる）

- [x] 12. 保存の単一経路 `save_page_body` とページ系ビューへの接続
  - `api/services.py` を新規作成し、`save_page_body(page_or_path, *, title, body, author) -> (page, created_revision_bool)` を実装する（design 6.1）。`transaction.atomic()` 内で作成（POST）/更新（PUT/restore）を分岐: 作成は `Page.objects.create(..., created_by=author, updated_by=author)`（path 重複は `IntegrityError`→409 相当）、更新/復元は `select_for_update().get(path=path)` で行ロックし `created_by` は保持・`updated_by` のみ更新。最新リビジョン body と新 body が一致なら新リビジョンを作らず（本文不変は `Page.save()` も呼ばず `updated_at` を動かさない、タイトルのみ変更は `Page.title` 更新・リビジョン作らず）、変化ありなら `number=(最新 or 0)+1` で `Revision` を作成し `Page.body/title/updated_by` を更新する。新規作成は必ず `number=1` の初回リビジョンを作る（design 6.2）。`PageDetailView` の POST/PUT と（タスク 14 の）restore がこの関数を経由するよう `views.py` を接続する。
  - ファイル: `backend/api/services.py`, `backend/api/views.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api`（既存 `tests_pages.py` が全合格し続ける＋次タスクでリビジョン記録を検証）。
  - _要件: P2-8-1, P2-8-4, P2-8-5, P2-8-6, P2-9-1, P2-9-2, P2-9-3, P2-9-4, P2-11-2, P2-11-3_

- [x] 13. 初期リビジョンのバックフィル・データマイグレーション
  - `backend/api/migrations/0004_backfill_initial_revisions.py` を `RunPython` で新規作成する（design 7 章）。既存全ページに `number=1` の初回リビジョンを作る（body=`Page.body`、title=`Page.title`、author=`Page.updated_by`（null 可）、`created_at`=`Page.updated_at`）。`apps.get_model('api','Revision')` のヒストリカルモデルで `created_at` を直接明示代入する。本文空ページも対象。`Revision.objects.filter(page=page).exists()` ガードで**冪等**（再 migrate で二重作成しない）。reverse 関数で作成分を削除する。
  - ファイル: `backend/api/migrations/0004_backfill_initial_revisions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py migrate`（既存 db.sqlite3 の全ページに初回リビジョンが付与される）→ 再度 `../.venv/bin/python manage.py migrate`（冪等・差分なし）→ `../.venv/bin/python manage.py test api`。マイグレーション後のデータ検証テストを `tests_revisions.py` に追加する。
  - _要件: P2-8-4, P2-15-2, 統合受入 22_

- [x] 14. リビジョン API（一覧 / 1 件取得 / 差分 / 復元）とシリアライザ
  - `api/serializers.py` に `RevisionSummarySerializer`（`id, number, created_at, author`。本文なし）と `RevisionSerializer`（`+ body, title`）を追加する。`api/views.py` に `RevisionListView`（GET `?path=&limit=&offset=`、`order_by("-number")`、limit 既定 50・上限 200・不正値は既定へフォールバック）、`RevisionDetailView`（GET `?path=&number=`）、`RevisionDiffView`（GET `?path=&from=&to=`、`from` は `request.query_params.get("from")` で取り変数名は `from_num`/`to_num`、`difflib.SequenceMatcher(None, a, b).get_opcodes()` で `[{op:"add"|"del"|"equal", line}]` に展開、replace は del 群+add 群に分解）、`RevisionRestoreView`（POST body `{path, number}`、`save_page_body` 経由で復元）を追加する。指定子はすべて `number`（PK は使わない）、照合は `filter(page=page, number=n)`。一覧/取得/差分は view、復元は edit を要求し、いずれも「権限 → 存在」順（権限拒否は既定 403／秘匿時 404、通過後に `number` 不在/別ページで 404）。`api/urls.py` に `pages/revisions`・`pages/revisions/detail`・`pages/revisions/diff`・`pages/revisions/restore` を追加する（design 5.5・5.6）。
  - ファイル: `backend/api/serializers.py`, `backend/api/views.py`, `backend/api/urls.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` 成功、`../.venv/bin/python manage.py test api`（次タスクのテストで網羅）。
  - _要件: P2-10, P2-11, P2-13-2, P2-13-4_

- [x] 15. リビジョン機能の統合テスト
  - `api/tests_revisions.py` に `APITestCase` で検証を追加する: 保存で全文スナップショットが 1 件記録され `Page.body` が最新リビジョンと一致、本文不変で増えない、新規作成で初回リビジョン 1 件、履歴一覧が新しい順＋ページング（limit/offset）、diff が行単位（`get_opcodes` の replace が del+add に分解、存在しない `number`・別ページの `number` は 404）、復元が過去本文を新リビジョン化し過去を消さない、復元 no-op 成功、restore の判定順序（権限 → 存在・秘匿時 404）、作者削除で author null 化・履歴残存、ページ削除で連動削除、同時 POST 競合で 409。view/edit 権限ゲート（履歴は view、復元は edit）も検証する。
  - ファイル: `backend/api/tests_revisions.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api` が全て合格する。
  - _要件: P2-8, P2-9, P2-10, P2-11, P2-12, 統合受入 10,11,12,13,14,15,16,17,18_

---

## フロントエンド: 契約と最小 UI（バックエンド API 確定後）

- [x] 16. StorageClient 契約の追加（型・インターフェース）
  - `frontend/src/storage/types.ts` に型を追加する（既存シグネチャは変更しない・追加のみ、design 8.1）: `RevisionSummary`（`id, number, created_at, author: User | null`）、`Revision`（`+ body, title`）、`DiffLine { op: 'add'|'del'|'equal'; line: string }`、`PermissionEntry { id, path, principalType, principalId: number, action, effect }`、`EffectivePermission { view: boolean; edit: boolean }`。`PageClient` に `listRevisions(path, opts?)`/`getRevision(path, number)`/`diffRevisions(path, from, to)`/`restoreRevision(path, number)` を追加。新 `PermissionClient`（`listPermissions`/`grantPermission`/`updatePermission`/`revokePermission`/`getEffectivePermission`）を定義し `StorageClient` に合成する。指定子はすべて `number`。
  - ファイル: `frontend/src/storage/types.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` が成功する。
  - _要件: P2-13-1, P2-13-2, P2-13-3, P2-13-5_

- [x] 17. RestClient 実装と契約テスト
  - `frontend/src/storage/rest-client.ts` に新メソッドを既存の `url()`/`authHeaders()`/`toApiError()` ヘルパで実装する（既存メソッドは変更しない、design 8.2）。403 は `ApiError(status=403)`（401 と区別）、`getRevision`/`diffRevisions` の 404 は throw、`getEffectivePermission` は認証済みなら常に 200・401 のみ throw。REST URL は 5.6 の集約表に合わせる。`frontend/src/storage/rest-client.test.ts` に fetch モックで各メソッドの成功・403・404・401 ケースを追加する（既存流儀）。
  - ファイル: `frontend/src/storage/rest-client.ts`, `frontend/src/storage/rest-client.test.ts`
  - 検証: `frontend/` で `npm run test:run`（新旧テスト全合格）→ `npx tsc --noEmit` が成功する。
  - _要件: P2-13-1, P2-13-2, P2-13-3, P2-6-1_

- [x] 18. 履歴 / 差分 / 復元の最小 UI
  - `frontend/src/pages/PageHistoryPage.tsx`（+ `.module.css`）を新規作成し、`App.tsx` に `/history/*` ルートを `RequireAuth` でラップして追加する。`listRevisions` で一覧（新しい順・ページング）、2 件選択で `diffRevisions` の結果を行単位で色分け表示、edit 権限者に各リビジョンの「このリビジョンに復元」ボタン（`restoreRevision`）。`PageViewPage.tsx` でマウント時に `getEffectivePermission(path)` を取得し view なら「履歴」導線、edit なら「編集/削除/権限設定」導線を出し分ける。素の CSS Modules を維持し追加フレームワークを入れない。403 時は本文・リビジョン本文を描画しない。
  - ファイル: `frontend/src/pages/PageHistoryPage.tsx`, `frontend/src/pages/PageHistoryPage.module.css`, `frontend/src/App.tsx`, `frontend/src/pages/PageViewPage.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` → `npm run build` が成功する。
  - _要件: P2-14-1, P2-14-2, P2-14-4, P2-6-6_

- [x] 19. 権限設定の最小 UI とエラー表示統合
  - `frontend/src/pages/PagePermissionPage.tsx`（+ `.module.css`）を新規作成し、`App.tsx` に `/permissions/*` ルートを `RequireAuth` で追加する（edit 権限者/管理者のみ到達想定）。主体（user/group）× action（view/edit）× effect（allow/deny）の一覧・付与（`grantPermission`）・取消（`revokePermission`）・更新（`updatePermission`）の最小フォーム。到達して 403 を受けた場合の文言は「編集権限がありません」に集約。`frontend/src/pages/use-page-error.ts` を拡張し、閲覧系 403 を「閲覧権限がありません」、編集系・権限設定系 403 を「編集権限がありません」、401 は従来どおり logout+/login に対応付ける。edit 権限のない利用者には編集・削除・復元・権限設定の UI を非表示/無効化する。
  - ファイル: `frontend/src/pages/PagePermissionPage.tsx`, `frontend/src/pages/PagePermissionPage.module.css`, `frontend/src/App.tsx`, `frontend/src/pages/use-page-error.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` → `npm run build` → `npm run lint` が成功する。History/Permission 画面の最小テスト（403 時に本文非描画、edit なしで操作 UI 無効/非表示）を追加する。
  - _要件: P2-14-2, P2-14-3, P2-14-4, P2-14-5, P2-6-6_

---

## 統合・回帰（最終確認）

- [ ] 20. フェーズ 2 全体の統合・回帰確認
  - バックエンド全テスト回帰: `backend/` で `../.venv/bin/python manage.py test`（既存 `tests.py`/`tests_auth.py`/`tests_pages.py`/`tests_assets.py`/`tests_integration.py` が全合格し続ける＝デフォルトポリシー既定で期待値不変、要件 P2-15-4）＋ 新規 `tests_permissions.py`/`tests_revisions.py` が全合格。`makemigrations --check --dry-run`（未生成差分なし）・`migrate`（SQLite で成立、要件 P2-16-1）・`check` を通す。
  - フロントエンド: `frontend/` で `npx tsc --noEmit` → `npm run test:run` → `npm run build` → `npm run lint` を通す。
  - 権限マトリクス（view/edit・継承・Allow/Deny・superuser・デフォルト）、履歴/差分/復元、アセット非干渉がテストで検証済みであることを確認する。SQLite で全成立することを明記する。
  - ファイル:（検証のみ・新規変更なし。必要に応じ軽微な修正）
  - 検証: 上記 backend/frontend の全コマンドが成功し、既存フェーズ 1 テストの差分がゼロであること。
  - _要件: P2-15-4, P2-16-1, 統合受入 21,23_

> **設計上の依存順の根拠:** 権限管理を先に実装するのは、(1) 認可ゲート `require_page_permission` がページ系ビュー改修（GET/children/PUT/DELETE/POST）の土台であり、(2) リビジョン API（履歴 view・復元 edit）がこの認可ゲートを前提にするため。リビジョン機能の中核 `save_page_body`（保存単一経路）は権限ゲートを適用済みのページ系ビューに接続するので、権限 → リビジョンの順が最も手戻りが少ない。両者は要件上は独立性が高いが、実装上は認可ゲートを共有基盤として先に確定するのが合理的。
