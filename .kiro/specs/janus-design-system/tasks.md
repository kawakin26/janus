# Janus 実装計画（デザインシステム刷新・Tailwind CSS v4 全面統一・Zed docs 風）

本タスクリストは `janus-design-system/design.md`（設計レビュー APPROVED・DECISION-NEEDED 5 項目すべて CONFIRMED・§13 参照）を実装順に分解したもの。設計 §7「移行計画」の順序（基盤導入 → トークン/テーマ → AppLayout → 共通 UI → 各ページ順次 → 全廃確認・検証）に忠実に積み上げる。各タスクは前のタスクの成果に積み上がり、各タスク完了時にコードベースがビルド可能・テスト緑を保つ。チェックを付けながら進める。設計の章番号・トークン表（§2）・ダーク機構（§3）・レイアウト（§4）・コンポーネント体裁（§5）・移行計画（§7）・テスト戦略（§10）・エラー処理（§11）に忠実に実装すること。

## 全体方針（着手前に必ず読む）

- **非破壊（最優先）**: フェーズ 1/2/3a の機能・API・保存形式・権限・記法仕様・アクセシビリティ属性を一切変えない。**変えるのは見た目だけ**（設計 §7.1 不変条件・§9・§12）。既存の約 145（backend）/ 約 132（frontend）テストを回帰ゼロで通し続ける。バックエンド（Django）は一切変更しない（本刷新はフロントエンドのスタイルのみ）。
- **`data-*`・role・テキスト・要素タグはテスト契約**: `data-op`/`data-drawio-container`/`data-directive`/`data-custom-map` と各 `role`/`aria-*`/`htmlFor`/`id` を**スタイルへ置換せず維持**する（設計 §7.1-2・§1.5）。`import styles from './*.module.css'` を削除するとき、その TSX が参照する `data-*`/role を失わないことを徹底する。
- **外部非依存・オフライン完結**: ビルド時に CSS を生成し `dist` 同梱、実行時に外部ドメインへ接続しない（CDN ランタイム版・Play CDN・外部フォント配信を使わない）。draw.io セルフホスト同梱・CAD ブラウザ変換と同じ思想（設計 §9・§7-DS-7）。
- **トークン駆動**: 配色・タイポグラフィ・余白等を `@theme` のデザイントークンに集約し、マジックナンバー直書きを避ける。ただし Tailwind 既定スケール（spacing・`max-w-*` 等）の参照は例外として許容（設計 §2.3）。
- **全面移行（段階併存を長期化しない）**: 11 個の `*.module.css` を全廃し、CSS Modules と Tailwind の長期併存を作らない。基盤導入中の一時併存のみ許容し、各ページ移行の段階末で該当 `*.module.css` を削除する（設計 §7.2）。
- **確定事項（DECISION-NEEDED すべて CONFIRMED・設計 §13）**:
  - **D-PALETTE**: §2.1 の OKLCH 提案パレットを初期採用、実装後に目視でコントラスト（本文 4.5:1・大テキスト 3:1 目安）を詰める。
  - **D-FONT**: システムフォントスタック維持（追加フォント同梱なし・THIRD-PARTY-NOTICES 追記不要）。`--font-sans` は現 index.css のシステムスタック、`--font-mono` は ui-monospace 系。
  - **D-DARK-DEFAULT**: 既定 `"system"`（OS 追従）、トグル 3 状態（system/light/dark）、指標 `data-theme`、`localStorage` キー `janus-theme`（値 `"system"|"light"|"dark"`、不正値は `"system"` に正規化）。
  - **D-GENCONTENT**: §3.3 の A 案（既定 OS 追従 + 明示上書き時の CAD SVG / draw.io の明暗割れを許容、生成パイプライン非改変）。
  - **D-TESTSTYLE**: テストはクラス非依存（実査 0 件）。移行時に全テスト再確認し、スタイル起因の修正ゼロを §7.3/§10 のチェックで確証する。
