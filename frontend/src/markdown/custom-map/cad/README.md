# CAD → SVG ブラウザ変換（cad/）

JWW / DXF の CAD ファイルをブラウザ内で SVG に変換するユーティリティ群。
サーバーは一切関与しない（原本 CAD バイトはアップロードされない。design 5.4）。
変換結果の SVG のみを、呼び出し側が既存の `uploadAsset` で登録する（design 9.2）。

## ファイル構成

- `config.ts` — 変換設定（`maxEntities` / `maxFileBytes` / `jww.*` / `dxf.*`）。
- `dxf-to-svg.ts` — DXF → SVG。`dxf-parser` でパースし、文字コードは
  `Uint8Array` + `TextDecoder`（UTF-8 厳密判定 → `$DWGCODEPAGE` → CP932 →
  宣言 → latin1）で判定する。`iconv-lite` は使わない。
- `jww-to-svg.ts` — JWW → SVG。vendored ezjww（WASM）を
  `../../../vendor/ezjww-web/ezjww_wasm.js` から import。`init()` は module scope で
  memoize し、一度だけ await する。
- `convert.ts` — 統合エントリ `convertCadToSvg(file, orientation)`。純粋関数で
  副作用なし（`uploadAsset` を呼ばない）。型付きエラーを投げる。
- `convert-worker.ts` — module Worker エントリ。
- `convert-dispatch.ts` — `convertCadToSvgDispatch(file, orientation)`。
  後続（FEAT-002 / 統合）はこれを使う。

## 公開 API（後続ステップ向け）

```ts
import { convertCadToSvgDispatch } from './convert-dispatch';
import {
  convertCadToSvg,
  CadUnsupportedError,
  CadTooLargeError,
  CadTooManyEntitiesError,
  CadConversionError,
  CadEngineUnavailableError,
  type CadOrientation,
} from './convert';
```

`convertCadToSvgDispatch(file, orientation)` と `convertCadToSvg(file, orientation)` は
いずれも `Promise<{ svg: string; filename: string }>` を返す。`filename` は `.svg` に
正規化済み。`orientation` は `CadOrientation = 0 | 90 | 180 | 270`（既定 0）。

## 実行モード（既定とフォールバック）

既定は **Worker + メインスレッドフォールバック**。

- `typeof Worker !== 'undefined'` の環境では module Worker（
  `new Worker(new URL('./convert-worker.ts', import.meta.url), { type: 'module' })`）で変換する。
- `Worker` が存在しない、または Worker の起動/通信が失敗した場合は、
  メインスレッドの `convertCadToSvg` にフォールバックする。
- `convert.ts` が出す型付きエラー（上記 5 クラス）は確定結果なので、
  フォールバックで握りつぶさずそのまま伝播する。

実ブラウザでの Worker 初期化は jsdom では検証できない（jsdom は実 Worker と
WASM fetch を提供しない。design 5.6）。このためテスト/ビルド下では
フォールバック経路が正しさを担保する。実 WASM パースは Vitest（node 環境）で
スパイク済み。
