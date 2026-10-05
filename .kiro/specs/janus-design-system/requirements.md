# Janus デザインシステム刷新 要件定義書（Tailwind CSS v4 全面統一）

## 概要

本書は Janus フロントエンドの **見た目（デザインシステム）を全面刷新**する要件を定義する。現在のスタイルは各コンポーネントの素の CSS Modules（`*.module.css`）＋ 最小のグローバル `index.css` ＋ 一部インラインスタイル（地図ビューア等）で構成されている。これを **Tailwind CSS v4（CSS-first 設定）へ全面統一**し、見た目を **Zed のドキュメントサイト（https://zed.dev/docs/）風**に刷新する。

本書は要件定義のみを扱う。設計・実装・コミットは後続ステップで行い、**本書の段階ではアプリケーションコード（frontend/backend）を一切変更しない**。成果物は本 spec（`janus-design-system`）の `requirements.md` / `design.md` のみである。

フェーズ 1（janus-foundation）・フェーズ 2（janus-phase2）・フェーズ 3a（janus-phase3a）は完了・コミット済みであり、本刷新はそれらの**機能・挙動・API・保存形式・権限を一切変えず、見た目だけを置き換える**（非破壊）。ローカルモード（3b・PWA + IndexedDB）は未着手だが、本刷新は 3b を阻害せず、むしろ「サーバーモードとローカルモードで同一の見た目を得る」ための基盤を整える。

### 位置づけ（フェーズとの関係）

- 本書は特定の機能フェーズではなく、全フェーズ横断の **UI 基盤刷新**である。フェーズ 3b（ローカルモード）に進む前に、ユーザー合意のもとデザインを確定するために実施する。
- フェーズ 3a までに実装された全ページ・全コンポーネントが刷新対象である（下記「移行対象の棚卸し」）。

### 用語

- **デザイントークン**: 配色・タイポグラフィ・余白・角丸・ボーダー・影などの設計値を名前付きで定義したもの。Tailwind v4 では CSS の `@theme` ディレクティブで定義し、ユーティリティクラスとして自動展開される。
- **Tailwind CSS v4（CSS-first 設定）**: `tailwind.config.js`/PostCSS 設定を使わず、エントリ CSS に `@import "tailwindcss";` を書き、`@theme { ... }` でトークンを定義する v4 の設定方式。
- **`dark:` バリアント**: Tailwind のダークモード用プレフィックス。`class`/`data` 戦略では祖先要素に付いた指標（`.dark` クラスや `data-theme="dark"`）を見て適用される。
- **生成コンテンツ**: CAD 変換が出力する SVG（`cad/config.ts` の `lightColors`/`darkColors` を SVG 内 `<style>` の `prefers-color-scheme` で切替）と、draw.io（セルフホスト同梱 webapp）が描画する図。これらはアプリの Tailwind とは独立に自前の明暗切替を持つ。
- **オフライン完結**: 実行時に外部ドメイン（CDN・フォント配信・draw.io 公開エンドポイント等）へ接続せず、`dist` 同梱物だけで動作すること。Janus の中核方針（draw.io セルフホスト同梱・CAD ブラウザ変換と同じ思想）。

---

## 移行対象の棚卸し（現状のスタイル資産・コード実査）

本書は以下の実コードを読んで対象を確定した。本刷新は下表の**全スタイル資産を Tailwind へ置き換える**ことを対象とする（段階移行ではなく全面移行）。

### 置き換え対象の `*.module.css`（11 ファイル）とインポート元

