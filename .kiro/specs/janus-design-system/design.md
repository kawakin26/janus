# Janus デザインシステム刷新 設計書（Tailwind CSS v4 全面統一・Zed docs 風）

本書は `janus-design-system/requirements.md`（要件 DS-1〜DS-8 と非機能要件）を実装レベルに具体化する設計書である。Janus フロントエンドのスタイルを素の CSS Modules から **Tailwind CSS v4（CSS-first 設定）へ全面統一**し、見た目を **Zed のドキュメントサイト（https://zed.dev/docs/）風**に刷新する。本書の段階ではアプリケーションコード（frontend/backend）を一切変更せず、設計の確定のみを行う。実装・コミットは後続ステップで行う。

設計の大原則は 4 つ。(1) **非破壊** — フェーズ 1/2/3a の機能・API・保存形式・権限・記法・アクセシビリティ属性を変えず、見た目だけを置き換える。(2) **外部非依存・オフライン完結** — ビルド時に CSS を生成し `dist` 同梱、実行時に外部ドメインへ接続しない（draw.io セルフホスト同梱・CAD ブラウザ変換と同じ思想）。(3) **トークン駆動** — 配色・タイポグラフィ・余白等を `@theme` のデザイントークンに集約し、マジックナンバーの直書きを避ける。(4) **全面移行** — 11 個の `*.module.css` を全廃し、CSS Modules と Tailwind の長期併存を作らない。

本書は冒頭で技術導入と全体像を述べ、以降は章ごとに「何を・どのファイルに・どう統合するか・エラーと検証・テスト」を具体化する。末尾に **DECISION-NEEDED** 節（ユーザー最終確認が必要な項目）とレビュー応答欄を置く。

---

## 1. 技術導入（Tailwind v4 / CSS-first・承認後ロック）

### 1.1 技術スタック（確定・承認後ロック）

- **スタイリング**: **Tailwind CSS v4 系の最新版**（例: v4.x）、**CSS-first 設定**（`tailwind.config.js`・PostCSS 設定を作らない）。
- **ビルド統合**: **`@tailwindcss/vite` プラグイン**（v4 の Vite 公式プラグイン。PostCSS 経由より高速で設定が少ない）。
- **エントリ CSS**: 既存 `src/index.css` を Tailwind のエントリとして使い、先頭に `@import "tailwindcss";` を置く。
- **トークン定義**: CSS の **`@theme` ディレクティブ**でライト基準トークン（色/フォント/余白/角丸/影）を定義。ダークは後述の戦略で上書き。
- **ダークモード**: **`@custom-variant dark` で class/data 戦略**を宣言（下記 1.4・3 章）。`prefers-color-scheme` の自動 media 戦略だけに頼らない。
- **既存基盤**: Vite 8 + React 18 + TypeScript 6 + Vitest 4（いずれも据え置き）。追加 UI フレームワークは入れない。
- **フォント**: 既定はシステムフォントスタック（オフライン可）。Zed 風の端正さのためのローカル同梱フォント採用可否は DECISION-NEEDED（D-FONT）。

バージョンは「v4 最新・懸案なければ最新」というユーザー方針に従い **v4 系の最新版**を前提とする。確定マイナー系列は本書で断定しない（`tailwindcss` は現状 `package.json`/`node_modules` に未導入のため、本 spec 内では実在系列を裏取りできない）。**導入時に `npm view tailwindcss version` で取得した v4 系最新を devDependencies へ厳密ピン**する（1.3）。本書に記す構文（`@import "tailwindcss";`・`@theme`・`@custom-variant`）は v4 の安定仕様に基づき、`@theme` 名前空間や `@custom-variant` のマイナー差があれば実バージョンに合わせて初手で読み替える。

### 1.2 なぜ `@tailwindcss/vite`（PostCSS 版ではなく）か

Tailwind v4 は 2 つの導入経路がある: (a) `@tailwindcss/vite` プラグイン、(b) `@tailwindcss/postcss` を PostCSS に挿す方式。**本設計は (a) を採用する**。理由: Janus は既に Vite 8 を使っており、PostCSS 設定ファイルを新設せずに済む（CSS-first 方針＝設定ファイルを増やさないに合致）。(a) は Vite のパイプラインに直結し HMR とビルドが速い。(b) は PostCSS を別途構成するフレームワーク向けで、本プロジェクトには不要な間接層が増える。したがって (a) に一本化する。

### 1.3 `vite.config.ts` への統合（具体）

既存の `vite.config.ts` は `@vitejs/plugin-react` と `server.proxy`、`test`（Vitest）設定を持つ。これらを壊さず **plugins 配列に Tailwind を追加するだけ**とする。

```ts
// vite.config.ts（変更イメージ・本フェーズでは実装しない）
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],   // ← tailwindcss() を追加
  server: { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['src/test/setup.ts'] },
})
```

`package.json` には `tailwindcss` と `@tailwindcss/vite` を **devDependencies にピン止め（厳密バージョン）** で追加する（開発/ビルド時のみ必要。ランタイム依存ではない）。採用フォントをローカル同梱する場合はフォントファイルを `src/assets/fonts/`（または `public/fonts/`）に置き `@font-face` で参照する（D-FONT 確定後）。

### 1.4 エントリ CSS の構成（`src/index.css` を再編）

既存 `src/index.css`（`:root` のフォント/配色、`a`/`h1`〜`h3`/`input`/`textarea`/`article` 等）を **Tailwind エントリ**へ再編する。構成は次の順:

```css
/* src/index.css（刷新後イメージ） */
@import "tailwindcss";

/* ダークを class/data 戦略で駆動する（3 章）。*/
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* デザイントークン（2 章）。ライト基準値。*/
@theme {
  /* 色・フォント・余白・角丸・影 … 2 章参照 */
}

/* ダーク時のトークン上書き（3 章）。*/
@layer base {
  [data-theme="dark"] { /* --color-* を上書き */ }

  /* base: 既存 index.css の最小グローバル（box-sizing, body margin 等）*/
  * { box-sizing: border-box; }
  body { @apply bg-surface text-fg; margin: 0; }
}

/* Markdown 本文（article）の体裁は限定的な @apply コンポーネントクラス or @layer で再現（6 章）。*/
```

採用するダーク戦略の構文は **1 本に確定する**。指標は `data-theme`（3 章で確定）であり、`<html>` は常に `data-theme="light"` か `data-theme="dark"` のどちらかに解決して書く（3.1 の解決ロジック）。確定構文は次とする:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

> 注: v4 のバージョン差で `:where`/`:is` 等の軽微な違いがありうるが、その場合は上記と等価な形（`data-theme="dark"` を祖先指標として `dark:` を効かせる）に読み替えるだけとし、戦略・指標そのものは変えない。class 戦略（`.dark`）は採らない。

### 1.5 ESLint / Vitest / テストへの影響

