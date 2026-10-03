# Janus フェーズ 2 設計書（権限管理・リビジョン）

本書は `janus-phase2/requirements.md`（要件 P2-1〜P2-16）を実装レベルに具体化する設計書である。フェーズ 1（janus-foundation）の `Page`/CRUD API・DRF Token 認証・`StorageClient` 契約・既存画面を起点に、**権限管理（要件 5）** と **リビジョン機能（要件 6）** を追加する。本フェーズはアプリケーションコードを変更せず、本書は仕様の確定のみを目的とする。実装・コミットは後続タスクで行う。

設計上の大原則は 3 つ。(1) **foundation 非破壊** — `Page`/`Folder`/`Asset` のスキーマと既存 API レスポンスの必須フィールドを変えず、新規モデル・追加フィールド・別エンドポイントで積み上げる。(2) **サーバーがセキュリティ境界** — すべての可否判定は Python 層で確定し、フロントの表示制御は補助に過ぎない。(3) **SQLite で成立し PostgreSQL 移行を阻害しない** — 権限合成はアプリ層で行い、DB 固有の再帰 CTE に依存しない。

---

## 1. 技術スタック（確定・承認後ロック）

設計承認後は以下を固定する。新規依存は追加しない。

- バックエンド: Python 3.12 系 / Django 5.2 / Django REST Framework（既存）。認証は DRF `TokenAuthentication`（既存のまま、変更なし）。
- 差分計算: Python 標準ライブラリ `difflib`（追加依存なし。要件 P2-10-4、非機能 3）。
- 権限モデル: **Janus 独自の `PagePermission` モデル**。django-guardian 等のオブジェクト権限ライブラリは採用しない（U-1 の推奨を確定、下記 10 章で理由を記録）。主体は Django 標準 `auth.User`/`auth.Group`。
- DB: SQLite を必須ターゲット、PostgreSQL は将来移行対象（ユーザー方針により後回し。要件 P2-16）。
- フロントエンド: React + TypeScript + React Router + Vite + Vitest（既存）。`fetch` のみ、追加 UI フレームワークなし（foundation 要件 13、要件 P2-14-4）。素の CSS Modules（既存 `*.module.css` 流儀）。
- 設定: 環境変数は `backend/janus/settings.py` の `env_bool`/`env_list` ヘルパで読む（既存流儀を踏襲）。

---

## 2. データモデル

`backend/api/models.py` に 2 モデルを**追加**する。既存 `Page`/`Folder`/`Asset` は変更しない。

### 2.1 `PagePermission`（権限エントリ・要件 P2-1）

| フィールド | 型 | 説明 |
|---|---|---|
| id | BigAutoField | 主キー |
| path | CharField(max_length=1000, db_index=True) | 権限を適用するパス（正規化済み）。`Page.path` への FK ではなく **文字列**で保持する（U-2: 仮想ノード許容＝実ページが無い祖先 path にも設定可能）。 |
| principal_type | CharField(choices=["user","group"]) | 主体種別 |
| user | FK(auth.User, null=True, on_delete=CASCADE, related_name="page_permissions") | principal_type=="user" のとき設定 |
| group | FK(auth.Group, null=True, on_delete=CASCADE, related_name="page_permissions") | principal_type=="group" のとき設定 |
| action | CharField(choices=["view","edit"]) | 操作 |
| effect | CharField(choices=["allow","deny"]) | 効果 |
| created_at / updated_at | DateTimeField(auto_now_add / auto_now) | 監査 |

制約（`Meta.constraints`、既存 `Folder`/`Asset` と同じ `UniqueConstraint` 流儀）:

- `UniqueConstraint(fields=["path","user","action"], condition=Q(principal_type="user"), name="pageperm_user_unique")`
- `UniqueConstraint(fields=["path","group","action"], condition=Q(principal_type="group"), name="pageperm_group_unique")`

この部分一意制約は「(path, 主体, action) 一意」（要件 P2-1-2）を SQLite・PostgreSQL 双方で成立する標準 Django 機能で表現する。重複登録時は後述のビューで 409 を返す（要件 P2-1-3、下記 5.3）。effect は一意キーに含めない（同一 (path,主体,action) で allow と deny を同時に持たせない。1 行で effect を切替える）。

主体の整合性（user/group のどちらか一方のみ非 null で principal_type と一致）は、`PagePermission.clean()`（モデルバリデーション）とシリアライザ検証の 2 層で担保する。所有層は **シリアライザ（API 入力検証）が第一防衛**、`clean()` は admin 経由の直接作成に対する保険とする。理由: API 経由の作成が主経路でありユーザー入力の検証はシリアライザに集約するのが DRF の自然な形だが、admin から直接編集される経路も存在するためモデル側にも最低限の不変条件を置く。

`SET_NULL` ではなく `CASCADE` を user/group に用いる理由: 権限エントリは「その主体が存在する前提の設定」であり、主体が消えたら設定自体が無意味になる。残すと「主体 null の権限エントリ」が実効権限計算に紛れ込み危険（安全側＝消す）。これはリビジョンの編集者 `SET_NULL`（履歴は監査のため残す）とは目的が異なるため、方針を変えることを明記する。

### 2.2 `Revision`（リビジョン・要件 P2-8）

| フィールド | 型 | 説明 |
|---|---|---|
| id | BigAutoField | 主キー |
| page | FK(Page, on_delete=CASCADE, related_name="revisions") | 対象ページ。ページ削除で連動削除（要件 P2-12-2） |
| number | PositiveIntegerField | ページ内連番（1 始まり、表示・指定用） |
| body | TextField | 本文の全文スナップショット（差分保存ではない。要件 P2-8-3） |
| title | CharField(max_length=255, blank=True) | スナップショット時点のタイトル（任意記録） |
| created_at | DateTimeField(db_index=True) | スナップショット日時。**`auto_now_add` を使わない**（バックフィルで過去日時を入れるため明示代入可能にする。下記 7 章） |
| author | FK(auth.User, null=True, on_delete=SET_NULL, related_name="authored_revisions") | 編集者。削除時 null 化で履歴を保持（要件 P2-12-1） |

制約:

- `UniqueConstraint(fields=["page","number"], name="revision_page_number_unique")` — ページ内連番の一意性。
- `Meta.ordering = ["-number"]` — 既定で新しい順（要件 P2-10-1）。
- インデックス: `(page, -number)` を複合インデックスにし、履歴一覧・最新取得を SQLite/PostgreSQL 双方で効率化（要件 P2-16-3）。

連番 `number` の採番は「同一ページの既存最大 number + 1」をトランザクション内で `select_for_update()` ロック下に決める（下記 6.1）。`created_at` の自動付与を外す代わり、新規作成経路では `timezone.now()` を明示代入する。

### 2.3 既存 `Page` との関係

`Page.body` は引き続き「最新本文のキャッシュ」として保持する（要件 P2-8-5、foundation design 3 章の想定どおり）。不変条件「最新リビジョン（`number` 最大）の body == `Page.body`」は**保存経路（ビュー層）が所有**して維持する。モデル制約では表現しない。理由: この一致はトランザクション内の処理順序で保証する性質で、DB 制約で表せない。保存経路を 1 本に集約（下記 6.1）して破れを防ぐ。

---

## 3. 権限判定アルゴリズム（セキュリティ境界の中核）

要件 P2-2〜P2-4 の合成規則を 1 つの純粋関数に集約する。配置は新規 `backend/api/permissions_logic.py`（判定ロジック）とし、DRF Permission クラス（下記 5.1）から呼ぶ。`utils.normalize_path` と同じく **DB・リクエストに依存しない純粋関数**として単体テスト可能にする（normalize_path の設計思想を踏襲）。

### 3.1 入力と出力

```
def effective_permission(
    *,
    path: str,                 # 正規化済みの対象パス
    action: str,               # "view" | "edit"
    user,                      # auth.User インスタンス
    entries: list[PermEntry],  # 事前取得した候補権限エントリ（下記 3.3）
    default_allow: bool,       # action に対応するデフォルトポリシー（P2-3）
    default_edit_allow: bool,  # edit のデフォルトポリシー（view 問い合わせ時の含意用・MEDIUM-1）
) -> bool                      # True=許可, False=拒否
```

`PermEntry` は `(path, principal_type, principal_id, action, effect)` の軽量タプル/dataclass。DB アクセスは呼び出し側で一括実行し、関数自体は純粋に保つ（一覧 API で N ページ分呼んでも DB を叩き直さない。非機能 6）。

`default_edit_allow` は常に渡す（`view` 問い合わせでも）。これは「デフォルトポリシー経由の edit 許可にも edit→view 含意を効かせる」ための引数で、MEDIUM-1 の確定に用いる（下記 3.2 ステップ 6・3.3.1）。`action=="edit"` の問い合わせでは `default_edit_allow == default_allow` となり無害。

### 3.2 合成の優先順位（固定・テストで保護）

要件 P2-4「合成順序の明確化」のとおり 3 段で決める。

1. **管理者バイパス**: `user.is_superuser` が真なら、エントリ・デフォルトに関わらず即 `True`（要件 P2-1-5・P2-3-5）。
2. **edit は view を含意（含意規則の厳密化・HIGH-3 の確定）**: `action=="view"` の判定では、同一主体・同一レベルで次の順に決める。(a) 当該レベルに **view の明示エントリ**があれば、それだけで決着する（allow/deny を view エントリ内で評価し、deny 優先）。(b) view の明示エントリが無く、かつ **edit allow** があれば allow とする（edit は view を含意）。(c) **edit deny は view を拒否しない**（edit を禁止されても閲覧は妨げない）。すなわち「view 明示 > edit allow による含意」で、`view deny` と `edit allow` が同一主体・同一レベルで併存する場合は **view 明示の deny が勝つ**（view=deny）。この規則は 3.3 真理値表 #8・#9 とテストで固定する。
3. **階層的近さ（第 1 優先）**: 対象 path とその全祖先 path（`/docs/intro` → `[/docs/intro, /docs, /]`、`utils` と同じ分解規則）について、**最も path が長い（近い）レベルから順に**評価する。あるレベルに当該主体（user 直接 or 所属 group）向けのエントリが存在すれば、そのレベルで決着し、より遠い祖先は見ない（要件 P2-2-3）。
4. **同一レベル内の具体性（第 2 優先）**: 同じレベルに user 直接エントリと group エントリが混在する場合、**user 直接を優先**して決着する（要件 P2-4-4）。
5. **同一レベル・同一具体性内の競合（第 3 優先）**: なお allow と deny が競合する（複数グループ所属で allow と deny が両方効く等）場合は **deny を優先**（要件 P2-2-4・P2-4-2、安全側）。
6. **デフォルトポリシー（含意規則をデフォルトにも適用・MEDIUM-1 の確定）**: いずれのレベルにも当該主体向けエントリが無ければデフォルトに委ねる。このとき `action=="edit"` なら `default_allow`（＝`JANUS_DEFAULT_PAGE_EDIT`）を返す。`action=="view"` なら、まず `default_allow`（＝`JANUS_DEFAULT_PAGE_VIEW`）が真ならそのまま allow を返し、**偽であっても `default_edit_allow`（＝`JANUS_DEFAULT_PAGE_EDIT`）が真なら allow を返す（edit がデフォルトで許可されるなら view も含意される。要件 P2-1-4）**。両方偽なら deny。これにより `JANUS_DEFAULT_PAGE_VIEW=False` かつ `JANUS_DEFAULT_PAGE_EDIT=True` という組合せでも「編集できるのに閲覧すると 403」という P2-1-4 違反の状態を作らない。この含意は明示 edit allow エントリ（ステップ 2(b)）とデフォルト edit 許可の両方に一貫して適用される。

擬似コード:

含意規則（ステップ 2）を自己矛盾なく表すため、「ある主体の・あるレベルでの決着」を次の補助関数 `resolve_subject_level` に分離する。この関数は「このレベル・この主体で決着するか（確定した bool）／決着しないか（None＝次の祖先へ）」の 3 値を返す。