| # | `*.module.css` | インポートする TSX | 役割 |
|---|---|---|---|
| 1 | `components/AppLayout.module.css` | `components/AppLayout.tsx` | 共通ヘッダー＋本文ラッパ（Zed 風レイアウトの中心） |
| 2 | `components/Breadcrumbs.module.css` | `components/Breadcrumbs.tsx` | パンくず |
| 3 | `markdown/custom-map/MapEditor.module.css` | `markdown/custom-map/MapEditor.tsx` | 地図 GUI 編集 UI |
| 4 | `markdown/drawio/DrawioViewer.module.css` | `markdown/drawio/DrawioViewer.tsx` | draw.io ビューア・プレースホルダ |
| 5 | `pages/AssetLibraryPage.module.css` | `pages/AssetLibraryPage.tsx` | アセットライブラリ（ファイル選択・変換スピナー含む） |
| 6 | `pages/CommentSection.module.css` | `pages/CommentSection.tsx` | コメント欄 |
| 7 | `pages/PageEditPage.module.css` | `pages/PageEditPage.tsx` | ページ編集フォーム |
| 8 | `pages/PageHistoryPage.module.css` | `pages/PageHistoryPage.tsx` | リビジョン履歴・差分表示 |
| 9 | `pages/PageListPage.module.css` | `pages/PageListPage.tsx` | ページ一覧 |
| 10 | `pages/PagePermissionPage.module.css` | `pages/PagePermissionPage.tsx` | 権限設定 |
| 11 | `pages/PageViewPage.module.css` | `pages/PageViewPage.tsx` | ページ閲覧（編集/削除導線） |

### `*.module.css` を持たない UI（グローバル CSS・インラインスタイル依存）

- **グローバル `src/index.css`**: `:root` のフォント/行高/配色、`a`/`h1`〜`h3`/`input`/`textarea`/`article`（Markdown 本文のタイポグラフィ・`code`/`pre`）等。本刷新で Tailwind のエントリ CSS ＋ `@theme` ＋ base レイヤへ再編する。
- **`pages/LoginPage.tsx`・`pages/NotFoundPage.tsx`**: `*.module.css` を持たず素の要素（`<main>`/`<form>`/`role="alert"` 等）。本刷新で Tailwind ユーティリティを付与する。
- **`markdown/custom-map/CustomMapViewer.tsx`**: 全要素が**インラインスタイル**（パン/ズーム/回転の動的計算、SVG を `<img src>` Blob URL で描画）。閲覧表示の見た目は刷新対象だが、**動的計算に依存するインラインスタイルは Tailwind で代替できない部分がある**ため、本書は「周辺のコンテナ・ボタン・ポップアップのみ Tailwind 化し、動的トランスフォーム等のインラインは維持する」方針とする（設計で境界を確定）。
- **`index.html`**: `<html lang="ja">`。ダークモード指標（`class`/`data-theme`）の初期注入箇所になりうる（設計で確定）。

### テストのスタイル依存（実査結果 = 重要）

- フロントテスト（`*.test.tsx`）は **CSS Modules のクラス名（`styles.*`）を一切参照していない**（`grep` で 0 件）。テストは **ロール（`getByRole`）・テキスト（`getByText`）・`data-*` 属性（`data-op`/`data-drawio-container`/`data-directive`）・要素タグ（`querySelector('p'|'table'|'script')`）** で検証している。
- したがって **Tailwind 化によるテストのクラス参照修正はほぼ発生しない**見込み。ただし「スタイルによって要素が存在するか」を間接的に見ているテスト（例: `script` が注入されないこと）は見た目変更の影響を受けないため維持される。設計で全テストファイルを洗い出し、クラス依存ゼロを確証する。

---

## 要件

### 要件 DS-1: Tailwind CSS v4（CSS-first）の導入 〔デザイン基盤〕

**ユーザーストーリー:** 開発者として、スタイルを Tailwind CSS v4 に一本化したい。そうすればトークン駆動で一貫した見た目を保ち、CSS Modules の分散管理をやめて保守を単純化できる。

#### 受け入れ基準

