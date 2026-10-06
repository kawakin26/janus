# Janus サイドバー ページツリー 設計書

本書は `janus-sidebar-page-tree/requirements.md`（要件 ST-1〜ST-9 と非機能要件）を実装レベルに具体化する設計書である。Janus のサイドバーに `Page.path` 由来の階層ツリーを追加する。バックエンドにサブツリー一括取得エンドポイント `GET /api/pages/tree` を**新設（加算・非破壊）**し、フロントは初回に全ツリーを 1 回で取得し、展開/折り畳みをクライアント側の表示トグルで行う。既存 `GET /api/pages/children` は温存する。本書の段階ではアプリケーションコードを変更せず、設計の確定のみを行う。実装・コミットは後続ステップで行う。

設計の大原則は 4 つ。(1) **非破壊** — 既存ビュー・シリアライザ・権限ロジック・保存経路を変えず、ツリー用のエンドポイントとフロント部品を**加算**する。(2) **既存流儀への接地** — `PageChildrenView` の「直下判定ロジック」「`require_page_permission(view)` フィルタ」「`PageSummarySerializer`」「`useStorage()` 契約」「`NavItems` の配色/フォーカス流儀」「`theme-core.ts` の `localStorage` 防御運用」を一般化・踏襲する。(3) **トークン駆動 UI** — 既存 `@theme` トークンのみで装飾し、CSS Modules・アイコンライブラリを増やさない。(4) **将来拡張の予約** — `?depth=<n>`・件数ガード・遅延ロードへ移れるよう取得層を分離する。

技術スタックは本機能で**ロック**する: バックエンドは Django + Django REST Framework（既存 `APIView` 流儀）、フロントは React 18 + TypeScript + react-router-dom + Tailwind CSS v4（CSS-first）、テストは backend が Django `APITestCase`/`SimpleTestCase`、frontend が Vitest + Testing Library（per-file `// @vitest-environment jsdom`）。追加の UI フレームワーク・アイコンライブラリ・HTTP クライアントは導入しない。

---

## 1. 全体像

```
利用者操作
  │
  ├─ 初回描画 ── useStorage().getPageTree('/') ──► RestClient.getPageTree
  │                                                   │ GET /api/pages/tree?root=/
  │                                                   ▼
  │                                           PageTreeView（新規・views.py）
  │                                             - normalize_path(root)
  │                                             - サブツリー構築（path__startswith）
  │                                             - require_page_permission(view) で枝刈り
  │                                             - PageTreeNodeSerializer（新規・再帰）
  │                                                   │ ネスト JSON（1 レスポンス）
  │                                                   ▼
  │                                           PageTreeNode[]（types.ts・新規型）
  │
  └─ サイドバー（AppLayout.NavItems 直下に注入）
        ├─ PageTree（コンテナ：取得・状態・一括ボタン）
        │    ├─ expanded: Set<string>（展開中パス）
        │    ├─ localStorage: janus-sidebar-expanded（復元/保存）
        │    └─ currentPath: useLocation().pathname をヘルパで復元
        ├─ PageTreeHeader（「すべて展開」「すべて折り畳む」）
        └─ PageTreeNodeRow（再帰：マーカー ▶/▼ ＋ ページ名本体）
             ├─ マーカー click → expanded 切替（遷移なし）
             └─ ページ名 click → hasPage なら /view/<path> 遷移、仮想ノードはグレーアウト
```

---

## 2. バックエンド設計（`GET /api/pages/tree`）

### 2.1 レスポンス JSON 例（ネスト・仮想ノードを含む）

セットアップ例として、実ページが `/docs/intro`・`/docs/guide`・`/docs/intro/deep`・`/blog` に存在し、`/docs` という実ページは**存在しない**とする（`/docs` は子を持つが実体が無い＝仮想ノード）。`GET /api/pages/tree?root=/`（既定）のレスポンス:

```json
[
  {
    "path": "/blog",
    "title": "/blog",
    "hasPage": true,
    "hasChildren": false,
    "children": []
  },
  {
    "path": "/docs",
    "title": "docs",
    "hasPage": false,
    "hasChildren": true,
    "children": [
      {
        "path": "/docs/guide",
        "title": "Guide",
        "hasPage": true,
        "hasChildren": false,
        "children": []
      },
      {
        "path": "/docs/intro",
        "title": "Intro",
        "hasPage": true,
        "hasChildren": true,
        "children": [
          {
            "path": "/docs/intro/deep",
            "title": "Deep",
            "hasPage": true,
            "hasChildren": false,
            "children": []
          }
        ]
      }
    ]
  }
]
```

ポイント: トップ配列は `root`（既定 `/`）の直下。`/docs` は `hasPage=false`（仮想ノード）だが `hasChildren=true`。`title` は実ページがあればそのタイトル（例 `Intro`/`Guide`/`Deep`）、無ければパス末尾セグメント（`/docs` → `docs`）。並び順はパス文字列昇順（既存 `children` の `order_by("path")` 流儀）で、各階層内でも昇順に並べる。

### 2.2 フィールド定義