```
def resolve_subject_level(subject_entries, action) -> bool | None:
    # subject_entries: この主体の・このレベルの全エントリ（action 問わず）
    explicit = [e for e in subject_entries if e.action == action]
    if explicit:
        # 当該 action の明示エントリで決着（deny 優先）
        return not any(e.effect == "deny" for e in explicit)
    if action == "view":
        # view 明示なし → edit allow があれば含意で allow、edit deny は view を拒否しない
        if any(e.action == "edit" and e.effect == "allow" for e in subject_entries):
            return True
    return None   # この主体・このレベルでは決着せず → 次の祖先へ


def effective_permission(path, action, user, entries, default_allow, default_edit_allow):
    if user.is_superuser:
        return True

    ancestors = ancestor_paths(path)          # 近い順: [self, ..., "/"]
    group_ids = set(user's group ids)

    for level in ancestors:                   # 近い祖先から
        level_entries = [e for e in entries if e.path == level]
        # user-direct = principal_type=="user" かつ principal_id==user.id（NIT-2）
        user_entries  = [e for e in level_entries
                         if e.principal_type == "user" and e.principal_id == user.id]
        # group       = principal_type=="group" かつ principal_id が所属グループ集合に含まれる（NIT-2）
        group_entries = [e for e in level_entries
                         if e.principal_type == "group" and e.principal_id in group_ids]

        # 同一レベル内の具体性: user 直接 > group（P2-4-4）
        decided = resolve_subject_level(user_entries, action)
        if decided is not None:
            return decided
        decided = resolve_subject_level(group_entries, action)
        if decided is not None:
            return decided
        # このレベルに該当主体のエントリが無ければ次の（遠い）祖先へ

    # 全レベルで決着せず → デフォルトに委ねる（含意規則をデフォルトにも適用・MEDIUM-1）
    if action == "view" and not default_allow and default_edit_allow:
        return True        # view デフォルト不許可でも edit デフォルト許可なら view を含意（P2-1-4）
    return default_allow
```

`group_entries` の `resolve_subject_level` 内 `explicit` に複数グループ由来の allow と deny が混在する場合は `any(deny)` により **deny 優先**（P2-4-2、安全側）。`user_entries` が決着すれば `group_entries` は見ない（具体性優先、P2-4-4）。

**POST（新規作成）での対象 path（HIGH-1 の確定）**: 新規作成の edit 判定は、**作成予定の正規化済み path をそのまま対象 path として同一関数で評価する**（`effective_permission(path=new_path, action="edit", user=user, entries=..., default_allow=JANUS_DEFAULT_PAGE_EDIT, default_edit_allow=JANUS_DEFAULT_PAGE_EDIT)`）。親 path を別途算出して渡すことはしない。理由: (1) `effective_permission` は「渡した path 自身＋その全祖先」を評価するので、新規 path をそのまま渡せば新規 path 自身への先行権限エントリ（仮想ノード、U-2）と親階層継承の双方が自動的に効く。(2) 親 path だけを渡すと新規 path 自身レベルの明示エントリを見落とし、仮想ノード設定（U-2）と挙動が食い違う。ルート直下（トップレベル）作成でも `ancestor_paths(new_path)` が最遠 `/` まで評価し、該当エントリが無ければ `JANUS_DEFAULT_PAGE_EDIT` に委ねる。「親階層に対する edit」という要件 P2-5-3 の文言は、「新規 path を対象に評価した結果、自身への明示エントリが無ければ祖先（＝親階層）の継承で決まる」という意味に確定する。

### 3.3 真理値表（テストで固定する代表ケース）

対象 `/docs/intro`、ユーザー `alice`（group `editors` 所属）、action=`view`、default_allow=True を基準に:

| # | `/docs/intro` のエントリ | `/docs` のエントリ | 期待 |
|---|---|---|---|
| 1 | （なし） | （なし） | **allow**（デフォルト） |
| 2 | （なし） | user alice view deny | **deny**（祖先 deny が継承） |
| 3 | user alice view allow | user alice view deny | **allow**（近いレベルが勝つ・P2-2-3） |
| 4 | （なし） | user alice view deny | **deny**（親非公開を継承） |
| 5 | user alice view allow | user alice view deny（親で deny） | **allow**（子の明示 Allow が親 Deny に優先・P2-6-3） |
| 6 | group editors view allow かつ user alice view deny（同レベル） | — | **deny**（同レベルで user 直接が優先、その user が deny・P2-4-4） |
| 7 | group editors view allow かつ group readers view deny（同レベル・両方所属） | — | **deny**（同レベル同具体性で deny 優先・P2-4-2） |
| 8 | user alice edit allow のみ（view 問い合わせ） | — | **allow**（view 明示なし＋edit allow の含意・P2-1-4、HIGH-3-(b)） |
| 9 | user alice view deny かつ user alice edit allow（同レベル・同主体、view 問い合わせ） | — | **deny**（view 明示 deny が edit allow の含意より優先・HIGH-3-(a)） |
| 10 | user alice edit deny のみ（view 問い合わせ） | — | **allow**（edit deny は view を拒否しない。view 明示も無いので #1 と同じくデフォルトに委ね default_allow=True→allow・HIGH-3-(c)） |

default_allow=False（非公開運用）では #1・#10 が **deny** に変わる（#10 は view 明示が無くデフォルトに委ねるため）。ただし default_edit_allow=True を併用する組合せ（下記 3.3.1）では #1・#10 は再び **allow** になる（デフォルト edit 許可の含意）。この表を `tests_permissions.py` にそのまま移植する。

### 3.3.1 デフォルトポリシー経由の edit→view 含意（MEDIUM-1 の確定・テストで固定）

要件 P2-1-4「edit は view を含意」は、明示 edit allow エントリ（3.2 ステップ 2(b)）だけでなく **デフォルトポリシー経由の edit 許可にも適用する**。設計は `JANUS_DEFAULT_PAGE_VIEW` と `JANUS_DEFAULT_PAGE_EDIT` を独立に切替可能とする（4 章・P2-3-1）ため、両者が不整合な組合せ（view=不許可・edit=許可）に運用上到達しうる。これを「view を allow に倒す」ことで解消する（起動時に組合せを禁止する案 (b) は採らない。理由: フラグ独立性を保ち、運用者が意図的に片方だけ切替えても安全側＝「編集できるなら閲覧もできる」に落ちるため、設定ミスがロックアウトではなく含意として吸収される）。

デフォルト委任時（権限エントリで一切決着しないページ）の `view` の真理値表:

| # | `JANUS_DEFAULT_PAGE_VIEW` | `JANUS_DEFAULT_PAGE_EDIT` | view の実効 | 根拠 |
|---|---|---|---|---|
| D1 | True | True | **allow** | view デフォルト許可（従来・後方互換） |
| D2 | True | False | **allow** | view デフォルト許可 |
| D3 | False | False | **deny** | 両方不許可（純粋な非公開運用） |
| D4 | **False** | **True** | **allow** | **view デフォルト不許可だが edit デフォルト許可の含意（P2-1-4）。edit できて view できない状態を作らない** |

同じ組合せで `edit` の実効はデフォルトどおり（D4 なら edit=allow）。D4 を `tests_permissions.py` に明示ケースとして追加し、「`JANUS_DEFAULT_PAGE_VIEW=False` かつ `JANUS_DEFAULT_PAGE_EDIT=True`・権限エントリなしのページで view=allow・edit=allow」を固定する。`require_page_permission`（5.1）は view 判定時に `default_allow=JANUS_DEFAULT_PAGE_VIEW` と `default_edit_allow=JANUS_DEFAULT_PAGE_EDIT` の両方を渡す。

### 3.4 祖先パスの導出

`ancestor_paths("/docs/intro")` は `["/docs/intro", "/docs", "/"]` を返す（自身を含み、近い順）。ルート `"/"` は常に最遠の祖先として含める。**ルート自身の `ancestor_paths("/")` は `["/"]` を返す（ルートは自身のみを祖先列に持つ。最浅・ルートページ判定の境界ケース、NIT-1 の確定）。** 実装は `utils` に `ancestor_paths(path: str) -> list[str]` を純粋関数として追加する（`normalize_path` の隣に置き、同じテスト流儀でユニットテストする。`ancestor_paths("/")==["/"]` のケースを明示的にユニットテストに含める）。これは文字列処理のみで DB 固有機能に依存しない（要件 P2-16-2）。

### 3.5 候補エントリの一括取得（性能・非機能 6）

ある path 群に対する判定で必要なエントリは「対象 path と全祖先 path に設定された、当該ユーザー（と所属グループ）向けのエントリ」。一覧 API（`children`）では対象の全子ページの祖先 path 集合を 1 クエリで取得する:

```
all_paths = { p for child in children for p in ancestor_paths(child.path) }
entries = PagePermission.objects.filter(path__in=all_paths).filter(
    Q(principal_type="user", user=user) |
    Q(principal_type="group", group_id__in=group_ids)
)
```

取得後は Python 側で path 別・action 別に振り分け、各子ページに対し `effective_permission` を DB 追加アクセスなしで評価する。`path__in` は SQLite/PostgreSQL 双方で有効（要件 P2-16-3）。所属グループ ID はリクエスト毎に 1 回だけ取得しキャッシュする。

**`PagePermission`（2 FK モデル）→ `PermEntry`（単一 `principal_id`）の変換規則（MEDIUM-3 の確定・判定経路側）**: 判定関数は `PermEntry.principal_id` 1 本で user/group を照合する（3.2 擬似コードの `principal_id == user.id`／`principal_id in group_ids`）が、モデル `PagePermission` には単一 `principal_id` 列が無く `user_id`/`group_id` の 2 本に分かれる（2.1）。取得した各 `PagePermission` を判定用 `PermEntry(path, principal_type, principal_id, action, effect)` に写すとき、次の規則で単一 `principal_id` を生成する:

```
principal_id = row.user_id if row.principal_type == "user" else row.group_id
```

すなわち `principal_type=="user"` なら `user_id` を、`"group"` なら `group_id` を `principal_id` に採る。この変換は `permissions_logic`／`require_page_permission` の内部変換であり、**5.3 の `PagePermissionSerializer` の入出力マッピング（API 応答用）とは別経路**である（両者は同じ射影規則だが所有層が異なる。シリアライザは HTTP 入出力、ここは判定ロジック内部）。この 1 文を書き損なって常に `user_id` を読む等とすると、グループ経由権限が無効化され P2-4 の合成が壊れる（セキュリティ境界）。`tests_permissions.py` でグループ経由エントリが正しく `principal_id` に写り合成されることを明示的に検証する。

---

## 4. デフォルトポリシーと存在秘匿（要件 P2-3・P2-7）

`settings.py` に Janus 固有フラグを `env_bool` で追加する（既存 `JANUS_REQUIRE_AUTH` と同じ流儀）:

- `JANUS_DEFAULT_PAGE_VIEW`（既定 `True`） — view のデフォルト許可（要件 P2-3-2）。
- `JANUS_DEFAULT_PAGE_EDIT`（既定 `True`） — edit のデフォルト許可（要件 P2-3-2）。
- `JANUS_HIDE_FORBIDDEN`（既定 `False`） — 無権限時に 404 で存在秘匿するか（要件 P2-7-2、U-4）。

**既定値はすべてフェーズ 1 挙動を保つ**。権限エントリを 1 つも設定しない限り、全認証ユーザーが全ページを読み書きでき、既存テストの期待値（201/200/401/409/404）は不変（要件 P2-15-3・P2-15-4）。この後方互換が最重要の制約。

存在秘匿の応答選択は 1 箇所（`require_page_permission`）に集約する。view 権限なしのとき:

- `JANUS_HIDE_FORBIDDEN=False`（既定）→ **403**（存在を認める）。
- `JANUS_HIDE_FORBIDDEN=True` → **404**（`PAGE_NOT_FOUND_DETAIL` を流用し、本文・メタを含めない。要件 P2-7-3・P2-7-4）。