1. THE フロントエンド SHALL スタイリングを **Tailwind CSS v4 系の最新版**（例: v4.x）に統一する。追加の UI フレームワーク（Bootstrap/MUI 等）は導入しない。採用するバージョンは断定せず、**導入時に `npm view tailwindcss version` で取得した v4 系最新を devDependencies に厳密ピン**する（具体の取得・ピン手順は設計で定める）。
2. THE 導入方式 SHALL **CSS-first 設定**とする。すなわち `@tailwindcss/vite` プラグインを Vite に組み込み、エントリ CSS に `@import "tailwindcss";` を置き、デザイントークンは CSS の `@theme` ディレクティブで定義する。`tailwind.config.js`・PostCSS 設定ファイルは作成しない。
3. THE Tailwind SHALL **ビルド時に使用クラスのみを含む CSS を生成**し `dist` に同梱する（CDN ランタイム版・Play CDN は使わない）。
4. WHEN フロントエンドをビルドする THEN システム SHALL 既存の `tsc -b && vite build` 経路でスタイルを生成し、`vite dev` でも同じトークン・ユーティリティが効く。
5. THE 導入 SHALL 既存 Vite 8 設定（`vite.config.ts` の `@vitejs/plugin-react`・`server.proxy`・Vitest 設定）を壊さず統合する。
6. THE 導入 SHALL 既存のビルド検証（`tsc` 型検査、`vitest run`、`vite build`、`eslint`）を全て通過させる（回帰ゼロ）。

### 要件 DS-2: デザイントークン（Zed docs 風・ライト/ダーク両パレット） 〔デザイン基盤〕

**ユーザーストーリー:** 利用者として、Zed のドキュメントサイトのような落ち着いた端正な見た目で Janus を使いたい。そうすれば情報が読みやすく、長時間の閲覧でも疲れにくい。

#### 受け入れ基準

1. THE デザイン SHALL 配色・タイポグラフィ・余白・角丸・ボーダー・影を **デザイントークンとして `@theme` で定義**し、各ページ/コンポーネントはトークン由来のユーティリティで装飾する（マジックナンバーの直書きを原則禁止）。
2. THE 配色 SHALL **ライト用パレットとダーク用パレットの両方**を定義し、少なくとも 背景（surface）・前景（text）・境界（border）・アクセント（primary/link）・状態色（成功 success・警告 warning・エラー error/danger）を含む。
3. THE 見た目 SHALL **Zed docs 風**とする: ダークを基調にしつつライト/ダーク切替あり、落ち着いた配色、情報密度のある端正なタイポグラフィ、適度な余白・角丸・繊細なボーダー。
4. THE タイポグラフィ SHALL サイズスケール（本文・見出し `h1`〜`h3`・コード）と行間を定義し、現状 `index.css` が持つ Markdown 本文（`article`）の可読性（行高・`code`/`pre` の体裁）を Tailwind トークン/ユーティリティで**同等以上**に再現する。
5. THE 既存の操作導線の意味的な色分け SHALL 維持する: 編集導線はアクセント色、削除は危険色（danger）、エラーメッセージは error 色、変換スピナーの強調色など、現状 `*.module.css` が表現していた意味的配色をトークンで表現する。

### 要件 DS-3: ダークモード対応（OS 追従 + 手動トグル・生成コンテンツ整合） 〔デザイン基盤〕

**ユーザーストーリー:** 利用者として、ライト/ダークを切り替えて使いたい。そうすれば環境や好みに合わせて快適に閲覧でき、OS のダーク設定にも自然に追従する。

#### 受け入れ基準

1. THE アプリ SHALL ライトモードとダークモードの両方で破綻なく表示できる（全ページ・全コンポーネント）。
2. THE ダークモード SHALL **OS 設定への追従を既定**とし、かつ**利用者による手動切替（トグル）**を提供する。
3. THE 手動トグルの状態 SHALL 永続化（例: `localStorage`）し、再訪・リロード後も保持する。トグルの取りうる状態は「OS 追従 / 明示ライト / 明示ダーク」を基本とする（具体は設計で確定）。
4. THE Tailwind のダークモード戦略 SHALL v4 の仕様に沿って **`class` もしくは `data` 属性ベース**で指定し（`prefers-color-scheme` の自動 `media` 戦略だけに頼らない）、`dark:` バリアントで両パレットを切り替える。採用する指標（`.dark` クラス / `data-theme` 等）は設計で 1 つに確定する。
5. WHEN ちらつき（FOUC: 初期描画時に誤ったテーマが一瞬出る）を防ぐ必要がある THEN システム SHALL 初期テーマ指標を描画前に `<html>` へ適用する手段を設計で定める。
6. THE アプリのダークモード機構 SHALL **生成コンテンツ（CAD 変換 SVG・draw.io）との整合方針**を明示する。CAD 変換 SVG は `prefers-color-scheme`（OS 追従）で明暗を切り替え（`cad/config.ts` の `lightColors`/`darkColors`）、draw.io 同梱 webapp も独自に描画するため、**アプリの手動トグルと OS 設定が食い違う場合に生成コンテンツとアプリ本体で明暗が割れうる**。本刷新はこの論点に対する方針（例: アプリも OS 追従を既定にし、手動上書き時の生成コンテンツとの割れを許容するか、生成コンテンツ側にも同じ指標を波及させるか）を設計で決定する。
7. THE 切替 SHALL アクセシブルであること（トグルに適切なラベル、キーボード操作可能、状態が支援技術に伝わる）。