| フィールド | 型 | 定義 |
|---|---|---|
| `path` | string | ノードの正規化済み絶対パス（`normalize_path` 済み）。一意。 |
| `title` | string | `hasPage=true` なら `Page.title`、`hasPage=false` なら `path` の末尾セグメント（`path.rsplit("/",1)[-1]`。ルート直下の仮想ノードでも必ず非空）。 |
| `hasPage` | boolean | 当該 `path` に実ページ（`Page`）が存在するか。UI の仮想ノード判定（グレーアウト）に必須。 |
| `hasChildren` | boolean | 当該ノードが子ノードを持つか（`len(children) > 0` と常に一致）。 |
| `children` | Node[] | 子ノード配列（再帰）。葉は `[]`。 |

**`hasChildren` 冗長性の結論**: `hasChildren` は `children` 空判定（`children.length > 0`）と**論理的に等価**であり、全階層を 1 レスポンスで返す本設計では厳密には冗長である。それでも**明示フィールドとして残す**。理由は 2 つ: (1) 将来 `?depth=<n>` で途中打ち切り（子が省略されても「子がある」ことを UI に伝える必要が出る）に備える前方互換、(2) フロントがマーカー表示要否を `children.length` の再帰計算に依存せず `hasChildren` 1 フィールドで判定でき、意図が明瞭。初期実装では両者は常に一致する（テストで固定）。

### 2.3 新規クラス名と配線

- **View**: `backend/api/views.py` に `PageTreeView(APIView)` を新規追加（既存 `PageChildrenView` の隣）。GET のみ。
- **Serializer**: `backend/api/serializers.py` に `PageTreeNodeSerializer(serializers.Serializer)` を新規追加。`PageSummarySerializer`（`path`/`title`）を土台に `hasPage`（`BooleanField`）・`hasChildren`（`BooleanField`）・`children`（`PageTreeNodeSerializer(many=True)` の自己再帰）を加える。モデル直結の `ModelSerializer` ではなく、View が組み立てた**プレーンな dict ツリー**を受けて整形する `Serializer` とする（仮想ノードは `Page` インスタンスを持たないため）。
- **URL**: `backend/api/urls.py` に `path("pages/tree", views.PageTreeView.as_view(), name="pages-tree")` を追加する。`pages/children` の近く（`pages`（`PageDetailView`）より前）に置く。これは**ルーティング衝突を避けるためではない**。`urls.py` の各ルートは末尾ワイルドカードを持たない厳密な `path()` 文字列であり、`pages/tree` と `pages` は前方一致で衝突しないため、順序は正しさに影響しない。配置理由は純粋に**既存の並びの慣習（具体的・より特定のルートを先に列挙する）に合わせて可読性を保つ**ためである。

> シリアライザ方針の選択: (案1) View が dict ツリーを完成させ `PageTreeNodeSerializer` は整形のみ、(案2) シリアライザの `SerializerMethodField` で子を再帰取得。**案1 を採用**する。理由: 権限枝刈り（2.5）とパス走査は DB アクセスを伴うため View 層に集約した方が N+1 とクエリ回数を制御しやすく、シリアライザは純粋な整形に徹してテスト容易性が上がる。シリアライザは `many=True` の自己参照で**ネスト JSON へのシリアライズのみ**を担う。

### 2.4 `PageChildrenView` ロジックの一般化（全階層版）

既存 `PageChildrenView` は「指定 `parent` の直下 1 階層」を返す。本 View はこれを**全階層のツリー構築**へ一般化する。純粋な Python 文字列処理（`normalize_path`/`ancestor_paths` 流儀）＋ 1 回のクエリでツリーを組む方針とする。

アルゴリズム（dict ツリー構築）:

1. `root = normalize_path(request.query_params.get("root"))`。既定は `/`。
2. `prefix = "/" if root == "/" else root + "/"`（`PageChildrenView` と同一式）。
3. `pages = Page.objects.filter(path__startswith=prefix).order_by("path")` を 1 回だけ取得する（既存 `children` の走査起点と同じ。全階層ぶんを一括取得）。`root` 自身（`path == root`）はツリーのトップには含めない（既存 `children` が parent を除外する流儀）。
4. 取得した各 `Page.path` について、`root` より下の各セグメント境界で**中間ノードを導出**する。例 `root=/`・`path=/docs/intro/deep` なら `/docs`・`/docs/intro`・`/docs/intro/deep` の 3 ノードを生成候補にする（`ancestor_paths(path)` のうち `root` より深いものを近い順→遠い順に反転して使う）。これにより実ページの無い中間パス（`/docs`）も**仮想ノード**として出現する。
5. 各ノードを `path` キーの dict（`{path, title, hasPage, hasChildren(後で確定), children: {}}`）に登録し、親子を `path` の親子関係で接続する。`hasPage` は「その `path` が手順 3 で取得した実ページ集合に含まれるか」。`title` は実ページがあれば `Page.title`、無ければ末尾セグメント。
6. 権限枝刈り（2.5）を適用する。
7. 各ノードの `children` を**パス昇順**に整列し配列化する（`hasChildren` の確定は手順 7.5 の空ノード剪定の後に行う。剪定で `children` が変わり得るため）。
7.5. **ボトムアップの空仮想ノード剪定**を行う。葉から根へ向かって走査し、`hasPage=false` かつ `len(children)==0` のノードを親から取り除く。この除去は**上位へ伝播**させる（子を失ったことで親の仮想ノードも空になれば、その親も除去する）。実ページを持つ葉（`hasPage=true` かつ `len(children)==0`）は**残す**。この一段を入れる理由は 2.5 で詳説するが、要約すると「権限枝刈り（手順 6）で仮想ノードの子孫がすべて落ちると、その仮想ノードが `hasPage=false` かつ子無しで宙に浮き、§3.8 の状態組合せ表と ST-3-6 が『論理的に発生しない』と宣言した組合せ（`hasPage=false` かつ `hasChildren=false`）を実際に生成してしまう」ため。剪定後に各ノードの `hasChildren = len(children) > 0` を確定する。
8. `PageTreeNodeSerializer(tree_roots, many=True).data` を 200 で返す。