**非公開デフォルト運用での「存在を認める」の意味（MEDIUM-A の確定）**: `GET /api/pages` は「権限 → 存在」の順で判定する（5.2）。権限判定（`require_page_permission`）はページ実在を参照しないため、`JANUS_DEFAULT_PAGE_VIEW=False`（非公開運用）では、権限エントリの無い path は**実在・非実在を問わず同一応答**（`JANUS_HIDE_FORBIDDEN=False` なら両方 403、`True` なら両方 404）になる。したがって要件 P2-5-1 の 403 =「存在を認める」は、**デフォルト公開運用（`JANUS_DEFAULT_PAGE_VIEW=True`）かつ閲覧許可された実在ページに view 権限なしでアクセスした場合**に限って成り立つ。非公開デフォルトでは実在・非実在が同じ応答に畳まれる（これは存在露出を避ける意図した挙動で、P2-6-5 と整合する）。

**書き込み系の秘匿挙動（MEDIUM-C の確定、PUT/DELETE と POST を分離）**: edit 権限なしの書き込みは、いずれも応答本文に本文・メタを含めず detail は固定文言のみとする（要件 P2-7-4）。応答コードは次のとおり:

- **PUT / DELETE**（既存ページの更新・削除）: 既定 **403**、`JANUS_HIDE_FORBIDDEN=True` のとき **404**（既存リソースの存在を秘匿する意味がある）。
- **POST**（新規ページ作成）: `JANUS_HIDE_FORBIDDEN` の値に関わらず**常に 403**。理由: POST はまだ存在しない path を作る操作で、秘匿すべき既存リソースが無く、404（存在秘匿）の意味が成り立たないため（5.2 POST 行と整合）。POST だけが PUT/DELETE と非対称になるのは意図した差である。

---

## 5. REST エンドポイントと権限適用

既存 `backend/api/views.py` の `APIView` + `urls.py` の `path(...)` 流儀をそのまま踏襲する（ViewSet/Router は導入しない）。

### 5.1 認可の配置方針（ビュー内一本化・MEDIUM-B の確定）

**view/edit の認可判定は独自 DRF Permission クラスを作らず、各ビューのメソッド冒頭で明示的に呼ぶ方式に一本化する**（MEDIUM-B の確定）。前レビュー改訂で `PagePermissionCheck`（`BasePermission` 派生で `has_permission` に view/edit 認可を持たせる案）と「ビュー内一本化」案の両方が併記され自己矛盾していたため、本改訂で**ビュー内一本化に確定し、独自 Permission クラスは作らない**。

- ページ系ビュー（`PageDetailView`/`PageChildrenView`/`PagePermissionView`/`PageEffectivePermissionView`/リビジョン系ビュー）の `permission_classes` は、**既存の `DEFAULT_PERMISSION_CLASSES`（`JANUS_REQUIRE_AUTH` により `IsAuthenticated`／`AllowAny`）のまま**とする。独自の `PagePermissionCheck` は定義しない。
- **401（未認証）は既存 `DEFAULT_PERMISSION_CLASSES`（`IsAuthenticated`）がそのまま担保する**（要件 P2-6-1）。新規ビューも同じ既定権限クラスを継承するため、未認証アクセスはビュー本体に入る前に 401 となる。
- **view/edit の認可（403/404 の切替を含む）は、各ビュー冒頭で判定ヘルパ `require_page_permission(request, path, action)` を 1 回だけ呼んで行う**。認可を 1 系統に集約することで、`?path=`・`request.data` からの path 解決、存在秘匿の 403/404 切替、POST の対象 path 評価（3 章「POST での対象 path」）、5.5 で固定した「権限 → 存在」の評価順序がすべて 1 箇所に収まり、二重評価（Permission クラスとビュー内判定で認可が 2 回走る事故）を避けられる。

理由: `?path=` クエリや `request.data` からの path 解決、存在秘匿の 403/404 切替は path に強く依存し、DRF Permission の `has_object_permission` にページ取得を二重化させるより、ビュー内で一貫処理する方が読みやすくテストも素直になる。メソッド→action の対応（GET→view、PUT/DELETE→edit、POST→対象 path の edit）は Permission クラスではなく **`permissions.py` の `require_page_permission` ヘルパおよび各ビュー呼び出し側**が持つ。

判定ヘルパ `require_page_permission(request, path, action) -> Response | None`（新規 `backend/api/permissions.py`）の契約:

- 入力: `request`（認証済みユーザーを含む）、正規化済み `path`、`action`（`"view"`|`"edit"`）。
- 処理: 3.5 の方式で候補エントリを一括取得し、3 章 `effective_permission(path, action, user, entries, default_allow, default_edit_allow)` を呼ぶ（`default_allow` は action に応じ `JANUS_DEFAULT_PAGE_VIEW`／`JANUS_DEFAULT_PAGE_EDIT`、`default_edit_allow` は常に `JANUS_DEFAULT_PAGE_EDIT`）。これにより view 判定でデフォルト edit 許可の含意（3.3.1・MEDIUM-1）が効く。
- 出力: 許可なら `None`、拒否なら適切な `Response`（既定 403、`JANUS_HIDE_FORBIDDEN=true` のとき 404、本文・メタを含めない固定 detail）。
- **このヘルパはページ実在を参照しない**（path・エントリ・デフォルトのみで可否を決める）。ページ存在確認は各ビューが別途行い、「権限 → 存在」の順序を守る（5.2・5.5）。
- **匿名ユーザーの扱い（MEDIUM-1 の確定）**: `JANUS_REQUIRE_AUTH=False`（`AllowAny`）運用では `AnonymousUser` がビュー本体に到達しうる。このとき `require_page_permission` は **`request.user.is_authenticated` が偽なら `effective_permission` を呼ばず、デフォルトポリシー（action に応じた `JANUS_DEFAULT_PAGE_VIEW`／`JANUS_DEFAULT_PAGE_EDIT`、view 判定では edit デフォルト許可の含意も適用）のみで可否を決める**。これにより 3.2 擬似コードの `principal_id==user.id`（匿名では `user.id` が `None`）や `user.groups` 参照という未定義経路を一切踏ませない（匿名は権限エントリの主体になり得ないため、エントリ評価を省いてデフォルトに委ねるのが整合的）。可否が偽のときの応答選択（既定 403／秘匿時 404、ただし未認証で `IsAuthenticated` が有効な場合は 401 が先行）は認証済みと同じ。

### 5.2 ページ系ビューの改修（foundation ビューに権限ゲートを追加）

既存 `PageDetailView`/`PageChildrenView` のレスポンス形状は変えず、**権限ゲートの呼び出しを追加する**だけに留める（要件 P2-8-7・P2-15）。

- `GET /api/pages?path=`: **「権限 → 存在」の順序を 5.5 と同粒度で固定する（MEDIUM-A の確定）**。(1) まず `require_page_permission(request, path, "view")` で view 可否を判定する。拒否なら `JANUS_HIDE_FORBIDDEN=False` のとき 403、`True` のとき 404 を返す（本文・メタを含めず、**この段階でページ実在を参照しない**）。(2) 通過後に `Page.objects.filter(path=path).first()` を引き、不在なら 404（`PAGE_NOT_FOUND_DETAIL`）。これにより、取得前に view を判定してから存在を確認する（要件 P2-5-1・P2-7）。
    - **非公開デフォルト時の存在漏洩に関する注記（MEDIUM-A）**: `JANUS_DEFAULT_PAGE_VIEW=False`（非公開運用）では、権限エントリの無い path は**実在・非実在を問わず同一応答**（既定 403／秘匿時 404）になる。これは意図した挙動で、むしろ「実在ページだけ別応答」になって存在が露出するのを防ぐ（P2-6-5「存在を推測させない」と整合）。したがって要件 P2-5-1 の 403 =「存在を認める」は、**デフォルト公開運用（`JANUS_DEFAULT_PAGE_VIEW=True`）かつ閲覧許可された実在ページに view 権限なしでアクセスした場合**に成り立つ意味であり、非公開デフォルトでは「存在を認める」保証は成り立たない（権限判定が存在判定より先に立つため、実在・非実在が同じ 403/404 に畳まれる）。この折り合いを 4 章にも記す。
- `PUT /api/pages?path=`: edit 判定 → 既存保存経路（下記 6.1 でリビジョン記録を内包）。拒否は既定 403／秘匿時 404、変更なし（要件 P2-5-2）。順序は GET と同じく「権限 → 存在」（edit 拒否を先に返し、通過後に Page 不在を 404）。
- `DELETE /api/pages?path=`: edit 判定 → ページ削除（リビジョン CASCADE）。拒否は既定 403／秘匿時 404。順序は「権限 → 存在」。
- `POST /api/pages`: **作成予定の正規化済み path をそのまま対象として** `effective_permission(path=new_path, action="edit", default_allow=JANUS_DEFAULT_PAGE_EDIT, default_edit_allow=JANUS_DEFAULT_PAGE_EDIT)` を評価する（要件 P2-5-3、HIGH-1 の確定。親 path を別算出しない。3 章「POST での対象 path」参照）。新規 path 自身への先行エントリ（仮想ノード）と親階層継承の双方が効き、該当エントリが無ければ `JANUS_DEFAULT_PAGE_EDIT` に委ねる。**edit 拒否時の応答は `JANUS_HIDE_FORBIDDEN` の値に関わらず常に 403 とする（MEDIUM-C の確定）**。理由: POST は「まだ存在しない path を作る」操作であり、秘匿すべき既存リソースが無い以上、存在秘匿（404）の意味が成り立たない。detail は固定文言のみで本文・メタを含めない（要件 P2-7-4）。この点で POST だけが PUT/DELETE（秘匿時 404）と非対称になるが、それは意図した差であり 4 章でも POST を分離して明記する。作成成功時に初回リビジョンを記録（下記 6.1）。
- `GET /api/pages/children?parent=`: 子集合を一括取得後、view 判定を各子に適用し、許可された子のみ返す（要件 P2-6-2・P2-6-5）。親の可視性に関わらず、直接 `?parent=` 指定された階層の見える子は返す（要件 P2-6-4）。親自体の可視性チェックはしない（親非公開でも子の明示 allow は返る＝要件 P2-6-3 を満たす）。**応答順序・応答コードの固定（MEDIUM-3 の確定）**: `children` は **指定 `parent` の存在・可視性を一切確認せず常に 200 を返し、view 判定は各子にのみ適用する**（`require_page_permission` を parent 自身に対しては呼ばない）。したがって **非実在 parent と、実在するが view 可能な子がゼロの parent は、ともに同じ空配列 `[]`（200）**を返し、両者を区別させない（要件 P2-6-4 と整合し、parent 自身の存在・可視性を漏らさない）。

  **到達導線の確定（MEDIUM-3・要件 P2-6-4 の設計委任を解消）**: `children` は **親の可視性に依存せず、指定 `parent` 直下の view 可能な子のみを返す**（中間階層が非公開でも、深い `parent` を直接指定すれば到達できる）。「自分が見える全ページを平坦に列挙する一覧 API」は **本フェーズのスコープ外**とする。要件 P2-6-4 の「許可された子に到達できる保証」は、「深い path の直接指定で `children` を発行すれば到達可能」という形で満たす。フロントは view 可能ページへの既知の入口（検索結果・ブックマーク・既知 path・直接リンク）から深い `?parent=` を発行する（UI は 8.3）。将来、平坦一覧が必要になれば新規エンドポイントとして 5 章に追加する（本フェーズでは追加しない）。

### 5.3 権限管理 API（要件 P2-1-6・P2-13）

新規 `PagePermissionView`（`path("pages/permissions", ...)`、GET/POST）と `PagePermissionDetailView`（`path("pages/permissions/<int:pk>", ...)`、PATCH/DELETE）を追加する（全 URL は 5.6 の集約表に記載）:

| メソッド | パス | ビュークラス | 動作 | 権限 |
|---|---|---|---|---|
| GET | `/api/pages/permissions?path=` | `PagePermissionView` | 当該 path の権限エントリ一覧 | 対象ページ edit or 管理者（要件 P2-1-6・P2-5-6） |
| POST | `/api/pages/permissions` | `PagePermissionView` | エントリ新規作成。(path,主体,action) 重複は **409** | 同上 |
| PATCH | `/api/pages/permissions/<id>` | `PagePermissionDetailView` | 既存エントリの effect 更新 | 同上 |
| DELETE | `/api/pages/permissions/<id>` | `PagePermissionDetailView` | エントリ削除（取消） | 同上 |