- **ダーク戦略の確定構文**: `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`（設計 §1.4・§3.1・唯一採用。class 戦略 `.dark` は不採用）。v4 のマイナー差があれば等価形に読み替えるだけで戦略・指標は変えない。
- **検証コマンド（すべて cwd=`frontend/` で実行・設計 §7.3/§7.4 と同一 cwd）**:
  - `npx tsc --noEmit`（型検査。`npm run build` の `tsc -b` と重複可）
  - `npm run test:run`（Vitest・既存約 132 件回帰ゼロ）
  - `npm run build`（`tsc -b && vite build`・使用クラスのみ CSS 生成・外部 CDN 参照なし）
  - `npm run lint`（ESLint）
- **コミット運用（進め方の約束事）**: 実装はワークフローへ委譲し、ワークフロー内ではコミットさせない。**各タスク（または段階）完了ごとにオーケストレータが独立に上記 4 コマンドで検証してからコミット**する。見た目は本質的にユニットテストで担保できないため、**実ブラウザ（Firefox 最新）での目視確認が必須の項目（§7.4）はユーザー確認後にコミット**する。

## 実装順の根拠（タスク依存）

設計 §7.2 の順序に従う。**基盤（Tailwind 導入・`@theme` トークン・ダーク機構）が全移行の前提**であり最初に据える（タスク 1〜2）。次に全画面の器である **AppLayout を Zed 風へ再設計**（タスク 3）、その上で**複数ページで使う共通 UI を切り出し**（タスク 4）、以降は**依存の浅い順に各ページを移行**（Breadcrumbs → PageListPage → PageViewPage+article → PageEditPage → PageHistoryPage → PagePermissionPage → AssetLibraryPage → CommentSection → MapEditor → DrawioViewer → CustomMapViewer）。各ページ移行で対応する `*.module.css` を削除し import を除去して段階末で緑を確認する。最後に **CSS Modules 全廃の grep 確認と全体回帰・実機目視**（タスク 10）で締める。

## スコープ外（本刷新で扱わない。設計 §13 スコープ外）

- 機能追加・挙動変更（ページ/アセット/権限/コメント/地図/draw.io/CAD の機能・挙動の変更）。見た目のみ。
- ローカルモード（フェーズ 3b・PWA・IndexedDB・端末カメラ）の実装。ただし本刷新は 3b が同一ビルド = 同一スタイルを得られる基盤に整える。
- 生成コンテンツ内部の配色変更（CAD 変換 SVG のペン色 `cad/config.ts`・draw.io webapp の内部テーマの作り替え）。アプリ側との整合方針（§3.3-A）のみ扱う。
- draw.io 全画面編集・CustomMapViewer への**フォーカストラップの新規追加**（設計 §5.3）。既存の `role="dialog"`/`aria-modal`/`Escape` クローズを維持しクラスのみ差し替える。トラップ追加は別課題。
- `@tailwindcss/typography`（prose プラグイン）・`eslint-plugin-tailwindcss` の導入（追加依存を増やさない。設計 §1.5・§6・§9）。
- バックエンド（Django）の変更。レガシーブラウザ対応（Tailwind v4 要件: Firefox 128+ 等）。

---

## 基盤: Tailwind v4 導入 + デザイントークン + ダークモード機構