> 補足: `prefix` による `path__startswith` は、`PageChildrenView` と同じく「実ページが無い中間パスでも、その配下に実ページがあれば子として現れる」性質（調査 §2「仮想ノードの扱い」）を全階層へ素直に延長したものである。中間ノードの実在有無は `hasPage` で表現する。

### 2.5 権限フィルタと祖先継承（枝刈り）

既存 `require_page_permission(request, path, "view")` を各ノードに適用し、`None`（許可）のノードのみ残す。これは `PageChildrenView` の `visible = [...]` フィルタの全階層版である。

**祖先継承（ST-1-5）**: あるノードが `view` 不可なら、その**子孫を一切出力しない**。実装は「ルート側から深さ優先で下り、`view` 不可ノードに達したらその枝（部分木）を丸ごと捨てる」。これにより、祖先が隠されている場合に子孫がツリーに現れることを防ぐ。親が仮想ノード（`hasPage=false`）でも権限判定は `path` 単位で行える（`PagePermission` は実ページ非依存で祖先パスにも設定可能・調査 §3）。

> 判定順序の注意: 枝刈りは「上から下へ」行う（祖先を先に判定）。`require_page_permission` は `check_permission` 経由で `ancestor_paths` 全体の allow/deny を合成する（Deny 優先・階層的近さ）ため、各ノードは自分のパスで判定すれば階層継承は内部的に効く。本 View が追加で課すのは「祖先ノード自体が可視でない枝は子孫を描かない」という**出力上の枝刈り**であり、権限ロジックそのものは変更しない。

**空になった仮想ノードの剪定（手順 7.5・ST-3-6 との整合）**: 権限枝刈り（手順 6）は祖先継承で「可視でない枝を丸ごと落とす」が、**可視な仮想ノード（`hasPage=false`）の配下にある実ページ子孫だけが個別に `view` 拒否される**ケースがある。例: `/docs`（実ページ無し・仮想ノード）は可視だが、その唯一の実ページ子孫 `/docs/intro` が `view` 拒否のとき。この場合、手順 6 は `/docs` 自身を残しつつ `/docs/intro` を落とすため、`/docs` は `children=[]` の空仮想ノードになる。これは `hasPage=false` かつ `hasChildren=false` という、§3.8 の状態組合せ表最終行と ST-3-6 が「論理的に発生しない」と明記した組合せそのものであり、放置すると「実ページも無く開いても何も出ない」宙に浮いた行がツリーに残る。

そこで手順 7.5 でボトムアップに剪定する: `hasPage=false` かつ `len(children)==0` のノードを親から外し、親が空になれば親も外す（上位伝播）。実ページを持つ葉（`hasPage=true, hasChildren=false`）は残す。この剪定後は「仮想ノードは必ず 1 つ以上の可視な子を持つ」が不変条件として保証され、設計内（アルゴリズムと §3.8 表・ST-3-6）の矛盾が解消する。剪定は純粋な木操作で DB アクセスを伴わない。

### 2.6 入力バリデーション

| 入力 | 必須/任意 | 型・制約 | 失敗時の挙動 |
|---|---|---|---|
| `root`（query） | 任意（既定 `/`） | 文字列。`normalize_path` で正規化（過剰スラッシュ・`.`/`..` 除去・絶対パス化・末尾スラッシュ除去）。 | 不正・空・`///`・`..` 等はすべて `normalize_path` が `/` 等の安全な正規値に畳む。例外は投げず 200 を返す（既存 `children` と同一）。 |
| `depth`（query） | 任意（**初期実装は未使用・予約**） | 将来: 非負整数。既定=全階層。 | 予約段階では受理しても無視する。将来実装時に `_revision_limit` 流儀でクランプ/フォールバックする。 |

### 2.7 エラーハンドリング（操作ごと）

| 失敗条件 | 可否 | 呼び出し側が受け取るもの | ログ |
|---|---|---|---|
| 未認証 | 回復可（ログイン） | 既定 `IsAuthenticated` が 401（既存 API と同一） | DRF 既定。追加ログなし |
| `root` が不正値 | 回復可（正規化） | `normalize_path` が安全な正規値へ畳み、200 + ツリー（または空配列） | なし |
| `root` 配下に可視ノード 0 件 / `root` 非実在 | 正常系 | 200 + `[]`（非実在と可視 0 件を区別しない。既存 `children` と同一契約） | なし |
| 一部ノードが `view` 不可 | 正常系（枝刈り） | 200 + 可視ノードのみのツリー（不可の枝は欠落） | なし |
| DB エラー等の想定外例外 | 致命的 | DRF 既定の 500（本 View で握りつぶさない） | DRF/Django 既定のサーバログ |

本 View は固定 detail を新設しない（`children` 同様、常に 200 を返す設計のため 4xx 固有 detail が不要）。既存の `PAGE_NOT_FOUND_DETAIL` 等は使わない。

### 2.8 不変条件の所有層