要件 P2-1-3 の「重複拒否 + 更新用 PATCH」を確定採用する。POST は重複時 409（`PagePermission` の `IntegrityError` を既存アセットビューと同じ try/`transaction.atomic`/`IntegrityError`→409 パターンで捕捉）、変更は PATCH で明示的に行う。管理 API 自体の権限は「対象 path の edit 権限または管理者」。edit 権限がない非管理者には 403。

**GET 一覧の判定順序とエントリ 0 件時の応答（NIT の確定）**: `GET /api/pages/permissions?path=` は、**先に `require_page_permission(request, path, "edit")` を評価し、拒否なら 403（`JANUS_HIDE_FORBIDDEN=true` のとき 404）を返す**（第三者が任意 path のエントリ有無を観測できないよう、認可を一覧取得より先に置く）。通過後に当該 path のエントリ一覧（`PagePermission.objects.filter(path=path)`）を返し、**0 件なら空配列 `[]`（200）**を返す（空であることは edit 権限者にのみ観測可能）。

**`PagePermissionSerializer` の入力マッピング（NIT-4 の確定）**: フロント契約の入力ボディは `{path, principalType, principalId, action, effect}`（camelCase、8.1 の `PermissionEntry` と一致）だが、モデル `PagePermission` は `principal_type` と `user`/`group` の 2 本の FK に分かれる（2.1）。シリアライザは入力 `principalId` を `principalType` に応じて次のとおり片方の FK へ落とす（既存 `FolderSerializer` の `parentId`→`parent` と同じ流儀）:

- `principalType == "user"` のとき → `user_id = principalId`、`group = None`、`principal_type = "user"`。
- `principalType == "group"` のとき → `group_id = principalId`、`user = None`、`principal_type = "group"`。

検証: `principalType` が enum 外、または `principalId` が指す user/group が実在しない場合は **400**（9.1 の入力検証規則と一致）。この「`principalId` が `principalType` 次第で別 FK に入る」規則をシリアライザが所有し、ビューは検証済みデータのみ扱う。出力（GET 一覧・8.1 の `PermissionEntry`）では逆向きに、`user_id`／`group_id` のうち非 null 側を `principalId` に、`principal_type` を `principalType` に射影して返す。

**PATCH/DELETE の判定順序（MEDIUM-2 の確定）**: `<id>` 指定のエントリ操作は、対象 path を知るためにまずエントリを読む必要がある。順序を次に固定する。
1. `<id>` で `PagePermission` を取得。**無ければ 404**（`PERMISSION_ENTRY_NOT_FOUND_DETAIL`、固定文言。本文・メタを含めない）。
2. 取得した `entry.path` に対して edit 権限（または管理者）を判定（`require_page_permission(request, entry.path, "edit")`）。拒否なら 403（既定）／`JANUS_HIDE_FORBIDDEN=true` のとき 404。
3. 通過後に PATCH（effect 更新）／DELETE（削除）を実行。

**PATCH で更新可能なフィールド（MEDIUM-2 の確定）**: `PATCH /api/pages/permissions/<id>` は **`effect`（`"allow"|"deny"`）のみを更新対象**とし、`path`・`principalType`・`principalId`・`action` が送られても**無視する**（`PagePermissionSerializer` を `partial=True` + `effect` のみ書込可フィールドに制限し、他フィールドは read-only として受理時に 400 を返さず無視する）。主体・対象・操作の変更は PATCH では行わず、**DELETE してから POST で作り直す**（これにより (path,主体,action) の部分一意制約を PATCH が再評価して衝突する事故を防ぐ。2.1 の `pageperm_user_unique`／`pageperm_group_unique` と整合）。`effect` の値自体は一意キーに含まれないため、effect 変更が unique 制約に触れることはない（2.1）。

この順序では「エントリ存在の有無（404 の発生）」が、対象 path に対する権限を持たない第三者にも観測されうる。ただし `PagePermission.id` は連番 PK であって path やタイトルを含まず、存在有無だけでは秘匿対象（ページの path 構成）を漏らさないため、存在確認を認可より先に置くことを許容する。POST 入力で与える id（`principalId`）とは別物であり、権限エントリ自身の PK は一覧 API（GET、edit 権限者のみ）経由でしか得られない点も漏洩を抑える。

### 5.4 実効権限の問い合わせ（要件 P2-13-3）

`GET /api/pages/effective-permission?path=` を追加し、現在ユーザーの当該 path に対する `{ "view": bool, "edit": bool }` を返す。フロントが UI 表示制御（編集ボタンの出し分け等、要件 P2-14-2）に使う。これはサーバー判定の結果を返すだけで、セキュリティ境界ではない（境界は各操作 API 側）。

**認可と情報漏洩の扱い（MEDIUM-1 の確定）**:
- **未認証は 401**（既存 `DEFAULT_PERMISSION_CLASSES` の `IsAuthenticated` がそのまま担保。要件 P2-6-1）。
- **認証済みユーザーは任意 path を問い合わせ可能**。view/edit 権限の有無を問わず、呼び出し自体は許可する（権限チェックで弾かない）。
- **応答は常に「問い合わせた本人の実効可否のみ」**（`{view, edit}` の 2 ブール）を返す。権限エントリの内容・主体・件数、ページの存在有無、本文・メタは一切返さない。
- **存在秘匿運用（`JANUS_HIDE_FORBIDDEN=true`）でも情報は漏れない**。権限が無ければ `{view:false, edit:false}` を返すだけで、これは秘匿の有無に関わらず同じ応答であり、「その path が実在するか」を区別させない（存在しない path でも権限の無い path でも同じ `false/false`）。したがってこのエンドポイントは秘匿運用でも 403/404 の分岐を持たず、常に 200 + `{view, edit}` を返す。

### 5.5 リビジョン API（要件 P2-10・P2-11）

**リビジョン指定子は全エンドポイントで `number`（ページ内連番）に 1 本化する（HIGH-2 の確定）**。PK（`id`）はクライアント契約の指定子に使わない（レスポンスには参考情報として含めてよいが、取得・差分・復元の指定キーは常に `number`）。理由: `number` は「このページの第 N 版」とユーザー可読で直感に合い、`id` と `number` の 2 系統を取り違える事故を無くせる。404 照合は常に `Revision.objects.filter(page=page, number=n)` で行う（PK ルックアップは使わない）。

| メソッド | パス | 動作 | 権限 |
|---|---|---|---|
| GET | `/api/pages/revisions?path=&limit=&offset=` | 履歴一覧（新しい順・ページング、本文を含まない軽量メタ） | view |
| GET | `/api/pages/revisions/detail?path=&number=<n>` | リビジョン 1 件の本文取得（指定子は `number`） | view |
| GET | `/api/pages/revisions/diff?path=&from=<n>&to=<n>` | 2 リビジョンの行単位差分（指定子は `number`） | view |
| POST | `/api/pages/revisions/restore` （body: `{path, number}`） | 復元（新リビジョンとして保存。指定子は `number`） | edit |

- 一覧（要件 P2-10-1,2）: `Revision.objects.filter(page=page).order_by("-number")[offset:offset+limit]`。`limit`/`offset` は未指定時に既定（例 limit=50）。**`limit` の上限は 200（9.1 と一致）**。上限超過・不正値は既定へフォールバックし（9.1・9 章エラー表）、400 は返さない。軽量メタ（`id`, `number`, `created_at`, `author`）のみ、`body` は含めない（`id` はクライアントが保持してよいが指定キーには使わない）。
- 1 件取得（要件 P2-10・P2-11 の前提）: `path` でページを引き、`Revision.objects.filter(page=page, number=n).first()`。無ければ 404（存在しない／別ページの `number` も `filter(page=page, ...)` で自動的に 404 になる）。
- 差分（要件 P2-10-3,4）: `from`/`to`（いずれも `number`）の `Revision.body` を `filter(page=page, number=...)` で取り出す。**`from` は Python 予約語のためローカル変数名に使えない。クエリ値は `request.query_params.get("from")` で取得し、変数名は `from_num`（対の `to` は `to_num`）等にする（NIT の確定、9.1 と整合）**。どちらかが対象ページに存在しなければ 404（要件 P2-10-5）。差分アルゴリズムは **`difflib.SequenceMatcher(None, from_lines, to_lines).get_opcodes()` に 1 本化する**（NIT-1 の確定）。`get_opcodes()` の各 `(tag, i1, i2, j1, j2)` を行単位の `{op, line}` 配列へ展開する: `equal`→対象行を `{op:"equal", line}`、`delete`→`{op:"del", line}`、`insert`→`{op:"add", line}`、`replace`→**削除行を `{op:"del", line}` 群、続いて追加行を `{op:"add", line}` 群に分解**（`op:"change"` は使わない）。JSON は `[{op:"add"|"del"|"equal", line:str}]` の配列。フロントが色分け描画する。
- 復元（要件 P2-11）: `{path, number}` で指定リビジョンの body を**通常保存経路（6.1）経由で**最新として保存。これにより重複抑制（本文一致なら no-op 成功、要件 P2-11-3）と新リビジョン作成（編集者=操作者、日時=現在、要件 P2-11-2）が自動的に満たされる。権限・存在チェックの順序は下記「restore の判定順序」で固定。指定 `number` が無い/別ページなら 404（要件 P2-11-4）。

**restore の判定順序（MEDIUM-4 の確定）**: restore は edit 専用操作なので、次の順で評価し、**権限チェックを存在チェックより先に行う**（存在を権限不足者に漏らさない）。
1. 対象ページを `path` で取得。ページ自体が無ければ 404（`PAGE_NOT_FOUND_DETAIL`）。
2. **edit 権限を判定**（`require_page_permission(request, path, "edit")`）。拒否なら既定で 403、`JANUS_HIDE_FORBIDDEN=true` のとき 404。detail は固定文言のみ（本文・メタを含めない。要件 P2-7-4）。
3. 通過後に `filter(page=page, number=n)` で指定リビジョンの存在・ページ所属を確認。不在/別ページなら 404（要件 P2-11-4）。
4. 6.1 の `save_page_body` を呼び、復元本文を新リビジョンとして保存（本文一致なら no-op 成功）。

同じ順序（権限 → 存在）を `GET revisions/detail`・`GET revisions/diff` にも適用する（view 権限を先に判定し、通過後に `number` の存在を 404 判定）。

### 5.6 追加 URL ルートの確定（`urls.py`・MEDIUM-4／NIT-2 の確定）

本フェーズで追加する全エンドポイント・ビュークラス・メソッド・権限を 1 表に集約する（5.3/5.4/5.5 に分散していたものを統合）。実装者はこの表のとおり `backend/api/urls.py` の `urlpatterns` に `path(...)` を追加する。既存の `pages/children` を `pages` より前に置く順序依存流儀（確認済み）に合わせ、**より具体的な（literal セグメントの深い）パスを先に、`<int:pk>` を含む可変パスを後に**並べる。既存 `path(...)` 行は変更しない。

| 追加 `path(...)`（URL） | ビュークラス | メソッド | 動作 | 権限 |
|---|---|---|---|---|
| `pages/permissions` | `PagePermissionView` | GET | 当該 `?path=` の権限エントリ一覧 | 対象 path の edit or 管理者 |
| `pages/permissions` | `PagePermissionView` | POST | エントリ新規作成（重複は 409） | 同上 |
| `pages/permissions/<int:pk>` | `PagePermissionDetailView` | PATCH | 既存エントリの effect 更新 | 同上（entry.path の edit） |
| `pages/permissions/<int:pk>` | `PagePermissionDetailView` | DELETE | エントリ削除（取消） | 同上 |
| `pages/effective-permission` | `PageEffectivePermissionView` | GET | 現在ユーザーの `?path=` に対する `{view, edit}` | 認証済み（任意 path 可、5.4） |
| `pages/revisions` | `RevisionListView` | GET | 履歴一覧（`?path=&limit=&offset=`、新しい順・軽量メタ） | 対象 path の view |
| `pages/revisions/detail` | `RevisionDetailView` | GET | リビジョン 1 件の本文取得（`?path=&number=<n>`） | 対象 path の view |
| `pages/revisions/diff` | `RevisionDiffView` | GET | 2 リビジョンの行単位差分（`?path=&from=<n>&to=<n>`） | 対象 path の view |
| `pages/revisions/restore` | `RevisionRestoreView` | POST | 復元（body `{path, number}`、新リビジョン化） | 対象 path の edit |

