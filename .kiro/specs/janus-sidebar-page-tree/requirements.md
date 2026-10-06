# Janus サイドバー ページツリー 要件定義書

## 概要

本書は Janus のサイドバーに **ページ階層ツリー**を追加する要件を定義する。現在のサイドバー（`frontend/src/components/AppLayout.tsx` の `NAV_ITEMS`）は「ページ一覧 `/`」「アセットライブラリ `/assets`」の静的 2 項目（グローバル導線）のみで、ページの階層を一覧・探索する手段が無い。本機能は `NAV_ITEMS` の**直下**に、`Page.path` の階層を木構造で描画し、ノード単位の展開/折り畳みと一括展開/折り畳みを提供する。

Janus のページ階層は**親子 FK を持たず、`Page.path` の文字列（例 `/docs/intro/deep`）だけ**で表現される（`backend/.agents/tasks/sidebar-page-tree-investigation.md` §1 で確認済み）。したがってツリーの「フォルダ」は、**子ページを持つ中間パスセグメント**（実ページが存在するとは限らない仮想ノード）として扱う。`Folder` モデルはアセットライブラリ専用でページツリーには流用しない。

本機能はバックエンドに**サブツリー一括取得エンドポイント `GET /api/pages/tree` を新設**（調査 §7 案A・推奨）し、フロントは初回に全ツリーを 1 回で取得して、展開/折り畳みはクライアント側の表示トグルで行う。既存 `GET /api/pages/children` は**温存**し、本機能は加算的（非破壊）とする。

本書は要件定義のみを扱う。設計・実装・コミットは後続ステップで行う。成果物は本 spec（`janus-sidebar-page-tree`）の `requirements.md` / `design.md` / `tasks.md` のみである。フェーズ 1（janus-foundation）・フェーズ 2（janus-phase2）・フェーズ 3a（janus-phase3a）およびデザインシステム刷新（janus-design-system）は完了・コミット済みであり、本機能はそれらの**機能・API・保存形式・権限・記法・デザイントークンを一切壊さない**。

### 用語

- **ノード（Node）**: ツリー上の 1 項目。パス `path`、表示名 `title`、実ページの有無 `hasPage`、子の有無 `hasChildren`、子ノード配列 `children` を持つ。
- **仮想ノード（virtual node）**: 実ページが存在しない中間パス（`hasPage=false`）。例として `/docs/intro` が存在するが `/docs` ページが無いとき、`/docs` は仮想ノードになる。
- **フォルダ**: 子ページを持つ中間ノード（`hasChildren=true`）。実ページの有無（`hasPage`）とは独立。
- **展開集合（expanded set）**: 現在展開中のノード `path` の集合（`Set<string>`）。
- **現在パス（current path）**: `useLocation().pathname` から `/view/`・`/edit/`・`/history/`・`/permissions/` のプレフィックスを剥がして復元した、いま表示中のページのパス。

### 位置づけ（フェーズとの関係）

- 本機能は引き継ぎメモの「残作業: サイドバーのページツリー（機能追加・デザインシステムのスコープ外）」に対応する新規機能 spec である。
- バックエンドは**新規エンドポイントの加算のみ**で、既存ビュー・シリアライザ・権限ロジックの挙動は変えない。フロントは**サイドバーへのツリー注入とクライアント契約の 1 メソッド追加のみ**。

---

## 要件

### 要件 ST-1: サブツリー一括取得 API `GET /api/pages/tree`（新設・非破壊） 〔バックエンド〕

**ユーザーストーリー:** 利用者として、サイドバーにページ階層全体を一度の読み込みで表示したい。そうすればノードを開くたびに待たされず、一括展開も即座に効く。

#### 受け入れ基準