- **パス正規化**: `normalize_path`（`utils.py`）が所有。View は入力 `root` の正規化のみ委譲し独自正規化を作らない。
- **可視性**: `require_page_permission`/`check_permission`（`permissions.py`）が所有。View は結果の bool（`None`/応答）で枝刈りするだけで、権限合成ロジックを再実装しない。
- **ツリー構造の一意性**: `path` の一意制約（`Page.path` unique）と `normalize_path` により、同一ノードが二重生成されないことを View のアルゴリズム（`path` キー dict）が保証する。
- **「空仮想ノードを出力しない」不変条件**: `PageTreeView` が所有する（手順 7.5 のボトムアップ剪定）。これにより「`hasPage=false` のノードは必ず 1 つ以上の可視な子を持つ（＝常に `hasChildren=true`）」をレスポンス境界で保証し、フロント（§3.8 表）とテスト（§2.9）はこの不変条件に依拠できる。フロント側では剪定しない（サーバが唯一の所有層）。理由: 可視性判定はサーバ側にしか無く（`require_page_permission`）、空ノードは権限枝刈りの結果として生じるため、剪定も同じ層で行うのが一貫する。

### 2.9 テスト観点（backend）

`backend/api/tests_pages.py` に `PageTreeTests(APITestCase)` を新設（`PageChildrenTests` のセットアップ流儀＝`/docs`・`/docs/intro`・`/docs/guide`・`/docs/intro/deep`・`/blog` を踏襲）。

- **ネスト構造**: `?root=/` が第 1 階層以下を正しいネストで返す（`/docs` 配下に `/docs/intro`、その配下に `/docs/intro/deep`）。
- **仮想ノード**: `/docs` 実ページを作らず `/docs/intro` のみ作ると、`/docs` が `hasPage=false`・`hasChildren=true`・`title="docs"` で現れる。
- **`root` 引数**: `?root=/docs` が `/docs` 配下（`/docs/intro`・`/docs/guide`、さらに `/docs/intro/deep` のネスト）を返し、`/blog` を含まない。
- **権限フィルタ + 祖先継承**: `view` 拒否ノードが欠落し、祖先が不可なら子孫も欠落する（`override_settings` で `JANUS_DEFAULT_PAGE_VIEW` を切替、`PagePermission` の allow/deny を併用。`tests_permissions.py` の children 検証の流儀を援用）。
- **空仮想ノードの剪定（手順 7.5）**: 祖先（例ルート）が可視・中間が仮想（`/docs` 実ページ無し）・唯一の実ページ子孫（`/docs/intro`）が `view` 拒否のとき、空になった仮想ノード `/docs` が**レスポンスに現れない**ことを検証する。あわせて剪定後に `hasPage=false` かつ `hasChildren=false` のノードがレスポンス中に 1 件も存在しないこと（全ノードで `not (hasPage==false and hasChildren==false)`）を再帰的にアサートする。
- **空ツリー**: 可視ノード 0 件・非実在 `root` が 200 + `[]`。
- **`hasChildren` と `children` の一致**: 全ノードで `hasChildren == (len(children) > 0)`。
- **`children` 非破壊回帰**: 既存 `PageChildrenTests` がそのまま緑（本 View 追加で `children` の挙動が変わらない）。

---

## 3. フロントエンド設計

### 3.1 クライアント契約（`types.ts`）

`frontend/src/storage/types.ts` に型とメソッドを追加する。

```ts
/** ページツリーのノード（PageTreeNodeSerializer に一致）。children は再帰。 */
export interface PageTreeNode {
  path: string
  title: string
  hasPage: boolean
  hasChildren: boolean
  children: PageTreeNode[]
}
```

`PageClient` 契約へ 1 メソッド追加:

```ts
/** ルート配下のページツリーを一括取得する（既定 root='/'）。ネスト構造。 */
getPageTree(root?: string): Promise<PageTreeNode[]>
```

`StorageClient` は `PageClient` を継承しているため、`StorageClient` 実装（`RestClient`・将来の `LocalClient`・テストモック）は**すべて** `getPageTree` を満たす必要がある（型で強制される）。

### 3.2 `RestClient` 実装（`rest-client.ts`）

`listChildren` と同じ流儀で `PageClient` 節に追加する。

```ts
async getPageTree(root: string = '/'): Promise<PageTreeNode[]> {
  const response = await fetch(
    this.url(`pages/tree?root=${encodeURIComponent(root)}`),
    { method: 'GET', headers: { ...this.authHeaders() } },
  )
  if (!response.ok) {
    throw await this.toApiError(response)
  }
  return (await response.json()) as PageTreeNode[]
}
```

404→null 変換はしない（`listChildren` と同じく常に配列）。401 は `ApiError(status=401)` を throw し、画面側（`usePageError` 等）で処理する。

### 3.3 コンポーネント構成

`frontend/src/components/sidebar/`（新規ディレクトリ）に自作する。既存の折りたたみ/ツリー/アイコン/Spinner コンポーネントは無い（調査 §5）ため新規作成する。