**ルーティング解決の確定事項**:

- **`revisions/get` の literal `get` を廃し `pages/revisions/detail` に統一する**（MEDIUM-4）。HTTP メソッド `GET` と紛らわしい literal セグメント `get` を避け、「1 件取得」を `detail` で表す。8.1 の `getRevision(path, number)` はこの `pages/revisions/detail?path=&number=` を呼ぶ（契約メソッド名はフロントの命名で、URL とは独立）。
- **`<int:pk>` は権限エントリ（`pages/permissions/<int:pk>`）だけに使う**。リビジョンは全て `?path=` + `number`（クエリ）で指定し、URL の可変パスセグメントにはしない（HIGH-2 の `number` 一本化と整合）。したがって `<int:pk>` の literal 併存問題（`get`/`diff`/`restore` と `<id>`）は発生しない。リビジョン系の `detail`/`diff`/`restore` は全て literal セグメントで、Django `path()` は literal 完全一致で解決するため衝突しない。
- **登録順**: `pages/permissions/<int:pk>`（具体 pk）→ `pages/permissions`、`pages/revisions/detail`・`pages/revisions/diff`・`pages/revisions/restore`（literal 深）→ `pages/revisions`（literal 浅）、`pages/effective-permission` の順で、既存の「深いものを先に」流儀に合わせる。Django の `path()` は正規表現貪欲マッチではないため致命的衝突は起きないが、可読性と既存流儀のため順序を固定する。
- 1 つの URL に複数メソッドを割り当てる APIView（`PagePermissionView` の GET/POST、`PagePermissionDetailView` の PATCH/DELETE）は、各メソッドを同一クラスのハンドラとして実装する（既存 `PageDetailView` が GET/POST/PUT/DELETE を 1 クラスに持つ流儀と同じ）。

このルート確定により、実装者はルート設計を即興で決める必要がなく、ビュークラス名・URL・メソッドが 1 対 1 に定まる。

### 5.7 アセットは対象外（要件 P2-5-7）

`FolderListCreateView`/`AssetListCreateView`/`AssetMoveView`/`AssetFileView` は**一切変更しない**。ページ権限ゲートを足さず、フェーズ 1 挙動（`JANUS_REQUIRE_AUTH` ベースの認証のみ）を維持する。アセット権限は将来拡張（U-5）。無権限ユーザーがアセット直リンク（`/api/assets/<id>/file`）で画像を取得しうる点は、**明示判定が必要なセキュリティ事項**として下記 10 章に残す。

---

## 6. 保存経路とリビジョン記録

### 6.1 保存の単一経路（不変条件の所有）

ページ保存は作成（POST）・更新（PUT）・復元（restore）の 3 入口があるが、**リビジョン記録を含む保存ロジックを 1 つのサービス関数に集約する**（新規 `backend/api/services.py` の `save_page_body(page_or_path, *, title, body, author) -> (page, created_revision_bool)`）。理由: 「`Page.body` 更新」「重複判定」「連番採番」「初回リビジョン」の整合を 1 箇所でトランザクション管理するため。3 入口がそれぞれ独自に書くと不整合（要件 P2-8-6 違反）を生みやすい。

**作成（POST）と更新（PUT/restore）で直列化方式が異なる（MEDIUM-5 の確定）**。更新/復元は既存ページ行が存在するので `select_for_update()` で行ロックして `number` 採番を直列化できる。だが**作成（POST）はロック対象の行がまだ存在しない**ため `select_for_update` は効かない。作成の同時実行の直列化は **`Page.path` の unique 制約 + `Revision` の `revision_page_number_unique` 制約の `IntegrityError`** に依存する（既存 `PageDetailView.post` が `exists()` 事前確認 + `try/IntegrityError`→409 で行っている流儀をそのまま踏襲）。同一 path への同時 POST が競合した場合、片方が `IntegrityError` を受け **409（`DUPLICATE_PATH_DETAIL`）** を返す。初回リビジョン `number=1` の二重作成も `revision_page_number_unique` が弾き、同じく 409 に落とす（作成全体が同一トランザクションでロールバック）。

アルゴリズム（`transaction.atomic()` 内）:

```
0. 作成(POST)か更新(PUT/restore)かで分岐:
     - 作成: page = Page.objects.create(path=path, title=title, body=body,
                                         created_by=author, updated_by=author)
             IntegrityError（path 重複）→ 409 で中断。
             この経路に行ロックは無く、unique 制約が直列化を担保する。
             **created_by と updated_by の両方を author に設定する**（既存
             PageDetailView.post の挙動を踏襲。MEDIUM-2 の確定、後方互換 P2-15）。
             作成分岐では以降のステップ 2・3（最新リビジョン取得・重複判定）は
             必ず「最新リビジョンなし」になるため、常にステップ 4 へ進み初回
             リビジョン number=1 を作る（6.2）。
     - 更新/復元: page = Page.objects.select_for_update().get(path=path)
             既存行をロックし、以降の number 採番を直列化する。
             **created_by は変更しない**（既存どおり、作成者を保持）。
             updated_by はステップ 4 で author に更新する。
2. 最新リビジョン（number 最大）を取得。
3. 重複判定（要件 P2-9-1）:
     if 最新リビジョンが存在し、その body == 新 body:
         # 本文不変 → 新リビジョンを作らない
         title のみ変化していれば Page.title を更新（要件 P2-9-2, U-6）
         updated_at の更新 → U-6 の確定（下記）
         return (page, created=False)
4. 本文変化あり:
     number = (最新 number or 0) + 1
     Revision.objects.create(page, number, body, title, created_at=now, author)
     Page.body = body; Page.title = title; Page.updated_by = author; Page.save()
     # created_by はここで触らない。作成分岐（ステップ 0）で既に設定済み、
     # 更新/復元分岐では既存の created_by を保持する（MEDIUM-2）。
     return (page, created=True)
```

重複判定は「直前（最新）リビジョンとの完全一致のみ」（要件 P2-9-4）。過去任意リビジョンとの一致は見ない。

### 6.2 初回リビジョン（要件 P2-8-4）

POST による新規作成成功時は、ステップ 2 の最新リビジョンが存在しないため必ずステップ 4 に入り、`number=1` の初回リビジョンが 1 件作られる。`Page.body` と初回リビジョン body は一致する（要件 P2-8-5）。新規 `Page` の `created_by`／`updated_by` はステップ 0 の `Page.objects.create(..., created_by=author, updated_by=author)` で設定済みであり（MEDIUM-2 の確定）、`PageSerializer` が出力する `created_by`／`updated_by` の値と既存 `tests_pages.py` の作成者検証（もしあれば）は従来どおり成立する。更新/復元経路では `created_by` を変更せず、`updated_by` のみ author に更新する。

### 6.3 U-6 の確定（本文不変時の挙動）

- 本文不変ならリビジョンを作らない（要件 P2-9-1、確定）。
- タイトルのみ変更は `Page.title` のみ更新し、リビジョンを作らない（要件 P2-9-2、確定）。リビジョンは「本文の履歴」と位置づける。
- **本文不変保存時の `updated_at` は更新しない**（確定）。理由: `Page.updated_at` は `auto_now=True` で `save()` の度に動くが、本文不変時はそもそも `Page.save()` を呼ばない（ステップ 3 で早期 return）。これにより「履歴に残らない保存で更新時刻だけ動く」混乱を避け、`updated_at`=「最後に本文/タイトルが実際に変わった時刻」の意味を保つ。ページ保存自体は 200 成功として扱う（要件 P2-9-3）。※タイトルのみ変更時は `Page.save()` を呼ぶため `updated_at` は動く（本文は不変だがページ内容は変わったため妥当）。

### 6.4 原子性（要件 P2-8-6・P2-12-3）

リビジョン記録と `Page` 更新は同一 `transaction.atomic()` 内で行い、片方成功・片方失敗を生じさせない。更新/復元は `select_for_update()` の行ロックで同一ページへの同時保存を直列化し、作成（POST）は行が無いため `Page.path` + `revision_page_number_unique` の unique 制約の `IntegrityError`→409 で直列化する（6.1 の作成/更新分岐、MEDIUM-5）。

**SQLite での `select_for_update()` の縮退に関する実装者向け注意（第 3 回レビュー Unverified #1 への対応・記載位置の集約）**: SQLite では行ロックが接続単位の書き込みロックに縮退し、`select_for_update()` は厳密な行ロックとしては機能しないことがある。したがって更新/復元の `number` 採番が `select_for_update()` だけで直列化されると過信してはならない。本設計では最終的な直列化を **`revision_page_number_unique` の `IntegrityError`** が担保し、同一ページへの同時更新で `number` が衝突した場合は一方が `IntegrityError` を受けてトランザクションがロールバックする（リトライまたは 409 相当の整合エラー応答）。この縮退と「最終的に unique 制約が守る」構造は 13.1 章末尾でも述べているが、実装者が 6.1 だけを読んで `select_for_update` を過信しないよう本節にも明記する。SQLite 必須条件（要件 P2-16-1）は制約で担保されるため設計変更は不要。ページ削除時のリビジョン連動削除は FK `on_delete=CASCADE` が DB トランザクション内で原子的に処理する。

---

## 7. マイグレーションと後方互換（要件 P2-15）

`backend/api/migrations/0003_phase2_permissions_revisions.py`（スキーマ）と `0004_backfill_initial_revisions.py`（データ）を追加する。既存 `0001_initial`/`0002_asset_library` は変更しない。

- **スキーマ（0003）**: `PagePermission`・`Revision` を新規追加。既存 `Page`/`Folder`/`Asset` に破壊的変更なし（カラム追加もしない。要件 P2-15-1）。
- **データ（0004・バックフィル、要件 P2-15-2）**: 既存全ページに初回リビジョン（`number=1`）を 1 件作る `RunPython` マイグレーション。body=現在の `Page.body`、title=`Page.title`、author=`Page.updated_by`（null 可）、`created_at`=`Page.updated_at`。`Revision.created_at` を `auto_now_add` にしなかったのはこのため（過去日時を正確に移植）。`apps.get_model('api','Revision')` 経由のヒストリカルモデルは実行時点の DB 状態を反映し `auto_now_add` のような自動付与フックを持たないため、`created_at` に `Page.updated_at` を**直接明示代入できる**（2.2 で `created_at` を明示代入可能に設計済み）。**`Page.updated_at` は `auto_now=True` で定義されており（foundation の `Page` モデル）、保存のたびに自動設定されるため全既存行で非 null が保証される。したがって `Revision.created_at`（非 null）へ `Page.updated_at` を無条件に代入でき、null チェックや代替値（`timezone.now()` へのフォールバック等）は不要である（NIT の確定）。**逆マイグレーション（reverse）は作成したリビジョンを削除する関数を提供する。将来のモデル変更に影響されないよう判定・生成はヒストリカルモデルで行う。
  - **本文空ページも対象（MEDIUM-6 の確定）**: `body==""` の既存ページにも必ず `number=1` を 1 件作る。重複リビジョン抑制（要件 P2-9-1）は**通常保存経路の規則であり、バックフィルには適用しない**（履歴の起点を全ページに必ず作る）。
  - **再実行冪等性（MEDIUM-6 の確定）**: 各ページについて `Revision.objects.filter(page=page).exists()` でガードし、**既にリビジョンがあるページはスキップ**する。これにより手動作成済み・部分適用後の再 migrate でも二重作成（`revision_page_number_unique` 違反）を起こさず、冪等に完了する。
