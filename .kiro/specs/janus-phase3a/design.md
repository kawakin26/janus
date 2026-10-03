# Janus フェーズ 3a 設計書（サーバーモードのコンテンツ機能）

本書は `janus-phase3a/requirements.md`（要件 3A-C / 3A-CAD / 3A-DRAW / 3A-MAP / 3A-PHOTO と横断の権限・契約・非機能要件）を実装レベルに具体化する設計書である。フェーズ 1（janus-foundation）とフェーズ 2（janus-phase2）は完了・コミット済みであり、本フェーズはそれらの上に **追加のみ** で積み上げる。本書の段階ではアプリケーションコード（backend/frontend）を一切変更せず、設計の確定のみを行う。実装・コミットは後続ステップで行う。

設計の大原則はフェーズ 2 を踏襲する。(1) **フェーズ 1/2 非破壊** — 既存スキーマ・API レスポンスの必須フィールド・既定挙動を変えず、新規モデル・追加マイグレーション（0005 以降）・別エンドポイント・契約の追加メソッドで積み上げる。(2) **サーバーがセキュリティ境界** — すべての可否判定は Python 層（`require_page_permission` ほかビュー内判定）で確定し、フロントの表示制御は補助に過ぎない。(3) **SQLite で成立し PostgreSQL 移行を阻害しない**。(4) **本文を変える操作は `save_page_body` 単一経路を通す**（不変条件: 最新リビジョン body == `Page.body`）。(5) **記法 `:::custom-map` 仕様は foundation の `parse-map.ts` が正**。GUI 編集はそれが読める記法だけを生成する。

本書は冒頭で全体像を述べ、以降は機能ごとに「何を・どのファイルに・どの API/契約で・どう統合するか・エラーと検証」を具体化する。末尾に **DECISION-NEEDED** 節（ユーザー最終確認が必要な項目）とレビュー応答欄を置く。

---

## 1. 全体アーキテクチャと技術スタック（承認後ロック）

フェーズ 3a は 5 つの機能を追加する。これらは「ページ本文に載る操作」「アセットに対する操作」「ページに紐づく独立レコード（コメント）」の 3 系統に整理できる。系統ごとに権限・保存経路・契約の扱いが決まる。

| 機能 | 系統 | 保存先 | 保存経路 | 権限 | 契約 |
|---|---|---|---|---|---|
| コメント（3A-C） | 独立レコード | 新 `Comment` モデル | 専用ビュー（`save_page_body` を通さない） | ページ view/edit に準拠 + 投稿者本人 | 新 `CommentClient` |
| CAD 変換（3A-CAD） | **ブラウザ変換 → アセット操作** | 既存 `Asset`（SVG） | **ブラウザ内変換 → 既存 `uploadAsset`（サーバー非関与）** | アセット権限ポリシー（認証のみ・P2-5-7） | **契約追加なし（フロント内変換ユーティリティ + 既存 `uploadAsset`）** |
| draw.io（3A-DRAW） | ページ本文 | `Page.body` 内のフェンス/ディレクティブ | 既存 `updatePage`/`createPage`（内部 `save_page_body`） | ページ view/edit（既存） | 契約追加なし（フロントのシリアライザ） |
| 地図 GUI 編集（3A-MAP） | ページ本文 | `Page.body` 内 `:::custom-map` | 既存 `updatePage`/`createPage` | ページ view/edit（既存） | 契約追加なし（フロントのシリアライザ） |
| 現場写真（3A-PHOTO） | アセット操作 + 本文 | 既存 `Asset` + `Page.body` 記法 | 既存 `uploadAsset` + `save_page_body` | アセット権限ポリシー + ページ edit | 既存 `uploadAsset`（追加なし） |

この表が本フェーズの設計上の背骨である。重要な帰結は 2 つ。第 1 に、本文に載る 3 機能（draw.io・地図 GUI・写真紐付け）は **新しい本文保存経路を一切作らない** — すべて既存の `updatePage`/`createPage` が内部で呼ぶ `save_page_body` を通るため、リビジョン整合（P2-8）が自動的に満たされる。第 2 に、サーバー側で新規に増える API は **コメント CRUD の 1 系統のみ**である。**CAD 変換はブラウザ内で完結し、変換後 SVG の登録は既存 `uploadAsset`（`/api/assets`）をそのまま使う** — サーバーに CAD 変換エンドポイントも変換ライブラリも追加しない。draw.io・地図・写真もバックエンドにエンドポイントを増やさない。したがって本フェーズのバックエンド追加は Comment CRUD と `0005_comment` マイグレーションに限定され、CAD 変換・draw.io はすべてフロントエンドで完結する。

### 技術スタック（承認後ロック）

- **バックエンド**: Python 3.12 / Django 5.2 / DRF（既存のまま）。認証は DRF `TokenAuthentication`（変更なし）。
- **コメント**: Django 標準 ORM のみ（新規依存なし）。
- **CAD 変換（ブラウザ変換・確定）**: サーバーは変換に**一切関与しない**（ezdxf 等のサーバー依存を追加しない。CAD 変換用 Django エンドポイントを設けない）。**変換はフロントエンドのユーティリティで行い**、JWW は **`ezjww`（Rust コア/WASM）**、DXF は **`dxf-parser` + `iconv-lite`（Shift-JIS/UTF-8 判定）** を用いる。座標変換・向き焼き込み・色/線種・境界/viewBox のロジックは参考実装（`temp/jww-to-svg.js`・`temp/dxf-to-svg.js`）から Janus フロントへ移植し、両者が共有していた `config.js` 相当（色・線種・`maxEntities`・各種 divisor）は Janus 側に新規定義する。変換後 SVG は既存 `AssetClient.uploadAsset` で登録する。追加フロント依存は `ezjww`/`dxf-parser`/`iconv-lite`（WASM の Vite 読み込みに留意）。詳細は 5 章。
- **draw.io（セルフホスト同梱・確定）**: 保存データは **mxGraph XML テキストのみ**で自己完結。エディタ・ビューアともに **diagrams.net（Apache-2.0）をセルフホスト同梱**し、実行時に外部ドメイン（公開 `embed.diagrams.net`）へ接続しない。同梱配布物（`drawio-webapp` 等）を Vite で配信する。これにより編集・閲覧がオフラインでも完結する（3b 再利用性）。詳細は 6 章。
- **地図 GUI 編集**: 追加フロント依存なし。既存 `parse-map.ts` の逆関数（記法シリアライザ）を新規に `serialize-map.ts` として実装する。
- **フロント**: React + TypeScript + Vite + Vitest（既存）。追加 UI フレームワークは入れない。素の CSS Modules を維持。
- **DB**: SQLite を必須ターゲット、PostgreSQL は将来（ユーザー方針で後回し）。新規スキーマは SQLite 固有機能に依存しない。

---

## 2. データモデル（3A-C コメントのみ新規）

本フェーズで新規追加するモデルは **`Comment` のみ**。CAD/描画/地図/写真は既存 `Asset`/`Page` に載るためスキーマを足さない（要件「新スキーマはコメントのみ」）。マイグレーションは `0005_comment.py`（additive-only）とする。既存 `Page`/`Folder`/`Asset`/`PagePermission`/`Revision` は一切変更しない。

### 2.1 `Comment`（`backend/api/models.py` に追加）

| フィールド | 型 | 説明 |
|---|---|---|
| id | BigAutoField | 主キー。契約の指定子（phase2 `PagePermission` と同流儀の数値 ID）。 |
| page | FK(Page, on_delete=CASCADE, related_name="comments") | 対象ページ。ページ削除で連動削除（要件 3A-C-5、`Revision` と同じ直感）。 |
| body | TextField | コメント本文。空・空白のみは禁止（検証はシリアライザが所有、2.2）。 |
| author | FK(auth.User, null=True, blank=True, on_delete=SET_NULL, related_name="comments") | 投稿者。削除時 null 化で本文・日時を保持（要件 3A-C-6、`Revision.author` と同方針）。 |
| created_at | DateTimeField(auto_now_add=True, db_index=True) | 作成日時。一覧の既定ソートキー（昇順）。 |
| updated_at | DateTimeField(auto_now=True) | 更新日時（本文編集で動く。要件 3A-C-3）。 |

`Meta`: `ordering = ["created_at", "id"]`（作成日時昇順・既定、要件 3A-C-2。同時刻の安定順序のため第 2 キーに `id`）。

**設計判断（`page` を FK にする理由）**: `PagePermission.path` は実ページの無い仮想ノードにも権限を張るため文字列だった。コメントは「実在するページに付く注記」であり仮想ノードに付ける要件がない。FK にすることで `on_delete=CASCADE`（要件 3A-C-5）を Django 標準で得られ、存在しないページへのコメント投稿をビューの Page 取得段で自然に 404 にできる。これは `Revision.page` FK と同じ判断で、既存流儀に一致する。

**設計判断（`author` の `on_delete`）**: `PagePermission` は主体が消えたら設定が無意味なので CASCADE だったが、コメントは監査性のため本文・日時を残す。よって `Revision.author` と同じ `SET_NULL`。要件 3A-C-6 の明文に一致。

本文の最大長は **TextField（上限はアプリ検証で 10,000 文字）** とする。CharField の DB 制約ではなくシリアライザ検証で上限を課す理由: 本文は複数行注記を想定し行数・改行を許すため TextField が自然で、長さ上限は入力検証の責務（空・空白のみ拒否と同じ層）に置くのが一貫する。

### 2.2 コメント本文のバリデーションと XSS 方針

- **必須・型・上限（カウント基準を確定、レビュー指摘 6）**: `body` は必須・文字列。長さ上限は **`strip()` 前の受領文字列の `len()`（Python コードポイント数、改行文字も 1 文字として数える）で 10,000 を上限**とし、10,001 以上は **400**。空判定は別基準で、**`strip()` 後が空**（空文字および空白のみ）なら **400** で拒否する（要件 3A-C-7）。すなわち上限は受領値そのもの、空判定は `strip()` 後、と基準を分けて確定する（例: 前後空白込み 10,001 文字で中身 9,999 文字は上限超過として 400）。検証は `CommentSerializer.validate_body` が所有（第一防衛）。
- **保存はそのまま**: 本文は受領したテキストをそのまま保存し、サーバー側で HTML 変換・サニタイズを行わない。
- **表示はプレーンテキスト**: コメント本文は **既定でプレーンテキスト扱い**とし、Markdown レンダリングの対象にしない（要件 3A-C-7、DECISION-NEEDED D-COMMENT-RENDER）。フロントは React のテキストノード（`{comment.body}`）として描画し `dangerouslySetInnerHTML` を使わない。これにより本文が `<script>` を含んでも DOM に注入されず、XSS 経路を作らない。将来 Markdown 化する場合も、本文側は既存 `MarkdownRenderer`（生 HTML 無効・rehype-raw 不採用）を通すだけで足り、サーバー保存形式は変えない。

---

## 3. API エンドポイント（コメント CRUD のみ）

既存 `backend/api/urls.py` の規約（スラッシュ無し・クエリパラメータで `path` 指定・末尾に `pages`/`assets` を置く順序依存）に合わせて追加する。既存ルートは変更しない。**本フェーズで新規追加するバックエンド API はコメント CRUD の 1 系統のみ**である。CAD 変換はブラウザで完結し、変換後 SVG の登録は既存 `AssetListCreateView`（`/api/assets`）をそのまま使うため、**CAD 変換用のエンドポイントは追加しない**（旧設計の `AssetCadConvertView`・`/api/assets/convert` は廃止）。

### 3.1 コメント CRUD