| コンポーネント | 役割 |
|---|---|
| `PageTree.tsx` | コンテナ。初回に `getPageTree('/')` を取得、展開集合 `Set<string>`・現在パス・エラー/ローディングを管理。ヘッダー（一括ボタン）とノード群を描画。`AppLayout` の `NavItems` から呼ばれる。 |
| `PageTreeHeader.tsx`（または `PageTree` 内の小片） | 「すべて展開」「すべて折り畳む」の 2 ボタン。`Button`（variant `normal`）または `index.css` トークン準拠の軽量テキストボタンで実装。 |
| `PageTreeNodeRow.tsx` | 1 ノード行（再帰）。マーカー（`▶`/`▼`）＋ページ名本体。`role="treeitem"`、子は `role="group"` でラップ。 |
| `current-path.ts` | 現在パス復元の小ヘルパ（純粋関数・単体テスト可能）。 |
| `tree-expand.ts` | 展開集合の導出ヘルパ（`expandablePaths`＝展開可能ノード（`hasChildren=true`）の path 収集・祖先導出・localStorage 入出力）。純粋関数。 |

> データ取得層の分離（ST-2-5）: 取得は `PageTree` が `useStorage().getPageTree('/')` を `useEffect` で 1 回呼ぶだけに閉じ込める。将来 `depth` 制限・遅延ロードに切り替える場合は、この取得呼び出しとツリーマージの箇所だけ差し替えればよい（表示トグルは取得と無関係なため影響しない）。

### 3.4 状態モデル

- **ツリーデータ**: `PageTreeNode[]`（取得結果をそのまま保持。1 つのネスト構造）。
- **展開集合**: `expanded: Set<string>`（展開中ノードの `path`）。

**子データキャッシュ Map は持たない**。理由: 全ツリーを初回 1 回で取得する（遅延ロードしない）ため、調査 §6/§7 が挙げた `Map<string, children>` キャッシュは不要。「1 つのツリーデータ構造 + 展開集合 `Set<string>`」だけで、展開/折り畳みは `expanded.has(node.path)` の判定に帰着する（最小構成を選ぶ）。遅延ロードを将来入れる場合に初めてキャッシュ Map を検討する。

展開トグル:
- マーカー click → `setExpanded(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next })`。
- すべて展開 → `setExpanded(new Set(expandablePaths(tree)))`（`tree-expand.ts` の `expandablePaths` が `hasChildren=true` のノードのみを再帰収集する）。展開集合は「展開可能＝子を持つノードの path」だけを意味づけに持つ。葉の path は `expanded.has()` で何も意味を持たず、収集すると localStorage に永続化される配列（§3.7）が無意味に膨らむため、`hasChildren=true` のノードに限定する。
- すべて折り畳む → `setExpanded(new Set())`。

### 3.5 現在パス復元ヘルパ（`current-path.ts`）

```ts
const ROUTE_PREFIXES = ['/view/', '/edit/', '/history/', '/permissions/'] as const

/** location.pathname から現在のページ path を復元する。該当しなければ null。 */
export function currentPagePath(pathname: string): string | null {
  for (const prefix of ROUTE_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      // プレフィックスを剥がし、先頭 '/' を 1 つ付けた絶対パスにする。
      const rest = pathname.slice(prefix.length)
      return '/' + rest.replace(/^\/+/, '')
    }
  }
  return null
}
```

- `App.tsx` のルートは `/view/*`・`/edit/*`・`/history/*`・`/permissions/*`（splat）であり、`PageViewPage` が `'/' + useParams()['*']` で path を復元する流儀と整合する。`/`（ページ一覧）・`/assets`・`/login` は該当せず `null`（どのノードもアクティブにしない＝ST-5-4）。
- バリデーション: 空 splat（`/view/`）は `'/'` を返す（ルートページ）。多重スラッシュは `replace(/^\/+/, '')` で畳む。

### 3.6 祖先の自動展開（`tree-expand.ts`）

```ts
/** 現在パスの全祖先パスを返す（自身は含めない。'/docs/intro/deep' → ['/docs','/docs/intro']）。 */
export function ancestorPaths(path: string): string[] {
  const segs = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i < segs.length; i++) {
    out.push('/' + segs.slice(0, i).join('/'))
  }
  return out
}
```

初期描画時、現在パス（`currentPagePath`）が非 null なら `ancestorPaths(currentPath)` を展開集合へマージする。これで現在ページまでの枝が開く。バックエンドの `ancestor_paths`（自身含む・近い順）とは目的が異なり、フロントは「開くべき中間ノード（自身の親まで）」だけを使う。

### 3.7 localStorage 永続化と優先関係（`tree-expand.ts`）

`theme-core.ts` の防御運用（try/catch・不正値フォールバック・キー定数）に倣う。

```ts
export const SIDEBAR_EXPANDED_KEY = 'janus-sidebar-expanded'

export function readExpanded(): string[] {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function writeExpanded(paths: string[]): void {
  try {
    window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, JSON.stringify(paths))
  } catch {
    /* プライベートモード等では握りつぶす（UI を壊さない） */
  }
}
```

**優先関係（ST-6-3 の確定）**: 初期展開集合 = `new Set([...readExpanded(), ...ancestorPaths(currentPath)])`。すなわち**復元を先に適用し、その上に現在パス祖先をマージ**する。これにより「前回開いていた枝」と「現在ページまでの枝」の両方が開く（和集合）。現在ページ祖先の自動展開は永続値を上書きせず**追加**するだけなので、利用者が畳んでいた他の枝を勝手に開き直さない（現在ページの枝だけ必ず開く）。

**保存契機**: `expanded` が変化するたび（`useEffect([expanded])`）に `writeExpanded([...expanded])` する。不正値・非配列・非文字列要素は読み出し時にフィルタして無視する。