1. THE バックエンド SHALL 新規エンドポイント `GET /api/pages/tree` を追加する。クエリ `?root=<path>`（既定 `/`）で指定したルート配下のサブツリーを、**ネストした 1 レスポンス**で返す。
2. THE 各ノード SHALL `{ path: string, title: string, hasPage: boolean, hasChildren: boolean, children: Node[] }` の形状とする。`hasPage` は当該パスに実ページが存在するか、`title` は実ページがあればそのタイトル、無ければパス末尾セグメント、`hasChildren` は子ノードを持つか、`children` は子ノード配列を表す。
3. THE レスポンス SHALL `root` 自身をレスポンスのトップには含めず、`root` の**直下以下**をツリーとして返す（既存 `children` が parent 自身を除外する流儀に合わせる）。既定 `root=/` のときは第 1 階層以下の全ツリーを返す。
4. WHEN ノードの可視性を判定する THEN システム SHALL 各ノードに既存 `require_page_permission(request, path, "view")` を適用し、**閲覧可能なノードのみ**を返す（既存 `children` と同一方式）。
5. WHEN ある祖先ノードが閲覧不可である THEN システム SHALL その**子孫を一切出力しない**（祖先継承。閲覧不可の枝は丸ごと落とす）。
6. THE エンドポイント SHALL 将来拡張として `?depth=<n>` クエリ（既定=全階層）を**仕様として予約**する。初期実装は全階層を返す。
7. THE 既存 `GET /api/pages/children` SHALL 挙動・レスポンス形状を一切変えずに**温存**する（本機能は加算のみ・非破壊）。
8. WHEN `root` が実在しない／可視なノードが 0 件である THEN システム SHALL 200 と空配列 `[]`（または `children` 空）を返し、非実在と可視 0 件を区別しない（既存 `children` の挙動に揃える）。
9. THE エンドポイント SHALL 既定の `IsAuthenticated` により未認証を 401 とする（既存 API と同じ）。

### 要件 ST-2: ツリーデータのクライアント契約と取得 〔フロントエンド・契約〕

**ユーザーストーリー:** 開発者として、ツリー取得を既存のストレージ契約の延長で呼びたい。そうすれば画面は `useStorage()` 経由だけでデータを扱え、将来のローカルモード実装でも同じ契約を満たせる。

#### 受け入れ基準

1. THE `PageClient` 契約（`frontend/src/storage/types.ts`）SHALL ツリー取得メソッド `getPageTree(root?: string): Promise<PageTreeNode[]>` を追加する。`PageTreeNode` は ST-1-2 のノード形状に対応する型とする。
2. THE `RestClient`（`frontend/src/storage/rest-client.ts`）SHALL `getPageTree` を `GET /api/pages/tree`（`root` を `encodeURIComponent` でクエリ付与）で実装し、非 2xx は既存流儀どおり `ApiError` を throw する。
3. THE サイドバーツリー SHALL データ取得を `useStorage().getPageTree(...)` 経由でのみ行い、`fetch`・`RestClient` 具象を直接使わない（既存の `useStorage()` 規約）。
4. WHEN 他の `StorageClient` 実装やテスト用モックが存在する／将来追加される THEN それら SHALL 同一の `getPageTree` 契約を満たす。
5. THE 取得 SHALL **初回レンダー時に 1 回だけ**全ツリーを取得する（遅延ロードはしない）。ただしデータ取得層は分離し、将来 `depth` 制限・遅延ロードへ切り替えられる構造とする。

### 要件 ST-3: ノードの表示と 2 つのクリック対象（展開マーカー / ページ名本体） 〔フロントエンド・挙動〕

**ユーザーストーリー:** 利用者として、ツリーの各行で「開く」と「そのページへ移動する」を別々に操作したい。そうすれば階層を広げながら目的のページへ正確にたどり着ける。

#### 受け入れ基準

1. THE 各ノード行 SHALL **2 つのクリック対象**を持つ: (a) 展開マーカー（文字アイコン・折り畳み `▶` / 展開 `▼`）、(b) ページ名本体。
2. WHEN 利用者が展開マーカーをクリックまたは Enter/Space で操作する THEN システム SHALL そのノードの展開/折り畳みを切り替える（**ページ遷移はしない**）。
3. WHEN ノードが子を持たない（`hasChildren=false`）THEN システム SHALL 展開マーカーを表示しない（または非操作のプレースホルダとし、押下しても何も起きない）。
4. WHEN 利用者がページ名本体をクリックまたは Enter で操作する AND そのノードが実ページを持つ（`hasPage=true`）THEN システム SHALL `/view/<path>` へ遷移する。
5. WHEN ノードが実ページを持たない（`hasPage=false` の仮想ノード）THEN システム SHALL ページ名本体を**グレーアウト（無効状態・補助テキスト色）で描画し、ページ遷移を無効**にする。この場合、操作可能なのは展開マーカーのみとする。
6. THE 子を持たず実ページも持たない（`hasChildren=false` かつ `hasPage=false`）ノード SHALL ツリーに現れない。仮想ノードは「子があるからこそ中間ノードになる」ため本来この組合せは発生しないが、権限枝刈りで仮想ノードの可視な子孫がすべて落ちると空の仮想ノードが生じ得る。したがってバックエンド（`GET /api/pages/tree`）SHALL 空になった仮想ノード（`hasPage=false` かつ子無し）をレスポンス前に剪定し、この組合せをフロントへ渡さない。設計はこの剪定アルゴリズムと不可能性を状態組合せ表に明記する。