- **ESLint**: 既存は `@eslint/js` + `typescript-eslint` + React hooks/refresh。CSS に対する lint は行っておらず、Tailwind 化で ESLint 設定の変更は不要（任意で `eslint-plugin-tailwindcss` を足せるが v4 対応状況が不確かなため**本刷新では導入しない**＝余計な依存を増やさない）。
- **Vitest**: テスト環境は実 `vite.config.ts` のとおり **`test.environment: 'node'` が既定**で、DOM が要るテストは各ファイル先頭の docblock `// @vitest-environment jsdom` で **per-file 指定**する運用（既存 `*.test.tsx` が全てこの方式）。**Tailwind の CSS はテスト実行に影響しない**（Vitest は CSS を評価せず、クラス名は文字列として DOM 属性に乗るだけ）。`@import "tailwindcss"` の解決はビルド時であり、テストでは CSS Modules の `styles.*` オブジェクトが消えることだけが差分になる。新規に足すテーマ関連テストの環境指定は 10 章で確定する。
- **テストのクラス参照（実査結果）**: フロントテストは **CSS Modules クラス名（`styles.*`）を一切参照していない**（実査で 0 件）。検証は role / text / `data-*`（`data-op`/`data-drawio-container`/`data-directive`）/ 要素タグに依存している。したがって **Tailwind 化でテスト修正はほぼ発生しない**。唯一の注意点は「`import styles from './X.module.css'` を削除したとき、その TSX が参照する `data-*` 属性や role を**維持**すること」。移行時に `data-op` 等の属性を Tailwind クラスへ置換しないよう徹底する（これらは**スタイルではなくテスト契約**として残す）。この不変条件を 7 章の検証で固定する。

---

## 2. デザイントークン（Zed docs 風・`@theme`）

Zed docs の見た目特性は「ダーク基調・落ち着いた低彩度・情報密度の高い端正なタイポグラフィ・繊細なボーダー・控えめな角丸と影」である。これを `@theme` のトークンに落とす。**色は OKLCH で定義**する（v4 標準・知覚的に均一でダーク/ライトの明度調整がしやすい。Firefox 128+ で `oklch()` 対応）。以下は提案値（最終確定は DECISION-NEEDED D-PALETTE）。

### 2.1 配色（ライト基準値・`@theme`）

| トークン | 用途 | ライト（提案） | ダーク（提案・3 章で上書き） |
|---|---|---|---|
| `--color-surface` | 画面背景 | `oklch(0.99 0 0)`（ほぼ白） | `oklch(0.17 0.01 260)`（Zed 風の濃紺グレー） |
| `--color-surface-raised` | カード/サイドバー背景 | `oklch(0.975 0.002 260)` | `oklch(0.21 0.012 260)` |
| `--color-fg` | 本文テキスト | `oklch(0.25 0.01 260)` | `oklch(0.92 0.005 260)` |
| `--color-fg-muted` | 補助テキスト | `oklch(0.5 0.01 260)` | `oklch(0.68 0.008 260)` |
| `--color-border` | 繊細な境界線 | `oklch(0.9 0.004 260)` | `oklch(0.3 0.01 260)` |
| `--color-primary` | アクセント/リンク | `oklch(0.55 0.17 255)`（Zed 風の青） | `oklch(0.72 0.14 255)` |
| `--color-primary-contrast` | primary 上の前景 | `oklch(0.99 0 0)` | `oklch(0.17 0.01 260)` |
| `--color-success` | 成功 | `oklch(0.6 0.14 150)` | `oklch(0.72 0.15 150)` |
| `--color-warning` | 警告 | `oklch(0.72 0.15 80)` | `oklch(0.8 0.15 80)` |
| `--color-danger` | 削除/エラー | `oklch(0.55 0.19 25)` | `oklch(0.68 0.19 25)` |
| `--color-ring` | フォーカスリング | `--color-primary` | `--color-primary` |

`@theme` で `--color-surface` 等を定義すると、Tailwind は自動で `bg-surface`/`text-fg`/`border-border`/`text-primary`/`bg-danger` 等のユーティリティを生成する。既存 `*.module.css` の意味的配色（編集=青 `#2563eb`、削除=赤 `#dc2626`/`#c0392b`、スピナー強調 `#1f6feb`、プレースホルダ `#666`）はそれぞれ `--color-primary`/`--color-danger`/`--color-fg-muted` に対応づけてトークン化する（要件 DS-2-5）。

### 2.2 タイポグラフィ（`@theme`）

- **フォントスタック（既定・オフライン可）**: 現 `index.css` の `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", Meiryo, sans-serif` を `--font-sans` として維持。等幅は `--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`（現 `article code` 相当）。
  - **選択肢**: Zed 風の端正さを強めるなら Inter（本文）等をローカル同梱して `--font-sans` 先頭に差す案があるが、bundle 増とライセンス追記を伴う。**既定はシステムフォント維持（追加なし）を推奨**し、同梱は DECISION-NEEDED（D-FONT）。
- **サイズスケール**: `--text-xs 0.8rem / --text-sm 0.9rem / --text-base 1rem / --text-lg 1.1rem / --text-xl 1.3rem / --text-2xl 1.8rem`（現 `index.css` の `h1 1.8rem`・`h2 1.3rem`・`h3 1.1rem`・`code 0.9em` を踏襲）。
- **行間**: 本文 `line-height 1.6`（UI）/ `1.7`（`article` 本文）を `--leading-normal`/`--leading-relaxed` に対応。

### 2.3 余白・角丸・ボーダー・影（`@theme`）

- **余白スケール**: Tailwind 既定の spacing（`0.25rem` 刻み）をそのまま使う。現 `*.module.css` の `0.5/0.75/1/1.5rem` 等はすべて `gap-2`/`gap-3`/`p-4`/`p-6` 等に対応。
  - **トークン駆動原則の例外**: 2.1 の「マジックナンバー直書き禁止」は配色・タイポ等の設計値を指す。**Tailwind 既定スケール（spacing・`max-w-*` 等）の利用はこの禁止の例外**として許容する（既定スケール自体がトークン化された設計値であり、`gap-2`/`p-6`/`max-w-3xl` のようなスケール参照は数値直書きとは見なさない）。本文幅は `max-w-3xl`（= 48rem、現 `AppLayout.module.css` の `max-width: 48rem` と一致）に**確定**する。
- **角丸**: `--radius-sm 3px / --radius 4px / --radius-md 6px`（現 `input 4px`・`code 3px`・`pre 6px` を踏襲。Zed 風の控えめな角丸）。
- **ボーダー**: 既定 1px、色は `--color-border`（繊細な境界）。
- **影**: Zed docs 風に控えめ。`--shadow-sm`（カード/ポップアップ用の薄い影）程度に留め、強い影は使わない。

---

## 3. ダークモード機構（OS 追従 + 手動トグル・生成コンテンツ整合）

### 3.1 戦略の選定（`data-theme` + 3 状態トグル）

Tailwind v4 のダークモードは `@custom-variant` で戦略を宣言する。候補は class 戦略（`<html class="dark">`）と data 戦略（`<html data-theme="dark">`）だが、**本設計は `data-theme` 戦略を 1 本に確定して採用する。** 理由: (1) `class="dark"` はユーティリティ的なクラス空間と混ざりやすいが、`data-theme` は「テーマ指標」という意味が属性名から明確。(2) 将来 `data-theme="high-contrast"` 等の拡張がしやすい。(3) 生成コンテンツ（draw.io/CAD SVG）へ同じ `data-theme` を波及させたくなったときに属性ベースのほうが扱いやすい。