- [ ] 1. Tailwind CSS v4（CSS-first）の導入とエントリ CSS の再編
  - **バージョン取得とピン**: `frontend/` で `npm view tailwindcss version` を実行して v4 系最新を取得し、`tailwindcss` と `@tailwindcss/vite` を **devDependencies へ厳密バージョンでピン**して追加する（設計 §1.1/§1.3。断定せず取得値を採用。v4 系であることを確認）。
  - **Vite 統合**: `frontend/vite.config.ts` の `plugins` に `tailwindcss()`（`@tailwindcss/vite`）を**追加するだけ**とし、既存の `@vitejs/plugin-react`・`server.proxy`・`test`（Vitest）設定を壊さない（設計 §1.3）。`tailwind.config.js`・PostCSS 設定ファイルは**作らない**（CSS-first）。
  - **エントリ CSS 再編**: 既存 `frontend/src/index.css` を Tailwind エントリへ再編する（設計 §1.4）。構成順: 先頭 `@import "tailwindcss";` → ダーク戦略宣言 `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));` → `@theme { ... }`（トークンはタスク 2 で投入。本タスクでは枠だけでも可）→ `@layer base`（ダーク上書き枠 + 既存 index.css の最小グローバル: `box-sizing`・`body` margin/地色・リンク等）。この時点で既存 `*.module.css` は**残したまま**（一時併存を許容）。
  - ファイル: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/index.css`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（既存全合格）→ `npm run build`（Tailwind がビルドに組み込まれ CSS を生成・外部 CDN 参照なし）→ `npm run lint` が成功する。`tailwind.config.js`/`postcss.config.js` が存在しないこと。
  - _要件: DS-1-1, DS-1-2, DS-1-3, DS-1-4, DS-1-5, DS-1-6, DS-7-1, 統合受入 1_

- [ ] 2. デザイントークン（Zed docs 風・ライト/ダーク両パレット）とダークモード機構（OS 追従 + 3 状態トグル・FOUC 回避）
  - **トークン投入（`@theme`）**: 設計 §2 のトークンを `frontend/src/index.css` の `@theme` に定義する。配色は §2.1 の OKLCH 提案パレット（surface/surface-raised/fg/fg-muted/border/primary/primary-contrast/success/warning/danger/ring のライト基準値）、タイポgrafィ §2.2（`--font-sans` = 現システムスタック維持・`--font-mono` = ui-monospace 系・サイズスケール `--text-xs`〜`--text-2xl`・行間 `--leading-normal`/`--leading-relaxed`）、角丸 §2.3（`--radius-sm 3px`/`--radius 4px`/`--radius-md 6px`）・影 `--shadow-sm`。既存 `*.module.css` の意味的配色（編集=青→`--color-primary`、削除=赤→`--color-danger`、スピナー強調→`--color-primary`、プレースホルダ→`--color-fg-muted`）をトークンに対応づける（設計 §2.1・DS-2-5）。
  - **ダーク上書き**: `@layer base` の `[data-theme="dark"]` で §2.1 のダーク提案値へ `--color-*` を上書きする（設計 §1.4/§3.1）。
  - **テーマ解決ロジック + React 層**: `useTheme` フック（または軽量 `ThemeProvider`・Context を増やさない方針。設計 §3.3）を新規作成する。`preference`（`"system"|"light"|"dark"`）を `localStorage` キー **`janus-theme`** に永続化、実効テーマは `preference==="system"` のとき `matchMedia("(prefers-color-scheme: dark)")` で `light`/`dark` に解決し `<html data-theme>` に反映（`"system"` を属性へ直接書かない）。`system` のとき `matchMedia` の変化を購読し OS 変更へ追従。不正値は許可リスト検証で `"system"` に正規化（設計 §3.1/§3.2/§11）。`ThemeProvider` を使う場合は既存 Provider 入れ子（BrowserRouter > StorageProvider > AuthProvider）を複雑化させず最外に 1 枚だけ足す（設計 §3.2）。
  - **FOUC 回避（インライン `<head>` スクリプト確定）**: `frontend/index.html` の `<head>` に、`localStorage`（`janus-theme`）と `matchMedia` から実効テーマを計算し `document.documentElement.dataset.theme` を描画前に即時設定するインライン `<script>` を 1 つ追加する（設計 §3.2 確定採用）。不正値正規化（許可リスト外→`"system"`）・`try/catch`（`localStorage`/`matchMedia` 不在時も落ちない）・`matchMedia` 不在時は `"light"` 既定（設計 §11）を FOUC スクリプトと `useTheme` で**同一ルール**にする。
  - **ダークトグル UI**: 3 状態（system/light/dark）を切り替える `<button>`（または select）を用意し、AppLayout ヘッダー（タスク 3）に設置する前提で先に部品化してよい。`aria-label`（例「配色テーマ切替」）+ 現在状態を支援技術に伝える表示（アイコン + `sr-only` テキスト）を付す（設計 §3.1/§8・DS-3-7）。
  - **ユニットテスト**: 新規テーマ関連テストは**先頭に `// @vitest-environment jsdom` を必ず付す**（既定 node 環境のため。設計 §10/§1.5）。`window.matchMedia` を `vi.fn()`（`matches`/`addEventListener`/`removeEventListener` を持つスタブ）でモックし、(a) `localStorage` 永続化（キー `janus-theme`・3 値）、(b) 不正値→`"system"` 正規化、(c) `system` 時の `matchMedia` 追従、(d) トグルで `data-theme` が解決値に変わること、を role/ロジックベースで検証する（CSS 評価不可の色変化は目視で担保）。
  - ファイル: `frontend/src/index.css`, `frontend/index.html`, `frontend/src/theme/useTheme.ts`（または `ThemeProvider.tsx`・新規）, `frontend/src/theme/*.test.tsx`（新規・jsdom）, 必要なら `frontend/src/main.tsx`（Provider 設置）
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（新テーマテスト + 既存全合格）→ `npm run build` → `npm run lint` が成功する。**実機目視（ユーザー確認・コミット前）**: Firefox でライト/ダーク切替・OS 追従・トグル永続化（リロード保持）・FOUC が出ないこと・OKLCH/`/alpha` 下地が意図どおり表示されること。
  - _要件: DS-2-1, DS-2-2, DS-2-3, DS-2-4, DS-2-5, DS-3-1, DS-3-2, DS-3-3, DS-3-4, DS-3-5, DS-3-6, DS-3-7, DS-7-2, DS-8-2, 統合受入 2, 3, 4_