### 3.8 ノード行の表示仕様と状態組合せ表

各行は flex 1 行で、左に展開マーカー、右にページ名本体を置く。インデントは階層深さ × padding ユーティリティ（例 `style={{ paddingLeft: depth * 12 + 'px' }}` ではなく、Tailwind の `pl-*` を深さに応じて選ぶか、`--indent` を使わずトークン整合の範囲で `pl-{n}`）。深さは再帰描画時に親から渡す。

状態組合せ表（`hasPage` × `hasChildren` × 展開/折畳 × 現在ページ → 表示）:

| hasPage | hasChildren | expanded | is-current | マーカー | ページ名本体 | 子グループ | 備考 |
|---|---|---|---|---|---|---|---|
| true | true | false | no | `▶`（操作可） | `text-fg`・`/view/<path>` 遷移可 | 非表示 | 通常の折畳フォルダ兼ページ |
| true | true | true | no | `▼`（操作可） | `text-fg`・遷移可 | 表示（`role="group"`） | 展開済み |
| true | true | * | yes | `▶`/`▼` | `bg-primary/10 text-primary`・`aria-current="page"` | 展開状態に従う | 現在ページ |
| true | false | — | no | 非表示（またはプレースホルダ） | `text-fg`・遷移可 | 無し | 葉ページ |
| true | false | — | yes | 非表示 | `bg-primary/10 text-primary`・`aria-current="page"` | 無し | 現在ページ（葉） |
| false | true | false | — | `▶`（操作可） | `text-fg-muted`・`cursor-default`・遷移無効 | 非表示 | 仮想ノード（折畳） |
| false | true | true | — | `▼`（操作可） | `text-fg-muted`・遷移無効 | 表示 | 仮想ノード（展開） |
| false | false | — | — | — | — | — | **ツリーに現れない**（バックエンドの手順 7.5 で剪定済み。`hasPage=false` かつ子無しのノードはレスポンスに含まれない。ST-3-6） |

`hasPage=false` かつ `hasChildren=false` の組合せは、バックエンドが手順 7.5（§2.4/§2.5）で空仮想ノードを剪定するため、フロントが受け取るツリーには出現しない。したがってこの行はフロントで分岐を書く必要がなく、`PageTreeNodeRow` は常に「`hasPage=true` の行」または「`hasChildren=true` の仮想ノード行」のいずれかだけを扱えばよい。仮想ノードは現在ページになり得ない（`hasPage=false`＝実ページが無く `/view/<path>` の対象にならない）ため、`is-current` 列は `—`。マーカーの `▶`/`▼` は `aria-hidden="true"` の文字スパンとし、トグルは行内の `<button>`（マーカーをラップ）で担う。

### 3.9 クリック対象の分離（ST-3）

- **マーカー**: `<button type="button" aria-label="展開/折り畳み" onClick={toggle}>`。`▶`/`▼` を内包。クリック・Enter/Space でトグル。遷移しない。
- **ページ名本体（実ページ）**: `<Link to={'/view' + node.path} onClick={onNavigate}>`（既存 `NavItems` の `Link` 流儀）。`onNavigate` は狭幅オーバーレイを閉じるコールバック（ST-7-4）。
- **ページ名本体（仮想ノード）**: `<span>`（`Link`/`button` にしない）＋ `text-fg-muted cursor-default`。クリックしても何も起きない。`aria-disabled` は付けず、そもそも対話要素にしないことで支援技術にも「リンクではない」と伝わる。

### 3.10 AppLayout 統合（ST-7）

`AppLayout.tsx` の `NavItems` コンポーネント内、`NAV_ITEMS` の `<ul>` の**直後**に `<PageTree onNavigate={onNavigate} />` を置く。`NavItems` は広幅常設 `<nav>` と狭幅オーバーレイの両方で描画されるため、ツリーも両モードで出る。`onNavigate`（既存の `closeMenu`）はページ遷移時にオーバーレイを閉じるために `PageTreeNodeRow` の `Link` へ伝播させる。

- `NavItems` は `pathname` を既に受け取るので、`PageTree` へ渡して現在パス復元に使う（または `PageTree` 内で `useLocation()` を直接呼ぶ。既存 `AppLayout` が `useLocation()` を使う流儀に合わせ、`PageTree` 内で `useLocation()` を呼ぶ方が props を増やさず素直）。
- 未ログイン時は `AppLayout` が `NavItems` ごと描画しない（`user === null` 分岐）ため、ツリーも出ない（既存挙動不変）。
- セクション区切り: `NAV_ITEMS` の `<ul>` とツリーの間に `border-border` の区切り（`mt-3 pt-3 border-t border-border`）とラベル（例「ページ」`text-xs text-fg-muted`）を置く（デザイン整合）。

### 3.11 デザイントークン対応表（ST-8）

