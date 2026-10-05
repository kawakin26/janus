# ezjww web ビルド成果物（同梱元の記録）

本ディレクトリの `ezjww_wasm.js` / `ezjww_wasm_bg.wasm` / `ezjww_wasm.d.ts` /
`ezjww_wasm_bg.wasm.d.ts` は、JWW/Jw_cad リーダ **ezjww**（Rust → WebAssembly）を
`wasm-pack --target web` で自ビルドした成果物である。

- 上流リポジトリ: https://github.com/monozukuri-ai/ezjww （MIT）
- タグ / コミット: `v0.3.4`（grafted HEAD `41bdea7`）
- ビルド対象クレート: `crates/ezjww-wasm`（クレート版 `0.2.10`）
- 取得方法: 自ビルド（example 成果物の取得ではない）
- ビルドコマンド:
  ```
  wasm-pack build crates/ezjww-wasm --target web \
    --out-dir <out> --out-name ezjww_wasm --release
  ```
- ツールチェーン: rustc 1.95.0 / cargo 1.95.0 / wasm-pack 0.15.0 /
  rustup target `wasm32-unknown-unknown`
- ライセンス: 上流リポジトリ root の MIT LICENSE を `./LICENSE` として同梱

## 使い方（本番タスク10/11 での統合）

```ts
import init, { isJwwFile, readDocument } from '@/vendor/ezjww-web/ezjww_wasm.js'
await init() // 引数なしで ezjww_wasm_bg.wasm を自動 fetch（Vite が .wasm を dist へ資産出力）
if (isJwwFile(bytes)) {
  const doc = readDocument(bytes) // doc.entities を SVG 化（temp/jww-to-svg.js 準拠）
}
```

default export は async init（wasm-pack `--target web` の標準）。`init()` を一度 await した後に
`isJwwFile(Uint8Array)` / `readDocument(Uint8Array)` を呼ぶ。これは参考実装
`temp/jww-to-svg.js` が参照する `ezjww.isJwwFile` / `ezjww.readDocument` と同一 API。

Web Worker 内でも同じ import + `await init()` で初期化できる（module Worker 推奨）。
