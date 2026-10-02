# markdown/ · custom-map/

Markdown レンダラと地図記法ディレクティブ（`:::custom-map`）を置くディレクトリ。

- `markdown/`（実装済み・タスク 10）: react-markdown + remark-directive + remark-gfm によるレンダラ（design 2 章 / 要件 13）。`MarkdownRenderer.tsx` が本文を描画し、未対応ディレクティブ（`:::custom-map`）は `remark-directive-fallback.ts` が無害なプレースホルダ要素へ変換する（クラッシュしない）。
- `markdown/custom-map/`（予定・タスク 11）: 既存 `viewer.ts` を移植した地図ビューア（GROWI 依存を StorageClient 経由に置換。design 7 章）。`:::custom-map` プレースホルダ（`data-directive="custom-map"`）を実ビューアへ差し替える。

タスク 10（Markdown レンダラ）は実装済み。タスク 11（地図ビューア移植）は未着手。