確定する宣言（1.4 と同一・本書で唯一採用する形）:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

`<html data-theme="light|dark">` は下記解決ロジックで常に `light`/`dark` のどちらかに解決して書く（`"system"` を属性へ直接書かない）。class 戦略（`.dark`）は採用しない。

**トグルの状態セット（3 状態）**: `"system"（OS 追従・既定）/ "light"（明示ライト）/ "dark"（明示ダーク）`。実効テーマの決定ロジック:

```
effectiveTheme = (preference === "system")
  ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  : preference
// <html data-theme={effectiveTheme}> を設定する（"light"/"dark" のどちらかに解決して書く）
```

`preference === "system"` のときは `matchMedia` の変化を購読し、OS 設定変更に追従して `data-theme` を更新する。

### 3.2 永続化と FOUC 回避

- **永続化（キー名を確定）**: `preference` を `localStorage` に保存する。**キー名は `janus-theme` に確定**し、格納値は文字列 `"system" | "light" | "dark"` の 3 値のいずれかに限定する。FOUC スクリプト（本節）・`useTheme`（3.3 の React 層）・10 章の永続化ユニットテストは、いずれもこの確定キー `janus-theme` と 3 値を参照する（実装者ごとの `theme`/`janus.theme` 等のブレを禁じる）。
- **FOUC 回避（実装形態を確定）**: `<html>` に初期 `data-theme` を**描画前に**適用するため、**`index.html` の `<head>` に置くインラインの小スクリプトを本 spec の確定採用とする**（ビルドに含まれる自オリジンのインラインのため外部依存なし）。このスクリプトは `localStorage` の `preference` と `matchMedia` から実効テーマを計算し、`document.documentElement.dataset.theme` を即時設定する。これにより React マウント前に正しいテーマが乗り、ちらつきが出ない。現状 `index.html`（実ファイル確認済み）は `<head>` に何もインライン実行していないため、本刷新ではこのインライン `<script>` を 1 つ追加する差分になる。確定とする理由: 現状 CSP 未設定の環境に最も素直で差分が最小、かつエントリ 1 ファイルで完結し実装者の判断を残さない（1.1「承認後ロック」方針と整合）。
  - スクリプトは例外安全に書く（`try/catch` で `localStorage`/`matchMedia` 不在時も落ちない。11 章の不正値正規化・ガードと同じ規則を適用）。
- **CSP との整合（将来の条件付き代替・既定は変えない）**: Janus は現状 Content-Security-Policy を課していないため、上記インライン `<script>` はそのまま実行される。**将来 CSP を導入する場合のみ**（サーバーモードの Django、ローカルモードの PWA いずれでも）、インラインスクリプトは `script-src` に nonce / hash（例 `script-src 'self' 'sha256-…'`）が無いと無言で失効し、ダーク既定運用でちらつき/誤テーマが出る。その時点での対応は 2 択で、(a) このスクリプトに nonce/hash を付与して許可する、または (b) 同スクリプトを `public/theme-init.js` として自オリジン配信し `<script src="/theme-init.js">` で読み込む方式（外部非依存は維持・CSP 下でも `script-src 'self'` だけで通る）へ移行する。**どちらも「CSP を導入したとき」に初めて検討する移行条件付きの代替であり、本刷新の既定はあくまで `<head>` インライン `<script>` に確定する**（実装フェーズへ決定を先送りしない）。
- **React 層**: テーマ状態は軽量な `ThemeProvider`（React Context）か、Context を増やさず `useTheme` フック + モジュール内状態で管理する。**既存の Provider 入れ子（BrowserRouter > StorageProvider > AuthProvider）を複雑化させないため、`ThemeProvider` は最外（または `main.tsx` のルート直下）に 1 枚だけ足す**。トグル UI は `AppLayout` のヘッダーに置く（4 章）。

### 3.3 生成コンテンツ（CAD SVG / draw.io）との整合（要件 DS-3-6）

現状の生成コンテンツは **OS 設定（`prefers-color-scheme`）追従**で明暗を切り替える:

- **CAD 変換 SVG**: `cad/config.ts` の `lightColors`/`darkColors` を SVG 内 `<style>` の `prefers-color-scheme` メディアクエリで切替。`CustomMapViewer` は SVG を `<img src>`（Blob URL）で描画するため、**アプリ側の `data-theme` は SVG 内部に届かない**（`<img>` 内のメディアクエリは閲覧者の OS 設定を見る）。
- **draw.io**: セルフホスト同梱 webapp を自オリジン iframe で開く。webapp 内部のテーマは webapp 側の設定/OS に従い、`data-theme` は iframe 境界を越えない。

したがって、**アプリの手動トグルが OS 設定と食い違う場合、本体はトグル値・生成コンテンツは OS 値**となり、明暗が割れうる。方針を次の 2 案で比較し **A を採用**する:

- **A（採用・割れを許容し既定を OS 追従にする）**: アプリの**既定を "system"（OS 追従）**にすることで、既定運用では本体も生成コンテンツも OS に揃い割れが起きない。利用者が**明示的に**トグルで OS と異なるテーマを選んだ場合のみ、`<img>` の CAD SVG と iframe の draw.io が OS 側に残り割れる。この割れは「明示上書き時の既知の制約」として許容し、UI に軽い注記を出せる余地を残す（必須ではない）。実装が単純で、生成コンテンツのパイプライン（foundation/3a 由来）に手を入れずに済む＝非破壊。
- **B（却下・指標を波及させる）**: CAD 変換時に SVG の `prefers-color-scheme` 依存をやめ `data-theme` 連動の `<style>` を焼き込む、draw.io に theme パラメータを渡す等で揃える案。これは **生成コンテンツのパイプライン改変＝ foundation/3a の非破壊方針に反する**うえ、`<img>` 描画では外部 `data-theme` を参照できず結局追加の仕組み（インライン SVG 化＝ XSS 面の後退）が要る。本刷新のスコープ（見た目のみ・非破壊）を超えるため却下。

**結論（DECISION-NEEDED D-GENCONTENT で最終確認）**: 既定 OS 追従 + 明示上書き時の割れ許容（A）。これにより生成コンテンツに触れず非破壊を保つ。将来、生成コンテンツ側の `data-theme` 連動が必要になれば別課題で扱う。

---

## 4. 共通レイアウト（AppLayout の Zed docs 風再設計）

### 4.1 構成

Zed docs は「上部ヘッダー + 左サイドバーナビ + 中央本文（max-width で可読幅に制限）」。現 `AppLayout.tsx` は「上部ヘッダー + 中央 `<main>`（`max-width: 48rem`）」のみで左サイドバーがない。本刷新で **左サイドバーを追加**する。

