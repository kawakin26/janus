# Janus 実装計画（サイドバー ページツリー）

本タスクリストは `janus-sidebar-page-tree/design.md`（設計）を実装順に分解したもの。設計 §1 の全体像と依存関係に従い、**バックエンド（シリアライザ → ビュー → URL → テスト）→ フロントエンド（契約 → RestClient → ヘルパ → ツリー部品 → AppLayout 統合 → 永続化 → 自動展開 → 一括ボタン → テスト）** の順に積み上げる。各タスクは前のタスクの成果に積み上がり、各タスク完了時にコードベースがビルド可能・テスト緑を保つ。

## 全体方針（着手前に必ず読む）

- **非破壊（最優先）**: フェーズ 1/2/3a・デザインシステムの機能・API・保存形式・権限・記法・ARIA・デザイントークンを一切変えない。`GET /api/pages/children`・`PageChildrenView`・`PageSummarySerializer` を温存し、本機能は `GET /api/pages/tree`（新 View/Serializer/URL）とフロント部品の**加算のみ**（設計 §5）。既存 backend テスト・frontend 283 テストを回帰ゼロで通し続ける。
- **PATH の正規化**: `root` は既存 `api/utils.normalize_path` で正規化してから扱う（既存流儀）。ツリー構築は `path__startswith`＋`ancestor_paths` 流儀の純粋文字列処理（設計 §2.4）。
- **権限**: 各ノードに既存 `require_page_permission(request, path, "view")` を適用し、祖先不可の枝は子孫ごと落とす（設計 §2.5）。権限ロジック自体は再実装しない。
- **モデル追加なし**: 新規マイグレーションは発生しない（`makemigrations --check --dry-run` 差分なしを確認）。
- **デザイン整合**: Tailwind v4 ユーティリティのみ（CSS Modules 新設禁止）。トークン名は `index.css` のものを厳密使用（`bg-surface-raised`/`border-border`/`text-fg`/`text-fg-muted`/`bg-primary/10`/`text-primary`）。フォーカスリングは既存全コンポーネントと完全一致の `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring`（色ユーティリティ `outline-ring` にも `focus-visible:` を付ける。プレフィックス無しの `outline-ring` 単体は常時リング表示になるため禁止）。ダークは `data-theme` 自動追従（`dark:` 手書き禁止）。展開マーカーは `▶`/`▼` 文字（アイコンライブラリ非導入）。インデントは padding ユーティリティ（設計 §3.11）。
- **検証コマンド**:
  - backend（`backend/` から実行）: `../.venv/bin/python manage.py check` / `../.venv/bin/python manage.py makemigrations --check --dry-run` / `../.venv/bin/python manage.py test api`
  - frontend（`frontend/` から実行）: `npx tsc --noEmit` / `npm run test:run` / `npm run build` / `npm run lint`
- **コミット運用**: 実装はワークフローへ委譲し、ワークフロー内ではコミットしない。各タスク完了ごとにオーケストレータが独立に上記コマンドで検証してからコミットする。見た目の最終確認は実ブラウザ（Firefox 最新・広幅/狭幅・ライト/ダーク）でユーザー確認後にコミットする。

## スコープ外（本機能で扱わない。要件スコープ外）

- 仮想ノードからのページ新規作成導線、ツリーからの移動/リネーム/並べ替え、遅延ロードの実装、アセットツリー化、`children` の挙動変更・モデル追加（要件スコープ外）。
- `role="tree"` の矢印キー完全ナビ（本イテレーションは Tab/Enter/Space の最小スコープ・設計 §3.12 で確定）。

---

## バックエンド: `GET /api/pages/tree`