### 要件 DS-4: 共通レイアウトの Zed docs 風再設計 〔レイアウト〕

**ユーザーストーリー:** 利用者として、左のナビゲーションから目的の画面へ素早く移動し、中央で本文に集中したい。そうすれば Zed docs のように迷わず情報にたどり着ける。

#### 受け入れ基準

1. THE `AppLayout` SHALL **Zed docs 風の左サイドバーナビ + 中央本文**の構成に再設計する。ヘッダー（アプリ名・アカウント・ダークトグル・ライセンス導線）を備える。
2. THE ナビゲーション SHALL 既存の主要導線（ページ一覧 `/`、アセットライブラリ `/assets`）を含み、ページ文脈に応じた導線（履歴・権限・編集等）との整合を保つ。ナビ項目構成は設計で確定する。
3. THE レイアウト SHALL レスポンシブとし、狭幅（モバイル/Android）ではサイドバーを折りたたむ等の適応を行う（Janus はローカルモードで Android 単体利用を想定）。
4. THE レイアウト刷新 SHALL 既存の挙動を変えない: 未ログイン/復元中（`user === null`）はヘッダーを出さず本文のみ、`/login`・404 はレイアウト外、ログアウトは `logout()` → `/login` へ `replace` 遷移、という現 `AppLayout.tsx` の分岐を維持する。
5. THE ライセンス/帰属表記導線（`/drawio/LICENSE`・`/drawio/NOTICE` への素の `<a>`）SHALL 維持する。

### 要件 DS-5: 共通 UI コンポーネントの体裁基準 〔コンポーネント〕

**ユーザーストーリー:** 開発者として、ボタン・入力・通知などの繰り返し使う UI を一貫した見た目で使いたい。そうすれば画面間でばらつかず、新規画面も素早く組める。

#### 受け入れ基準

1. THE デザイン SHALL 繰り返し使う UI（ボタン=通常/アクセント/危険、テキスト入力・テキストエリア、フォーム、リスト、通知/アラート=成功 情報 警告 エラー、モーダル/オーバーレイ、スピナー）の見た目基準を定める。
2. THE スタイルの当て方 SHALL **ユーティリティ直書き / 共通コンポーネント（React）化 / `@apply` による小さなコンポーネントクラス**の使い分け方針を設計で定め、過度な抽象化を避けつつ重複を抑える。
3. THE 既存のオーバーレイ/モーダル体験（draw.io の全画面編集、変換中の二重操作防止の disable + 「変換中...」スピナー表示）SHALL Tailwind でも同等に再現する。
4. THE 既存のインラインスタイル依存 UI（`CustomMapViewer` のパン/ズーム/回転）SHALL 動的計算部分のインラインを維持しつつ、静的な枠・ボタン・ポップアップの体裁は Tailwind 化する（境界は設計で確定）。

### 要件 DS-6: 全ページ一気移行（非破壊・CSS Modules 全廃） 〔移行〕

**ユーザーストーリー:** 開発者として、スタイルを中途半端に二重管理したくない。そうすれば CSS Modules と Tailwind が混在する不整合を避け、デザインを一本化できる。

#### 受け入れ基準

