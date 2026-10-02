# markdown/ · custom-map/

Markdown レンダラと地図記法ディレクティブ（`:::custom-map`）を置くディレクトリ。

- `markdown/`（実装済み・タスク 10）: react-markdown + remark-directive + remark-gfm によるレンダラ（design 2 章 / 要件 13）。`MarkdownRenderer.tsx` が本文を描画し、未対応ディレクティブ（`:::custom-map` 以外）は `remark-directive-fallback.ts` が無害なプレースホルダ要素へ変換する（クラッシュしない）。
- `markdown/custom-map/`（実装済み・タスク 11）: 既存 `viewer.ts`/`common.ts`（GROWI プラグイン growi-plugin-custom-map v0.3.1）から地図ビューアを移植。GROWI API 依存を `StorageClient`（`useStorage` 経由）・props・定数へ置換（design 7 章）。画像アセット上にマーカーを表示する（画像のみ・表示）。

## ファイル構成（タスク 11）

| ファイル | 役割 |
|---|---|
| `types.ts` | `MapData` / `MarkerData` / `PhotoData` 型（記法のパース結果） |
| `map-utils.ts` | 純ユーティリティ・定数（`toNumber`/`clamp`/`normalizeRotate`/`textColorForBg`/`isCadFile`/`normalizeForSearch`、ピン・ラベルのサイズ定数） |
| `config.ts` | 最小アプリ設定（`DEFAULT_STOCK_PAGE`/`DEFAULT_OPEN_LABEL`/`getMinimizedPinSize`）。GROWI のグローバル設定依存を置換 |
| `parse-map.ts` | 記法パーサ `buildMapData(node)`（mdast の `:::custom-map` コンテナ → `MapData` の純関数） |
| `resolve-assets.ts` | 候補ページ算出とアセット解決（`StorageClient.resolveAssetUrl` 経由。多段フォールバック） |
| `remark-custom-map.ts` | custom-map 専用 remark プラグイン（コンテナを `data-custom-map` 付き div へ変換） |
| `CustomMapViewer.tsx` | 地図ビューア React コンポーネント（モーダル・パン/ズーム/90 度回転・最小化/復帰・写真/説明ポップアップ） |

## MarkdownRenderer への統合方式（D3）

- `remarkPlugins` の順序は `[remarkGfm, remarkDirective, remarkCustomMap, remarkDirectiveFallback]`。
- `remarkCustomMap` が `containerDirective`（`name==='custom-map'`）を `hName='div'` + `hProperties`（`data-custom-map`＝`MapData` の JSON、`data-directive='custom-map'`）へ変換し、子を空にする。
- `remarkDirectiveFallback` は `hName` 既設を尊重するため custom-map に触れず、custom-map 以外の未対応ディレクティブだけプレースホルダ化する。
- react-markdown の `components.div` が `data-custom-map` 属性を検出したときだけ `<CustomMapViewer />` を描画し、それ以外の div は素通しする（生 HTML 有効化 rehype-raw は不要）。

## GROWI 依存の置換マッピング（D5/D6）

| 既存（GROWI 依存） | Janus での置換 |
|---|---|
| `resolveAttachmentUrl` / `getAttachmentsForPage` / `getPageIdByPath` | `useStorage().resolveAssetUrl(name, candidates)`（内部で `listAssets`） |
| 登録アセット API / CAD 変換 API | 使わない（フェーズ 3）。画像として `resolveAssetUrl` を試み、不可なら日本語メッセージ |
| `GROWI_CUSTOM_MAP_CONFIG`（defaultSrc / minimizedPinSize / lang） | `config.ts` の定数（`DEFAULT_STOCK_PAGE='/map-library'`・最小化ピン径 24・日本語固定） |
| `window.GROWI_CONTEXT` / `__NEXT_DATA__`（現在ページ解決） | `PageViewPage` の `path`（`'/' + splat`）を props で `MarkdownRenderer` → `CustomMapViewer` へ渡す |

> CAD 変換・GUI 編集・写真アップロードはフェーズ 3。タスク 11 は「画像アセット上にマーカー表示」まで。