| 要素 | トークン/ユーティリティ |
|---|---|
| サイドバー地色（既存 `<nav>`/オーバーレイ） | `bg-surface-raised`（既存のまま） |
| ツリーセクション区切り | `border-t border-border mt-3 pt-3` |
| セクションラベル「ページ」 | `text-xs text-fg-muted` |
| ノード行（通常） | `text-fg hover:bg-surface rounded px-2 py-1 text-sm` |
| ノード行（アクティブ=現在ページ） | `bg-primary/10 text-primary` + `aria-current="page"` |
| 仮想ノードのページ名 | `text-fg-muted cursor-default` |
| 展開マーカー `▶`/`▼` | 文字スパン `aria-hidden="true"`・`text-fg-muted`・`w-4` 相当の固定幅で桁揃え |
| フォーカスリング | `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring`（既存 `NavItems`・`Button` 等と完全一致。色ユーティリティ `outline-ring` にも `focus-visible:` を付け、キーボードフォーカス時のみリングを出す） |
| インデント | 深さに応じた `pl-*`（Tailwind spacing。マジックナンバー直書きを避ける） |
| 一括ボタン | `Button` variant `normal`、または `text-xs text-fg hover:bg-surface rounded px-2 py-1` の軽量テキストボタン |

ダークは `data-theme` トークン上書きで自動追従（`dark:` 手書きなし）。アイコンは `▶`/`▼` 文字のみ（ライブラリ非導入）。

### 3.12 アクセシビリティ（ST-9）とキーボード範囲の確定

- **ARIA**: コンテナ `<ul role="tree" aria-label="ページ">`、各行 `<li role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-current={isCurrent ? 'page' : undefined}>`、子グループ `<ul role="group">`。`aria-expanded` は `hasChildren=true` のノードにのみ付ける（葉には付けない）。
- **キーボード範囲（確定）**: 本機能は**最小スコープ**を採用する — Tab でノード間（マーカー `<button>`・ページ名 `<Link>`）をフォーカス移動でき、Enter/Space でマーカーのトグル、Enter でページ名の遷移ができる。`role="tree"` の完全な矢印キーナビ（上下移動・左右で開閉・Home/End）は**本イテレーションのスコープ外**とし、将来拡張として記録する。理由: 既存 `NavItems` が通常の Tab フォーカス前提で、ツリーだけに `tabindex` ロービング＋矢印ハンドラを導入すると複雑性が上がり回帰リスクが増える。最小スコープでも ST-9-2 を満たす。この判断は本書で確定事項とする。
- フォーカス可視は `focus-visible` リングで担保。ユーティリティは既存全コンポーネント（`AppLayout`・`Button`・`ThemeToggle` 等）と完全一致の `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring` を使う。色トークン `outline-ring` にも `focus-visible:` を付けることで、マウス押下やプログラム的フォーカスではリング色が出ず、キーボードフォーカス時のみ可視になる（ST-9-3）。
- 注記: `role="tree"` を付けつつ矢印キーを実装しないのは厳密な WAI-ARIA Authoring Practices とは差があるが、Tab/Enter/Space での操作性と `aria-expanded`/`aria-current` の提供で実用上のアクセシビリティを確保する。完全準拠の矢印ナビは別課題。

### 3.13 ローディング / エラー表示

- **ローディング**: 取得中は `text-fg-muted text-sm` の「読み込み中…」テキスト（Spinner は未作成のため文字で表現。既存流儀）。
- **エラー**: 取得失敗（401 以外）は `text-fg-muted text-sm` で控えめに「ツリーを読み込めませんでした」を表示し、グローバル導線（`NAV_ITEMS`）は壊さない。401 は `usePageError` 流儀でログアウト誘導（画面側の既存機構に委譲）。ツリーの取得失敗はサイドバー局所の劣化に留め、本文ページの描画を妨げない。

### 3.14 テスト観点（frontend）

Vitest + Testing Library（per-file `// @vitest-environment jsdom`）。`useStorage()` にモック `StorageClient`（`getPageTree` を返すスタブ）を注入（`StorageProvider` の `client` prop）して検証する。

- **展開トグル**: マーカー click で子グループが現れ/消える（`aria-expanded` の true/false 遷移）。マーカー操作でページ遷移が起きない。
- **一括展開/折り畳み**: 「すべて展開」で全 `treeitem` の子が表示、「すべて折り畳む」で第 1 階層のみ。追加の `getPageTree` 呼び出しが発生しない（モックの呼び出し回数で確認）。
- **グレーアウト非遷移**: `hasPage=false` ノードのページ名が `<Link>` ではなく非対話要素で描かれ、クリックで遷移しない（`text-fg-muted` 相当・ロールがリンクでない）。
- **現在ページハイライト**: `MemoryRouter` で `/view/docs/intro` を与えると、該当 `treeitem` に `aria-current="page"` が付く。
- **祖先自動展開**: 上記で `/docs`・`/docs/intro` が初期展開される。
- **localStorage 復元**: `janus-sidebar-expanded` に `['/docs']` を仕込むと初期で `/docs` が展開。保存契機で書き込まれる。優先関係（復元 ∪ 現在パス祖先）を検証。
- **ヘルパ単体**: `currentPagePath`（各プレフィックス・空 splat・非該当 null）、`ancestorPaths`、`readExpanded`/`writeExpanded`（不正値フォールバック）を純粋関数として検証。
- **AppLayout 統合**: 広幅・狭幅（オーバーレイ）両方でツリーが描画され、既存 `AppLayout.test.tsx` の挙動（未ログイン非表示・オーバーレイ開閉・フォーカス）が回帰ゼロ。
- **既存 283 テスト非破壊**: フロントの既存テストが全緑のまま。

---

## 4. 性能と将来拡張（未計測の明示）