```
┌───────────────────────────────────────────────┐
│ Header: [Janus]            [🌓 theme] [user] [logout] [LICENSE/NOTICE] │
├──────────────┬────────────────────────────────┤
│ Sidebar      │ Main (max-width 48rem = max-w-3xl, 中央寄せ)        │
│  ・ページ一覧 │   {children}                                      │
│  ・アセット   │                                                   │
│  （文脈導線） │                                                   │
└──────────────┴────────────────────────────────┘
```

- **ヘッダー**: アプリ名「Janus」（`/` リンク・`brand`）、右側にダークトグル・`username`・ログアウトボタン・ライセンス/帰属導線（`/drawio/LICENSE`・`/drawio/NOTICE` への素の `<a>`、要件 DS-4-5）。Tailwind: `flex items-center justify-between border-b border-border bg-surface-raised px-6 py-3`。
- **サイドバー**: グローバル導線（`ページ一覧` `/`、`アセットライブラリ` `/assets`）。Tailwind: `w-56 shrink-0 border-r border-border bg-surface-raised p-4`。アクティブ項目は `aria-current="page"` + アクセント下地。
- **本文**: `mx-auto max-w-3xl p-6`（現 `max-width: 48rem` 相当）。Markdown 本文は 6 章の `article` スタイル。

### 4.2 既存挙動の保持（非破壊・要件 DS-4-4）

現 `AppLayout.tsx` の分岐を**そのまま維持**し、見た目クラスだけ差し替える:

- `user === null`（未ログイン/復元中）→ ヘッダー/サイドバーを出さず `<main>` のみ返す。
- `/login`・404 はレイアウト外（`App.tsx` 変更なし）。
- ログアウト → `logout()` → `navigate('/login', { replace: true })`。
- ナビの `aria-label="グローバル"` 等の既存 aria を維持。

### 4.3 レスポンシブ（要件 DS-4-3）

- 広幅（`md:` 以上）: サイドバー常設（`md:flex`）。
- 狭幅（モバイル/Android）: サイドバーを**折りたたむ**。ヘッダーにハンバーガーボタン（`aria-expanded`/`aria-controls` 付き、キーボード操作可）を置き、開閉でサイドバーをオーバーレイ表示する。既定は閉じ。Tailwind: `hidden md:flex` + 開時 `fixed inset-y-0 left-0 z-40 ...`。
- 本文は常に `mx-auto max-w-3xl` で可読幅を保つ。

**新規オーバーレイサイドバーのキーボード/フォーカス仕様（本刷新で新規追加する操作可能要素・受け入れ挙動を確定）**: 狭幅時のサイドバーオーバーレイは本刷新で新規に導入する操作可能要素のため、既存 draw.io 全画面（`Escape` クローズを持つ）との一貫性も含めて以下を**確定仕様**とする。

- **開く**: ハンバーガーボタンを `aria-expanded="true"` にし、オーバーレイのサイドバーを `role="dialog"` 相当（`aria-modal="true"` + `aria-label="グローバルナビゲーション"`）で表示する。開いた直後に**最初のナビ項目へフォーカスを移動**する。
- **閉じる（3 経路）**: (a) `Escape` キー、(b) 背景（半透明オーバーレイ `fixed inset-0 bg-black/50`）クリック、(c) ナビ項目の選択（遷移に伴い閉じる）。いずれの経路でも閉じた後に**フォーカスをハンバーガーボタンへ復帰**させ、`aria-expanded="false"` に戻す。
- **開いている間のフォーカス閉じ込め**: 展開中は背後の本文/ヘッダーを操作不可にする。手段は背後コンテナへ `inert` 属性を付与する（`inert` が使えない環境では、Tab 到達要素をオーバーレイ内に限定する簡易フォーカストラップで代替）。これにより Tab で背後要素へフォーカスが抜けない。
- **広幅（`md:` 以上）常設時**: 上記のモーダル挙動（フォーカス移動/復帰・`inert`・`aria-modal`）は適用しない（常設ナビであり閉じない）。モーダル挙動は狭幅のオーバーレイ表示時のみ。
- これらは 5.1 で切り出す `Modal`（または専用のオーバーレイサイドバー）コンポーネントに実装し、挙動を 10 章でユニットテストする（`aria-expanded` の `true`/`false` 遷移、`Escape`/背景クリック/項目選択による閉、閉じたときのハンバーガーへのフォーカス復帰、開時の最初のナビ項目へのフォーカス移動）。

### 4.4 ナビ項目構成（要件 DS-4-2）

- 常設グローバル: `ページ一覧 (/)`・`アセットライブラリ (/assets)`。
- 文脈導線（履歴 `/history/*`・権限 `/permissions/*`・編集 `/edit/*`）は各ページ内の操作導線（現状 `PageViewPage` の `actions` 等）として維持し、サイドバーには出さない（画面文脈に依存するため）。この分担は現状の情報設計を保ちつつ Zed 風の「グローバルは左、文脈は本文上部」に合致する。

---

## 5. コンポーネント設計（体裁基準とクラスの当て方）

### 5.1 スタイルの当て方の方針（要件 DS-5-2）

3 手段を次の基準で使い分ける:

1. **ユーティリティ直書き（既定・大多数）**: 1 回しか使わないレイアウト/装飾はマークアップ近傍にユーティリティで書く。CSS Modules を置き換える基本手段。
2. **共通 React コンポーネント化**: 構造 + 挙動 + スタイルが繰り返す UI（Button・Alert・Spinner・Modal 等）は小さな React コンポーネントに切り出し、`props` で variant を受ける（例 `<Button variant="danger">`）。**挙動を伴うもの**はここに寄せる。
3. **`@apply` の小コンポーネントクラス（限定）**: マークアップに手を入れにくい箇所（Markdown レンダラが生成する `article` 内の `code`/`pre`/`table` 等、クラスを個別付与できない要素）に限り、`@layer components` で `.prose-code { @apply ... }` 的なクラス、または要素セレクタ + `@apply` を使う（6 章）。**`@apply` の多用は避け**、まず 1・2 を優先する（過度な抽象化回避）。

共通コンポーネントは `src/components/ui/`（新規）に `Button.tsx`・`Alert.tsx`・`Spinner.tsx`・`Modal.tsx` 等として置く案を推奨する（既存 `components/` 配下の `AppLayout`/`Breadcrumbs` と並べる）。ただし**作りすぎない** — 実際に 2 箇所以上で使われるものだけ切り出す。

### 5.2 UI 体裁基準（要件 DS-5-1）

| UI | 体裁基準（Tailwind 概要） | トークン |
|---|---|---|
| ボタン（通常） | `inline-flex items-center rounded border border-border bg-surface-raised px-3 py-1.5 hover:bg-surface` | border/surface |
| ボタン（アクセント） | `bg-primary text-primary-contrast hover:opacity-90` | primary |
| ボタン（危険） | `border-danger text-danger hover:bg-danger/10`（現 `deleteButton` 相当） | danger |
| テキスト入力/テキストエリア | `rounded border border-border bg-surface px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-ring`（現 `input:focus` 相当） | border/ring |
| フォーム | `grid gap-2`（現 `AssetLibraryPage .form` 相当・`max-w-lg`） | — |
| 通知/アラート | 役割別の下地 + `role`: 成功 `bg-success/10 text-success`、警告 `bg-warning/10`、エラー `bg-danger/10 text-danger`、情報 `bg-primary/10` | 状態色 |
| モーダル/オーバーレイ | 背面 `fixed inset-0 bg-black/50`、本体 `rounded-md bg-surface-raised shadow-sm`、`role="dialog" aria-modal="true"` | surface/shadow |
| スピナー | 現 `AssetLibraryPage .spinner`（回転ボーダー + currentColor）を `Spinner` コンポーネント化。`animate-spin` ＋ `border-2 border-current border-t-transparent rounded-full` | primary |