---

## レイアウト: AppLayout の Zed docs 風再設計

- [ ] 3. AppLayout をヘッダー + 左サイドバー + 中央本文（レスポンシブ）へ再設計し、ダークトグルを統合
  - **構成**: 設計 §4.1 の Zed docs 風（上部ヘッダー + 左サイドバーナビ + 中央本文 `mx-auto max-w-3xl p-6`）へ再設計する。ヘッダー: アプリ名「Janus」（`/` リンク）+ 右側にダークトグル（タスク 2 の部品）・`username`・ログアウトボタン・ライセンス/帰属導線（`/drawio/LICENSE`・`/drawio/NOTICE` への素の `<a>`・DS-4-5 で維持）。サイドバー: グローバル導線（`ページ一覧 /`・`アセットライブラリ /assets`）、アクティブ項目は `aria-current="page"` + アクセント下地（設計 §4.4）。文脈導線（履歴/権限/編集）はサイドバーに出さず各ページ内の操作導線として維持。
  - **既存挙動の保持（非破壊・設計 §4.2・DS-4-4）**: `user === null`（未ログイン/復元中）はヘッダー/サイドバーを出さず `<main>` のみ返す、`/login`・404 はレイアウト外（`App.tsx` 不変）、ログアウトは `logout()` → `navigate('/login', { replace: true })`、既存 aria（`aria-label="グローバル"` 等）を維持。クラスだけ差し替える。
  - **レスポンシブ + モバイルオーバーレイサイドバーの確定 a11y 仕様（設計 §4.3）**: 広幅（`md:` 以上）はサイドバー常設。狭幅はサイドバーを折りたたみ、ヘッダーのハンバーガーボタン（`aria-expanded`/`aria-controls`・キーボード操作可）で開閉し、開時はオーバーレイ表示する。新規オーバーレイの確定挙動: 開く→`aria-expanded="true"`・オーバーレイを `role="dialog"` 相当（`aria-modal="true"` + `aria-label="グローバルナビゲーション"`）・**最初のナビ項目へフォーカス移動**。閉じる 3 経路（Escape / 背景 `fixed inset-0 bg-black/50` クリック / ナビ項目選択）、いずれも**フォーカスをハンバーガーへ復帰** + `aria-expanded="false"`。展開中は背後に `inert`（不可環境は簡易フォーカストラップ）。広幅常設時はモーダル挙動を適用しない。
  - **CSS Modules 除去**: `AppLayout.module.css` を削除し `AppLayout.tsx` の `import styles` を除去する。
  - **ユニットテスト**: `AppLayout.test.tsx` で既存挙動（未ログイン非表示・ログアウト遷移・aria 維持）が緑であることを確認。新規オーバーレイサイドバーの a11y 挙動を role/属性ベースでテスト（設計 §10・jsdom + `matchMedia` モック）: `aria-expanded` の `false→true` 遷移と開時フォーカス移動、Escape/背景クリック/項目選択での閉、各閉経路でハンバーガーへフォーカス復帰 + `aria-expanded="false"`、展開中の `inert`（または Tab 到達限定）。
  - ファイル: `frontend/src/components/AppLayout.tsx`, 削除: `frontend/src/components/AppLayout.module.css`, `frontend/src/components/AppLayout.test.tsx`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（AppLayout テスト + 既存全合格）→ `npm run build` → `npm run lint` が成功する。**実機目視（ユーザー確認・コミット前）**: Firefox で広幅/狭幅のレイアウト・サイドバー開閉・フォーカス移動/復帰・ライト/ダーク。
  - _要件: DS-4-1, DS-4-2, DS-4-3, DS-4-4, DS-4-5, DS-8-1, DS-8-4, 統合受入 5_