| メソッド・パス | ビュー | 用途 | 権限 |
|---|---|---|---|
| GET `/api/pages/comments?path=<path>` | `CommentListCreateView.get` | 一覧（作成日時昇順） | ページ **view** |
| POST `/api/pages/comments?path=<path>` | `CommentListCreateView.post` | 投稿（body を JSON で） | ページ **view** |
| PATCH `/api/pages/comments/<int:pk>` | `CommentDetailView.patch` | 本文編集（body のみ） | 投稿者本人 or ページ **edit** or 管理者 |
| DELETE `/api/pages/comments/<int:pk>` | `CommentDetailView.delete` | 削除 | 投稿者本人 or ページ **edit** or 管理者 |

URL 配線は順序依存に注意し、既存の `pages/permissions/<pk>` と `pages/permissions` の並びに倣って `pages/comments/<int:pk>` を `pages/comments` より **前** に置く。`pages` 単独ルートより前に `pages/comments*` を置く（既存 revisions 系と同じ配置規約）。

**一覧のページング（レビュー指摘 7）**: コメント一覧は本文と独立に増えうるが、**3a は該当ページのコメントを全件・作成日時昇順で返す（ページングは将来課題）**とする。要件は件数上限を課しておらず、現時点のコメント件数規模では全件取得で足りる。`listRevisions`（`limit`/`offset` を持つ）との一貫性を将来必要とする場合は、同じ任意引数 `limit`/`offset` を後方互換で `listComments`/`CommentListCreateView.get` に追加できる形にしておく（追加のみで既存契約を壊さない）。本フェーズでは実装しない。

**ビューの判定順序（既存 `RevisionListView`/`PageDetailView` に厳密に倣う）**:

- GET/POST（list/create）: `path = normalize_path(query/body)` → `require_page_permission(request, path, "view")`（拒否は 403/秘匿時 404、既存ヘルパがそのまま所有）→ `Page.objects.filter(path=path).first()`、不在は 404（`PAGE_NOT_FOUND_DETAIL`）→ 一覧返却 or 作成。順序は「権限 → 存在」（design 5.2 と同じ）。
- POST の本文検証: `CommentSerializer(data=...)` で `body` を検証（空・空白のみ・上限超過は 400）。`author=request.user` を注入して作成。作成したコメントを 201 で返す（要件 3A-C-1）。
- PATCH/DELETE: まず `Comment.objects.filter(pk=pk).first()`、不在は 404（`COMMENT_NOT_FOUND_DETAIL`、`PagePermissionDetailView` と同じ「取得 → 無ければ 404」流儀）→ **コメント編集権限判定**（3.2）→ 本文更新 or 削除。PATCH は `body` のみ更新可（`updated_at` が動く。`created_at`/`author` は不変、要件 3A-C-3）。DELETE は 204。

**コメント操作は本文・リビジョンに影響しない**（要件 3A-C-8）: `Comment` ビューは `save_page_body` も `Page.save()` も呼ばない。`Page.updated_at` は `auto_now` だが Comment ビューが `Page` を保存しないため動かない。これはテストで保証する（9 章 T-C-5）。

### 3.2 コメント編集/削除の権限ヘルパ

要件 3A-C-11 の「投稿者本人 or edit 権限 or 管理者」を 1 つのヘルパに閉じ込める。**独自の階層判定は作らず**、既存 `check_permission`（`permissions.py`、superuser バイパスを含む `effective_permission` を内部で呼ぶ）を流用する。

```
def can_modify_comment(request, comment) -> bool:
    # 1. 管理者バイパスは check_permission(edit) 内の effective_permission が担う。
    #    superuser は常に edit True になるため、ここで明示分岐は不要だが可読性のため先に見る。
    if request.user.is_superuser:
        return True
    # 2. 投稿者本人（author が null 化されている場合は本人判定できない → False 側）。
    if comment.author_id is not None and comment.author_id == request.user.id:
        return True
    # 3. 対象ページの edit 権限（階層継承・Deny 優先・含意はすべて既存ロジックに委譲）。
    return check_permission(request, comment.page.path, "edit")
```

これを `permissions.py` に追加し、`CommentDetailView` が呼ぶ。拒否時の応答は **常に 403**（`PERMISSION_DENIED_DETAIL`）とする。これは既存 `PagePermissionDetailView` の編集系（PATCH/DELETE）が `require_page_permission(request, entry.path, "edit")` を経由し、`_denied_response(settings.JANUS_HIDE_FORBIDDEN)` によって **既定 403・秘匿運用（`JANUS_HIDE_FORBIDDEN=True`）時 404** を返すのとは **意図的に異なる**（実コードで確認済み。「既存編集系も常に 403」という以前の記述は誤りで本改訂で訂正した）。

コメント編集系を常に 403 にする理由と仕組み:

- コメントは PATCH/DELETE 時点で `pk` により対象を `Comment.objects.filter(pk=pk).first()` で取得済み（存在は既に判明）であり、かつ view 権限は一覧・投稿の時点で通過しているため、対象の存在を秘匿する意味がない。したがって **コメント編集系は `require_page_permission` を使わず**、`can_modify_comment` が False のとき `CommentDetailView` が固定で 403（`PERMISSION_DENIED_DETAIL`）を返す。
- `can_modify_comment` の 2.投稿者本人判定（`comment.author_id == request.user.id`）は `require_page_permission` を経由しないため、`JANUS_HIDE_FORBIDDEN` の秘匿すり替え（404）の影響を受けない。3.ページ edit 判定は `check_permission`（応答を生成しない純 bool 判定）を使い、こちらも 404 すり替えを経由しない（`check_permission` は 403/404 の応答生成を行わず bool を返すだけ）。
- 以上により、コメント編集系の拒否は `JANUS_HIDE_FORBIDDEN` の値に関わらず **常に 403** で安定する。この不変条件を T-C-3 で固定する（秘匿運用 ON/OFF の双方で、無関係な一般利用者の PATCH/DELETE が 404 ではなく 403 になること）。

### 3.3 CAD 変換（バックエンド API なし — 既存 `uploadAsset` を再利用）

CAD 変換はブラウザ内で完結するため、**本フェーズで CAD 変換用のバックエンド API を追加しない**。変換後の SVG バイト列はフロントエンドで `File`（`image/svg+xml`、`.svg` 正規化後の filename）に包み、**既存 `AssetListCreateView`（POST `/api/assets?folder=<id>`、multipart `file`/任意 `alias`）をそのまま使って登録する**。これは写真アップロード（3A-PHOTO）が既存 `uploadAsset` を使うのと同一経路であり、サーバーから見れば「クライアントが生成した SVG を通常アップロードした」のと区別がつかない。

したがって次が自動的に満たされる:

- **一意制約・重複 409・物理フラット保存・`AssetSerializer(context={"request": request})` による `url` 生成**は、既存 `AssetListCreateView` の実装がそのまま所有する（CAD 用に再実装しない）。
- **権限**はフェーズ 2 の確定（アセットはページ権限の対象外、認証のみ・P2-5-7）が既存ビューにより適用される。`require_page_permission` は呼ばれない（既存の DRF 既定 `JANUS_REQUIRE_AUTH`→`IsAuthenticated`）。本フェーズでアセット単位権限を新設しない（U-3A-2 据え置き、DECISION-NEEDED D-ASSET-PERM）。
- **孤児防止**も既存ビューの二段構え（save 前 `.exists()` 事前重複チェック + `IntegrityError` 時 `asset.file.delete(save=False)`）がそのまま効く。CAD 変換自体はアップロードより前（ブラウザ内）で完了するため、変換失敗時はそもそもアップロードを行わず、サーバー側に副作用は一切発生しない。

ブラウザ変換の詳細（変換ユーティリティ・向き焼き込み・失敗フォールバック・性能/ハング対策・SVG XSS 配慮・エントリポイント）は 5 章に記す。`backend/api/urls.py` への追加・`backend/api/views.py` への CAD ビュー追加・`settings.py` への変換器設定追加は**いずれも不要**（旧設計の `AssetCadConvertView`・`/api/assets/convert`・`JANUS_CAD_CONVERTER` は廃止）。

---

## 4. 権限との統合（横断・セキュリティ境界）

本フェーズは新しい権限判定規則を一切作らない。既存 `require_page_permission`・`check_permission`・`effective_permission`（superuser バイパス・階層継承・Deny 優先・edit→view 含意を含む）を流用する。アセット非干渉（P2-5-7）も据え置く。

- **ページ本文に載る操作（地図 GUI 編集・draw.io 保存・それらの閲覧）**: 既存の `PageDetailView`（GET=view、PUT/POST=edit）がそのまま権限を担保する。本文の一部として保存されるため、別権限・別ゲートを足さない。閲覧は `getPage`（view）経由で本文が返り、フロントがレンダリングする。
- **コメント**: 一覧・投稿は view、編集・削除は投稿者本人 or edit or 管理者（3.1/3.2）。判定は既存ヘルパに委譲。
- **アセット操作（CAD 変換後 SVG の登録・写真アップロード）**: いずれも既存 `uploadAsset`（`/api/assets`）経由であり、ページ権限の対象外（認証のみ）。`/api/assets/<id>/file` 直リンクで認証ユーザーがアセットを取得しうる点は **セキュリティ上の明示事項として据え置く**（U-3A-2・DECISION-NEEDED D-ASSET-PERM）。CAD 変換はブラウザ内処理のため、サーバー側に新たな権限面は増えない。
- **管理者（Django superuser）**: `effective_permission` のバイパスにより、権限エントリやデフォルトに関わらずページ系操作（コメントのモデレーション含む）を行える。これは **仕様**（ユーザー確認済み: superuser は閲覧拒否を受けないのが仕様）であり本フェーズでも維持する。
- **フロント表示制御は補助**: 編集 UI（地図 GUI・draw.io・コメント編集ボタン・CAD/写真アップロード）の出し分けは `getEffectivePermission` の利便性のためで、セキュリティ境界はサーバーが担保する（P2-5-5）。例えばコメント編集ボタンは「投稿者本人 or edit」で出し分けるが、最終判定はサーバーが行う。

---

## 5. CAD 変換（ブラウザ変換・要件 3A-CAD）

本章は旧設計の「サーバー側 `ezdxf` 変換（`CadConverter` Strategy・`AssetCadConvertView`・`JANUS_CAD_CONVERTER`・D-CAD-STATUS）」を**全面的に置き換える**。確定方針は **CAD→SVG 変換をブラウザ（フロントエンド）で行い、サーバーは変換に一切関与しない**（CAD 変換用の Django エンドポイント・サーバー変換依存を持たない）。変換後 SVG の登録のみ既存 `AssetClient.uploadAsset` を使う。

**foundation 要件 8-3 の整合（改善）**: foundation 要件 8-3 は「ローカルモードは事前変換済み画像/SVG の取り込みで対応」としていたが、変換がブラウザ内で完結する本設計では **ローカルモードでも事前変換が不要になり、端末内で直接 CAD→SVG 変換できる**ように改善される。3a で作る変換ユーティリティはサーバー/ローカルに依存しない純フロント処理のため、3b がそのまま再利用できる（要件 3A-CAD-8）。

### 5.1 変換ユーティリティの構成と採用ライブラリ

ユーザーの主フォーマットは JWW であり、JWW→SVG の確立した変換資産（`ezjww`＝Rust コア/WASM）はブラウザ資産である。これを直接再利用するため変換はブラウザで行う。移植元は参考実装 `temp/jww-to-svg.js`（JWW）と `temp/dxf-to-svg.js`（DXF）で、両者は共通の `config.js`（`lightColors`/`darkColors`・`linetypes`・`maxEntities`・各 divisor）を参照していたが、その `config.js` は参考資産に含まれないため **Janus 側に定義する**。

新規フロントディレクトリ `frontend/src/markdown/custom-map/cad/`（地図背景として使う SVG を生むため custom-map 配下に置く）を設け、次を実装する:

| ファイル | 役割 | 移植元 |
|---|---|---|
| `cad/config.ts` | 色（light/dark）・線種ダッシュ・`maxEntities`・`maxFileBytes`・stroke/dash divisor 等の設定値（参考実装 `config.js` 相当を Janus 側に定義） | 両参考実装が参照する `config.js` |
| `cad/jww-to-svg.ts` | JWW バイト列→SVG。`ezjww` の `isJwwFile`/`readDocument` を使い、LINE/ARC/CIRCLE(楕円)/SOLID/TEXT/POINT を描画。ペン色クラス・線種・Y 反転・向き焼き込み・viewBox 算出 | `temp/jww-to-svg.js` |
| `cad/dxf-to-svg.ts` | DXF バイト列→SVG。`dxf-parser` でパース、`iconv-lite` で Shift-JIS/UTF-8 判定デコード。LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC/ELLIPSE/TEXT/MTEXT/POINT を描画 | `temp/dxf-to-svg.js` |
| `cad/convert.ts` | 拡張子/マジックで JWW/DXF を振り分け、`orientation` を渡して SVG 文字列を返す統一入口。失敗は型付きエラーで throw。入力サイズ・エンティティ数の上限を適用 | 両者の統合 |
| `cad/convert-worker.ts` | （採用時）上記変換を Web Worker 上で実行し、UI スレッドをブロックしない | 新規 |

**追加するフロント依存（`frontend/package.json`）**: `ezjww`（JWW/WASM）、`dxf-parser`（DXF パース）、`iconv-lite`（DXF 文字コード判定）。**WASM と Vite の読み込みに留意**する: `ezjww` は WASM を同梱するため、Vite の WASM 取り扱い（`?url`/`vite-plugin-wasm` あるいは `ezjww` が提供する初期化 API）と、Web Worker からの WASM 初期化が成立するかを実装初手のスパイクで確認する（§5.6・タスク参照）。`iconv-lite` はブラウザ向けバンドルが肥大化しうるため、必要エンコーディング（CP932=`shift_jis` 中心）に絞れるか、ブラウザの `TleaseDecoder`（UTF-8 判定）＋最小 CP932 デコードで代替できるかもスパイクで評価する。

**参考実装の `Buffer` 依存の置換**: 参考実装は Node の `Buffer`（`Buffer.isBuffer`・`buffer.toString('latin1')`・`subarray`）を使う。ブラウザ移植では `Uint8Array` + `TextDecoder`（UTF-8 妥当性判定は `new TextDecoder('utf-8',{fatal:true})`）に置換する。`$DWGCODEPAGE` ヘッダ読み取り（先頭 64KB を latin1 相当で走査）も `Uint8Array` のバイト走査に置き換える。この置換は `dxf-to-svg.ts` の `decodeDxfBuffer` 相当を Janus 側で書き直すことを意味する（ロジックは参考実装の方針＝実体優先の文字コード判定を踏襲）。

### 5.2 変換の統一入口と型

`cad/convert.ts` に単一の入口を置く（擬似シグネチャ）:

```ts
export type CadOrientation = 0 | 90 | 180 | 270

export class CadUnsupportedError extends Error {}   // 未対応拡張子/内容（JWW/DXF いずれでもない）
export class CadTooLargeError extends Error {}       // 入力サイズ上限超過
export class CadTooManyEntitiesError extends Error {} // エンティティ数上限超過（maxEntities）
export class CadConversionError extends Error {}      // 破損・描画可能エンティティなし・座標不正等
export class CadEngineUnavailableError extends Error {} // WASM 初期化失敗等（環境起因）

export async function convertCadToSvg(
  file: File,
  orientation: CadOrientation = 0,
): Promise<{ svg: string; filename: string }>  // filename は .svg 正規化後
```

内部処理順序: (1) サイズ上限チェック（`file.size > config.maxFileBytes` → `CadTooLargeError`）、(2) `ArrayBuffer` 読み出し → `Uint8Array`、(3) 拡張子/マジックで JWW か DXF を判定（JWW は `ezjww.isJwwFile`、DXF は拡張子 `.dxf`。いずれでもなければ `CadUnsupportedError`）、(4) 対応する変換関数で SVG 文字列を生成（エンティティ数上限超過は `CadTooManyEntitiesError`、パース不能・座標不正は `CadConversionError`、WASM 初期化不能は `CadEngineUnavailableError`）、(5) filename を `.svg` 正規化して返す。向き焼き込みは変換関数内で適用する（§5.3）。この関数は副作用を持たず（アップロードしない）、純粋に `File`→SVG 文字列の変換に閉じる（テスト容易）。

### 5.3 向き焼き込み（0/90/180/270、参考実装の方式を踏襲）

要件 3A-CAD-2 の「向きを SVG の内容に焼き込む」は、記法 `rotate`（表示時回転）とは別物である。参考実装（`jww-to-svg.js`/`dxf-to-svg.js`）はいずれも、CAD 原座標のまま要素を出力し、**外側の `<g transform>` で `rotate(θ) scale(1,-1)`（Y 反転 + 回転）をまとめて適用**し、回転後の 4 隅から外接矩形を計算して `viewBox` に設定する方式を採る。この方式を Janus 側へそのまま移植する。

- **焼き込み（CAD 変換時）**: `orientation`（`normalizeRotate` で 0/90/180/270 に正規化）に応じて、Y 反転済みの 4 隅を回転させた外接矩形 `rb`（min/max に `pad` を加味）を求め、`viewBox="rb.minX rb.minY vbW vbH"` を設定する。これにより**どの向きでも図形がクリップされない**（参考実装がこの外接矩形再計算を既に行っている。回転後の負座標側はみ出しは `viewBox` の原点オフセットで吸収される）。90/270 度では実質的に幅高さが入れ替わる。生成 SVG は `preserveAspectRatio="xMidYMid meet"`・`width="100%"` で `<img>` 表示にフィットする。
- **表示時回転（記法 `rotate`）**: 既存 `CustomMapViewer` の 90 度回転機能はそのまま。焼き込みと独立で、閲覧者が一時的に回す操作。両者は直交し、焼き込み済み SVG に記法 `rotate` を重ねても矛盾しない。
- **テキストの可読性**: 参考実装は TEXT を個別 `transform`（`scale(1,-1)` 打ち消し、JWW は文字角 `rotate(-angle)` も）で正立させる。回転時に文字も回る点は参考実装が「90/180/270 のみのため許容」としており、Janus でも同方針（可読性の完全補正は 3a スコープ外）。

### 5.4 filename 正規化・一意制約・SVG 登録（既存 `uploadAsset` 経由）

- 登録時の filename は元 `.jww`/`.dxf` 名の拡張子を `.svg` に置換して正規化する（要件 3A-CAD-3）。規則: ベース名を取り、末尾拡張子を `.svg` に置換（拡張子が無ければ付す）。安全化（パス区切り除去等）はフロントで行い、サーバー側の既存 `_safe_filename` も二重に効く。
- 変換後 SVG 文字列を `new File([svg], filename, { type: 'image/svg+xml' })` に包み、**既存 `AssetClient.uploadAsset({ folderId, file, alias })` で登録する**。フォルダ内一意・重複 409 は既存 `AssetListCreateView` の制約・重複チェックがそのまま適用される（新しい一意規則を作らない）。物理保存（UUID フラット保存）・`content_type`・`url` 生成もすべて既存ビュー所有。
- **元 CAD は保持しない**（要件 3A-CAD-4）: 元 CAD バイト列はブラウザのメモリ上で変換に使うだけで、アップロードするのは変換後 SVG のみ。サーバーに元 CAD は一切渡らない。

### 5.5 失敗フォールバックと UI 提示（要件 3A-CAD-5、サーバー非関与）

変換はアップロードより**前**にブラウザ内で行うため、失敗時はそもそも `uploadAsset` を呼ばず、**サーバー側に副作用（孤児・部分登録）は一切発生しない**。失敗は HTTP ステータスではなく **フロントエンドのエラー表示**で表現し、いずれも「**通常の画像/SVG アップロード経路（既存 `AssetLibraryPage` の `uploadAsset` フォーム）へ案内**」する文言を含める。

| 失敗条件 | エラー型 | UI 表示（例） | 回復導線 |
|---|---|---|---|
| 入力サイズ上限超過（`file.size > maxFileBytes`） | `CadTooLargeError` | 「ファイルが大きすぎます（上限 N MB）。画像/SVG に変換してから通常アップロードしてください。」 | 通常アップロードへ案内 |
| 未対応拡張子/内容（JWW/DXF でない） | `CadUnsupportedError` | 「このファイルは CAD 変換に対応していません（対応: .jww / .dxf）。通常の画像/SVG アップロードをご利用ください。」 | 通常アップロードへ案内 |
| エンティティ数上限超過（`maxEntities`） | `CadTooManyEntitiesError` | 「図面の要素数が多すぎて変換できません（上限 N）。CAD 側で画像/SVG に書き出してアップロードしてください。」 | 通常アップロードへ案内 |
| 破損 CAD・描画可能エンティティなし・座標不正 | `CadConversionError` | 「CAD ファイルを変換できませんでした。通常の画像/SVG アップロードをご利用ください。」 | 通常アップロードへ案内 |
| WASM 初期化失敗等（`ezjww` ロード不可） | `CadEngineUnavailableError` | 「この環境では CAD 変換を実行できませんでした。通常の画像/SVG アップロードをご利用ください。」 | 通常アップロードへ案内 |
| アップロード段の重複（変換成功後に filename/alias 重複） | 既存 `ApiError`（409） | 既存 `uploadAsset` の 409 分岐（「同名が既に存在します」）をそのまま再利用 | リネーム再送 |

変換失敗はブラウザ内で完結するため CAD 本文はネットワークに出ない（情報漏えいなし）。コンソールへの詳細ログは開発時の最小限に留め、本番ではユーザー向けメッセージのみを表示する。アップロード段で起きる 409（重複）は、変換成功 → `uploadAsset` 呼び出し → 既存ビューの二段構え孤児防止（`.exists()` 事前チェック + `IntegrityError` 時 `file.delete`）がそのまま効くため、CAD 固有の孤児対策コードは不要。

### 5.6 性能・ハング対策とエントリポイント（ユーザー懸念への対応）

ユーザーの懸念（図面登録は低頻度だが、実行中にハングアップするのは困る）に対し、次を設計要件とする（要件 3A-CAD-9）:

- **入力サイズ上限（`config.maxFileBytes`）**: 変換前に `file.size` で足切りし、巨大ファイルを即座に拒否する。
- **エンティティ数上限（`config.maxEntities`）**: 参考実装と同じく、パース直後（`doc.entities.length`/`dxf.entities.length`）に上限超過を拒否する。SVG 生成前に弾くことで CPU/メモリ暴発を防ぐ。
- **ローディング表示**: 変換中は明示的なローディングインジケータ（スピナー/進行表示）を出し、完了/失敗で解除する。
- **Web Worker 実行（可能なら採用）**: `cad/convert-worker.ts` で変換を Worker 上に逃がし、UI スレッドをブロックしない。`ezjww`（WASM）が Worker 上で初期化できることをスパイクで確認し、成立すれば Worker 既定、不成立ならメインスレッド実行 + ローディング表示にフォールバックする（低頻度操作のため、Worker 不成立でも上限と明示表示があれば実用上許容。ユーザーは「ブラウザ不可は気にしないが実行中ハングアップは困る」と述べており、上限で重い図面を事前に弾く設計がこの懸念に直接応える）。

**エントリポイント（変換 UI の置き場所）**: 2 箇所から変換を起動する。

1. **アセットライブラリ（`AssetLibraryPage.tsx`）**: 既存のアップロードフォームに「CAD を変換して登録」導線（`<input type="file" accept=".jww,.dxf">` + 向き選択 0/90/180/270）を追加する。選択 → `convertCadToSvg(file, orientation)` → 成功した SVG を既存 `uploadAsset` で登録（既存の成功/409 ハンドリングを再利用）。失敗時は §5.5 のエラー表示で通常アップロードへ案内する。
2. **地図 GUI 編集（`MapEditor`、§7.4）**: 地図背景として CAD を取り込む場合も同じ `convertCadToSvg` → `uploadAsset` を使い、登録した SVG をマップ画像参照（`filename`/`alias`）に設定する。