状態色の下地に `/10`（10% 不透明）を使うのは、ライト/ダーク両方で地色に馴染む淡い塗りを作るため（`color-mix` 相当・v4 がサポート）。

### 5.3 既存のオーバーレイ/変換 UX の再現（要件 DS-5-3）

- **draw.io 全画面編集**: 現状 iframe を全画面相当で開く編集 UI。Tailwind でオーバーレイ（`fixed inset-0 z-50`）+ iframe を再現。**既存の実装（`PageEditPage.tsx` の `isDrawioFullscreen` 分岐）が持つのは `role="dialog"`・`aria-modal`・`Escape` キーで閉じる処理のみで、フォーカストラップ（Tab のループ閉じ込め・開閉時のフォーカス移動/復帰）は実装されていない**（実コードで確認済み）。本刷新ではこれら既存の属性・挙動（`role="dialog"`/`aria-modal`/`aria-label`/`Escape` クローズ）を**そのまま維持**し、クラスのみ Tailwind へ差し替える。**フォーカストラップは本刷新のスコープ外**（別課題）とし、「既存にあるトラップを移植する」とは解釈しない（存在しないため）。なお、本刷新で**新規に追加する**モバイルサイドバーのオーバーレイには新規にフォーカス管理を定義する（4.3）。draw.io 全画面にも同じ Modal 共通コンポーネント（5.1）を将来適用してトラップを足す余地はあるが、それは本スコープに含めず、含めるなら明示の別タスクとする。
- **変換中の二重操作防止（AssetLibraryPage）**: ユーザー確定方針（軽い案 3-A）= 変換中は入力・ボタンを一括 `disabled` + 「変換中...」スピナーを分かりやすく表示（モーダルは作らない）。現 `.spinner` の体裁を `Spinner` コンポーネントで再現し、`disabled` スタイルは `disabled:opacity-50 disabled:cursor-not-allowed` で表現する。
- **ファイル選択表示**: 現状「自前ボタン + 選択ファイル名（未選択時はプレースホルダ `fileNameEmpty`）」の構造（視覚的に隠した `input` + ラベル委譲）を維持し、`fileButton`/`fileName`/`fileNameEmpty`/`visuallyHiddenInput` の体裁を Tailwind へ移す（`sr-only` 相当のユーティリティで `visuallyHiddenInput` を置換）。

### 5.4 CustomMapViewer（インラインスタイル）の扱い（要件 DS-5-4）

`CustomMapViewer` は全要素インラインスタイルで、パン/ズーム/回転は**動的計算（`transform` 等）**をインラインで当てている。方針:

- **動的トランスフォーム（`transform`/座標/`rotate` 等の計算値）はインラインのまま維持**する（Tailwind ユーティリティは静的クラスで動的数値を表現できないため。無理に CSS 変数化すると可読性と非破壊性を損なう）。
- **静的な枠・ツールバー・ボタン・写真ポップアップの体裁のみ Tailwind 化**する（配色をトークンに乗せ、ダーク対応させる）。
- SVG を `<img src>`（Blob URL）で描画する既存のセキュリティ姿勢（スクリプト実行コンテキストに置かない）は変えない。
- この境界（インライン維持 vs Tailwind 化）は実装時にコンポーネントを読んで線引きを確定する。表示挙動（パン/ズーム/回転/最小化/ポップアップ）は不変。

---

## 6. Markdown 本文（article）スタイルの移し替え

現 `index.css` の `article`（`line-height 1.7`、`h1`〜`h3` の `margin-top`、`p`/`ul`/`a`、`code`/`pre`）は、Markdown が生成する DOM に対して**要素セレクタ**で効いている（個別にクラスを付けられない）。

**付与先の特定（実コード確認済み）**: `MarkdownRenderer.tsx` は `<ReactMarkdown>` を素で返すだけで**ラッパ要素（`<article>` 等）を描画しない**。`<article>` 要素は呼び出し側の `PageViewPage.tsx`（`<article><MarkdownRenderer body={page.body} /></article>`）にのみ存在し、現 `index.css` の `article …` 要素セレクタはこの `<article>` に効いている。また `MarkdownRenderer` を使うのは **`PageViewPage` のみ**（grep 確認済み。プレビュー等の別経路なし）であり、prose スタイルの付与は 1 箇所でよい。

Tailwind 化の方針:

- prose コンテナクラス（例 `className="prose-janus"`）は **`PageViewPage.tsx` の既存 `<article>` 要素に付与**する。**`MarkdownRenderer` 自体はラッパ要素を追加しない**（不要な DOM 構造変更＝非破壊方針との摩擦や、PageViewPage の既存 `<article>` との二重ラッパを避けるため）。
- `@layer components` で `.prose-janus { ... } .prose-janus :where(h1,h2,h3) { @apply ... } .prose-janus code { @apply ... } .prose-janus pre { @apply ... }` のように**要素セレクタ + `@apply`** で現体裁を再現する。
- 将来 `PageEditPage` にプレビューを足す場合も、プレビューを包む要素へ同じ `.prose-janus` を付与する（付与箇所の規約を 1 本に統一）。
- `@tailwindcss/typography`（prose プラグイン）は**導入しない**: 追加依存を増やさず、現状の軽い体裁を自前の小さな `.prose-janus` で再現するほうが Janus の軽量方針に合う。将来必要になれば別途検討。
- `article code`/`pre` の背景（現 `#f3f4f6`）は `--color-surface-raised` 系トークンに置換し、ダークで破綻しないようにする。

---

## 7. 移行計画（全面移行の順序・検証・不変条件）

### 7.1 不変条件（移行中つねに守る）

1. **挙動・API・保存形式・権限・記法・aria は不変**。変えるのは見た目だけ。
2. **`data-*` 属性・role・テキスト・要素タグはテスト契約**として維持する（スタイルへ置換しない）。特に `data-op`/`data-drawio-container`/`data-directive` と各 `role`/`aria-*`。
3. **各段階で緑**: 段階ごとに `tsc -b`・`vitest run`・`vite build`・`eslint .` を通す（回帰ゼロ）。

### 7.2 順序