1. THE 移行 SHALL **全ページ・全コンポーネントを一気に Tailwind へ書き換える**（段階的な部分移行で CSS Modules と Tailwind を長期併存させない）。
2. WHEN 移行が完了する THEN システム SHALL 上記棚卸しの **11 個の `*.module.css` を全廃**し、各 TSX の `import styles from './*.module.css'` を除去する（移行完了の確認方法は設計で定める）。
3. THE 移行 SHALL **既存機能の挙動・API・保存形式・権限・記法仕様・アクセシビリティ属性を一切変えない**（見た目のみ刷新する不変条件）。地図記法（`:::custom-map`）・draw.io・CAD 変換・コメント・権限・リビジョン等の動作は不変。
4. WHEN 各移行段階を終える THEN システム SHALL `tsc` 型検査・`vitest run`・`vite build`・`eslint` が通り、既存テストが回帰ゼロで合格することを確認する。見た目の最終確認は実ブラウザ（Firefox 最新）で行う。
5. THE グローバル `index.css` が担っていた base スタイル（フォント・リンク・見出し・Markdown 本文体裁）SHALL Tailwind のエントリ CSS（`@theme` + base レイヤ / 必要箇所の Markdown 用スタイル）へ移し替え、`article`（Markdown 本文）の見た目を同等以上に保つ。

### 要件 DS-7: 外部 CDN 非依存・オフライン完結・ローカルモード整合 〔非機能・中核方針〕

**ユーザーストーリー:** 運用者/利用者として、サーバーモードでもローカルモード（オフライン）でも同じ見た目で、外部に接続せず完結してほしい。そうすれば Janus の軽量・ローカル完結・外部非依存の思想を崩さない。

#### 受け入れ基準

1. THE スタイル SHALL ビルド時に CSS を生成して `dist` に同梱し、**実行時に外部ドメインへ接続しない**（Tailwind の CDN ランタイム版・Play CDN を使わない）。
2. THE フォント SHALL 外部 CDN（`fonts.googleapis.com` 等）へ実行時依存しない。**システムフォントスタック、またはローカル同梱フォント**のいずれかを採用し、Zed 風の端正さとオフライン可を両立する（具体の選定は設計の DECISION-NEEDED）。
3. THE 刷新 SHALL サーバーモードとローカルモード（3b・PWA）で **同一の frontend ビルド成果物 = 同一スタイル**になることを保証する（モード差でスタイルが変わらない）。
4. THE 刷新 SHALL draw.io セルフホスト同梱・CAD ブラウザ変換と同じ**外部非依存思想に揃える**。

### 要件 DS-8: アクセシビリティの維持・担保 〔非機能〕

**ユーザーストーリー:** 利用者として、支援技術やキーボードでも問題なく使えてほしい。そうすれば誰にとっても扱いやすい。

#### 受け入れ基準

1. THE 刷新 SHALL 既存のアクセシビリティ属性（`role="alert"`/`role="status"`、`aria-label`、`aria-modal`、`aria-live`、`htmlFor`/`id` 関連付け 等）を**全て維持**する。Tailwind 化で意味的マークアップを失わない。
2. THE 配色 SHALL ライト/ダーク両方で本文・UI テキストのコントラスト比が **WCAG AA を目安**（通常テキスト 4.5:1、大きなテキスト 3:1）を満たすようトークンを設計する。
3. THE フォーカス可視 SHALL `focus-visible` によるフォーカスリングで担保し、キーボード操作時に現在位置が明確に見える（現状 `index.css` の `input:focus` アウトライン相当を維持・強化）。
4. THE ダークトグル・ナビ・ボタン・モーダル SHALL キーボードで操作可能で、状態が支援技術に伝わる。
5. 注記: WCAG 完全準拠の確証には支援技術での手動テストと専門家レビューが必要であり、本刷新はコントラスト比・フォーカス可視・意味的マークアップ維持を**設計上の担保**として扱う。

---

## 非機能要件