### 5.7 SVG 配信と XSS 配慮

登録 SVG は既存 `AssetFileView`（`/api/assets/<id>/file`）が `FileResponse` で配信し、地図ビューアは `getAssetFileUrl`（Blob URL 化）経由で **`<img src>`** として表示する（実コード `CustomMapViewer.tsx` の `<img ref={imgRef} src={imageUrl}>` を確認済み）。`<img>` 表示は SVG 内スクリプトを実行しない画像コンテキストであり、外部由来 SVG を信頼しない既存の姿勢（foundation XSS 配慮）をそのまま踏襲する。加えて変換ユーティリティが生成する SVG はベクタ図形・`<style>`（prefers-color-scheme の色切替）のみで、**`<script>`/`foreignObject`/外部参照（`xlink:href` 等）を含めない**ことを移植時の不変条件とする（参考実装も含めていない）。これにより SVG 経由の XSS 経路を作らない。生成文字列は `esc()`（`&<>` エスケープ、参考実装にあり）でテキストノードを無害化してから埋め込む。

---

## 6. draw.io 描画機能（要件 3A-DRAW）

### 6.1 保持形式の選定（要件 3A-DRAW-3 / foundation 設計 11 章）

foundation 設計 11 章は「本文中コードフェンス方式」か「専用ディレクティブ方式」の 2 案を未決として残していた。本書で **専用ディレクティブ方式（コンテナディレクティブ `:::drawio`）** を選定する。

選定理由（判断基準 (a)〜(d) に対する評価）:

- **(a) 既存レンダラ・`:::custom-map` と共存**: 本文処理は既に `remark-directive` を有効化しており、`:::custom-map` が確立したコンテナディレクティブ変換パターン（`remark-custom-map.ts` が `data.hName='div'` + `data-*` 属性へ変換 → `components.div` が検出して専用コンポーネントを描画）を持つ。`:::drawio` を同じパターンで追加すれば、既存の仕組みにそのまま乗り、`remarkDirectiveFallback`（hName 既設を尊重）とも衝突しない。コードフェンス方式は `react-markdown` の `code` コンポーネントを差し替える別経路が要り、GFM のコードブロック表示と干渉するリスクがある。
- **(b) 生 HTML 無効（rehype-raw 不採用）維持**: ディレクティブ方式は XML を `data-*` 属性（文字列）に格納し、`:::custom-map` と同じく `dangerouslySetInnerHTML` を使わずに専用コンポーネントへ渡せる。XSS 経路を作らない。
- **(c) 1 ページ複数図**: コンテナディレクティブは本文中に何個でも書けるため複数図を自然に満たす。
- **(d) 自己完結・同期非阻害**: ブロック内に mxGraph XML テキストのみを保持し、別アセット・外部サービスへの実行時依存を持たない（要件 3A-DRAW-5）。将来の手動エクスポート/インポート同期（B 案）を阻害しない。

**既存 `:::custom-map` との一貫性**も決め手である。本文に載る 2 つめの専用ブロックを同じディレクティブ機構で表現することで、学習・保守・パーサ基盤を一本化できる。D-DRAW-FORMAT（要件 U-3A-4）はユーザー確認により **CONFIRMED**（§14）。

### 6.2 記法とシリアライズ

mxGraph XML は 1 行化が保証されず改行・引用符・`:::` を含みうるため、属性ではなく **ブロックのコードフェンス子要素**として格納する。すなわち `:::drawio` コンテナの中に XML を ` ```xml ... ``` ` フェンスで入れる形を既定とする。

```markdown
:::drawio
```xml
<mxGraphModel>...（draw.io が返す XML）...</mxGraphModel>
```
:::
```

パース（`remark-drawio.ts`、新規）: `remark-directive` 後・fallback 前に差し込み、`containerDirective` かつ `name==='drawio'` のノードを走査する。配下の最初の `code` ノード（`extractTextFromNode` 相当でテキスト抽出）から XML 文字列を取り出し、`data.hName='div'` + `data.hProperties={'data-drawio': <xml>, 'data-directive':'drawio'}` を設定、子を空にする（`remark-custom-map.ts` と同一パターン）。`MarkdownRenderer` の `components.div` を拡張し、`data-drawio` を検出したら新規 `DrawioViewer` を描画する（`data-custom-map` 検出分岐と並列に 1 分岐追加。既存分岐は不変）。

シリアライズ（`serialize-drawio.ts`、新規）: 保存時はエディタが返した XML をフェンス内に埋め込んで `:::drawio` ブロックを生成し、`PageEditPage` の `body` に差し込む。XML 内に ` ``` ` が現れた場合に備え、フェンスは必要に応じて 4 連バッククォートへ拡張する（Markdown のフェンス入れ子規則に従う）。往復（編集 → 保存 → 再パース）で XML が保たれることをテストで保証する。

**XML 中の行頭 `:::` によるコンテナ早期終了を防ぐ根拠（レビュー指摘 3、実機確認済み）**: コンテナディレクティブ `:::drawio` の終端は行頭 `:::` だが、mxGraph XML はスタイル文字列やラベルに任意テキスト（行頭 `:::` 相当を含みうる）を持つため、XML を**コードフェンス内に置く**ことでこの衝突を無害化する。`remark-parse`（CommonMark のコードフェンス規則）はフェンス開始から対応するフェンス終了までを 1 つの `code` ノードとして確定し、`remark-directive` のコンテナ終端走査は**フェンス内の行を終端として見ない**。この前提を実機（`remark-parse` + `remark-directive`）で確認した: `:::drawio` の中に ` ```xml ... ``` ` フェンスで `<mxGraphModel>\n:::foo should not close\n</mxGraphModel>` を入れた入力で、コンテナは早期終了せず（`drawio container found: true`）、`code` ノードの値に `:::foo should not close` を含む XML がそのまま保持された。したがって本設計の「XML をコードフェンス内に格納する」方式は `:::` 衝突に対して安全である。シリアライザはこの不変条件（XML は常にコードフェンス子要素として格納し、ブレース属性やフェンス外には出さない）を守る。
往復テスト T-DRAW には「**XML 本文に行頭 `:::` を含むケース**」（例: ラベルやスタイルに `:::` 相当文字列）と「XML 本文に ` ``` ` を含むケース（4 連バッククォートへ拡張）」の両方を往復検証項目として含める。将来この前提が崩れる（別パーサ設定等）場合の代替として、`:::drawio` 開閉フェンス長の動的化、または XML の Base64 安全化を §14 の据え置き課題に記す。

### 6.3 エディタ提供方式と閲覧レンダリング（セルフホスト同梱・確定）

編集エディタ・閲覧ビューアともに **diagrams.net（Apache-2.0）をセルフホスト同梱**し、**実行時に外部ドメイン（公開 `embed.diagrams.net`）へ接続しない**ことを確定する（D-DRAW-HOST = セルフホスト同梱、ユーザー確認済み）。公開埋め込みは採用しない。理由はユーザーがローカルモード（3b）の実用性を最優先し、同梱により (a) 編集/閲覧がオフラインで完結し、(b) 図面内容を外部 iframe ドメインへ漏らさないため。

- **編集エディタ（要件 3A-DRAW-1/6）**: diagrams.net の Web アプリ配布物（`drawio`／`drawio-webapp` 相当。Apache-2.0）を **フロントの静的アセットとして同梱**し、Janus 自身のオリジンから配信する `<iframe src="<self-hosted>/webapp/index.html?embed=1&proto=json&...">` で開く。`PageEditPage` に「描画を追加/編集」導線を置き、`postMessage` の embed protocol（`init`/`load`/`save`/`exit` イベント）で XML を受け渡す（プロトコルは公開版と同一。読み込み元のオリジンが自前になるだけ）。保存イベントで受け取った XML を `serialize-drawio` が本文へ差し込む。公開ドメインへ出ないため、`postMessage` の `origin` 検証は自オリジンに固定できる（セキュリティ向上）。
- **同梱配布物と Vite 配信（確定・要スパイク）**: diagrams.net の配布物は大きい（数 MB 規模）。Janus では **`frontend/public/`（または専用の静的ディレクトリ）に diagrams.net の webapp 一式を配置し、Vite のビルドにそのまま含めて同一オリジンから配信**する方式を既定とする。この静的一式は Vite のモジュールグラフ（`import`）には載せず**静的ファイルとして配る**ため、アプリ本体の JS バンドルサイズには原則加算されない（別経路でダウンロードされる）。採用する配布物の正確な構成（最小の webapp サブセットで足りるか、フル配布物が要るか）と総配信サイズ、ライセンス表記（Apache-2.0 の NOTICE 同梱）は実装初手のスパイクで確定する（§14 D-DRAW-HOST）。
- **オフライン前提**: セルフホスト同梱により編集・閲覧とも外部ドメイン非依存で、オフライン（3b）でも作図・閲覧が成立する。3a はサーバーモードでの編集・閲覧を主対象とするが、この成果は 3b がそのまま再利用できる（「3a で作ったものがオフラインを阻害しない」ことを保証する）。
- **閲覧レンダリング（要件 3A-DRAW-4）— 手段を確定する**: 閲覧は編集と切り離し **フロント完結**を優先する。保存 XML から図を描画する手段を、**diagrams.net 由来の mxGraph ビューア `GraphViewer`（`viewer.min.js` 相当・Apache-2.0）を「閲覧専用アセット」としてフロントに同梱し、`DrawioViewer` が `data-drawio` の XML を描画する**方式に **確定** する。この同梱物はビューア専用（編集 webapp とは別の軽量配布物）で、閲覧時に外部サービスへ一切出ないため 3b（オフライン）でも再利用でき、foundation の「レンダリングはフロント」方針に整合する。
  - **「保存時に SVG を併持する」代替案は不採用**とする。SVG 併持は本文に XML 以外のデータを持つか別アセット依存を生み、**要件 3A-DRAW-5 の不変条件「保存データは XML テキストのみで完結」と矛盾**するためである。閲覧は常に保存済み XML から `GraphViewer` が描画し、保存形式は XML テキスト 1 本に保つ（この両立を本書で明文として閉じる）。
  - **ライセンス / bundle posture（非機能 3・軽量性ポリシー）**: `GraphViewer`・編集 webapp ともに Apache-2.0 で同梱・自前配信が可能。公開ドメイン（外部 CDN 等）には実行時依存しない。閲覧ビューア（`viewer.min.js` 相当・比較的小）とフル編集 webapp（大）は配布物として独立に評価し、閲覧側は軽量に保つ。詳細な posture（採用配布物の構成・総サイズ上限・NOTICE 同梱）は §14 `D-DRAW-VIEW`/`D-DRAW-HOST` で確定する。
  - **実装初手のスパイク（必須、CAD と同様）**: 実装の最初のタスクで「(1) 同梱 `GraphViewer` が本文中の XML 単体（別アセット・外部参照なし）から閲覧描画できる、(2) 同梱 draw.io webapp が自オリジンから `embed=1` で起動し `postMessage` 往復で XML を保存/読込できる、(3) 追加配信サイズが許容範囲」をスパイクで確認する。スパイクの受け入れ基準: 代表 XML を外部参照ゼロで描画できること、閲覧ビューア追加分が目標サイズ（例: gzip 数百 KB 級）に収まること。不成立の場合は §14 `D-DRAW-VIEW`/`D-DRAW-HOST` へ戻し、保存形式 XML のみは崩さない前提で代替（別の軽量 mxGraph ビューア等）を選定する。

### 6.4 保存経路と権限