1. **基盤導入**: `@tailwindcss/vite` + `tailwindcss` を devDependencies にピン追加、`vite.config.ts` に `tailwindcss()` 追加、`src/index.css` を `@import "tailwindcss";` + `@theme`（トークン）+ base へ再編。この時点で既存 `*.module.css` は残したまま（併存は一時的に許容し、段階末で消す）。`tsc`/`test`/`build`/`lint` 緑を確認。
2. **トークン/テーマ確定**: 2 章のトークンを `@theme` に入れ、3 章のダーク機構（`@custom-variant`・`data-theme`・FOUC スクリプト・`ThemeProvider`・ヘッダートグル）を実装。ライト/ダークで素の要素が破綻しないことを確認。
3. **AppLayout 再設計**: 4 章の Zed 風レイアウト（サイドバー + ヘッダー + トグル + レスポンシブ）へ。`AppLayout.module.css` を削除し import を除去。既存挙動（未ログイン非表示等）維持を `AppLayout.test.tsx` で確認。
4. **共通 UI**: 5 章の `Button`/`Alert`/`Spinner`/`Modal` 等を `components/ui/` に用意（実際に複数箇所で使うものだけ）。
5. **各ページ移行**: `Breadcrumbs` → `PageListPage` → `PageViewPage`（+ `article`/6 章）→ `PageEditPage` → `PageHistoryPage`（`data-op` 維持）→ `PagePermissionPage` → `AssetLibraryPage`（ファイル選択・変換スピナー・disable）→ `CommentSection` → `MapEditor` → `DrawioViewer` → `CustomMapViewer`（5.4 の境界）。各ページ移行で対応する `*.module.css` を削除し import を除去、該当テストが緑であることを確認。
6. **全廃確認**: 下記 7.3。

### 7.3 CSS Modules 全廃の確認方法

**実行 cwd を `janus/frontend`（`package.json` の所在・npm スクリプトと同じ cwd）に固定**して以下を実行する。npm スクリプト（`build`/`test:run`/`lint`）がこの cwd で動くため、確認コマンドも同じ cwd・同じ相対パス（`src`）で揃え、`frontend/frontend/src` のようなパスずれによる偽陰性（「0 件＝全廃」ではなく「パス誤りで何も見ていない」）を防ぐ。

```sh
# cwd = janus/frontend （npm run build / test:run / lint と同一 cwd）
grep -rn "module.css" src           # 0 件（import 残骸・参照なし）
find src -name "*.module.css"        # 0 件（ファイル全削除）
grep -rn "import styles" src         # 0 件（CSS Modules 既定インポートなし）
grep -rn "@import \"tailwindcss\"" src   # 1 件（エントリ CSS src/index.css のみ）
test ! -e tailwind.config.js && test ! -e postcss.config.js && echo "no config files"  # 設定ファイル不在
```

- `grep -rn "module.css" src` が **0 件**（import 残骸なし）。
- `find src -name "*.module.css"` が **0 件**（ファイル全削除）。
- `grep -rn "import styles" src` が **0 件**。
- `@import "tailwindcss";` がエントリ CSS（`src/index.css`）に 1 箇所、`tailwind.config.js`/`postcss.config.js` が**存在しない**こと。

> 補足: リポジトリルートから打つ場合は全パスを `frontend/src` に統一する（`grep -rn "module.css" frontend/src` 等）。本 spec はブレを避けるため **cwd=`janus/frontend`・相対パス `src`** を正式手順に確定し、7.4 の自動検証（`npm run build`/`test:run`/`lint`）と同一 cwd で回す。

### 7.4 検証（各段階 + 最終）

- 自動（**cwd=`janus/frontend` で実行**・7.3 の全廃 grep と同一 cwd）: `npm run build`（`tsc -b && vite build`）・`npm run test:run`（Vitest）・`npm run lint`。既存テスト（約 130 件規模）回帰ゼロ。
- 目視: **Firefox 最新**でライト/ダーク両方・各ページ・レスポンシブ（広幅/狭幅）・OS テーマ変更追従・トグル永続化（リロード）・FOUC が無いこと・生成コンテンツ（CAD SVG/draw.io）の明暗整合（既定 OS 追従で揃うこと）を確認。あわせて **状態色の `/alpha` 下地（`bg-success/10` 等）と OKLCH 色の表示が Firefox で意図どおりか**（`color-mix` 相当のアルファ合成が破綻せず、淡い下地と前景のコントラストが保たれるか）を目視チェック項目に含める。
- アクセシビリティ: フォーカスリング可視、トグル/ハンバーガー/モーダルのキーボード操作、コントラスト AA 目安（ライト/ダーク）。

---

## 8. アクセシビリティ（維持・担保）

- **意味的マークアップ維持**: `role="alert"/"status"`、`aria-label`、`aria-modal`、`aria-live`、`htmlFor`/`id`、`aria-current`、`aria-expanded`/`aria-controls`（新規ハンバーガー）を維持/適切付与。Tailwind はクラスのみ足すもので、要素/属性を削らない。
- **コントラスト**: 2 章トークンはライト/ダークで本文 4.5:1・大テキスト 3:1 を目安に調整。OKLCH の明度（L）でダーク/ライトの前景/背景差を確保。最終値は D-PALETTE 確定時にコントラスト計測で裏取り。
- **フォーカス可視**: `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring`（現 `input:focus` の 2px アウトライン相当）を全操作要素へ。マウス操作時に出ない `focus-visible` を使い、キーボード時のみリング。
- **トグル**: `<button>` に `aria-label`（例「配色テーマ切替」）と現在状態を伝える表示（アイコン + sr-only テキスト）。
- 注記: WCAG 完全準拠は支援技術の手動テストと専門家レビューが必要。本刷新はコントラスト/フォーカス/意味的マークアップ維持を設計上の担保とする（要件 DS-8-5）。

---

## 9. 非機能・制約

- **非破壊**: フェーズ 1/2/3a の機能・API・保存形式・権限・記法を変えない。既存テスト回帰ゼロ。見た目のみ刷新。
- **外部非依存・オフライン**: ビルド時 CSS 生成 + `dist` 同梱、CDN/Play CDN 不使用。フォントはシステムスタック（既定）かローカル同梱（D-FONT）。サーバー/ローカル両モードで同一ビルド成果物 = 同一スタイル。
- **対象ブラウザ**: Firefox 最新（Tailwind v4 要件: Firefox 128+ / Chrome 111+ / Safari 16.4+。OKLCH・`color-mix`・`@layer` 等に依存）。レガシー非対応。
- **bundle サイズ**: v4 は使用クラスのみ生成で CSS は軽量。`@tailwindcss/typography` 不採用で肥大回避。ローカル同梱フォント採用時のみサイズ影響を評価（woff2・サブセット化を検討）。
- **依存の最小化**: 追加は `tailwindcss` + `@tailwindcss/vite`（devDependencies・ピン止め）のみ。ESLint 用 Tailwind プラグインや prose プラグインは入れない。

---

## 10. テスト戦略