1. **非破壊（最優先）**: フェーズ 1/2/3a の機能・API・保存形式・権限・記法仕様を破壊しない。見た目のみを刷新する。既存のフロントテスト（約 130 件規模）・バックエンドテストを回帰させない。
2. **対象ブラウザ**: 主対象は **Firefox 最新版**。Tailwind v4 の要件（Firefox 128+ / Chrome 111+ / Safari 16.4+ 等のモダンブラウザ、`@layer`・OKLCH・`color-mix()` 等の最新 CSS 機能に依存）を満たす前提で設計する。レガシーブラウザ対応は要求しない。
3. **オフライン・外部非依存**: 実行時に外部ドメインへ接続しない（要件 DS-7）。
4. **軽量性**: Tailwind v4 は使用クラスのみ生成するため CSS は軽量。ローカル同梱フォントを採用する場合も bundle サイズ影響を設計で評価する（閲覧専用の軽量さを損なわない）。
5. **一貫性**: トークン駆動（`@theme`）で配色・余白・タイポグラフィを一元管理し、画面間のばらつきを抑える。
6. **保守性**: CSS Modules を全廃し、スタイルの所在を「Tailwind ユーティリティ（マークアップ近傍） + `@theme`（トークン） + 限定的な共通クラス/コンポーネント」に集約する。

---

## 受け入れ基準（統合・検証観点のサマリ）

本刷新完了時、以下が確認可能であること。番号は検証項目。

1. `@tailwindcss/vite` + `@import "tailwindcss";` + `@theme` の CSS-first 構成で Tailwind v4 が有効化され、`tailwind.config.js`/PostCSS 設定が存在しない。
2. ライト/ダーク両パレットのトークンが `@theme` に定義され、全ページ・全コンポーネントがトークン由来の装飾で表示される（Zed docs 風）。
3. OS 追従を既定とし、手動トグルで明示ライト/ダークに切替でき、状態が永続化され、リロード後も保持される。FOUC が起きない。
4. ダークモードが `class`/`data` 戦略 + `dark:` バリアントで実装され、生成コンテンツ（CAD SVG・draw.io）との明暗整合方針が明示・実装されている。
5. `AppLayout` が Zed docs 風（左サイドバー + 中央本文 + ヘッダー + ダークトグル）に再設計され、未ログイン非表示・`/login`/404 のレイアウト外・ログアウト遷移の既存挙動が保たれる。レスポンシブで狭幅対応する。
6. 共通 UI（ボタン/入力/フォーム/通知/モーダル/スピナー）の体裁基準が確立され、draw.io 全画面編集・変換中 disable+スピナーが同等に再現される。
7. 11 個の `*.module.css` が全廃され、各 TSX から `import styles` が除去され、CSS Modules と Tailwind の併存がない。
8. 既存機能の挙動・API・保存形式・権限・記法・アクセシビリティ属性が不変（見た目のみ刷新）。
9. `tsc`・`vitest run`・`vite build`・`eslint` が全通過し、既存テストが回帰ゼロ。
10. 実行時に外部ドメインへ接続しない（CDN/フォント/draw.io 公開エンドポイント非依存）。サーバー/ローカル両モードで同一スタイル。
11. ライト/ダーク両方でコントラスト AA 目安を満たし、`focus-visible` リングでフォーカスが可視で、既存の role/aria が維持される。

---

## スコープ外（本刷新で扱わないこと）

- **機能追加・挙動変更**: ページ/アセット/権限/コメント/地図/draw.io/CAD の**機能や挙動の変更**は行わない（見た目のみ）。
- **ローカルモード（フェーズ 3b）の実装**: PWA・IndexedDB・オフライン基盤・端末カメラは本刷新のスコープ外。ただし本刷新は 3b が同一スタイルを得られる形に整える。
- **生成コンテンツ内部の配色変更**: CAD 変換 SVG のペン色（`cad/config.ts`）や draw.io webapp の内部テーマそのものの作り替えは対象外（アプリ側との**整合方針**のみ本書で扱う）。
- **全文検索（フェーズ 4）** 等、未着手機能の UI は本刷新時点に存在する画面のみを対象とし、将来機能の先取り UI は作らない。
- **バックエンド（Django）側の変更**: 本刷新はフロントエンドのスタイルのみ。バックエンドは一切変更しない。
- **レガシーブラウザ対応**: Tailwind v4 の要件を満たさない古いブラウザは対象外。

---

## foundation / phase2 / phase3a との関係（所有・非破壊）