draw.io の保存は **既存 `updatePage`/`createPage`（内部 `save_page_body`）を通る本文編集**であり、新しい保存系契約・エンドポイントを増やさない（要件 3A-DRAW-2、StorageClient 追加 3）。本文変更としてリビジョンに記録され（P2-8）、描画の変更履歴もページ履歴として追える。権限は既存ページ view/edit がそのまま適用される（要件 3A-DRAW-7）。

---

## 7. 地図 GUI 編集（要件 3A-MAP）と記法シリアライズ

### 7.1 記法シリアライザ（`parse-map.ts` の逆関数）

地図 GUI 編集の核心は「GUI の編集状態（`MapData`）から `:::custom-map` 記法テキストを生成し、既存 `buildMapData`（`parse-map.ts`）が同一の `MapData` に読み戻せる」往復無損失性（要件 3A-MAP-2）である。これを新規 `frontend/src/markdown/custom-map/serialize-map.ts`（`serializeMapData(mapData): string`）に実装する。**`parse-map.ts` は変更しない**（記法仕様の正は foundation 側）。

生成する記法は既存コンテナ属性・マーカー・写真のみを用い、属性名・意味・既定値・クランプ範囲を変えない（要件 3A-MAP-3）。`parse-map.ts` と `map-utils.ts` の読み取り規則に厳密整合させる具体仕様:

- **コンテナ属性行**: `:::custom-map{folder=... cx=... cy=... scale=... restore=... rotate=... link=... pinSize=... labelSize= ... <map 参照>}`。
  - `folder` は基準フォルダ（`baseFolderPath`）を出力。空なら省略。
  - 数値属性（`cx`/`cy`/`scale`/`restore`/`rotate`/`pinSize`/`labelSize`）は `MapData` の値をそのまま出力。既定値と一致する属性は省略してもよい（`buildMapData` が既定で補完するため往復で保たれる）。`rotate` は `normalizeRotate` 済み値（0/90/180/270）、`pinSize`/`labelSize` はクランプ範囲内の値を出力する。
  - **マップ画像参照は必ず「等号形式のディレクティブ属性」で出力する（コロン形式を使わない）**。理由（レビュー指摘 1、実機確認済み）: `buildMapData` はコンテナのマップ参照を `node.attributes`（= `remark-directive` が解釈した属性オブジェクト）から読む。`remark-directive` はコンテナのブレース `{...}` 内を **`key="value"` の等号形式のみ**解釈し、`filename:"..."` のコロン形式を書くと **ディレクティブ自体のパースに失敗して `containerDirective` ノードが生成されない**（実機で確認: 等号形式→`{"folder":"maps","filename":"plan.svg"}`、コロン形式→`NO containerDirective`）。コロン形式（`filename:`/`alias:`）が受理されるのは `parseAttrEntries` を通る **マーカー行・写真子リストのみ**で、コンテナ属性ブレースには適用されない。既存テスト・README のコンテナ参照はすべて等号形式。したがって `AssetSpecifier.kind` → コンテナ属性キーの対応を次に固定する:
    - `kind:'filename'` → `filename="..."`（短縮 `file="..."`。既定は `filename`）
    - `kind:'alias'`   → `aliasname="..."`（短縮 `alias="..."`。既定は `aliasname`）
  - **出力は 1 指定子のみ（既定、レビュー指摘 2）**: マップ参照は filename か alias の**どちらか一方だけ**を出力する（要件 3A-MAP-4「二重指定を避ける」・foundation 14-11 と整合）。`MapData.assetRef.specifiers` が複数指定子を持つ場合は**代表 1 件に正規化**して出力する（正規化規則: `specifiers` の先頭要素を採用。GUI は 1 参照しか作らないため実害がない）。これにより `node.attributes`（プレーンオブジェクト、`Object.entries` の挿入順に依存し仕様保証のない順序）経由の **出現順の往復不確定性を消し、往復を決定的にする**。複数指定子を併記する運用（出現順保存）は 3a スコープ外とし DECISION-NEEDED D-MAP-MULTISPEC で据え置き確認する。
  - 出力例（コンテナ）: `:::custom-map{folder="本館/2F" cx="30" cy="70" rotate="270" filename="plan.svg"}`。
  - **マップ参照なし（`specifiers` 空）の扱い（レビュー指摘 5）**: `MapData.assetRef.specifiers` が空（GUI でマップ画像を未選択、または既存ブロックに参照属性が無い場合）のときは、`filename`/`aliasname`（短縮 `file`/`alias`）等の **マップ参照属性を一切出力しない**。空の `filename=""` のような空属性も出さない。`folder` ほかのコンテナ属性のみ出力する。実コードの `buildMapData` は属性が無ければ `makeAssetRef(...)` が `specifiers: []` を返す（`entriesFromAttributes` が参照キーを拾わないため）ので、「属性非出力 → 読み戻しで空 `specifiers`」の往復が無損失で成立する（要件 3A-MAP-2 は「参照なし」でも成立すべき）。出力例（参照なし）: `:::custom-map{folder="本館/2F" cx="30" cy="70"}`。
  - 既定は基準フォルダ運用で、個別参照にスラッシュを含めない（上書きは行わない。DECISION-NEEDED D-MAP-SLASH で据え置き確認）。
- **マーカー行**: トップレベル箇条書き `- x=.. y=.. label="..." desc="..." color="..."`。`parse-map.ts` の `parseMarkerLine` は `x` または `y` があればマーカーと認識する。`label`/`desc`/`color` は値があるときのみ出力（空は省略可、`buildMapData` が既定補完）。
- **写真子リスト**: マーカー配下のネスト箇条書き `- filename="..." desc="..."` または `- alias="..." desc="..."`。写真行・マーカー行は `parseAttrEntries` を通るためコロン形式・等号形式の双方が受理されるが、**一貫性のため写真子リストも等号形式**で出力し、既存パーサテスト（`alias="entrance.jpg"` 等）と同形に揃える。`parsePhotoLine` が指定子を要求するため、各写真は filename か alias の一方を必ず出力する。

### 7.2 特殊文字のエスケープ整合（要件 3A-MAP-6）

`parse-map.ts` の `readAttrValue`/`unescapeAttr` の読み取り規則に厳密に対応するエスケープを `serialize-map.ts` に実装する。読み取り側の規則は:

- 引用符付き値（`"..."` / `'...'`）内では `\"`/`\'` のみがアンエスケープ対象（`unescapeAttr` は `\\(["'])` を `$1` に戻す）。
- 既存記法で `|` は改行表現（`CustomMapViewer.withLineBreaks` が `|` を `\n` に変換）。

したがってシリアライズ側は:

1. すべての属性値を **ダブルクォートで囲んで出力**する（空白・`/`・`:` を含む値でも安全。`readAttrValue` が引用符内を 1 トークンとして読む）。
2. 値中の `"` と `\` を `\"`/`\\` にエスケープする（`unescapeAttr` の逆。ラベルに `"` を含んでも往復で保たれる）。
3. 値中の改行（`\n`）は `|` に変換して出力する（既存の改行表現と整合。閲覧時に `withLineBreaks` が復元）。生の改行を属性値に書くと記法行が壊れるため必須。
4. `desc` 等に `|` 自体を literal で入れたいケースは 3a では非対応（改行表現が優先。DECISION-NEEDED D-MAP-PIPE で据え置き確認）。

これにより GUI 入力値がパーサを壊さないことを保証する。往復テスト（ラベルに `"`・改行・`/`・`:` を含む）で検証する（9 章 T-MAP）。

### 7.3 既存記法の取り込みと非破壊編集（要件 3A-MAP-7）

GUI 編集は既存ページの本文を扱う際、次の方針で未知/手書き記述を不用意に破壊しない。

- **ブロック単位の往復**: GUI は本文中の `:::custom-map` ブロックを 1 つ選び、`buildMapData` で `MapData` 化して GUI 状態に取り込む。保存時はそのブロックだけを `serializeMapData` の出力で置換し、**ブロック外の本文テキスト（他の段落・他ブロック・手書き Markdown）はそのまま保持**する。本文全体の再生成はしない。
- **ブロック境界の特定**: 編集対象ブロックの本文内オフセット（`:::custom-map` 開始行〜対応する `:::` 終了行）を保持し、その範囲のみ差し替える。複数の `:::custom-map` がある場合は編集対象のインデックスで区別する。
- **GUI 対象外属性の保持**: `buildMapData` が解釈する属性はすべて `MapData` に入るため、往復で保持される。`buildMapData` が無視する未知属性については、1 ブロックの往復では GUI が扱う属性のみ再出力する（最低限、GUI が扱うブロック外の本文は保持する、という要件の下限を満たす）。未知属性の完全保存は 3a スコープ外とし、DECISION-NEEDED D-MAP-UNKNOWN で据え置き確認する。

### 7.4 GUI コンポーネントと保存経路

- 新規 `frontend/src/markdown/custom-map/MapEditor.tsx`（または `pages/` 配下の編集補助コンポーネント）を追加する。マップ画像（アセット）を `AssetClient.listFolders`/`listAssets`/`resolveAssetUrl` で選択・プレビューし、画像上クリックでマーカー配置・ドラッグ移動・削除、各マーカーの `label`/`color`/`desc`/`x`/`y` を編集する（要件 3A-MAP-1）。座標系・クランプ・色選択は既存 `map-utils.ts` を流用する。
- 既存閲覧用 `CustomMapViewer`・`parse-map.ts` は変更しない（表示は不変、追加は編集 UI のみ・要件 3A-MAP-8）。
- 保存は専用経路を設けず、`PageEditPage` 内で `serializeMapData` の出力を本文へ反映し、既存 `updatePage`/`createPage`（内部 `save_page_body`）を通す（要件 3A-MAP-5）。地図変更はリビジョンに記録される。
- 新規ページ作成フロー内での地図初期設定の作り込みは最小でよい（要件 3A-MAP-8。既存ページ編集での GUI 生成/更新を主対象とする）。

---

## 8. 現場写真添付（要件 3A-PHOTO、サーバーモード）

- マーカーへの参考写真追加は、GUI（`MapEditor`）から **端末上の既存画像ファイルを選択してアップロード**し、既存 `AssetClient.uploadAsset`（フォルダ指定・任意 alias・フォルダ内一意・重複 409）で独立アセットライブラリへ登録する（要件 3A-PHOTO-1/2）。**新しいアップロード経路を増やさない**（CAD のみ変換経路が別）。
- 登録後、その参照を当該マーカーの写真子リスト（`filename:`/`alias:` + `desc`）として `serializeMapData` が記法に出力する（7.1 の写真子リスト仕様）。
- 保存は地図 GUI 編集と同じく `save_page_body` 経由でページ本文として保存する（要件 3A-PHOTO-3）。
- 表示は既存 `resolveAssetUrl`・`CustomMapViewer` の写真ポップアップをそのまま用いる（表示側不変・要件 3A-PHOTO-4）。
- **端末カメラ API による撮影は 3a スコープ外**（要件 3A-PHOTO-5、3b へ）。3a の写真添付 UI は「ファイル選択（`<input type="file">`）」を前提とし、撮影 UI（`capture` 属性やカメラ起動）を作り込まない。この分割を UI 上も意識する。
- 写真アップロードはアセット権限ポリシー（ページ権限の対象外・認証のみ、P2-5-7）に従う（要件 3A-PHOTO-6、CAD と同じ据え置き・U-3A-2）。

---

## 9. StorageClient 契約への追加（`frontend/src/storage/types.ts`）

既存メソッドシグネチャを破壊せず **追加のみ** で拡張する。ローカルモード（3b）が同契約を満たせる抽象度を保つ（foundation 要件 1）。

### 9.1 コメント契約（新 `CommentClient`）