- **ユニット（Vitest・既存流儀）**: 既存テストはクラス非依存（role/text/`data-*`/タグ）。移行後も同じ検証で緑を保つ。新規 `ThemeProvider`/`useTheme`・トグル・レスポンシブのサイドバー開閉は、`localStorage` 永続化（確定キー `janus-theme`・値 `"system"|"light"|"dark"`）・`matchMedia` モック・`aria-expanded` 遷移を**ロジック/ロールベースで**ユニットテストする（CSS は評価しないので「ダークで色が変わる」ことは jsdom では検証不能＝目視/統合で担保）。
- **新規オーバーレイサイドバーの a11y 挙動（4.3 の確定仕様をユニット検証）**: 狭幅サイドバーオーバーレイについて次を role/属性ベースでテストする（CSS 非依存・jsdom で検証可能）: (a) ハンバーガー押下で `aria-expanded` が `false`→`true` に遷移し、開時に最初のナビ項目へフォーカスが移る、(b) `Escape` キーで閉じる、(c) 背景オーバーレイクリックで閉じる、(d) ナビ項目選択で閉じる、(e) いずれの閉経路でも `aria-expanded` が `false` に戻りフォーカスがハンバーガーボタンへ復帰する、(f) 展開中は背後コンテナに `inert`（または Tab 到達の限定）が掛かる。永続化・テーマ系テストと同様、このテストファイルも先頭に `// @vitest-environment jsdom` を付し、`matchMedia` を `vi.fn()` でモックする。
- **新規テーマ関連テストの環境指定（必須・既存運用追従）**: `ThemeProvider`/`useTheme`/トグル/サイドバー開閉のテストは DOM・`matchMedia`・`localStorage` を使うため、**jsdom 環境が必須**。実 `vite.config.ts` は `environment: 'node'` が既定なので、既存 `*.test.tsx` に倣い**新規テストファイル先頭へ `// @vitest-environment jsdom` を必ず付す**（付け忘れると node 環境で `window`/`matchMedia`/`localStorage` 不在により落ちる）。`matchMedia` は jsdom に存在しないため、各テスト内で `window.matchMedia` を `vi.fn()`（`matches`/`addEventListener`/`removeEventListener` を持つスタブ）でモックする。これは 11 章の `matchMedia` ガード（`typeof window.matchMedia === 'function'`）と整合する。
- **統合/目視（Firefox 実機）**: 色・コントラスト・レイアウト・ダーク/ライト・レスポンシブ・FOUC・生成コンテンツ整合は実ブラウザで確認（jsdom では不可）。
- **テスト容易性の評価**: 見た目は本質的にユニットテストしにくいため、「挙動（トグル状態・永続化・開閉・aria）」と「見た目（色・レイアウト）」を分離し、前者をユニット、後者を目視チェックリストに割る。この分離により、スタイル刷新がテストを壊さない構造を保つ。
- **回帰防止**: 7.3 の CSS Modules 全廃 grep チェックと、`data-*`/role の維持を移行チェックリストに含める。

---

## 11. エラーハンドリング・エッジケース

スタイル刷新は実行時の失敗経路が少ないが、以下を明示する:

- **`localStorage` 不可（プライベートモード等）**: テーマ `preference` の読み書きが例外を投げうる。読み取り失敗時は `"system"` にフォールバック（既定）、書き込み失敗は握りつぶして実効テーマ適用のみ継続（致命的でない・ログは `console.warn` 程度、UI は壊さない）。
- **テーマ `preference` の不正値（入力バリデーション）**: `localStorage`（キー `janus-theme`）に `"system" | "light" | "dark"` 以外の値（旧バージョンの残骸、手動改変、`null`/空文字、`"dark-blue"` 等）が入っていた場合は、**`"system"` とみなす**（＝ OS 追従にフォールバックする）。この正規化は **FOUC スクリプト（3.2・`<head>` インライン）と `useTheme`（React 層）の双方で同一のルール**を適用し、片方だけがフォールバックして実効テーマが食い違う不整合を防ぐ。具体的には読み取り値を許可リスト（`["system","light","dark"]`）で検証し、含まれなければ `"system"` を採用する。10 章のテストはこの正規化（不正値→`"system"`）も検証する。
- **`matchMedia` 不在（SSR/テスト環境）**: 本アプリは CSR のみだが、テスト（jsdom）で `matchMedia` 未定義になりうる。`typeof window.matchMedia === 'function'` をガードし、無ければ `"light"` を実効テーマの既定にする（テストで `matchMedia` をモック可能にする）。
- **FOUC スクリプト失敗 / CSP で失効**: `<head>` インラインスクリプトが例外、または将来 CSP（3.2）で実行拒否された場合でも、`data-theme` 未設定なら CSS の既定（ライト基準トークン）で描画されるだけで**機能は壊れない**（グレースフルデグレード）。ただし **失敗＝初期描画のちらつき（ダーク既定運用で一瞬ライトが見える / 誤テーマ）** が運用上の症状として出る点に注意する。CSP 導入時は 3.2 の nonce/hash 許可か `public/theme-init.js` 方式でスクリプトを確実に実行させてちらつきを防ぐ。
- **ダーク/ライトで読めない配色**: コントラスト不足は「バグ」として扱い、D-PALETTE 確定時と目視検証で潰す。トークンの単一変更で全画面に波及するため修正は一箇所。
- **生成コンテンツの明暗割れ（既知の制約）**: 3.3-A のとおり、明示トグルが OS と食い違うときのみ `<img>` CAD SVG / draw.io iframe が OS 側に残る。これは致命でなく、既定 OS 追従運用では発生しない。必要なら注記 UI を出す（任意）。

---

## 12. foundation / phase2 / phase3a との関係（所有・非破壊）

- **所有**: 機能はフェーズ 1/2/3a が所有し本書は変更しない。本書は**見た目（デザインシステム）だけ**を所有する横断 spec。
- **非破壊**: 既存受入基準・既存テストを覆さない。`:::custom-map`/draw.io 記法、`StorageClient` 契約、REST API、権限モデル、保存単一経路（`save_page_body`）は不変。
- **生成コンテンツ**: CAD SVG の `prefers-color-scheme` 連動（foundation/3a）・draw.io セルフホスト同梱（3a）を前提に、3.3-A の整合方針を採る（生成パイプラインに触れない＝非破壊）。
- **3b 整合**: 本刷新は 3b（ローカルモード）が同一ビルド = 同一スタイルを得る基盤。モード差でスタイルが変わらない。

---

## 13. DECISION-NEEDED（ユーザー最終確認が必要な項目）

以下はいずれも **CONFIRMED（2026-10-05 ユーザー確認済み・全項目を推奨案どおり確定）**。実装はこの確定に従う。

- **D-PALETTE（配色の最終決定）— CONFIRMED**: 2.1 の OKLCH 提案パレット（ライト/ダークの surface/fg/border/primary/状態色）を**初期採用**し、実装後に目視でコントラスト（本文 4.5:1・大テキスト 3:1 目安）を詰める。トークンの単一変更で全画面に波及する前提。
- **D-FONT（フォント選定）— CONFIRMED**: **システムフォントスタック維持**（追加フォント同梱なし・オフライン自明・THIRD-PARTY-NOTICES 追記不要）。`--font-sans` は現 index.css のシステムスタック、`--font-mono` は ui-monospace 系。Inter 等の同梱は将来の別課題。
- **D-DARK-DEFAULT（ダークトグルの既定）— CONFIRMED**: 既定 `"system"`（OS 追従）、トグル 3 状態（system/light/dark）、指標 `data-theme`、localStorage キー `janus-theme`（値は `"system"|"light"|"dark"`、不正値は `"system"` に正規化）。
- **D-GENCONTENT（生成コンテンツ整合）— CONFIRMED**: 3.3 の **A 案**（既定 OS 追従 + 明示上書き時の CAD SVG / draw.io の明暗割れを許容、生成パイプラインに触れず非破壊維持）。B 案（指標波及・非破壊に反する）は不採用。
- **D-TESTSTYLE（テストのスタイル依存移行）— CONFIRMED**: テストはクラス非依存（実査 0 件）。移行時に全テストを再確認し、スタイル起因の修正ゼロを 7.3/10 のチェックで確証する（追加のテスト書き換えは原則不要）。