- **後方互換（要件 P2-15-3,4）**: デフォルトポリシー既定（view/edit=許可）により、既存テストの期待値は不変。既存ページは初回リビジョンを得るが API レスポンス形状は変わらない（リビジョンは別エンドポイント）。
- **既存テスト期待の変更が必要な場合（要件 P2-15-5）**: 原則発生しない見込み。もし発生する場合は本書に「foundation 変更か phase2 追加か」を追記し、フェーズ 1 の受入基準を覆さない範囲に限定する。現時点で foundation の変更は行わない（すべて phase2 の追加で構成）。

---

## 8. StorageClient 契約とフロント

### 8.1 型・契約の追加（`frontend/src/storage/types.ts`、要件 P2-13）

既存インターフェースのメソッドシグネチャは**変更しない**（追加のみ、要件 P2-13-1）。

- データ型追加（指定子は `number`、作者は null 許容）:
  - `RevisionSummary { id: number; number: number; created_at: string; author: User | null }` — `author` は `SET_NULL` で null になりうる（作者削除後、要件 P2-12-1）ため `User | null`（NIT-4）。`id` は参考情報、指定キーは `number`。
  - `Revision { id: number; number: number; body: string; title: string; created_at: string; author: User | null }`（NIT-4）。
  - `DiffLine { op: 'add' | 'del' | 'equal'; line: string }`。
  - `PermissionEntry { id: number; path: string; principalType: 'user' | 'group'; principalId: number; action: 'view' | 'edit'; effect: 'allow' | 'deny' }` — `principalId` は `number`（対象 user/group の id、NIT-3）。
  - `EffectivePermission { view: boolean; edit: boolean }`。
- `PageClient` に追加: `listRevisions(path, opts?)` / `getRevision(path, number)` / `diffRevisions(path, from, to)` / `restoreRevision(path, number)`（要件 P2-13-2、指定子はいずれも `number`。HIGH-2 の 1 本化と整合）。
- 新 `PermissionClient` を定義し `StorageClient` に合成（要件 P2-13-3）: `listPermissions(path)` / `grantPermission(entry)` / `updatePermission(id, effect)` / `revokePermission(id)` / `getEffectivePermission(path)`。
- 抽象度（要件 P2-13-5・P2-13-4）: サーバー固有詳細（URL 構造等）をインターフェースに漏らさず、フェーズ 3 のローカルモード（IndexedDB）でも同契約で実装可能に保つ。REST の URL は foundation 流儀（`/api/` 配下・`?path=`・ID 指定）に揃える（上記 5 章）。

### 8.2 RestClient 実装（`frontend/src/storage/rest-client.ts`）

既存メソッド（`getPage` 等）は変更しない。新メソッドは既存の `url()`/`authHeaders()`/`toApiError()` ヘルパを使い、非 2xx を `ApiError` に変換する既存流儀を踏襲する。403 は `ApiError(status=403)` として throw（401 と区別、要件 P2-6-1）。`getRevision(path, number)`/`diffRevisions(path, from, to)` の 404（指定 `number` 不在/別ページ）は（`getPage` と違い）`ApiError` を throw する。**`getEffectivePermission(path)` の 401（未認証、5.4）は他メソッド同様 `ApiError(status=401)` を throw する**（NIT-3。UI 層でログイン誘導に用いる）。なお 5.4 のとおり `getEffectivePermission` は認証済みなら常に 200 + `{view, edit}` を返し、権限不足でも 403/404 を返さない（権限が無ければ `{view:false, edit:false}`）。したがって throw されうるのは 401（および通信障害等の非 2xx）のみ。

### 8.3 UI（要件 P2-14、最小範囲）

foundation の軽量方針（素の CSS Modules、追加フレームワークなし）を維持する。

- `PageViewPage.tsx`: マウント時に `getEffectivePermission(path)` を取得し、view なら「履歴」導線、edit なら「編集/削除/権限設定」導線を出し分ける（要件 P2-14-1,2）。セキュリティ境界はサーバー、UI は補助。
- 履歴 UI（新規 `PageHistoryPage.tsx` + ルート `/history/*`）: `listRevisions` で一覧（新しい順・ページング）、2 件選択で `diffRevisions` の結果を行単位の色分け表示、edit 権限者には各リビジョンに「このリビジョンに復元」ボタン（`restoreRevision`）。
- 権限設定 UI（新規 `PagePermissionPage.tsx` + ルート `/permissions/*`、edit 権限者/管理者のみ）: 主体（user/group）× action（view/edit）× effect（allow/deny）の一覧・付与・取消の最小フォーム（要件 P2-14-3）。権限設定は edit 権限者のみに許される操作なので、**非権限者が到達して 403 を受けた場合の文言は「編集権限がありません」に集約**する（NIT-2。権限設定不可＝edit 不足と同義として扱う）。
- エラー表示（要件 P2-14-5・P2-6-6）: 既存 `usePageError` を拡張し、閲覧系の 403 を「閲覧権限がありません」、編集系・権限設定系の 403 を「編集権限がありません」に対応付ける（401 は従来どおり logout+/login）。無権限時はページ本文・リビジョン本文を描画しない。

---

## 9. エラーハンドリング（操作別・具体）

| 操作 | 失敗条件 | 可否 | 呼び出し側が受け取る | ログ |
|---|---|---|---|---|
| GET pages | 未認証 | 回復可（ログイン誘導） | 401 | 記録しない（通常フロー） |
| GET pages | 認証済み・view なし | 回復不可（権限不足） | 403（既定）/ 404（`JANUS_HIDE_FORBIDDEN`）、本文含めず | WARNING（権限拒否は監査対象、path と user を記録、本文は記録しない） |
| GET pages | 存在しない | 回復不可 | 404（`PAGE_NOT_FOUND_DETAIL`） | 記録しない |
| PUT/DELETE pages | edit なし | 回復不可 | 403/404、本文含めず、変更しない | WARNING |
| POST pages | 親階層 edit なし | 回復不可 | 403 | WARNING |
| POST pages | 重複 path | 回復可（別 path 入力） | 409（既存 `DUPLICATE_PATH_DETAIL`） | 記録しない |
| 保存（内部） | リビジョン記録失敗 | 致命（整合崩壊回避） | トランザクション全体ロールバック→500 | ERROR（例外とともに） |
| 権限管理 POST | (path,主体,action) 重複 | 回復可（PATCH で更新） | 409 | 記録しない |
| 権限管理 PATCH/DELETE | 対象 `<id>` が不在 | 回復不可 | 404（`PERMISSION_ENTRY_NOT_FOUND_DETAIL`、順序は 5.3） | 記録しない |
| 権限管理 全般 | 対象 edit 権限なし | 回復不可 | 403（秘匿時 404） | WARNING |
| 権限管理 入力 | user/group とprincipal_type 不整合、未知 user/group id | 回復可（入力修正） | 400（シリアライザ検証エラー） | 記録しない |
| リビジョン diff/get/restore | 指定 `number` が存在しない/別ページ（`filter(page=page, number=n)` が空） | 回復不可 | 404（権限チェック通過後に判定。5.5「restore の判定順序」） | 記録しない |
| リビジョン一覧 | limit/offset が不正値 | 回復可 | **既定値へフォールバック（400 を返さない）**。既存 `_folder_id` の防御的 `int()` フォールバック流儀に合わせる（NIT-1 の確定、9.1 と一致） | 記録しない |

ログは Django 標準 logging を用い、権限拒否（WARNING）に user 名と path を残して監査性を確保する（非機能 5）。本文・リビジョン body は決してログに出さない。500 系（整合崩壊）は ERROR でスタックトレースごと記録する。

### 9.1 外部入力の検証規則

| 入力 | 必須/任意 | 型・制約 | 失敗時 |
|---|---|---|---|
| `path`（全 API 共通） | 必須 | 文字列、`normalize_path` で正規化、max 1000 | 空は `/` に畳む（既存挙動） |
| 権限 `principal_type` | 必須 | `"user"\|"group"` の enum | 400 |
| 権限 `principalId` | 必須 | 整数、実在する user/group の id | 存在しなければ 400 |
| 権限 `action` | 必須 | `"view"\|"edit"` | 400 |
| 権限 `effect` | 必須 | `"allow"\|"deny"` | 400 |
| リビジョン `number`/`from`/`to`（全て連番 number） | 必須 | 正整数（ページ内連番、HIGH-2 で `id` は使わない） | 非整数は 400、`filter(page=page, number=n)` で不在/別ページは 404 |
| 一覧 `limit` | 任意 | 正整数、既定 50、上限 200（過大要求を抑制） | 不正は既定へフォールバック |
| 一覧 `offset` | 任意 | 0 以上整数、既定 0 | 不正は 0 へフォールバック |

検証はシリアライザ（`PagePermissionSerializer` 等）が所有し、ビューは検証済みデータのみ扱う（既存 `PageSerializer` 流儀）。`limit`/`offset` のクエリパラメータは `views` 内で `int()` 変換を try で囲みフォールバックする（既存 `_folder_id` の防御的変換と同じ流儀）。

---

## 10. ユーザー判断（未確定事項の確定記録）

本フェーズは推奨案を確定して進めるが、セキュリティ・運用に影響する項目を明示する。**U-1/U-4/U-5/U-7 はセキュリティ境界に関わるため、設計レビューで最終確認する。**

- **U-1（権限モデル基盤）→ 確定: 独自 `PagePermission`**。理由: 階層継承・Allow/Deny・デフォルトポリシーという Janus 固有合成を素直に表現でき、依存を増やさず軽量方針（foundation 要件 13）に合う。django-guardian はオブジェクト権限を提供するが path 階層継承を素直に扱えず、依存が増える。*セキュリティ境界につき要レビュー確認。*
- **U-2（付与対象）→ 確定: 仮想ノード許容**。`PagePermission.path` を文字列にし、実ページが無い祖先 path にも権限を設定可能（要件 P2-2 の階層単位制御を自然に満たす）。
- **U-3（管理手段）→ 確定: Django admin + 最小 API**。`PagePermission`/`Revision` を admin に登録（既存 `admin.py` 流儀）。グループ/ユーザーの本格管理 UI はスコープ外。
- **U-4（403/404）→ 確定: 既定 403、`JANUS_HIDE_FORBIDDEN=true` で 404**。*公開範囲の秘匿性に関わるため要レビュー確認。*
- **U-5（アセット権限）→ 確定: 本フェーズ対象外**。*無権限ユーザーがアセット直リンク（`/api/assets/<id>/file`）で画像を取得しうる。ページ本文に貼られた画像の秘匿が必要な運用では問題になりうる点を、明示的なセキュリティ判定事項として残す。要レビュー確認。*
- **U-6（本文不変・タイトルのみ）→ 確定: 上記 6.3**。本文不変はリビジョン作らず `updated_at` も動かさない、タイトルのみ変更は `Page.title` 更新のみ（リビジョン作らず、`updated_at` は動く）。
- **U-7（デフォルトポリシー既定値）→ 確定: view/edit=許可**（フェーズ 1 後方互換）。*既定を非公開に倒すとフェーズ 1 挙動と既存テスト前提が変わるため、非公開運用を既定にしたい方針があれば要レビュー確認。*

---

## 11. テスト戦略と受入条件

既存のテスト構成（`tests_*.py` を機能別に分割、`APITestCase`/`SimpleTestCase`）を踏襲し、バックエンドは `python manage.py test`、フロントは Vitest（`*.test.ts(x)`）で回す。SQLite 上で全テストを検証する（要件 P2-16-1）。

### 11.1 ユニットテスト（DB 非依存・純粋関数）

- `tests_permissions.py` / `effective_permission`: 3 章 3.3 の真理値表（#1〜#10、HIGH-3 で追加した view-deny+edit-allow・edit-allow-only・edit-deny-only を含む）を default_allow の真偽両方で網羅。管理者バイパス、edit→view 含意の 3 規則（view 明示 > edit allow 含意、edit deny は view を拒否しない）、deny 優先、近いレベル優先、user>group を個別検証。純粋関数なので `SimpleTestCase` で DB なしに高速検証（`normalize_path` のテスト流儀）。
- `ancestor_paths` のユニットテスト（`utils` 隣）。

### 11.2 統合テスト（API・`APITestCase`）