```ts
export interface Comment {
  id: number
  body: string
  author: User | null
  created_at: string
  updated_at: string
}

export interface CommentClient {
  listComments(path: string): Promise<Comment[]>            // 作成日時昇順・全件（3a はページングなし。将来 limit/offset を追加可能）
  addComment(path: string, body: string): Promise<Comment>  // view 権限、空は 400
  updateComment(id: number, body: string): Promise<Comment> // 本人/edit/管理者、他は 403
  deleteComment(id: number): Promise<void>                  // 同上
}

export interface StorageClient extends AuthClient, PageClient, AssetClient, SearchClient, PermissionClient, CommentClient {}
```

指定子は数値 `id`（phase2 `PermissionClient` と同流儀。`updateComment`/`deleteComment` は id、`listComments`/`addComment` は path）。`RestClient` に 4 メソッドを実装する（既存の `fetch` + `toApiError` パターン踏襲。403 は status で自然に区別、空本文の 400 も `ApiError` で throw）。

### 9.2 CAD 変換（契約追加なし — クライアント内ユーティリティ + 既存 `uploadAsset`）

CAD 変換はブラウザ内で完結し、**`StorageClient`/`AssetClient` 契約には新規メソッドを追加しない**（旧設計の `uploadCadAsset` は廃止）。契約面での CAD 変換は次の 2 つの既存/新規要素の合成で表現する:

- **変換**: `frontend/src/markdown/custom-map/cad/convert.ts` の `convertCadToSvg(file, orientation)`（§5.2）。これは `StorageClient` ではなく、記法シリアライザ（`serialize-map.ts`）と同じ**フロント内ユーティリティ**として置く（契約に載せない）。
- **登録**: 変換結果 SVG（`File` 化）を **既存 `AssetClient.uploadAsset({ folderId, file, alias })`** で登録する（追加なし）。

この構成の利点は、サーバー非関与という事実を契約に漏らさないこと、および 3b（ローカル）が `convertCadToSvg`（純フロント）と `uploadAsset`（ローカル実装）をそのまま再利用して端末内変換を成立できること（要件 3A-CAD-8、StorageClient 追加 2/5）。したがって本フェーズの `StorageClient` 契約追加は **コメント（`CommentClient`）のみ**で、既存シグネチャは不変（検証項目 16）。

### 9.3 draw.io・地図 GUI・写真は契約追加なし

- draw.io・地図記法の生成/パースは **フロント内ユーティリティ**（`serialize-map.ts`/`serialize-drawio.ts`/`remark-drawio.ts`）として実装し、契約には載せない。保存は既存 `updatePage`/`createPage`、写真は既存 `uploadAsset` で足りる（StorageClient 追加 3/4）。

---

## 10. マイグレーション戦略

- `0005_comment.py` を追加（`Comment` モデルの `CreateModel` のみ）。既存 `0001`〜`0004` は変更しない。additive-only で、既存 `Page`/`Folder`/`Asset`/`PagePermission`/`Revision` のスキーマ・データを一切変えない（非機能 1）。
- `Comment.page` の FK（CASCADE）・`author` の FK（SET_NULL）・`created_at`/`updated_at`・`ordering`・インデックス（`created_at` db_index）は、既存 `Revision` の `0003`/`0004` と同じ Django 標準表現で生成する。SQLite 固有機能に依存しない（非機能 4）。
- CAD 変換・draw.io・地図・写真はモデルを足さないため追加マイグレーションは不要。CAD 変換はブラウザ内で完結しサーバー設定（旧 `JANUS_CAD_CONVERTER`）も追加しない。
- 既存データ（フェーズ 1/2 で作成された Page/Revision/Asset/Permission）は `0005` 適用後も保全される。`0005` は後方互換で、ロールバック（`migrate api 0004`）でコメントテーブルを落とすだけで既存機能に影響しない。

---

## 11. エラーハンドリング方針（統合）

既存の DRF `{ detail }` 形式・`RestClient.toApiError` 変換に一貫して乗せる。機能別の失敗条件・回復性・ログは各章に具体化済み（コメント=3.1/3.2、CAD=5.5）。横断方針:

- **入力検証**: コメント本文（空・空白・上限）、既存 `uploadAsset` の filename/alias 一意はサーバーで検証し 400/409 を返す。CAD 変換の入力検証（サイズ上限・拡張子・エンティティ数・破損）は**ブラウザ内の変換ユーティリティが型付きエラーで担う**（サーバー非関与）。フロント検証は CAD については一次防衛そのものであり、コメント等サーバー検証がある機能では補助。
- **権限拒否**: ページ系は既存ヘルパの 403（秘匿時 404）、コメント編集/削除は常に 403、アセット系は認証のみ（401 は既定権限）。
- **CAD 変換の失敗**（§5.5）はブラウザ内で完結し、型付きエラー（`CadTooLargeError`/`CadUnsupportedError`/`CadTooManyEntitiesError`/`CadConversionError`/`CadEngineUnavailableError`）→ フロントの明確なエラー表示 + 「通常画像/SVG アップロードへの案内」で表現する（HTTP ステータスを用いない）。登録段で起きる 409（重複）のみ既存 `uploadAsset` の `ApiError`（409）分岐を再利用する。
- **ログ**: CAD 変換失敗はブラウザ内で完結し CAD 本文をネットワークに出さない（本番では詳細ログを残さず、ユーザー向けメッセージのみ）。サーバー側ログはコメント等の既存方針どおり（通常の入力エラー 400/404/409 はログしない）。
- **フロント**: `ApiError.status`/`detail` で分岐（既存 `PageEditPage` の 409 分岐パターン踏襲）。401 は既存 `usePageError`（logout + /login 誘導）。

---

## 12. テスト戦略

既存の約 145（backend）/ 約 132（frontend）テストを回帰ゼロで通し続けることを必須とする（非機能 1、検証項目 17）。検証は SQLite・`/home/kawakin/git/knowledge-base/janus/.venv/bin/python`（backend）と Vitest（frontend）で行う。

**バックエンド（新規 `tests_comments.py` のみ、既存 `tests_assets.py` 流儀）**: CAD 変換はブラウザ内で完結しサーバー側に新規エンドポイントが無いため、**バックエンドの CAD テスト（旧 `tests_cad.py`）は不要**。CAD 変換後 SVG の登録は既存 `AssetListCreateView` のテスト（`tests_assets.py`、回帰で担保）がカバーする。

- T-C-1 view 権限のある利用者がコメント投稿でき、body・created_at・author が記録される（201）。
- T-C-2 一覧が view 権限で作成日時昇順に取得でき、権限なしは 403（`JANUS_HIDE_FORBIDDEN` 時 404）。
- T-C-3 投稿者本人・edit 権限者・管理者（superuser）は編集/削除でき、無関係な一般利用者は 403。**（レビュー指摘 1）** コメント編集系の拒否は `JANUS_HIDE_FORBIDDEN` の値に関わらず **常に 403**（秘匿 404 を経由しない）であることを、`override_settings(JANUS_HIDE_FORBIDDEN=True)` と既定（False）の双方で固定する（`require_page_permission` 経由のページ編集系が秘匿時 404 を返すのとは異なる挙動）。
- T-C-4 ページ削除でコメント連動削除、投稿者ユーザー削除でコメントが残り author が null 化。
- T-C-5 コメント操作後に `Page.body`・最新リビジョン・`Page.updated_at` が不変（本文・履歴非干渉）。
- T-C-6 空・空白のみ・上限超過の body は 400。**（レビュー指摘 6）** 境界ケースとして、`strip()` 前の `len()` が **ちょうど 10,000 文字は 201**、**10,001 文字は 400** を明記して検証する。あわせて「前後空白込みで `len()` が 10,000 を超えるが `strip()` 後の中身は 10,000 以下」の値が上限超過（400）になること、`strip()` 後が空の値が 400 になることを固定する。
**フロント（Vitest、純ユーティリティ中心で単体テスト容易）**:

- T-CAD-1（`cad/convert.test.ts` / `jww-to-svg.test.ts` / `dxf-to-svg.test.ts`）: 既知寸法の最小 DXF（および可能なら最小 JWW フィクスチャ）を `convertCadToSvg` に通し、SVG 文字列が得られること（`<svg ... viewBox>` を含む、`image/svg+xml` の `File` に包める）、filename が `.svg` 正規化されることを検証。向き 0/90/180/270 で `viewBox` が回転後の外接矩形になり**どの向きでも図形がクリップされない**（回転後 `viewBox` が内容境界を包含）ことを、既知座標入力に対する境界ボックス比較で検証する。生成 SVG に `<script>`/`foreignObject`/外部参照が含まれないことを確認する。DXF は純 JS でフィクスチャを作れるため単体化しやすい。JWW（`ezjww`/WASM）はテスト環境での WASM 初期化可否に依存するため、WASM 不要な部分（統一入口の振り分け・サイズ/エンティティ上限・エラー型）を優先的に単体化し、実変換はスパイク/手動確認で補う。
- T-CAD-2（`cad/convert.test.ts`）: 失敗分岐がブラウザ内で正しい型のエラーになること — 入力サイズ上限超過→`CadTooLargeError`、未対応拡張子→`CadUnsupportedError`、エンティティ数上限超過→`CadTooManyEntitiesError`、破損/座標不正→`CadConversionError`。いずれの失敗でも `uploadAsset` を呼ばない（アップロード前に throw する）ことをモックで確認し、**サーバー側に副作用が発生しない**ことを担保する。
- T-CAD-3（`AssetLibraryPage.test.tsx` 等）: 変換成功時に生成 SVG が既存 `uploadAsset` で登録され（`image/svg+xml` の `File`・`.svg` filename）、失敗時に通常アップロード案内のエラー表示が出ること。登録後の SVG が既存 `resolveAssetUrl`/`<img>` 表示で解決できる（既存解決の非破壊）。
- T-ASSET-PERM: CAD 変換後 SVG の登録・写真アップロードが既存 `uploadAsset` 経由であり、認証のみ（ページ権限非干渉・P2-5-7 据え置き）で成立する（既存 `uploadAsset` の権限挙動の回帰で担保）。

- T-MAP（`serialize-map.test.ts`）: `MapData` → `serializeMapData` → `buildMapData` の往復無損失。**必須検証**として、(1) コンテナのマップ参照が**等号形式**（`filename="..."`/`aliasname="..."`／短縮 `file=`/`alias=`）で出力され、`buildMapData` が同一 `MapData` に読み戻せること（レビュー指摘 1。コロン形式では `containerDirective` が生成されないため等号形式でなければ往復不成立）、(2) 複数指定子を持つ `MapData` が**代表 1 件に正規化**されて出力され往復が決定的であること（レビュー指摘 2）を含める。(3) **マップ参照なし（`specifiers` 空）の往復**として、`specifiers` が空の `MapData` が参照属性を一切出力せず（空属性も出さない）、`buildMapData` が空 `specifiers` に読み戻すこと（レビュー指摘 5）を含める。加えてラベルに `"`・改行・`/`・`:` を含む値、複数マーカー・写真子リスト（等号形式）、既定値省略の往復を検証（要件 3A-MAP-2/6、検証項目 11/12）。
- T-DRAW（`serialize-drawio.test.ts` / `remark-drawio` 単体）: XML（引用符・改行・` ``` ` 含む）の往復、`MarkdownRenderer` が `:::drawio` と既存 `:::custom-map`・GFM を共存描画し壊れない（生 HTML 無効維持、検証項目 9/10）。**必須検証**として、(1) **XML 本文に行頭 `:::` を含むケース**がコンテナを早期終了させず往復で保たれること（レビュー指摘 3、コードフェンスによる `:::` 無害化の実機確認済み前提を回帰ガードする）、(2) **XML 本文に ` ``` ` を含むケース**で開閉フェンスが 4 連バッククォートへ拡張され往復で保たれることを含める。
- T-REST（`rest-client.test.ts` 追加）: `listComments`/`addComment`/`updateComment`/`deleteComment` が正しい URL・メソッド・body を叩き、403/400/409 を `ApiError` に変換する。CAD 変換は契約に載せず既存 `uploadAsset` を使うため、`uploadAsset` の既存テストが SVG 登録もカバーする（CAD 専用の REST テストは不要）。