調査 §6（Q6）のとおり、実運用の**総ページ数・最大階層深さは未計測**。初期実装は `?root=/` で全ページを `path__startswith` 走査し、各ノードに `require_page_permission` を 1 回呼ぶため、ページ数が大きいと走査と権限判定の繰り返しコストが増え得る（N 件ぶんの権限判定）。本機能は「個別＋一括展開を 1 リクエストで満たす」ことを優先し、初期は全階層返却を採る。

将来の緩和策（設計で予約済み・本イテレーションでは実装しない）:

- **`?depth=<n>`**: ルートから n 階層までで打ち切り、深い枝は遅延ロード（`getPageTree(subRoot)` を部分木取得に使う）。`hasChildren` を残したのはこの打ち切り時に「子はあるが未取得」を UI に伝えるため。
- **件数ガード**: 返却ノード数に上限を設け、超過時は深さ制限へフォールバック（`_revision_limit` のクランプ流儀を援用）。
- **権限判定の一括化**: `check_permission` を 1 ノードずつ呼ぶ代わりに、`_collect_entries` を全対象パスでまとめて引く最適化（権限ロジックの外形契約は変えずに内部最適化）。

これらは取得層（3.3 の分離）とフィールド（`hasChildren` 保持）で前方互換を確保済み。実データ計測後に優先度を判断する。

---

## 5. 非破壊の確認観点

- `GET /api/pages/children`・`PageChildrenView`・`PageSummarySerializer` は不変。本機能は `PageTreeView`/`PageTreeNodeSerializer`/`pages/tree` ルートの**加算のみ**。
- `normalize_path`/`ancestor_paths`/`require_page_permission`/`check_permission` は**呼び出すだけ**で改変しない。
- フロントは `PageClient` へ `getPageTree` を**追加**（既存メソッドは不変）。`AppLayout` は `NavItems` に 1 セクション**追加**し、既存挙動（未ログイン非表示・オーバーレイ a11y・ログアウト遷移）を変えない。
- CSS Modules を新設せず Tailwind トークンのみ。デザインシステムの確定事項（`data-theme` 戦略・トークン名・`▶`/`▼` 文字アイコン）に整合。
- 既存 backend テスト・frontend 283 テストを回帰ゼロで通す。

---

## 6. 検証コマンド

- **backend**（`backend/` から実行）: `../.venv/bin/python manage.py check` / `../.venv/bin/python manage.py makemigrations --check --dry-run`（新規モデルは追加しないため差分なしを確認） / `../.venv/bin/python manage.py test api`（新規 `PageTreeTests` + 既存回帰ゼロ）
- **frontend**（`frontend/` から実行）: `npx tsc --noEmit` / `npm run test:run`（新規ツリーテスト + 既存 283 件回帰ゼロ） / `npm run build`（外部 CDN 参照なし） / `npm run lint`

---

## 7. 設計レビュー（design-review）への対応

本節は `design-review.json` / `design-review.md`（判定 `CHANGES_REQUESTED`・HIGH 1 / MEDIUM 1 / NIT 2）の各指摘への対応を記録する。全件 **ADDRESSED**（確定済み要件・プロダクト判断は再オープンしていない）。

- **HIGH-1（権限枝刈りが「論理的に発生しない」はずの空仮想ノードを生成し得る）— ADDRESSED**: §2.4 のアルゴリズムに手順 **7.5（ボトムアップの空仮想ノード剪定）** を追加し、権限枝刈り後に `hasPage=false` かつ `len(children)==0` のノードを親から外して上位へ伝播させる（実ページ葉は残す）。§2.5 に発生ケース（可視な仮想ノード配下の唯一の実ページ子孫が `view` 拒否）と剪定の根拠を詳説。§2.8 に「空仮想ノードを出力しない」不変条件を `PageTreeView` 所有として追加。§3.8 の状態表最終行を「ツリーに現れない（手順 7.5 で剪定済み）」に更新し、ST-3-6（requirements）とタスク 2/4（tasks）にも反映。§2.9・tasks 4 に専用テスト（空になった仮想ノードがレスポンスに現れない／全ノードで `not (hasPage==false and hasChildren==false)` を再帰アサート）を追加。これで設計内の自己矛盾を解消。

- **MEDIUM-1（フォーカスリングのユーティリティ表記が常時リング表示になる）— ADDRESSED**: §3.11 のトークン対応表と §3.12 本文のフォーカスリング表記を、実コード全コンポーネント（`AppLayout`・`Button`・`ThemeToggle` 等、`Button.test.tsx` も含む）と完全一致の `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring`（色ユーティリティ `outline-ring` にも `focus-visible:` を付与）に修正。requirements ST-8-2 と tasks の記述も同じ完全形に統一。グレップで実コードが例外なくこの形であることを確認済み（表記の接地修正であり、確定済み方針「既存 `NavItems` と同一」の再オープンではない）。

- **NIT-1（`allNodePaths` が葉を含めて収集する冗長性）— ADDRESSED**: ヘルパを `expandablePaths`（`hasChildren=true` のノードの path のみを再帰収集）に改名・限定し、§3.3・§3.4 と tasks 8/10 を更新。葉 path を永続化配列（`janus-sidebar-expanded`）に混ぜないことで肥大を避ける。挙動は不変。

- **NIT-2（URL 配置順の根拠の正確性）— ADDRESSED**: §2.3 と tasks 3 の文言を「衝突回避のためではなく、各ルートは末尾ワイルドカード無しの厳密 `path()` で前方一致衝突しない。既存の並びの慣習（具体ルートを先に列挙する）に合わせる可読性目的」と明確化。