- [ ] 1. ツリーノードのネストシリアライザを追加する
  - `backend/api/serializers.py` に `PageTreeNodeSerializer(serializers.Serializer)` を新規追加する。フィールドは `path`（`CharField`）・`title`（`CharField`）・`hasPage`（`BooleanField`）・`hasChildren`（`BooleanField`）・`children`（`PageTreeNodeSerializer(many=True)` の自己再帰）。View が組み立てたプレーンな dict ツリー（仮想ノードは `Page` インスタンスを持たない）を整形する純粋な `Serializer` とし、`ModelSerializer` にはしない（設計 §2.3）。`PageSummarySerializer`（`path`/`title`）の表現に `hasPage`/`hasChildren`/`children` を足した形に揃える。
  - ファイル: `backend/api/serializers.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する。
  - _要件: ST-1-2_

- [ ] 2. サブツリー一括取得ビュー `PageTreeView` を追加する
  - `backend/api/views.py` に `PageTreeView(APIView)`（GET のみ）を `PageChildrenView` の隣に新規追加する。設計 §2.4 のアルゴリズム: (1) `root = normalize_path(?root)`（既定 `/`）、(2) `prefix = "/" if root=="/" else root+"/"`、(3) `Page.objects.filter(path__startswith=prefix).order_by("path")` を 1 回取得（`root` 自身はトップに含めない）、(4) 各ページパスの `root` より深いセグメント境界で中間ノード（仮想ノード含む）を導出、(5) `path` キー dict でノード登録・親子接続（`hasPage`＝実ページ集合に含まれるか、`title`＝実ページあれば `Page.title`／無ければ末尾セグメント）、(6) §2.5 の権限枝刈り、(7) `children` をパス昇順整列、(7.5) **ボトムアップの空仮想ノード剪定**（`hasPage=false` かつ `len(children)==0` のノードを親から外し上位へ伝播。実ページ葉は残す）、その後 `hasChildren = len(children) > 0` を確定、(8) `PageTreeNodeSerializer(roots, many=True).data` を 200 で返す。
  - **権限（設計 §2.5）**: 各ノードに `require_page_permission(request, path, "view")` を適用し、`None`（許可）のみ残す。ルート側から下り、`view` 不可ノードに達したら部分木を丸ごと捨てる（祖先継承）。
  - **空仮想ノードの剪定（設計 §2.4 手順 7.5／§2.5）**: 権限枝刈りで仮想ノードの子孫がすべて落ちると `hasPage=false` かつ `hasChildren=false` の宙に浮いた行が生じる（§3.8 表・ST-3-6 が「論理的に発生しない」と宣言した組合せ）。これをボトムアップ剪定で除去し、「仮想ノードは必ず 1 つ以上の可視な子を持つ」不変条件をレスポンス境界で保証する。
  - **入力・エラー（設計 §2.6/§2.7）**: `root` 不正は `normalize_path` が安全な正規値へ畳む。可視 0 件・非実在 `root` は 200 + 空配列（既存 `children` と同一契約）。固定 detail は新設しない。`depth` クエリは受理しても無視（予約）。未認証は既定 `IsAuthenticated` が 401。
  - ファイル: `backend/api/views.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` が成功する（テストは本リスト 4 で網羅）。
  - _要件: ST-1-1, ST-1-3, ST-1-4, ST-1-5, ST-1-6, ST-1-8, ST-1-9, ST-3-6_

- [ ] 3. ルートを配線する
  - `backend/api/urls.py` に `path("pages/tree", views.PageTreeView.as_view(), name="pages-tree")` を追加する。`pages/children` 付近（`pages`（`PageDetailView`）より前）に置く。これは衝突回避のためではなく（各ルートは末尾ワイルドカード無しの厳密 `path()` で前方一致衝突しない）、既存の並びの慣習（具体ルートを先に列挙する）に合わせるため。既存ルートは変更しない。
  - ファイル: `backend/api/urls.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py check` 成功、`../.venv/bin/python manage.py makemigrations --check --dry-run`（モデル追加なし＝差分なし）を確認する。
  - _要件: ST-1-1, ST-1-7_

- [ ] 4. ツリー API のテストを追加する
  - `backend/api/tests_pages.py` に `PageTreeTests(APITestCase)` を新設する（`PageChildrenTests` のセットアップ流儀＝`/docs`・`/docs/intro`・`/docs/guide`・`/docs/intro/deep`・`/blog` を踏襲、`reverse("api:pages-tree")`）。設計 §2.9 の観点を検証する:
    - ネスト構造（`?root=/` が第 1 階層以下を正しいネストで返す）。
    - 仮想ノード（`/docs` 実ページを作らない構成で `/docs` が `hasPage=false`・`hasChildren=true`・`title="docs"`）。
    - `root` 引数（`?root=/docs` が `/docs` 配下のみ・`/blog` を含まない）。
    - 権限フィルタ + 祖先継承（`override_settings` で `JANUS_DEFAULT_PAGE_VIEW` 切替・`PagePermission` allow/deny 併用で不可ノードと子孫が欠落）。
    - 空仮想ノードの剪定（祖先可視・中間仮想 `/docs`・唯一の実ページ子孫 `/docs/intro` が view 拒否のとき、空の `/docs` がレスポンスに現れない。かつ全ノードで `not (hasPage==false and hasChildren==false)` を再帰アサート）。
    - 空ツリー（可視 0 件・非実在 `root` が 200 + `[]`）。
    - `hasChildren == (len(children) > 0)` が全ノードで成立。
    - 既存 `PageChildrenTests` が回帰ゼロ（`children` 非破壊）。
  - ファイル: `backend/api/tests_pages.py`
  - 検証: `backend/` で `../.venv/bin/python manage.py test api` が全合格する（新規 `PageTreeTests` + 既存回帰ゼロ）。
  - _要件: ST-1-1, ST-1-2, ST-1-3, ST-1-4, ST-1-5, ST-1-8, ST-3-6, 非機能 1_

---

## フロントエンド: 契約とクライアント実装

- [ ] 5. `PageTreeNode` 型と `getPageTree` 契約を追加する
  - `frontend/src/storage/types.ts` に `PageTreeNode`（`{ path, title, hasPage, hasChildren, children: PageTreeNode[] }`）を追加し、`PageClient` 契約に `getPageTree(root?: string): Promise<PageTreeNode[]>` を追加する（設計 §3.1）。`StorageClient` は `PageClient` を継承するため、全実装・モックが契約を満たす必要がある旨は型で強制される。
  - ファイル: `frontend/src/storage/types.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` が成功する。
  - _要件: ST-2-1, ST-2-4_

- [ ] 6. `RestClient.getPageTree` を実装する
  - `frontend/src/storage/rest-client.ts` の `PageClient` 節に `getPageTree(root = '/')` を実装する。`GET /api/pages/tree?root=<encodeURIComponent(root)>`、`authHeaders()` 付与、非 2xx は `toApiError` で `ApiError` を throw（`listChildren` と同一流儀。404→null 変換はしない）。設計 §3.2 のとおり。
  - 既存 `rest-client.test.ts` の流儀に沿って、`getPageTree` の URL 組み立て・成功/エラー変換の最小テストを追加する。
  - ファイル: `frontend/src/storage/rest-client.ts`, `frontend/src/storage/rest-client.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（新規 + 既存回帰ゼロ）が成功する。
  - _要件: ST-2-2, ST-2-3_