### 要件 ST-4: 一括展開 / 一括折り畳み 〔フロントエンド・挙動〕

**ユーザーストーリー:** 利用者として、ツリー全体を一度に開いたり閉じたりしたい。そうすれば大きな階層でも全体像の把握と素早い折り畳みができる。

#### 受け入れ基準

1. THE ツリー上部 SHALL ヘッダー行を持ち、**「すべて展開」**と**「すべて折り畳む」**の 2 ボタンを置く。
2. WHEN 利用者が「すべて展開」を押す THEN システム SHALL 既知の全ノード `path` を展開集合に加え、全階層を表示する。
3. WHEN 利用者が「すべて折り畳む」を押す THEN システム SHALL 展開集合を空にし、第 1 階層のみ表示する。
4. THE 一括操作 SHALL 初回取得済みのツリーデータに対してクライアント側のみで完結する（追加のネットワーク取得を発生させない）。

### 要件 ST-5: 現在ページのハイライトと祖先の自動展開 〔フロントエンド・挙動〕

**ユーザーストーリー:** 利用者として、いま見ているページがツリー上のどこかひと目で分かり、その位置が最初から開いていてほしい。そうすれば現在地を見失わない。

#### 受け入れ基準

1. THE サイドバー SHALL `useLocation().pathname` から `/view/`・`/edit/`・`/history/`・`/permissions/` のプレフィックスを剥がす小ヘルパで**現在パス**を復元する。
2. WHEN あるノードの `path` が現在パスと一致する THEN システム SHALL そのノードに `aria-current="page"` とアクティブスタイル（アクセント下地 `bg-primary/10` + `text-primary`）を付与する（既存 `NavItems` の流儀に合わせる）。
3. THE サイドバー SHALL 初期描画時に、現在パスの**全祖先パス**を展開集合に加え、現在ページまでの枝を開いた状態にする（祖先はフロントで `path` を `/` 分割して導出する）。
4. WHEN 現在パスがツリーに存在しない（権限外・ルート直下等）THEN システム SHALL 例外を起こさず、どのノードもアクティブにしないだけとする。

### 要件 ST-6: 展開状態の永続化 〔フロントエンド・挙動〕

**ユーザーストーリー:** 利用者として、サイドバーで開いた枝が再訪やリロード後も開いたままであってほしい。そうすれば毎回開き直す手間がない。

#### 受け入れ基準

1. THE サイドバー SHALL 展開集合を `localStorage` キー **`janus-sidebar-expanded`** に、展開中パスの配列として永続化する（既存 `janus-theme` の運用に倣う）。
2. WHEN アプリ起動・再訪・リロード時 THEN システム SHALL 永続化された展開集合を復元する。
3. THE 復元された展開集合と「現在ページ祖先の自動展開（ST-5-3）」SHALL 両立する。両者の優先関係（復元後に現在パス祖先をマージする等）は設計で確定する。
4. WHEN `localStorage` が不在・アクセス不可・不正値である THEN システム SHALL 例外で UI を壊さず、空集合または現在パス祖先のみで続行する（既存 theme の防御的運用に倣う）。

### 要件 ST-7: AppLayout への統合（広幅 / 狭幅両モード） 〔フロントエンド・レイアウト〕

**ユーザーストーリー:** 利用者として、PC でも狭幅端末でも同じようにページツリーを使いたい。そうすれば端末を問わず階層を探索できる。