**テスト容易性の評価**: 記法シリアライズ・CAD 変換（`convertCadToSvg` と向き焼き込み）・コメント権限ヘルパはいずれも純関数/薄いビューに切り出せるため単体テストしやすい。CAD 変換は副作用（アップロード）を持たない純関数（`File`→SVG 文字列）として設計したため、変換ロジック・向き焼き込み・失敗分岐を Vitest で単体化できる（アップロードはモックした `uploadAsset` で検証）。`ezjww`（WASM）実変換はテスト環境の WASM 初期化に依存するため、WASM 不要部分を優先単体化し実 JWW 変換はスパイク/手動確認で補う。draw.io 編集エディタ（同梱 iframe + postMessage）と同梱 `GraphViewer` 閲覧は外部配布物依存のため、エディタ連携は `postMessage` ハンドラ単位で単体化し、実描画はスパイク/手動確認に回す。この分割が成立する設計であることを確認した（重い外部依存を UI 連携層の裏に隔離できている）。

---

## 13. foundation / phase2 との関係（重複・矛盾・所有）

- **要件の具体化**: 本書は foundation 要件 7/8/9/3-4/3-5 を 3a として実装レベルに具体化する。foundation・phase2 の要件書・設計書は変更しない。
- **コメントの連動/null**: foundation 要件 7-4（ページ削除で連動削除）を 2.1 の `on_delete=CASCADE` で踏襲、投稿者削除時 null 化は phase2 `Revision.author` SET_NULL と同方針。
- **CAD 変換とアセット**: 「変換は登録手段の一つ」「元 CAD は保持しない」を 3.3/5 章で確定。本フェーズでは**変換をブラウザ内で行い**（サーバー非関与）、登録のみ既存 `AssetClient.uploadAsset`（既存 `AssetListCreateView`）を使う。一意制約・重複 409・物理フラット保存・権限は既存ビューがそのまま所有し、CAD 用のバックエンド追加（エンドポイント・変換依存・設定）はしない。新規モデルはコメントのみ。foundation 要件 8-3 の「ローカル = 事前変換取り込み」はブラウザ変換により「端末内直接変換」へ改善（§5 冒頭）。
- **描画 XML の保持場所と提供方式**: foundation design 11 章の未決（コードフェンス or 専用ディレクティブ）を本書 6.1 で **専用ディレクティブ `:::drawio`** に確定・ロック。エディタ・ビューアは **セルフホスト同梱**（6.3、外部ドメイン非依存）に確定。保存は phase2 `save_page_body` 経由。
- **地図記法の所有**: `:::custom-map` 記法仕様の正は foundation `parse-map.ts`。GUI（`serialize-map.ts`）はそれに従属し記法を変えない。`parse-map.ts`/`CustomMapViewer` は非変更。
- **権限の所有**: ページ view/edit 判定は phase2（`permissions_logic`/`require_page_permission`/`check_permission`）が所有。本フェーズは流用のみで新判定規則を作らない。アセット非干渉（P2-5-7）も据え置き。
- **保存単一経路の所有**: 本文を変える操作（地図 GUI・draw.io・写真紐付け）は phase2 `save_page_body` の単一経路を通す。別の本文保存経路を作らない。コメントは本文ではないため `save_page_body` を通さず専用ビューで扱う（本文・リビジョン非干渉）。
- **フェーズ 2 後続改善は不干渉**: 権限付与 UI のユーザー名/グループ名指定、新規ページ作成フロー内の初期権限設定は、ユーザー合意どおり本フェーズでは扱わない（参照のみ）。
- **完了状態の非上書き**: フェーズ 1/2 の受入基準・既存テストを覆さない。本書は既存挙動を変えず追加のみ。既存挙動変更は生じない（すべて additive）。

---

## 14. DECISION-NEEDED（確定事項の記録と、残るスパイク項目）

本節はユーザー確認済みの確定事項（CONFIRMED）と、確定方針の下で実装初手に残る実機スパイクを記録する。CAD/draw.io の主要方針はユーザー確認により確定済みであり、残るのは「確定方針が実機で成立するか」の検証（スパイク）のみ。

- **D-CAD（U-3A-3）— CONFIRMED（ブラウザ変換）**: CAD→SVG 変換は **ブラウザ（フロントエンド）で行い、サーバーは変換に一切関与しない**。対象は **.jww（主）/.dxf の両方**。JWW=`ezjww`（WASM）、DXF=`dxf-parser`+`iconv-lite`。座標変換・向き焼き込み・色/線種・viewBox は参考実装（`jww-to-svg.js`/`dxf-to-svg.js`）から移植、`config.js` 相当は Janus 側に定義（§5.1）。追加フロント依存 `ezjww`/`dxf-parser`/`iconv-lite`。旧「サーバー `ezdxf` 変換・`CadConverter` Strategy・`AssetCadConvertView`・`JANUS_CAD_CONVERTER`」は**廃止**。
- **D-CAD-STATUS（U-3A-7）— CONFIRMED（HTTP ステータス不要）**: CAD 変換はブラウザ内で完結しサーバーエンドポイントを持たないため、失敗は **HTTP ステータスではなくフロントのエラー表示**で表現する（§5.5）。旧 D-CAD-STATUS（400/422/503 割当）は廃止。
- **D-DRAW-FORMAT（U-3A-4）— CONFIRMED**: draw.io XML の保持形式は **専用ディレクティブ `:::drawio`（内部にコードフェンスで XML）** で確定（既存 `:::custom-map` と一貫、生 HTML 無効維持、複数図・同期非阻害、§6.1/§6.2）。
- **D-DRAW-HOST（U-3A-5）— CONFIRMED（セルフホスト同梱）**: 編集エディタ・閲覧ビューアともに **diagrams.net（Apache-2.0）をセルフホスト同梱**し、実行時に外部ドメイン（公開 `embed.diagrams.net`）へ接続しない（§6.3）。オフライン編集・閲覧が成立し 3b が再利用できる。公開埋め込みは不採用。
- **D-DRAW-VIEW（U-3A-5 系）— CONFIRMED（同梱 `GraphViewer`）＋残スパイク**: 閲覧は **同梱 `GraphViewer`（Apache-2.0・公開ドメイン非依存）が XML 単体から描画**する方式で確定。「保存は XML テキストのみ（3A-DRAW-5）」の不変条件は維持し、SVG 併持案は不採用。残るのは実装初手の**スパイク**: (1) 同梱 `GraphViewer` が外部参照ゼロで代表 XML を描画できる、(2) 同梱 draw.io webapp が自オリジンから `embed=1` で起動し `postMessage` 往復できる、(3) 追加配信サイズが許容範囲（閲覧ビューア追加分の目標上限を実測）。不成立時は保存 XML のみを維持したまま代替の軽量 mxGraph ビューアを選定する。
- **D-COMMENT-RENDER（U-3A-6）— CONFIRMED**: コメント本文は **プレーンテキスト扱い**（`dangerouslySetInnerHTML` を使わず React テキストノードで描画。XSS 経路を作らない、§2.2）。
- **D-COMMENT-POST（U-3A-1）— CONFIRMED**: コメント投稿は **view 権限で可**、編集/削除は **投稿者本人 or edit or 管理者**（§3.1/§3.2、現設計どおり）。
- **D-ASSET-PERM（U-3A-2、セキュリティ境界）— CONFIRMED（据え置き）**: CAD 変換後 SVG の登録・写真を含むアセット操作を **フェーズ 2 どおりページ権限の対象外（認証のみ）** に据え置く。`/api/assets/<id>/file` 直リンクで認証ユーザーがアセットを取得しうる点は**セキュリティ上の明示事項として据え置く**（将来の専用課題）。本フェーズでアセット単位権限を新設しない。
- **D-MAP-SLASH / D-MAP-PIPE / D-MAP-UNKNOWN / D-MAP-MULTISPEC（据え置き・CONFIRMED 既定）**: (1) 個別参照にスラッシュでフォルダ上書きするか（確定: 基準フォルダ運用のみ）、(2) `desc` に literal `|` を許すか（確定: `|` は改行表現を優先し literal 非対応）、(3) `buildMapData` が無視する未知属性の完全保存（確定: 1 ブロック往復で GUI 扱い属性のみ再出力、ブロック外本文は保持）、(4) マップ参照に複数指定子（filename と alias の併記・出現順保存）を出力するか（確定: **1 指定子のみ出力し代表 1 件に正規化**。往復を決定的にするため）。いずれも既定で 3a を進め、必要なら後続で拡張（CONFIRMED）。

---

## 15. 設計レビューの指摘への応答

本節は設計レビュー（`design-review.json` 判定 `CHANGES_REQUESTED` / `design-review.md`）への応答を記す。全 7 件（HIGH 1・MEDIUM 2・NIT 4）を本改訂で処理した。HIGH/MEDIUM は要件の最重要検証項目（往復無損失・共存非破壊）に直結するため、要件・実コードに照らして**すべて修正で対応**した。スコープ境界（3a/3b/将来の分割、ユーザー合意メッセージ 11）を変える指摘は無く、本改訂はいずれも 3a 内の設計精緻化であって合意済み境界を動かさない。

