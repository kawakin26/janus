# markdown/ · custom-map/

Markdown レンダラと独立アセットライブラリを参照するマップ記法ディレクティブ（`:::custom-map`）を置くディレクトリです。

- `markdown/`: react-markdown + remark-directive + remark-gfm によるレンダラ。未対応ディレクティブは無害なプレースホルダへ変換します。
- `markdown/custom-map/`: GROWI プラグイン由来のマップビューアを移植し、アセット解決を `StorageClient.resolveAssetUrl(AssetRef)` に統一しています。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `types.ts` | `MapData` / `MarkerData` / `PhotoData` 型（`AssetRef` を含む記法のパース結果） |
| `map-utils.ts` | 座標・回転・色・ピンサイズ等の純ユーティリティ |
| `config.ts` | ボタン表示文言と最小化ピンサイズの定数 |
| `parse-map.ts` | mdast の `:::custom-map` コンテナを `MapData` へ変換 |
| `resolve-assets.ts` | `AssetRef` を `StorageClient.resolveAssetUrl` へ渡す解決ヘルパ |
| `remark-custom-map.ts` | custom-map コンテナを `data-custom-map` 付き div へ変換 |
| `CustomMapViewer.tsx` | モーダル・パン/ズーム・回転・最小化・写真/説明ポップアップ |

## 記法

コンテナの `folder` が基準フォルダです。`filename`（短縮形 `file`）は filename、`aliasname`（短縮形 `alias`）は alias を参照します。指定子は記法上の出現順で保持され、先の指定子で解決できなければ次を試します。値に `/` が含まれると基準フォルダからの相対フォルダを、先頭が `/` ならルートからの絶対フォルダを指定できます。

```markdown
:::custom-map{folder="本館/2F" aliasname="floor-plan" filename="floor.svg" link="図面を開く"}

- x=18 y=26 label="入口" desc="受付"
  - alias="entrance.jpg" desc="入口写真"

:::
```

## MarkdownRenderer への統合

`remarkPlugins` の順序は `[remarkGfm, remarkDirective, remarkCustomMap, remarkDirectiveFallback]` です。`remarkCustomMap` は `MapData` の JSON を `data-custom-map` に格納し、`components.div` が検出したときだけ `CustomMapViewer` を描画します。ビューアはパン・ズーム・90度回転・最小化/復帰・写真/説明ポップアップ・`link` を維持し、未解決時は「マップ/画像が見つかりません」を表示します。

CAD変換、GUI編集、写真アップロードはフェーズ3です。