- [ ] 7. 現在パス復元ヘルパ `current-path.ts` を追加する
  - `frontend/src/components/sidebar/current-path.ts`（新規）に `currentPagePath(pathname): string | null` を実装する（設計 §3.5）。`/view/`・`/edit/`・`/history/`・`/permissions/` のプレフィックスを剥がし先頭 `/` を 1 つ付ける。空 splat は `/`、多重スラッシュは畳む、非該当は `null`。純粋関数として単体テストを追加（各プレフィックス・空 splat・非該当）。
  - ファイル: `frontend/src/components/sidebar/current-path.ts`, `frontend/src/components/sidebar/current-path.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` が成功する。
  - _要件: ST-5-1, ST-5-4_

- [ ] 8. 展開集合ヘルパ `tree-expand.ts`（祖先導出・localStorage）を追加する
  - `frontend/src/components/sidebar/tree-expand.ts`（新規）に以下を実装する（設計 §3.6/§3.7）: `ancestorPaths(path): string[]`（自身を含めない祖先）、`expandablePaths(tree): string[]`（`hasChildren=true` のノードの path のみを再帰収集。葉は含めない＝永続化配列を膨らませない）、`SIDEBAR_EXPANDED_KEY = 'janus-sidebar-expanded'`、`readExpanded(): string[]`（try/catch・非配列/非文字列をフィルタ・不正は `[]`）、`writeExpanded(paths): void`（try/catch で握りつぶし）。`theme-core.ts` の防御運用に倣う。純粋関数として単体テスト（祖先導出・不正値フォールバック・収集）を追加。
  - ファイル: `frontend/src/components/sidebar/tree-expand.ts`, `frontend/src/components/sidebar/tree-expand.test.ts`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` が成功する。
  - _要件: ST-4-2, ST-4-3, ST-5-3, ST-6-1, ST-6-2, ST-6-4_

---

## フロントエンド: ツリー UI

- [ ] 9. ノード行コンポーネント `PageTreeNodeRow` を実装する
  - `frontend/src/components/sidebar/PageTreeNodeRow.tsx`（新規・再帰）を実装する（設計 §3.8/§3.9/§3.11/§3.12）。2 クリック対象: マーカー `<button aria-label="展開/折り畳み">`（`▶`/`▼`・`aria-hidden` 文字スパン・トグルのみ・遷移なし）、ページ名本体（実ページは `<Link to={'/view'+path} onClick={onNavigate}>`、仮想ノード `hasPage=false` は非対話 `<span className="text-fg-muted cursor-default">`）。`hasChildren=false` はマーカー非表示/プレースホルダ。`role="treeitem"`・`aria-expanded`（`hasChildren` のときのみ）・現在ページは `aria-current="page"` + `bg-primary/10 text-primary`。子は展開時のみ `<ul role="group">` で再帰描画。インデントは深さに応じた padding ユーティリティ。状態組合せ表（§3.8）に従う。
  - ファイル: `frontend/src/components/sidebar/PageTreeNodeRow.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` が成功する（挙動テストは本リスト 11 で網羅）。
  - _要件: ST-3-1, ST-3-2, ST-3-3, ST-3-4, ST-3-5, ST-3-6, ST-5-2, ST-8-1, ST-8-2, ST-8-3, ST-8-4, ST-9-1, ST-9-2, ST-9-3_

- [ ] 10. ツリーコンテナ `PageTree`（取得・状態・一括ボタン・永続化・自動展開）を実装する
  - `frontend/src/components/sidebar/PageTree.tsx`（新規）を実装する（設計 §3.3/§3.4/§3.7/§3.10/§3.13）。
    - 取得: `useStorage().getPageTree('/')` を `useEffect` で**初回 1 回**だけ呼ぶ（取得層を分離・遅延ロードしない）。ローディング/エラーは控えめな `text-fg-muted text-sm`（Spinner 不使用）、401 は既存 `usePageError` 流儀に委譲し、ツリー失敗は本文描画を妨げない。
    - 状態: `expanded: Set<string>`（1 ツリーデータ + Set のみ。子キャッシュ Map は持たない）。
    - 初期展開（優先関係・§3.7）: `new Set([...readExpanded(), ...ancestorPaths(currentPagePath(pathname) ?? '')])`（復元 ∪ 現在パス祖先）。空 current は祖先なし。
    - 永続化: `useEffect([expanded])` で `writeExpanded([...expanded])`。
    - 一括ボタン（ヘッダー行・§3.3）: 「すべて展開」=`new Set(expandablePaths(tree))`（`hasChildren=true` のノードのみ）、「すべて折り畳む」=`new Set()`。追加ネットワークを発生させない。`Button`（variant `normal`）またはトークン準拠の軽量テキストボタン。
    - 現在パス: `useLocation()` を `PageTree` 内で直接使う（props を増やさない・既存 `AppLayout` 流儀）。
    - マーカートグル・ページ遷移は `PageTreeNodeRow` にコールバックで渡す。`onNavigate`（オーバーレイを閉じる）を受け取り行へ伝播。
  - ファイル: `frontend/src/components/sidebar/PageTree.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` が成功する（挙動テストは本リスト 11 で網羅）。
  - _要件: ST-2-5, ST-3-*, ST-4-1, ST-4-2, ST-4-3, ST-4-4, ST-5-2, ST-5-3, ST-5-4, ST-6-1, ST-6-2, ST-6-3, ST-6-4, ST-9-1_

- [ ] 11. ツリー UI のユニットテストを追加する
  - `frontend/src/components/sidebar/PageTree.test.tsx`（新規・`// @vitest-environment jsdom`）を追加する。`StorageProvider` の `client` prop にモック `StorageClient`（`getPageTree` スタブ）を注入、`MemoryRouter` でルートを与える。設計 §3.14 の観点: 展開トグル（`aria-expanded` 遷移・マーカーで遷移しない）、一括展開/折り畳み（`getPageTree` 呼び出し回数が増えない）、グレーアウト非遷移（仮想ノードが非リンク）、現在ページハイライト（`/view/docs/intro` で `aria-current="page"`）、祖先自動展開、localStorage 復元と優先関係（復元 ∪ 現在パス祖先）、ローディング/エラー表示。
  - ファイル: `frontend/src/components/sidebar/PageTree.test.tsx`
  - 検証: `frontend/` で `npm run test:run` が全合格する（既存 283 件回帰ゼロ）。
  - _要件: ST-3-2, ST-3-4, ST-3-5, ST-4-2, ST-4-3, ST-4-4, ST-5-2, ST-5-3, ST-6-2, ST-6-3_