#### 受け入れ基準

1. THE ツリー SHALL `AppLayout.tsx` の `NavItems`（広幅の常設サイドバーと狭幅のモーダルオーバーレイで共用される本体）に注入し、**両モードで動作**する。
2. THE グローバル `NAV_ITEMS`（ページ一覧 / アセットライブラリ）SHALL 維持し、ツリーはその**直下**に別セクションとして置く。
3. THE ツリー注入 SHALL 既存 `AppLayout` の挙動（未ログイン/復元中は非表示、`/login`・404 のレイアウト外、ログアウト遷移、狭幅オーバーレイのフォーカス管理・Escape・背景クリック・`inert`）を一切変えない。
4. WHEN 狭幅オーバーレイでツリーのページ名本体を選択してページ遷移する THEN システム SHALL 既存のナビ項目選択時と同様にオーバーレイを閉じる。

### 要件 ST-8: デザインシステム整合 〔非機能・デザイン〕

**ユーザーストーリー:** 開発者として、ツリーを既存のデザイントークンと同じ流儀で装飾したい。そうすれば配色・ダークモード・フォーカス表現が全画面で一貫する。

#### 受け入れ基準

1. THE ツリー SHALL スタイルを **Tailwind v4（CSS-first）ユーティリティ**のみで表現し、CSS Modules を新設しない（全廃済み方針を維持）。
2. THE 配色 SHALL `frontend/src/index.css` のトークン名をそのまま用いる: サイドバー地色 `bg-surface-raised`、境界 `border-border`、本文 `text-fg`、グレーアウト `text-fg-muted`、アクティブ `bg-primary/10 text-primary`、フォーカス `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring`。
3. THE ダークモード SHALL `data-theme` トークン上書きで自動追従させ、`dark:` ユーティリティを手書きしない（既存戦略に揃える）。
4. THE 展開マーカー SHALL 文字アイコン（`▶`/`▼`）で表現し、アイコンライブラリを新規導入しない。インデント（階層の深さ）は Tailwind の padding ユーティリティで表現する。

### 要件 ST-9: アクセシビリティ 〔非機能〕

**ユーザーストーリー:** 利用者として、キーボードや支援技術でもページツリーを操作したい。そうすれば誰でも階層を探索できる。

#### 受け入れ基準

1. THE ツリー SHALL 適切な ARIA を付与する: 木全体に `role="tree"`、各ノード行に `role="treeitem"`、子グループに `role="group"`、展開可能ノードに `aria-expanded`（true/false）、現在ページに `aria-current="page"`。
2. THE 操作要素 SHALL キーボードで操作可能とする。最低限、Tab でフォーカス移動でき、Enter/Space で展開トグルと（実ページの）ページ遷移ができる。
3. THE フォーカス可視 SHALL `focus-visible` によるリング（`outline-ring`）で担保する（既存 `NavItems` と同じ）。
4. THE キーボード操作の範囲（上下移動・左右の開閉・Enter 遷移などツリーウィジェット準拠の拡張）SHALL 設計で範囲を確定し記録する。少なくとも ST-9-2 を満たす。

---

## 非機能要件

1. **非破壊（最優先）**: フェーズ 1/2/3a・デザインシステムの機能・API・保存形式・権限・記法・アクセシビリティ属性・デザイントークンを壊さない。既存 `GET /api/pages/children` を温存する。既存の backend テスト群と frontend の 283 テストを**回帰ゼロ**で通す。
2. **性能（未計測の明示）**: 実運用の総ページ数・最大階層深さは本調査では未計測（調査 §6 Q6）。初期実装は全階層を 1 レスポンスで返すため、ページ数が大きいと `?root=/`（全ページ走査）と各ノードの `require_page_permission` 繰り返しのコストが増え得る。将来の緩和策として `?depth=<n>`・件数ガード・遅延ロードを設計で予約する。
3. **外部非依存・オフライン完結**: 実行時に外部ドメインへ接続しない。アイコンライブラリ・外部フォント・CDN を増やさない。
4. **一貫性**: 配色・余白・フォーカス表現を既存トークン（`@theme`）に揃える。
5. **対象ブラウザ**: 主対象は Firefox 最新。既存デザインシステムの前提（モダンブラウザ）に従う。