---

## コンポーネント: 共通 UI の体裁基準

- [ ] 4. 共通 UI コンポーネントの切り出し（Button / Alert / Spinner / Modal・実際に複数箇所で使うものだけ）
  - 設計 §5.1/§5.2 のスタイルの当て方（① ユーティリティ直書き既定 → ② 繰り返す挙動付き UI は React コンポーネント化 → ③ 限定的な `@apply`）に従い、**実際に 2 箇所以上で使うものだけ**を `frontend/src/components/ui/`（新規）に切り出す。作りすぎない（過度な抽象化回避）。
    - `Button.tsx`: `variant="normal|accent|danger"`（§5.2 の体裁: 通常=border/surface、アクセント=`bg-primary text-primary-contrast`、危険=`border-danger text-danger`）。`disabled:opacity-50 disabled:cursor-not-allowed`。
    - `Alert.tsx`: 役割別下地 + `role`（成功 `bg-success/10 text-success`・警告 `bg-warning/10`・エラー `bg-danger/10 text-danger`・情報 `bg-primary/10`）。既存の `role="alert"`/`role="status"` を踏襲できる形。
    - `Spinner.tsx`: `animate-spin` + `border-2 border-current border-t-transparent rounded-full`（現 `AssetLibraryPage .spinner` 相当）。
    - `Modal.tsx`: 背面 `fixed inset-0 bg-black/50` + 本体 `rounded-md bg-surface-raised shadow-sm` + `role="dialog" aria-modal="true"`。モバイルサイドバーのオーバーレイ挙動（タスク 3）と共有できる形を検討（必須ではない）。
  - フォーカス可視 `focus-visible:outline-2 focus-visible:outline-ring` を操作要素に付す方針を各コンポーネントに反映（設計 §8・DS-8-3）。
  - 各コンポーネントの最小ユニットテスト（variant 分岐・role・disabled・キーボード操作）を role/属性ベースで追加（設計 §10）。
  - ファイル: `frontend/src/components/ui/Button.tsx`, `Alert.tsx`, `Spinner.tsx`, `Modal.tsx`（必要なもののみ）, 各 `*.test.tsx`（新規）
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run`（新 UI テスト + 既存全合格）→ `npm run build` → `npm run lint` が成功する。
  - _要件: DS-5-1, DS-5-2, DS-8-3, DS-8-4, 統合受入 6_

---

## 移行: 各ページ・各コンポーネントの Tailwind 化（CSS Modules 順次全廃）

各タスクで対象 TSX をユーティリティ/共通コンポーネントへ移行し、対応 `*.module.css` を削除して `import styles` を除去する。`data-*`/role/aria/`htmlFor`/`id` は維持（テスト契約）。各タスク末で 4 コマンド緑を確認（設計 §7.1/§7.2）。

- [ ] 5. Breadcrumbs の Tailwind 化
  - `frontend/src/components/Breadcrumbs.tsx` をユーティリティへ移行し `Breadcrumbs.module.css` を削除・`import styles` を除去する（設計 §7.2 の移行順先頭）。既存の構造・リンク・aria を維持。
  - ファイル: `frontend/src/components/Breadcrumbs.tsx`, 削除: `frontend/src/components/Breadcrumbs.module.css`
  - 検証: `frontend/` で `npx tsc --noEmit` → `npm run test:run` → `npm run build` → `npm run lint` が成功する。
  - _要件: DS-6-1, DS-6-2, DS-6-3, DS-6-4, DS-8-1_

- [ ] 6. PageListPage の Tailwind 化
  - `frontend/src/pages/PageListPage.tsx` を移行し `PageListPage.module.css` を削除・`import styles` を除去する。一覧の体裁・リンク・既存 role/aria を維持。
  - ファイル: `frontend/src/pages/PageListPage.tsx`, 削除: `frontend/src/pages/PageListPage.module.css`
  - 検証: `frontend/` で 4 コマンドが成功する。
  - _要件: DS-6-1, DS-6-2, DS-6-3, DS-6-4, DS-8-1_

- [ ] 7. PageViewPage の Tailwind 化 + Markdown 本文（article）の prose スタイル移し替え
  - `frontend/src/pages/PageViewPage.tsx` を移行し `PageViewPage.module.css` を削除・`import styles` を除去する。編集/削除導線の意味的配色（編集=アクセント・削除=危険）をトークン化（DS-2-5）。
  - **article prose（設計 §6）**: 現 `index.css` の `article`（`line-height 1.7`・`h1`〜`h3` margin・`p`/`ul`/`a`・`code`/`pre`・背景 `#f3f4f6`→`--color-surface-raised` 系）を、`frontend/src/index.css` の `@layer components` に `.prose-janus { ... } .prose-janus :where(h1,h2,h3) { @apply ... } .prose-janus code { @apply ... } .prose-janus pre { @apply ... }`（要素セレクタ + `@apply`）で再現し、**`PageViewPage.tsx` の既存 `<article>` に `className="prose-janus"` を 1 箇所付与**する。`MarkdownRenderer` はラッパ要素を追加しない（二重ラッパ回避・設計 §6 確定）。`@tailwindcss/typography` は導入しない。ダークで `code`/`pre` 背景が破綻しないこと。
  - ファイル: `frontend/src/pages/PageViewPage.tsx`, `frontend/src/index.css`（prose-janus 追加）, 削除: `frontend/src/pages/PageViewPage.module.css`
  - 検証: `frontend/` で 4 コマンドが成功する。**実機目視（ユーザー確認・コミット前）**: Firefox で article の見出し/本文/`code`/`pre` の体裁がライト/ダークで同等以上、`:::custom-map`/`:::drawio`/GFM の共存描画が崩れないこと。
  - _要件: DS-6-1, DS-6-2, DS-6-3, DS-6-5, DS-2-4, DS-2-5, DS-8-1, 統合受入 8_