---

## フロントエンド: AppLayout 統合と全体検証

- [ ] 12. ツリーを `AppLayout` の `NavItems` に統合する
  - `frontend/src/components/AppLayout.tsx` の `NavItems` 内、`NAV_ITEMS` の `<ul>` の直後に区切り（`mt-3 pt-3 border-t border-border`）とセクションラベル（「ページ」`text-xs text-fg-muted`）＋ `<PageTree onNavigate={onNavigate} />` を置く（設計 §3.10）。`NavItems` は広幅常設 `<nav>` と狭幅オーバーレイの両方で描画されるため、両モードで出る。`onNavigate`（既存 `closeMenu`）をツリーのページ遷移に伝播し、狭幅ではページ遷移時にオーバーレイを閉じる。既存 `AppLayout` の挙動（`user===null` 非表示・`/login`/404 レイアウト外・ログアウト遷移・オーバーレイのフォーカス管理/Escape/背景クリック/`inert`・既存 aria）は一切変えない。`NAV_ITEMS` の 2 項目は維持。
  - 既存 `AppLayout.test.tsx` が回帰ゼロであること、広幅/狭幅両方でツリーが描画されることをテストで確認（必要なら `AppLayout.test.tsx` にツリー描画の最小アサートを追加・既存挙動は不変）。
  - ファイル: `frontend/src/components/AppLayout.tsx`, `frontend/src/components/AppLayout.test.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（AppLayout + 既存回帰ゼロ）が成功する。
  - _要件: ST-7-1, ST-7-2, ST-7-3, ST-7-4, ST-8-1, ST-8-2_

- [ ] 13. 全体回帰・ビルド・lint と実機目視
  - **backend**（`backend/` から実行）: `../.venv/bin/python manage.py check` → `../.venv/bin/python manage.py makemigrations --check --dry-run`（差分なし＝モデル追加なし）→ `../.venv/bin/python manage.py test api`（新規 `PageTreeTests` + 既存回帰ゼロ）。
  - **frontend**（`frontend/` から実行）: `npx tsc --noEmit` → `npm run test:run`（新規ツリー/ヘルパ/RestClient テスト + 既存 283 件回帰ゼロ）→ `npm run build`（外部 CDN 参照なし・使用クラスのみ CSS 生成）→ `npm run lint`（0 errors）。
  - **実機目視（ユーザー確認・コミット前）**: Firefox で広幅/狭幅（オーバーレイ）両方、ライト/ダーク両方で、ツリー表示・マーカー展開/折り畳み・ページ名遷移・仮想ノードのグレーアウト非遷移・一括展開/折り畳み・現在ページハイライトと祖先自動展開・リロード後の展開状態復元・フォーカスリング可視・既存グローバル導線（ページ一覧/アセットライブラリ）の不変を確認する。
  - 検証: 上記すべてが成功し、既存フェーズ 1/2/3a・デザインシステムのテスト差分がゼロであること。実機目視項目をユーザーが確認してからコミットする。
  - _要件: ST-7-3, ST-8-3, ST-8-4, 非機能 1, 非機能 3, 統合受入 10_