---

## 受け入れ基準（統合・検証観点のサマリ）

本機能完了時、以下が確認可能であること。

1. `GET /api/pages/tree?root=<path>` がネスト構造で `{path,title,hasPage,hasChildren,children}` を返し、仮想ノードを含み、`view` 不可ノードとその子孫を落とす。既定 `root=/` で全ツリーを返す。
2. `GET /api/pages/children` の挙動・形状が不変（既存テスト回帰ゼロ）。
3. `PageClient.getPageTree` が契約に追加され、`RestClient` が `GET /api/pages/tree` を実装し、サイドバーは `useStorage()` 経由でのみ取得する。
4. サイドバーのツリーが `NAV_ITEMS` 直下に表示され、ノード単位の展開/折り畳み（マーカー）とページ遷移（ページ名本体）が分離動作する。仮想ノードはグレーアウトで遷移不可。
5. 「すべて展開」「すべて折り畳む」が追加ネットワークなしで動作する。
6. 現在ページが `aria-current="page"` + アクセント下地でハイライトされ、現在ページ祖先が初期展開される。
7. 展開状態が `janus-sidebar-expanded` に永続化され、復元される。
8. 広幅・狭幅（オーバーレイ）両モードで動作し、既存 `AppLayout` 挙動が不変。
9. Tailwind トークン整合（`bg-surface-raised`/`border-border`/`text-fg`/`text-fg-muted`/`bg-primary/10`/`text-primary`/`outline-ring`）・ダーク追従・`▶`/`▼` 文字アイコン・ARIA（`tree`/`treeitem`/`group`/`aria-expanded`/`aria-current`）が満たされる。
10. backend `../.venv/bin/python manage.py test api`、frontend `npx tsc --noEmit` / `npm run test:run` / `npm run build` / `npm run lint` が全通過し、既存テスト回帰ゼロ。

---

## スコープ外（本機能で扱わないこと）

- **ページの新規作成導線**: 仮想ノード（実ページ無し）クリックからのページ新規作成は扱わない（グレーアウト・遷移不可のみ）。
- **ドラッグ&ドロップ等でのページ移動・リネーム・並べ替え**: ツリーからの階層操作は対象外（表示・展開・遷移のみ）。
- **遅延ロード（lazy load）の実装**: 初回 1 回の全ツリー取得で実装する。将来の切替余地（データ取得層の分離・`depth`）だけ用意する。
- **アセットライブラリのツリー化**: `Folder`/`Asset` 系は別概念で対象外。
- **バックエンドの既存ビュー・権限ロジックの作り替え**: `GET /api/pages/tree` の加算のみ。`children` の挙動変更やモデル追加はしない。
- **全文検索（フェーズ 4）やローカルモード（フェーズ 3b）** 等の未着手機能。

---

## 参照資産（根拠・絶対パス）

- `/home/kawakin/git/knowledge-base/janus/backend/.agents/tasks/sidebar-page-tree-investigation.md`（事前調査レポート・全事実の根拠）
- `/home/kawakin/git/knowledge-base/janus/backend/api/views.py`（`PageChildrenView`）
- `/home/kawakin/git/knowledge-base/janus/backend/api/serializers.py`（`PageSummarySerializer`）
- `/home/kawakin/git/knowledge-base/janus/backend/api/permissions.py`（`require_page_permission`）
- `/home/kawakin/git/knowledge-base/janus/backend/api/utils.py`（`normalize_path`/`ancestor_paths`）
- `/home/kawakin/git/knowledge-base/janus/backend/api/urls.py`
- `/home/kawakin/git/knowledge-base/janus/backend/api/tests_pages.py`（`PageChildrenTests`）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/components/AppLayout.tsx`（`NAV_ITEMS`/`NavItems`）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/App.tsx`（`/view/*` ルート）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/storage/types.ts`（`PageClient`/`StorageClient`）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/storage/rest-client.ts`（`listChildren` 実装の流儀）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/storage/StorageProvider.tsx`（`useStorage()`）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/theme/theme-core.ts`（`janus-theme` 永続化パターン）
- `/home/kawakin/git/knowledge-base/janus/frontend/src/index.css`（デザイントークン名）