---

## 14. 設計レビューへの対応（review.json / design-review.md の findings）

### 14.1 本イテレーション（第 2 回レビューへの対応）

本イテレーションは第 2 回 `review.json`（verdict: **CHANGES_REQUESTED**、HIGH 0 / MEDIUM 4 / NIT 2）への改訂である。各 finding への対応は以下のとおり。いずれも元要件（DS-1〜DS-8・非破壊・オフライン・AA）と整合する「事実への修正／新規 a11y 要素の挙動定義追加／検証コマンドの cwd・パス一本化／確定事項の確定」で、方向性の変更はない。全 findings を **解消**した（バックログ化・対応見送りはなし）。

| Finding | 重大度 | 対応 | 反映箇所 |
|---|---|---|---|
| 1. draw.io 全画面に「フォーカストラップ」は存在せず「既存挙動を維持」はオーバークレーム | MEDIUM | **解消**。実コード（`PageEditPage.tsx` の `isDrawioFullscreen` 分岐）を確認し、既存が持つのは `role="dialog"`/`aria-modal`/`aria-label`/`Escape` クローズのみでフォーカストラップは未実装である事実に修正。これらを維持しクラスのみ差し替える、フォーカストラップは本刷新スコープ外（別課題）と明記。将来 Modal 共通化で足す余地のみ注記。 | 5.3 |
| 2. 新規モバイルサイドバーのキーボード/フォーカス仕様が未定義 | MEDIUM | **解消**。4.3 に新規オーバーレイサイドバーの確定受け入れ挙動を定義: 開時に最初のナビ項目へフォーカス移動 + `aria-modal`/`role="dialog"` 相当、`Escape`・背景クリック・項目選択で閉じハンバーガーへフォーカス復帰、展開中は背後を `inert` で不可操作。広幅常設時は非適用。10 章にユニットテスト項目（`aria-expanded` 遷移・各閉経路・フォーカス復帰・開時フォーカス移動・`inert`）を追加。 | 4.3 / 10 章 |
| 3. 全廃確認 grep のパスと実行 cwd の食い違いで偽陰性 | MEDIUM | **解消**。実行 cwd を npm スクリプトと同じ `janus/frontend` に固定し、相対パスを `src` に統一（`grep -rn "module.css" src` 等）。`frontend/frontend/src` のパスずれによる偽陰性を排除。7.4 の自動検証も同一 cwd で回す旨を明記。ルート実行時は `frontend/src` に統一する補足も付記。 | 7.3 / 7.4 |
| 4. FOUC スクリプトの実装形態（インライン vs `public/theme-init.js`）が実装時先送りで未確定 | MEDIUM | **解消**。`index.html` の `<head>` インライン `<script>` を**本 spec の確定採用**とした（最小差分・エントリ 1 ファイル完結・CSP 未設定の現状に素直）。`public/theme-init.js` 方式と nonce/hash 付与は「将来 CSP 導入時に初めて検討する移行条件付きの代替」に限定し、既定を宙に浮かせない。1.1「承認後ロック」と整合。 | 3.2 |
| 5. `localStorage` キー名が例示どまり | NIT | **解消**。キー名を `janus-theme` に確定、値を `"system"|"light"|"dark"` の 3 値に限定し、FOUC スクリプト・`useTheme`・10 章テストが同一キー/値を参照する旨を明記。 | 3.2 / 10 章 |
| 6. テーマ `preference` 不正値の入力バリデーション未記述 | NIT | **解消**。「`preference` が 3 値以外なら `"system"` とみなす（FOUC スクリプトと `useTheme` の双方で同じ正規化・許可リスト検証）」を 11 章に追加。10 章テストで正規化も検証。 | 11 章 |

残課題（本イテレーションで未確定のまま維持するもの）: DECISION-NEEDED（D-PALETTE / D-FONT / D-DARK-DEFAULT / D-GENCONTENT / D-TESTSTYLE）はユーザー最終確認待ちとして 13 章に据え置く。これらは review でも「推奨案付きで正しくユーザー判断に回されている」と評価されており、finding 対象ではない。

### 14.2 第 1 回レビューへの対応（履歴・解消済み）

第 1 回 `review.json`（CHANGES_REQUESTED・MEDIUM 5 / NIT 2）への対応は以下のとおり既に解消済みで、第 2 回レビューでも 7 件とも解消確認されている。記録として残す。

| Finding | 重大度 | 対応 | 反映箇所 |
|---|---|---|---|
| 1. Markdown 本文スタイルの付与先の誤記（`<article>` の所在） | MEDIUM | **解消**。`MarkdownRenderer` はラッパ非描画・`<article>` は `PageViewPage.tsx` のみ・使用箇所は `PageViewPage` のみを反映し、`prose-janus` は PageViewPage の既存 `<article>` に 1 箇所付与・`MarkdownRenderer` はラッパを足さないと特定。 | 6 章 |
| 2. Tailwind バージョン v4.3.x の実在性未検証 | MEDIUM | **解消**。確定マイナー系列の断定をやめ「v4 系最新」とし `npm view tailwindcss version` 取得値を厳密ピンする手順へ。requirements DS-1-1 も同期改訂。 | 1.1 / requirements DS-1-1 |
| 3. `@custom-variant dark` の確定構文が先送り | MEDIUM | **解消**。`@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));` を唯一採用の確定構文に 1 本化。class 戦略不採用を明記。 | 1.4 / 3.1 |
| 4. FOUC インラインスクリプトと CSP の整合が未記述 | MEDIUM | **解消（本イテレーションでさらに実装形態を確定）**。CSP 整合を追記（第 1 回）、実装形態をインライン確定に昇格（本イテレーション Finding 4）。 | 3.2 / 11 章 |
| 5. 新規テーマ関連テストの jsdom 環境指定が未明示 | MEDIUM | **解消**。新規テーマテストは先頭に `// @vitest-environment jsdom` を必ず付す・`matchMedia` を `vi.fn()` でモックすると明記。 | 1.5 / 10 章 |
| 6. 本文最大幅の記述ぶれ | NIT | **解消**。本文幅を `max-w-3xl`（48rem・`AppLayout.module.css` と一致）に確定。既定スケールはトークン直書き禁止の例外と 2.3 に明記。 | 4.1 図 / 2.3 |
| 7. `color-mix`/`/alpha` 下地の Firefox 実描画が目視チェック未記載 | NIT | **解消**。7.4 の Firefox 目視チェックに該当項目を追加。 | 7.4 |