- **要件の所有**: 機能要件はフェーズ 1/2/3a が所有し、本書は変更しない。本書は**見た目（デザインシステム）だけ**を所有する新規の横断 spec である。
- **非破壊の保証**: 本刷新は既存の受入基準・既存テストを覆さない。既存挙動を変える必要が生じた場合は設計書で明示し、見た目に限定する。
- **記法・契約の不変**: `:::custom-map`/draw.io 記法、`StorageClient` 契約、REST API、権限モデルは本刷新で一切変えない。
- **生成コンテンツとの整合**: CAD SVG の `prefers-color-scheme` 連動（foundation/3a 由来）と draw.io セルフホスト同梱（3a 由来）を前提に、アプリ側ダークモードとの整合方針を本書 DS-3-6 / 設計で確定する。

---

## ユーザー判断が必要な未確定事項（設計レビューで確認）

合理的な推奨案を置いて進めるが、以下は見た目・運用・実現可能性に影響するため設計レビューで最終確認する（設計書 DECISION-NEEDED と対応）。

- **D-PALETTE（配色の最終決定）**: Zed docs 風のライト/ダーク具体パレット（背景/前景/境界/アクセント/状態色）の最終値。OKLCH で定義するか hex か。
- **D-FONT（フォント選定）**: システムフォントスタックのままにするか、Zed 風の端正さのためにローカル同梱フォント（例: Inter 等）を採用するか。採用時は bundle/ライセンス/THIRD-PARTY-NOTICES への追記を伴う。
- **D-DARK-DEFAULT（ダークトグルの既定）**: 既定を OS 追従にする（推奨）。トグルの状態セット（OS 追従/明示ライト/明示ダーク）と指標（`.dark` クラス / `data-theme`）。
- **D-GENCONTENT（生成コンテンツ整合）**: アプリ手動トグルと OS 設定が食い違う場合の CAD SVG/draw.io との割れを「許容」するか「指標を波及させて揃える」か。
- **D-TESTSTYLE（テストのスタイル依存移行）**: 実査ではテストはクラス非依存だが、全テストを洗い出し、スタイル起因で修正が要るテストがゼロであることを設計で確証する方針。

---

## 設計レビューへの対応（改訂履歴）

### 第 2 回レビュー（`design-review.md` / `review.json`・CHANGES_REQUESTED・MEDIUM×4 / NIT×2）

本イテレーションの findings はすべて **design.md 側の具体記述**（draw.io 全画面の既存挙動の事実修正・新規モバイルサイドバーの a11y 挙動定義・全廃確認 grep の cwd/パス一本化・FOUC スクリプト形態の確定・`localStorage` キー確定・テーマ不正値の正規化）に関するもので、requirements の受け入れ基準（DS-1〜DS-8・非機能・統合サマリ）そのものは変更を要さない。

- requirements 側は既存のまま有効: Finding 2 が充足する a11y 要件は **DS-8-4**（ダークトグル・ナビ・ボタン・モーダルはキーボードで操作可能で状態が支援技術に伝わる）および **DS-4-3**（狭幅でサイドバーを折りたたむ適応）に既に存在し、design 4.3 がその具体的受け入れ挙動（開閉・Escape・背景クリック・フォーカス移動/復帰・`inert`）を定義することで要件を満たす。requirements の文言追加は不要。
- 各 finding の具体的対応は design.md 14.1 に記録した。

### 第 1 回レビュー（CHANGES_REQUESTED・MEDIUM×5 / NIT×2）

requirements に関係した対応は以下のとおり。設計側（design.md）の対応は design.md 14.2 にまとめる。

- **Finding 2（MEDIUM・Tailwind バージョン v4.3.x の実在性未検証）**: DS-1-1 を改訂。確定マイナー系列「v4.3.x 系」の断定をやめ、「v4 系最新（例: v4.x）」とし、採用値は `npm view tailwindcss version` で取得して厳密ピンする手順定義に置き換えた。これにより未導入（`package.json` に tailwindcss なしを確認）のまま実在性を断定していた記述を解消。
- Finding 1 / 3 / 4 / 5 / 6 / 7 はいずれも設計の具体（付与先・ダーク構文・CSP・テスト環境・本文幅・目視項目）に関する指摘で、requirements の受け入れ基準（挙動・非破壊・AA・オフライン等）は変更不要。design.md 側で解消し、14.2 に対応を記録した。