- **指摘 1 [HIGH] — 対応: 修正**（§7.1）。マップ画像参照を**等号形式のディレクティブ属性**（`filename=`/`aliasname=`、短縮 `file=`/`alias=`）で出力するよう改めた。実コード `buildMapData` は `node.attributes`（`remark-directive` が等号形式のみ解釈）からコンテナ参照を読むことを再確認し、さらに `remark-parse`+`remark-directive` の実機で「等号形式→属性取得成功、コロン形式→`containerDirective` 不生成」を確認した（本改訂の検証で再現）。写真子リストも一貫性のため等号形式に統一。T-MAP に「等号出力→同一 `MapData` 読み戻し」を必須検証として明記。これで要件 3A-MAP-2（往復無損失）・検証項目 11 が成立する。
- **指摘 2 [MEDIUM] — 対応: 修正（推奨案 (a) を採用）**（§7.1）。マップ参照は **1 指定子のみ出力**（複数指定子は代表 1 件＝`specifiers` 先頭に正規化）とし、`node.attributes` 経由の出現順不確定性を排除して往復を決定的にした。要件 3A-MAP-4「二重指定を避ける」と整合。複数併記（出現順保存）は D-MAP-MULTISPEC として据え置き（GUI は 1 参照しか作らず実害なし）。T-MAP に正規化の往復検証を追加。
- **指摘 3 [MEDIUM] — 対応: 修正**（§6.2）。`:::drawio` コンテナ内に XML をコードフェンスで格納する方式が、XML 中の行頭 `:::` でコンテナを早期終了させない根拠を明記した。`remark-parse`+`remark-directive` の実機で、XML に `:::foo should not close` を含んでもコンテナは早期終了せず（`drawio container found: true`）`code` ノードに全文保持されることを確認（本改訂の検証で再現）。T-DRAW に「XML 本文に行頭 `:::` を含む往復」と「` ``` ` を含む往復（4 連バッククォート拡張）」を必須検証として追加。前提が将来崩れる場合のフェンス長動的化／Base64 代替も記載。
- **指摘 4 [NIT] — 対応: 修正**（§3.3）。`assets/convert` を `assets/<int:pk>` より前に配置する規約（既存 `pages/permissions/<pk>` を前に置く順序依存と同様）を明記した。実 `urls.py` の配置順を確認済み（`assets` → `assets/<int:pk>` → `assets/<int:pk>/file`）。
- **指摘 5 [NIT] — 対応: 修正**（§5.1）。`ezdxf` 単体（matplotlib 非導入）の `.dxf`→SVG 出力を**実装初手のスパイクで確認し、不成立なら D-CAD の代替へ戻す**ことを明記した。`.venv` に `ezdxf` 未導入であることは本環境でも再確認済み。本件は D-CAD（新規依存承認）に紐づく非ブロッキング事項。
- **指摘 6 [NIT] — 対応: 修正**（§5.3 / T-CAD-1）。90/270（および 180）度で `viewBox` の min-x/min-y・width/height を回転後の内容外接矩形に合わせ再計算し**図形をクリップしない**ことを要件化。T-CAD-1 に各向きの内容境界保持（境界ボックス比較）観点を追加。
- **指摘 7 [NIT] — 対応: 修正（全件返却を明記）**（§3.1 / §9.1）。3a はコメント一覧を全件・作成日時昇順で返し、**ページングは将来課題**であること、必要時に `listRevisions` と同じ `limit`/`offset` を後方互換で追加できることを明記した。

**検証した実コード/実機事実（本改訂時）**: (1) `parse-map.ts` の `buildMapData` がコンテナ参照を `node.attributes` から `makeAssetRef(entriesFromAttributes(...))` で読むこと、`COLON_KEYS` が `parseAttrEntries`（マーカー/写真行）でのみ効くこと。(2) `remark-parse`+`remark-directive` 実機で等号/コロンの差（コロンはコンテナ不生成）と、コードフェンス内 `:::` の無害化。(3) 既存 `parse-map.test.ts` のコンテナ参照が全て等号形式であること。(4) `urls.py` の既存ルート順。これらにより HIGH/MEDIUM の修正が要件・実装に接地していることを確認した。

スコープ境界の変更を要する指摘は無かったため、`send_message`（severity warning）によるユーザー確認は不要と判断した。残る DECISION-NEEDED（§14）は推奨案と根拠を付した非ブロッキング確認項目である。

---

## 16. 設計レビュー（第 2 ラウンド）の指摘への応答

本節は第 2 ラウンドの独立レビュー（`design-review.json` 判定 `CHANGES_REQUESTED` / `design-review.md`、MEDIUM 2・LOW 4）への応答を記す。全 6 件を本改訂で処理した。いずれも 3a 内の設計精緻化であり、ユーザー合意済みのスコープ境界（3a/3b/将来の分割、メッセージ 11/12）を動かさないため、`send_message`（warning）によるユーザー確認は不要と判断した。第 1 ラウンド応答（§15）はそのまま保持する。

- **指摘 1 [MEDIUM] — 対応: 修正**（§3.2）。コメント編集/削除を「常に 403」とする根拠が実コードと不一致だった点を訂正した。実コード `PagePermissionDetailView.patch`/`delete` は `require_page_permission(request, entry.path, "edit")` を経由し `_denied_response(settings.JANUS_HIDE_FORBIDDEN)` により **既定 403・秘匿運用時 404** を返す（`permissions.py`・`views.py` で確認済み）。したがって「既存編集系も常に 403」という接地は誤りだった。改訂では、コメント編集系は **`require_page_permission` を使わず** `can_modify_comment` が False のとき固定 403 を返すこと、投稿者本人判定・`check_permission(edit)` のいずれも 404 すり替えを経由せず `JANUS_HIDE_FORBIDDEN` の影響を受けないことを明記し、T-C-3 に「秘匿 ON/OFF 双方で無関係ユーザーの PATCH/DELETE が 403（404 でない）」固定を追加した。
- **指摘 2 [MEDIUM] — 対応: 修正（推奨案 (a) を採用）＋ DECISION-NEEDED 追加**（§6.3 / §14）。draw.io 閲覧レンダリング手段を **同梱 mxGraph `GraphViewer`（Apache-2.0）で XML 単体から描画**する方式に **確定**し、「保存時 SVG 併持」案は **要件 3A-DRAW-5（保存は XML テキストのみ完結）と矛盾するため不採用**と明文化した。ライセンス（Apache-2.0・公開ドメイン非依存）と bundle posture を記し、実装初手で「XML 単体描画・bundle 影響」を `D-CAD` 同様のスパイクで確認するタスクを置いた。閲覧手段の最終 posture 確認として §14 に **`D-DRAW-VIEW`**（閲覧レンダリング手段・推奨案・ライセンス・bundle・XML のみ不変条件との両立・スパイク計画）を独立 DECISION-NEEDED として追加した。これで「保存は XML のみ」と閲覧手段の両立が明文で閉じた。
- **指摘 3 [LOW] — 対応: 修正**（§5.5 / T-CAD-2）。CAD 変換成功後の 409（重複）で孤児 SVG を残さない順序を明記した。(1) 変換後 SVG を物理保存する前に既存ビューと同じ `.exists()` 事前重複チェックを行い、重複なら保存せず 409、(2) 競合で `IntegrityError` 捕捉時は既存ビューと同じく `asset.file.delete(save=False)`、という二段構えを `AssetListCreateView.post`（実コードで確認）から踏襲する。T-CAD-2 に「変換成功後 409 でもアセット未登録・物理 SVG 未保存（孤児なし）」を追加した。
- **指摘 4 [LOW] — 対応: 修正**（§3.3）。`AssetCadConvertView` が `AssetSerializer(asset, context={"request": request})` で既存ビューと同一形状（`url` を含む）を返すことを明記した。実コードの `AssetListCreateView` が `context={"request": request}` 付きでシリアライズすることを確認済みで、コンテキストを落とすと `url` が壊れる点を注記した。
- **指摘 5 [LOW] — 対応: 修正**（§7.1 / T-MAP）。`specifiers` が空（マップ参照なし）のとき、マップ参照属性を一切出力せず（空属性も出さない）`folder` ほかのコンテナ属性のみ出力することを明記した。実コード `makeAssetRef`/`buildMapData` が属性非存在時に `specifiers: []` を返すことを確認し（`parse-map.ts`）、「属性非出力 → 空 `specifiers` 読み戻し」の往復無損失（要件 3A-MAP-2 の「参照なし」）が成立することを示した。T-MAP に「参照なし（specifiers 空）の往復」を追加した。
- **指摘 6 [LOW] — 対応: 修正**（§2.2 / T-C-6）。コメント本文上限 10,000 文字のカウント基準を確定した。**上限は `strip()` 前の受領文字列の `len()`（コードポイント数、改行も 1 文字）で 10,000**、**空判定は `strip()` 後が空か**で行う、と基準を分離した。T-C-6 に「ちょうど 10,000 文字は 201・10,001 文字は 400」の境界ケースと、「前後空白込みで上限超過」「`strip()` 後空は 400」を明記した。

**検証した実コード事実（本改訂時）**: (1) `PagePermissionDetailView.patch`/`delete` が `require_page_permission(entry.path, "edit")` 経由で `_denied_response(JANUS_HIDE_FORBIDDEN)`（既定 403・秘匿 404）を返すこと（`views.py`/`permissions.py`）。(2) `check_permission` が応答生成せず bool を返し superuser バイパスを含むこと。(3) `AssetListCreateView.post` が `.exists()` 事前チェック＋`IntegrityError` 時 `asset.file.delete(save=False)` の二段構えで孤児を防ぎ、`AssetSerializer(asset, context={"request": request})` を返すこと。(4) `parse-map.ts` の `makeAssetRef` が参照属性なしで `specifiers: []` を返し、`buildMapData` が常に `makeAssetRef` を通ること。これらにより本改訂の 6 件が要件・実装に接地していることを確認した。

---

## 17. ユーザー確定事項による改訂（CAD ブラウザ変換・draw.io セルフホスト同梱）

本節は、設計レビュー APPROVED 後にユーザー確認で確定した 2 つの大きな方針転換（CONFIRMED-1/2）を本設計に反映した改訂を記録する。**この改訂は §15/§16 および `design-review.md`/`design-review.json` が前提としていた旧 CAD 設計（サーバー側 `ezdxf` 変換・`AssetCadConvertView`・`/api/assets/convert`・`JANUS_CAD_CONVERTER`・D-CAD-STATUS）を上書き・廃止する**。§15/§16 と旧レビューはその旧設計に対する履歴記録として残すが、CAD/draw.io に関する現行の正は本 §17 と改訂済みの §1/§3.3/§5/§6.3/§9.2/§11/§12/§14 である。

- **CONFIRMED-1（CAD = ブラウザ変換）**: CAD→SVG 変換を**フロントエンド（ブラウザ）で実行**し、サーバーは変換に一切関与しない。対象は .jww（主）/.dxf、`ezjww`（WASM）/`dxf-parser`+`iconv-lite` を参考実装から移植。変換後 SVG は既存 `uploadAsset` で登録。失敗はフロントのエラー表示 + 通常アップロード案内（HTTP ステータス不要）。性能/ハング対策としてサイズ上限・エンティティ数上限・ローディング表示・（可能なら）Web Worker を規定。SVG は既存の `<img>`（Blob URL）表示で XSS 安全。旧サーバー変換章（§5）・CAD エンドポイント（§3.3）・契約 `uploadCadAsset`（§9.2）・D-CAD-STATUS（§14）を全面置換。foundation 要件 8-3 は「事前変換取り込み」から「端末内直接変換」へ改善。
- **CONFIRMED-2（draw.io = セルフホスト同梱）**: 編集エディタ・閲覧ビューアともに diagrams.net（Apache-2.0）をセルフホスト同梱し、実行時に外部ドメインへ接続しない。公開 `embed.diagrams.net` は不採用。保存形式は `:::drawio` 内コードフェンスの XML テキストのみ（D-DRAW-FORMAT 確定、不変）。閲覧は同梱 `GraphViewer`、編集は同梱 webapp を自オリジンから `iframe` + `postMessage` で起動。bundle/配信サイズと実機成立は実装初手のスパイクで確認。§6.3・§14（D-DRAW-HOST/D-DRAW-VIEW）を同梱方針で確定。
- **CONFIRMED-3（アセット権限据え置き）**: アセットはページ権限非干渉（認証のみ）を維持（§4・§14 D-ASSET-PERM）。`/api/assets/<id>/file` 直リンク露出はセキュリティ上の明示事項として据え置き。現行設計テキストを維持。
- **その他の CONFIRMED**: D-COMMENT-RENDER（プレーンテキスト）・D-COMMENT-POST（投稿=view、編集削除=本人/edit/管理者）・D-MAP-SLASH/PIPE/UNKNOWN/MULTISPEC（既存推奨既定）をすべて CONFIRMED として §14 に記録。

**旧レビュー NIT の帰結（本改訂での扱い）**: `design-review.md` の NIT-1（draw.io 閲覧の実現可能性）は、同梱 `GraphViewer`（D-DRAW-VIEW）＋外部ドメイン非依存のセルフホスト同梱に確定したことで、スパイク受け入れ基準（外部参照ゼロで代表 XML を描画・追加配信サイズ上限）として §6.3/§14 に取り込んだ。NIT-2（`JANUS_CAD_CONVERTER` の dotted-path 失敗挙動）・NIT-3（サーバー CAD 変換の入力サイズ/タイムアウト上限）は、**サーバー CAD 変換そのものを廃止したため消滅**（ブラウザ側のサイズ/エンティティ上限は §5.5/§5.6 で規定）。NIT-4（コメント一覧の 403/404 と「view ありページ不在 404」の区別）は CAD/draw.io 改訂と独立に有効なため、T-C-2 の検証項目として維持する（tasks.md のタスク 5 に明記）。

**スコープ境界・ユーザー確定の整合**: 本改訂はいずれもユーザーが明示確定した CONFIRMED-1/2/3 の反映であり、ユーザーの意図（JWW 主・ローカル完結・セルフホストでオフライン実用・ブラウザ不可は許容だが実行中ハングは回避）に一致する。確定事項を変える判断は含まないため、`send_message`（warning）による再確認は不要と判断した。