- [ ] 8. PageEditPage の Tailwind 化（draw.io 全画面・地図 GUI 導線の体裁を含む）
  - `frontend/src/pages/PageEditPage.tsx` を移行し `PageEditPage.module.css` を削除・`import styles` を除去する。
  - **draw.io 全画面編集（設計 §5.3）**: 既存 `isDrawioFullscreen` 分岐が持つ `role="dialog"`/`aria-modal`/`aria-label`/`Escape` クローズを**そのまま維持**し、オーバーレイのクラスのみ Tailwind（`fixed inset-0 z-50` 等）へ差し替える。**フォーカストラップは追加しない**（スコープ外）。地図 GUI 編集・写真添付の導線体裁も Tailwind 化。既存の保存経路（`updatePage`/`createPage`）・`data-*`・aria を不変に保つ。
  - ファイル: `frontend/src/pages/PageEditPage.tsx`, 削除: `frontend/src/pages/PageEditPage.module.css`
  - 検証: `frontend/` で 4 コマンドが成功する。**実機目視（ユーザー確認・コミット前）**: draw.io 全画面オーバーレイと Escape クローズが従来どおり動くこと。
  - _要件: DS-6-1, DS-6-2, DS-6-3, DS-5-3, DS-8-1_

- [ ] 9. 残りのページ/コンポーネントの Tailwind 化と CSS Modules 全廃確認・全体回帰・実機目視
  - **PageHistoryPage**: `frontend/src/pages/PageHistoryPage.tsx` を移行、`PageHistoryPage.module.css` 削除・`import styles` 除去。**差分表示の `data-op` を維持**（テスト契約・設計 §7.1-2）。
  - **PagePermissionPage**: `frontend/src/pages/PagePermissionPage.tsx` を移行、`.module.css` 削除・import 除去。権限 UI の体裁・role/aria 維持。
  - **AssetLibraryPage**: `frontend/src/pages/AssetLibraryPage.tsx` を移行、`.module.css` 削除・import 除去。ファイル選択（`fileButton`/`fileName`/`fileNameEmpty`/`visuallyHiddenInput`→`sr-only` 相当）・変換スピナー（`Spinner` 共通化）・変換中一括 `disabled`（`disabled:opacity-50 disabled:cursor-not-allowed`）を Tailwind で同等再現（設計 §5.3）。
  - **CommentSection**: `frontend/src/pages/CommentSection.tsx` を移行、`.module.css` 削除・import 除去。本文はテキストノード描画（`dangerouslySetInnerHTML` を使わない）を維持、編集/削除ボタンの意味的配色をトークン化。role/aria 維持。
  - **MapEditor**: `frontend/src/markdown/custom-map/MapEditor.tsx` を移行、`.module.css` 削除・import 除去。マーカー編集 UI の体裁を Tailwind 化、挙動（座標/クランプ/色）不変。
  - **DrawioViewer**: `frontend/src/markdown/drawio/DrawioViewer.tsx` を移行、`.module.css` 削除・import 除去。`data-drawio-container` 等のテスト契約を維持、GraphViewer 描画は不変。
  - **CustomMapViewer（設計 §5.4）**: `frontend/src/markdown/custom-map/CustomMapViewer.tsx` の**動的トランスフォーム（pan/zoom/rotate の計算値インライン）は維持**し、静的な枠・ツールバー・ボタン・写真ポップアップの体裁のみ Tailwind 化してダーク対応。SVG を `<img src>` Blob URL で描く既存のセキュリティ姿勢・表示挙動を不変に保つ。実装時にコンポーネントを読んでインライン維持 vs Tailwind 化の境界を確定する。
  - **CSS Modules 全廃確認（設計 §7.3・cwd=`frontend/`・相対パス `src`）**: `grep -rn "module.css" src`=0 件 / `find src -name "*.module.css"`=0 件 / `grep -rn "import styles" src`=0 件 / `grep -rn '@import "tailwindcss"' src`=1 件（`src/index.css` のみ）/ `tailwind.config.js`・`postcss.config.js` 不在、を確認する。
  - **全体回帰 + 実機目視（設計 §7.4）**: `npx tsc --noEmit` → `npm run test:run`（既存約 132 件回帰ゼロ・新規テーマ/a11y/UI テスト全合格）→ `npm run build`（外部 CDN 参照なし・使用クラスのみ CSS）→ `npm run lint`。実機目視（ユーザー確認・コミット前）: Firefox でライト/ダーク両方・全ページ・レスポンシブ（広幅/狭幅）・OS テーマ追従・トグル永続化・FOUC なし・生成コンテンツ（CAD SVG/draw.io）の明暗整合（既定 OS 追従で揃う）・`/alpha` 下地と OKLCH の表示・フォーカスリング可視・コントラスト AA 目安。
  - ファイル: `frontend/src/pages/PageHistoryPage.tsx`, `PagePermissionPage.tsx`, `AssetLibraryPage.tsx`, `CommentSection.tsx`, `frontend/src/markdown/custom-map/MapEditor.tsx`, `CustomMapViewer.tsx`, `frontend/src/markdown/drawio/DrawioViewer.tsx`, 削除: 上記各 `*.module.css`（計 7 ファイル・タスク 3/5/6/7/8 の 5 ファイルと合わせて 11 ファイル全廃）
  - 検証: 上記 4 コマンドが成功し、全廃 grep が規定どおり、既存フェーズ 1/2/3a テストの差分がゼロであること。実機目視項目をユーザーが確認してからコミットする。
  - _要件: DS-5-3, DS-5-4, DS-6-1, DS-6-2, DS-6-3, DS-6-4, DS-6-5, DS-7-1, DS-7-3, DS-7-4, DS-8-1, DS-8-2, DS-8-3, DS-8-4, 統合受入 6, 7, 8, 9, 10, 11_