- 権限マトリクス（受入 1,2,3,6,7,8,9・P2-5,P2-6）: view/edit なしの GET/PUT/DELETE/POST が 403（既定）/404（秘匿時）、未認証 401、superuser 全通過、デフォルト許可で既存同等。
- 一覧の見え方（受入 4,5・P2-6）: `children` が view 可のページのみ返す、親非公開でも子の明示 allow は返る、無権限ページの存在を漏らさない。
- リビジョン（受入 10〜18・P2-8〜P2-12）: 保存で 1 件記録・`Page.body` 一致、本文不変で増えない、新規で初回 1 件、一覧が新しい順＋ページング、diff が行単位（指定子 `number`、存在しない `number`・別ページの `number` は 404）、`SequenceMatcher.get_opcodes()` の replace が del+add に分解されること、復元が過去本文を新リビジョン化し過去を消さない、復元 no-op、復元の判定順序（権限 → 存在、秘匿時 404）、作者削除で null 化し履歴残存、ページ削除で連動削除。同時 POST 競合で 409（作成の直列化）。
- 権限管理 API（受入 19・P2-1-6）: edit 権限者/管理者のみ許可、他は 403、重複 POST は 409、PATCH で更新。
- アセット非干渉（受入 20・P2-5-7）: `/api/folders`・`/api/assets` がページ権限の影響を受けずフェーズ 1 挙動維持。
- マイグレーション（受入 22・P2-15-2）: バックフィルで既存ページに初回リビジョンが作られることを検証（`MigratorTestCase` 相当、または migrate 後のデータ検証）。

### 11.3 回帰（受入 21・P2-15-4）

既存 `tests.py`/`tests_auth.py`/`tests_pages.py`/`tests_assets.py`/`tests_integration.py` を**全て合格させ続ける**。デフォルトポリシー既定のまま期待値（201/200/401/409/404）を変えない。CI/ローカルで phase2 追加前後に全テストを実行し差分ゼロを確認する。

### 11.4 フロント（Vitest）

- `rest-client.test.ts` に新メソッド（listRevisions/diff/restore/権限系）の 403/404/成功ケースを追加（既存流儀）。
- 新画面（History/Permission）の最小テスト: 403 時に本文を描画しないこと、edit なしで操作 UI が無効/非表示になること（要件 P2-14-2,5）。

### 11.5 テスタビリティ評価

権限合成を純粋関数に切り出したことで、最も複雑なロジック（真理値表）が DB・HTTP なしに単体テスト可能になった。保存経路を 1 サービス関数に集約したことで、リビジョン記録・重複抑制・原子性を 1 箇所でテストできる。存在秘匿の 403/404 切替は設定フラグ 1 つに依存するため、設定を変えた 2 パターンのテストで網羅できる。これらは「テストしやすい設計」の指標を満たす。

---

## 12. foundation との関係（重複・矛盾の扱い）

- **すべて phase2 の追加**で構成し、foundation の requirements/design/tasks を変更しない。`Page`/`Folder`/`Asset` スキーマ・既存 API レスポンス形状・既存テストはそのまま。
- foundation design 3 章の「`Page.body` は最新キャッシュ、Revision 追加時も body を残す」想定どおりに `Revision` を追加（本書 2.3）。
- foundation design 11 章の第一候補「全文スナップショット + 表示時差分計算」を確定採用（本書 2.2・5.5）。
- foundation design 5 章の認証移行（Token→Cookie セッション）は将来拡張のまま。phase2 は Token 認証の上に権限レイヤを足すだけで `AuthClient` 契約・ログイン画面を不変に保つ。
- デフォルトポリシー・存在秘匿は foundation に無い新規定義（本書 4 章）。既定値をフェーズ 1 挙動に合わせることで既存の完了判定を覆さない。

---

## 13. 設計レビューへの対応（design-review.json / design-review.md の findings）

本章は設計レビューの各回の findings への対応を回ごとに記録する。本節（13）は**第 1 回**レビュー（CHANGES_REQUESTED、HIGH 3 / MEDIUM 6 / NIT 4）、13.1 は**第 2 回**（MEDIUM 3 / NIT 4）、13.2 は**第 3 回**（MEDIUM 4 / NIT 2）、13.3 は**第 4 回**（CHANGES_REQUESTED、HIGH 0 / MEDIUM 3 / NIT 4）に対応する。各指摘は該当改訂で**解消（Addressed）**済みで、backlog・justify-ignore とした指摘は無い。要件（requirements.md）との整合は各項に付記する。なお下表の HIGH-1・HIGH-2 の反映箇所に記す URL/呼び出し例（例 `revisions/get`、`default_edit_allow` 無しの呼び出し）は第 1 回改訂時点の記述であり、第 3 回改訂で `pages/revisions/detail` および `default_edit_allow` 引数追加に更新されている（13.2・5.6・3.1 参照）。

| ID | 対応 | 反映箇所 | 要件整合 |
|---|---|---|---|
| HIGH-1（POST の親階層評価が未定義） | **Addressed**。新規ページの正規化済み path をそのまま `effective_permission(path=new_path, action="edit", default_allow=JANUS_DEFAULT_PAGE_EDIT)` に渡すと確定。親 path は別算出しない。ルート直下作成は `/` まで評価しデフォルトに委ねる。 | 3 章「POST での対象 path」、5.2 POST 行 | P2-5-3・P2-2・U-2 と整合（仮想ノード設定が POST でも効く） |
| HIGH-2（リビジョン指定子 id/number 混在） | **Addressed**。全エンドポイントで `number`（ページ内連番）に 1 本化。`GET revisions/get?path=&number=` に変更、`diff`/`restore` も `number`。404 照合は常に `filter(page=page, number=n)`。PK は指定キーに使わない。 | 5.5、8.1 型、8.2、9.1 | P2-10-5・P2-11-4・P2-13-2 と整合 |
| HIGH-3（edit→view 含意と deny の自己矛盾） | **Addressed**。「view 明示で決着（deny 優先）→ view 明示なし＋edit allow で allow（含意）→ edit deny は view を拒否しない」の 3 規則を明文化。擬似コードを `resolve_subject_level` に分割。真理値表に #9・#10 を追加。 | 3.2 ステップ 2、3.2 擬似コード、3.3 真理値表、11.1 | P2-1-4・P2-2-4・P2-4-2 と整合 |
| MEDIUM-1（effective-permission の認可未定義） | **Addressed**。未認証 401、認証済みは任意 path 問い合わせ可、応答は本人の可否のみ、エントリ内容・存在は返さない、秘匿運用でも `{false,false}` で path 存在を漏らさない（常に 200）。 | 5.4 | P2-13-3・P2-6-1・P2-7 と整合 |
| MEDIUM-2（権限 PATCH/DELETE の順序未定義） | **Addressed**。id 取得（無ければ 404）→ `entry.path` で edit/管理者判定（無ければ 403／秘匿時 404）→ 更新/削除、の順序を固定。エラー表に行追加。 | 5.3、9 章エラー表 | P2-1-6・P2-5-6 と整合 |
| MEDIUM-3（children 到達導線が未確定） | **Addressed**。`children` は親可視性非依存で直下の view 可能な子のみ返す。平坦全件一覧はスコープ外とし「深い path 直接指定で到達可能」で要件を満たす、と確定記述。 | 5.2 children | P2-6-4 の設計委任を解消 |
| MEDIUM-4（restore の秘匿/順序未定義） | **Addressed**。restore は edit 権限判定（秘匿時 404／既定 403、detail 固定）を先、通過後に `number` の存在・ページ所属判定（不在/別ページ 404）。権限チェックを存在チェックより先に。get/diff にも同順序を適用。 | 5.5「restore の判定順序」 | P2-11-5・P2-7-4・P2-11-4 と整合 |
| MEDIUM-5（POST の select_for_update 無効） | **Addressed**。作成は行ロック不可のため `Page` unique + `revision_page_number_unique` の IntegrityError を既存流儀で捕捉し 409、更新/復元は既存行を `select_for_update` でロックして number 採番を直列化、と作成/更新を分けて明記。 | 6.1 作成/更新分岐、6.4 | P2-8-6 と整合 |
| MEDIUM-6（バックフィルの一意性・冪等性） | **Addressed**。本文空でも各ページに `number=1` を 1 件作る／重複抑制は非適用／`apps.get_model` のヒストリカルモデルは auto_now_add を持たず `Page.updated_at` を直接代入可／既存 Revision があればスキップで冪等、を明記。 | 7 章バックフィル | P2-15-2 と整合 |
| NIT-1（diff アルゴリズム併記） | **Addressed**。`difflib.SequenceMatcher.get_opcodes()` に 1 本化し、`{op, line}` 配列への変換（replace は del+add に分解、`op:"change"` 不使用）を確定。 | 5.5 差分 | P2-10-3 と整合 |
| NIT-2（権限設定 UI の 403 文言未定義） | **Addressed**。権限設定画面の 403 は「編集権限がありません」に集約（edit 不足と同義）と追記。 | 8.3 | P2-6-6 と整合 |
| NIT-3（principalId の TS 型未明記） | **Addressed**。`PermissionEntry.principalId: number` と明記。 | 8.1 型定義 | P2-13-3 と整合 |
| NIT-4（author の null 許容未記載） | **Addressed**。`RevisionSummary.author` / `Revision.author` を `User \| null` と明記（`SET_NULL` で作者削除後 null）。 | 8.1 型定義 | P2-12-1 と整合 |

いずれの対応も要件（requirements.md P2-1〜P2-16）およびフェーズ 1 の完了判定（既定ポリシーでの後方互換・既存テスト不変）を覆さない範囲に収めた。backlog（先送り）・justify-ignore（対応せず正当化）とした指摘は無い。

### 13.1 第 2 回レビュー（design-review.json: CHANGES_REQUESTED、MEDIUM 3 / NIT 4）への対応

第 2 回レビュー（HIGH 0 / MEDIUM 3 / NIT 4）の全指摘を本改訂で**解消（Addressed）**した。backlog・justify-ignore とした指摘は無い。各対応は要件（requirements.md）およびフェーズ 1 の完了判定を覆さない範囲に収めた。

| ID | 重大度 | 対応 | 反映箇所 | 要件整合 |
|---|---|---|---|---|
| MEDIUM-A（GET の存在確認×権限確認順序未確定、非公開デフォルト時の 403 と P2-5-1 の矛盾） | MEDIUM | **Addressed**。GET /api/pages を「(1) `require_page_permission(path,'view')` を先に評価し拒否なら既定 403／秘匿時 404（本文・メタなし・実在参照しない）、(2) 通過後に Page 取得し不在なら 404」に固定。併せて「非公開デフォルトでは権限なし path は実在・非実在を問わず同一応答になり、403 の〈存在を認める〉はデフォルト公開かつ閲覧許可された実在ページに限る」と 5.2 と 4 章に注記。 | 5.2 GET 行、4 章「非公開デフォルト運用での〈存在を認める〉の意味」 | P2-5-1・P2-6-5・P2-7 と整合（存在露出を避ける意図） |
| MEDIUM-B（DRF Permission クラス `PagePermissionCheck` の役割が自己矛盾し認可二重定義） | MEDIUM | **Addressed**。ビュー内一本化に確定。独自 `PagePermissionCheck` は作らず、ページ系ビューの `permission_classes` は既存 `DEFAULT_PERMISSION_CLASSES`（`IsAuthenticated`）のまま。view/edit 認可は各ビュー冒頭の `require_page_permission` に集約。`has_permission` にメソッド→action を持たせる記述は削除し、メソッド→action 対応は `require_page_permission` ヘルパ側に移した。 | 5.1 全面改稿（「認可の配置方針（ビュー内一本化）」） | P2-5-5・P2-6-1 と整合（二重評価の排除） |
| MEDIUM-C（POST の `JANUS_HIDE_FORBIDDEN` 時応答が未定義で PUT/DELETE と非対称） | MEDIUM | **Addressed**。POST の edit 拒否は `JANUS_HIDE_FORBIDDEN` に関わらず**常に 403**（新規作成に存在秘匿は無関係）、detail は固定文言のみと 5.2 POST 行に明記。4 章の一括記述から POST を分離し「PUT/DELETE は 403/既定・404/秘匿時、POST は常に 403」と整合させた。 | 5.2 POST 行、4 章「書き込み系の秘匿挙動（PUT/DELETE と POST を分離）」 | P2-5-3・P2-7-4 と整合 |
| NIT-1（`ancestor_paths("/")` の戻り値未定義） | NIT | **Addressed**。「`ancestor_paths("/")` は `["/"]` を返す（ルートは自身のみ）」を 3.4 に追記し、ユニットテストに当該ケースを含めると明記。 | 3.4 | 境界ケースの確定 |
| NIT-2（`principal_id` とグループ照合の具体式が曖昧） | NIT | **Addressed**。擬似コードに「user-direct = `principal_type=="user" and principal_id==user.id`、group = `principal_type=="group" and principal_id in group_ids`」の具体式を記載。 | 3.2 擬似コード | 中核判定ロジックの固定 |
| NIT-3（`getEffectivePermission` の 401 時フロント契約未記載） | NIT | **Addressed**。「`getEffectivePermission` の 401 は他メソッド同様 `ApiError(status=401)` を throw（UI 層でログイン誘導）」を 8.2 に追記。権限不足でも 403/404 を返さず常に 200 を返す点も再確認。 | 8.2 | 5.4・P2-6-1 と整合 |
| NIT-4（権限管理 POST の `principalId`→user/group FK マッピング未明示） | NIT | **Addressed**。「`principalType=="user"` なら `user_id=principalId`、`"group"` なら `group_id=principalId` にマップし、存在しない id は 400」と `PagePermissionSerializer` 仕様を 5.3 に確定。出力時の逆射影も明記。 | 5.3「`PagePermissionSerializer` の入力マッピング」 | P2-13-3・9.1 と整合 |

**レビューの未検証前提への留意**: レビューが「誤りではないが要注意」とした `select_for_update()` の SQLite 挙動（行ロックが接続単位の書き込みロックに縮退し no-op 気味になりうる点）は、本設計では作成経路を unique 制約の `IntegrityError`→409 で直列化し、更新/復元も最終的に `revision_page_number_unique` 違反で破れを防ぐ構造（6.1・6.4）のため、SQLite 必須条件（要件 P2-16-1）は満たす。実装時にこの縮退を認識しておく旨を本章に記録する（設計変更は不要）。

### 13.2 第 3 回レビュー（design-review.json: CHANGES_REQUESTED、HIGH 0 / MEDIUM 4 / NIT 2）への対応

第 3 回レビュー（HIGH 0 / MEDIUM 4 / NIT 2）の全指摘を本改訂で**解消（Addressed）**した。backlog（先送り）・justify-ignore（対応せず正当化）とした指摘は無い。各対応は要件（requirements.md P2-1〜P2-16）およびフェーズ 1 の完了判定（既定ポリシーでの後方互換・既存テスト不変）を覆さない範囲に収めた。

| ID | 重大度 | 対応 | 反映箇所 | 要件整合 |
|---|---|---|---|---|
| MEDIUM-1（デフォルトポリシーの edit→view 含意がフラグ独立組合せで不成立） | MEDIUM | **Addressed**。修正案 (a) を採用。`effective_permission` に `default_edit_allow` 引数を追加し、デフォルト委任時に `action=="view"` かつ `default_allow=False` かつ `default_edit_allow=True` なら view=allow を返すよう拡張（デフォルト edit 許可にも含意を適用）。起動時に組合せを禁止する案 (b) は不採用（フラグ独立性を保ち、設定ミスをロックアウトではなく安全側の含意として吸収するため）。真理値表 3.3.1（D1〜D4、特に D4）を追加しテストで固定。`require_page_permission` が view 判定時に `JANUS_DEFAULT_PAGE_EDIT` も渡すと明記。 | 3.1 シグネチャ、3.2 ステップ 6・擬似コード末尾、3.3 表の注記、**新 3.3.1**、5.1 ヘルパ契約、5.2 POST 行、11.1 | P2-1-4・P2-3-1 と整合（edit できて view できない状態を作らない） |
| MEDIUM-2（POST 時の created_by/updated_by が save_page_body で未指定） | MEDIUM | **Addressed**。6.1 作成分岐で `Page.objects.create(..., created_by=author, updated_by=author)` を明示。更新/復元分岐では `created_by` を変更せず `updated_by` のみ更新と明記。6.2 に PageSerializer 出力・既存作成者検証が従来どおり成立する旨を追記。 | 6.1 ステップ 0・ステップ 4 注記、6.2 | P2-15（foundation 後方互換）と整合 |
| MEDIUM-3（`PermEntry.principal_id` を 2 FK からどう生成するか判定経路で未定義） | MEDIUM | **Addressed**。3.5 に変換規則 `principal_id = row.user_id if principal_type=="user" else row.group_id` を 1 文で明記し、これが `permissions_logic`／`require_page_permission` の内部変換であって 5.3 シリアライザ入出力（API 用）とは別経路であることを明記。`tests_permissions.py` でグループ経由エントリの `principal_id` 変換と合成を検証すると追記。 | 3.5 | P2-4（グループ合成）と整合（セキュリティ境界） |
| MEDIUM-4（新規 URL ルートの `urls.py` 追加内容・順序・命名が未確定） | MEDIUM | **Addressed**。新 5.6 章に全追加エンドポイントの集約表（URL・ビュークラス・メソッド・権限）を新設。`revisions/get` の literal `get` を `pages/revisions/detail` に改名。`<int:pk>` は権限エントリのみに使い、リビジョンは `?path=`+`number` のクエリ指定に統一（literal 併存問題を回避）。登録順を既存「深いものを先に」流儀で固定。1 URL 複数メソッドの APIView 方針も明記。 | 新 5.6、5.3 表、5.5 表、5.5 本文、8.2 | P2-13-4 と整合（foundation の URL 流儀踏襲） |
| NIT-2（`effective-permission` が全エンドポイント一覧に集約されていない） | NIT | **Addressed**。MEDIUM-4 の集約表（5.6）に `pages/effective-permission` を含め、追加エンドポイントを 1 表で把握できるようにした。 | 5.6 集約表 | 機能影響なし（一覧性の改善） |
| NIT-1（limit/offset 不正値の扱いがエラー表と検証規則表で不一致） | NIT | **Addressed**。9 章エラー表を「既定値へフォールバック（400 を返さない）」に統一し、9.1 検証規則表（フォールバック）と一致させた。既存 `_folder_id` の防御的 `int()` フォールバック流儀に合わせる旨を明記。 | 9 章エラー表、9.1 | 既存流儀と整合 |

いずれの対応も設計書内の明確化・1〜数文の追記および URL 集約表の新設で収まり、アーキテクチャの作り直しは不要だった。セキュリティ境界に関わる MEDIUM-1（含意規則）と MEDIUM-3（グループ照合用 `principal_id` 変換）を優先して確定し、真理値表・内部変換規則・テスト固定を明記した。

**第 3 回レビューの未検証前提（Unverified / Wrong Assumptions）への対応**:
- Unverified #1（SQLite `select_for_update()` の縮退）→ 6.4 に実装者向け注意を追記（記載位置を 13.1 だけでなく保存経路の章にも集約）。設計変更は不要。
- Unverified #2（既存テストが POST の created_by/updated_by を検証するか未確認）→ MEDIUM-2 の対応（6.1・6.2）で `created_by`/`updated_by` を明示設定するため、実テストの有無に関わらず後方互換は保たれる。
- Unverified #3（difflib replace の del+add 分解の UI 挙動）→ 仕様としては 5.5・8.3 で成立。実 UI コンポーネントは実装フェーズで検証（本フェーズは仕様確定のみ）。
- Unverified #4（非公開デフォルト運用での MEDIUM-1 の影響範囲）→ MEDIUM-1 を仕様上の到達可能な欠陥として扱い、3.3.1・D4 で view=allow に倒す確定で解消。

### 13.3 第 4 回レビュー（design-review.json: CHANGES_REQUESTED、HIGH 0 / MEDIUM 3 / NIT 4）への対応

第 4 回レビュー（HIGH 0 / MEDIUM 3 / NIT 4）の全 7 件を本改訂で**解消（Addressed）**した。backlog（先送り）・justify-ignore（対応せず正当化）とした指摘は無い。いずれも既存の章番号・真理値表・擬似コードを変えない 1〜2 文の明確化で、設計方針の変更はない。各対応は要件（requirements.md P2-1〜P2-16）およびフェーズ 1 の完了判定（既定ポリシーでの後方互換・既存テスト不変）を覆さない範囲に収めた。

| ID | 重大度 | 対応 | 反映箇所 | 要件整合 |
|---|---|---|---|---|
| 1（匿名ユーザーの権限判定が未定義） | MEDIUM | **Addressed**。`JANUS_REQUIRE_AUTH=False`（`AllowAny`）運用で `AnonymousUser` が到達した場合、`require_page_permission` は `request.user.is_authenticated` が偽なら `effective_permission` を呼ばず**デフォルトポリシーのみ**で判定すると明記（view 判定では edit デフォルト許可の含意も適用）。これにより `principal_id==user.id`（`None`）や `user.groups` 参照の未定義経路を踏ませない。 | 5.1 ヘルパ契約「匿名ユーザーの扱い」 | P2-3・P2-6-1 と整合（匿名はデフォルト委任） |
| 2（権限エントリ PATCH の更新対象フィールド未確定） | MEDIUM | **Addressed**。PATCH は **`effect` のみ更新対象**とし、`path`・`principalType`・`principalId`・`action` が送られても無視する（シリアライザを `effect` のみ書込可に制限）。主体・対象・操作の変更は **DELETE + POST** で行い、部分一意制約（2.1）を PATCH が再評価して衝突する事故を防ぐと確定。 | 5.3「PATCH で更新可能なフィールド」 | P2-1-3・2.1 unique 制約と整合 |
| 3（children の parent 存在・可視性と応答順序が未固定） | MEDIUM | **Addressed**。`children` は **parent の存在・可視性を確認せず常に 200**、view 判定は各子にのみ適用、**非実在 parent と可視な子ゼロは同じ空配列 `[]`** を返すと 1 文で固定（parent 自身の存在・可視性を漏らさない）。 | 5.2 children 行 | P2-6-4 と整合 |
| 4（diff の `from` が Python 予約語である注意が無い） | NIT | **Addressed**。`from` は予約語のため `request.query_params.get("from")` で取得し、変数名は `from_num`（対は `to_num`）等にすると 5.5 diff 行に添えた。 | 5.5 差分行 | 実装注意の明確化 |
| 5（`limit` 上限 200 の記載が 9.1 のみで 5.5 と非対称） | NIT | **Addressed**。5.5 一覧行に「`limit` の上限は 200（9.1 と一致）／上限超過・不正値は既定へフォールバック」を追記し 9.1 と一致させた。 | 5.5 一覧行 | 9.1 と整合 |
| 6（バックフィルの `created_at` 代入が `Page.updated_at` 非 null 前提の根拠未記載） | NIT | **Addressed**。7 章に「`Page.updated_at` は `auto_now=True`（foundation モデルで確認）のため全既存行で非 null が保証され、`Revision.created_at` へ無条件代入でき null チェック・代替値は不要」と根拠を補った。 | 7 章バックフィル | P2-15-2 と整合 |
| 7（権限一覧 GET の認可順序とエントリ 0 件時の応答が未定義） | NIT | **Addressed**。`GET /api/pages/permissions?path=` は先に `require_page_permission(path,"edit")` を評価し拒否なら 403（秘匿時 404）、通過後に当該 path のエントリ一覧（**0 件なら空配列 `[]`・200**）を返すと固定。 | 5.3「GET 一覧の判定順序」 | P2-1-6・P2-5-6 と整合 |

いずれの対応も設計書内の 1〜2 文の明確化で収まり、既存の章番号・真理値表（3.3／3.3.1）・擬似コード（3.2）に変更はない。セキュリティ境界に関わる項目 1（匿名ユーザーのデフォルト委任）を優先して確定し、未定義経路の除去を明記した。これにより第 4 回レビューの全 findings が解消し、design.md は確定した。
