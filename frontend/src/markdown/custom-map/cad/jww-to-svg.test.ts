// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { buildStyle, ensureJwwInit, isJwwFile, jwwToSvg } from './jww-to-svg';

// 代表的な .jww は参考アセット(/home/kawakin/git/knowledge-base/temp/)に存在しないため、
// init() 解決と isJwwFile のルーティング挙動を best-effort で検証する。実 JWW の
// パースはスパイクで Vitest 下で実証済み(context.json)。
//
// jsdom では import.meta.url が file: にならず init() の自動 fetch が効かない。
// Vitest は Node プロセス上で動くので、スパイク同様 .wasm バイト列をファイルから読み、
// ensureJwwInit に直接渡して同一の初期化経路で初期化する(本番ブラウザ/Worker では
// 引数なし fetch 経路になる)。@types/node は未導入のため、使う node:fs / process の
// 最小面だけをインラインで宣言して型チェックを通す(依存追加なし)。
declare const process: { cwd(): string };

beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as {
    readFileSync(path: string): Uint8Array;
  };
  const wasmBytes = fs.readFileSync(`${process.cwd()}/src/vendor/ezjww-web/ezjww_wasm_bg.wasm`);
  await ensureJwwInit({ module_or_path: wasmBytes });
});

describe('jwwToSvg (ezjww WASM)', () => {
  it('ensureJwwInit() が解決済みで再呼び出しも解決する', async () => {
    await expect(ensureJwwInit()).resolves.not.toThrow();
  });

  it('JWW でないバイト列は isJwwFile=false に判定される', () => {
    const notJww = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(isJwwFile(notJww)).toBe(false);
  });

  it('JWW として認識できないバイト列は変換で例外になる', async () => {
    const notJww = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    await expect(jwwToSvg(notJww)).rejects.toThrow();
  });
});

// buildStyle は純粋関数で WASM 初期化に依存しないため独立 describe にする。
// Jw_cad LCOLLOR の線色2(標準線)が light=黒 / dark=白 で出ることを回帰防止で検証する。
describe('buildStyle 色値', () => {
  it('light の標準線(.jc2)が黒、dark の標準線(.jc2)が白で出る', () => {
    const style = buildStyle();
    // light ルール(トップレベル)に黒。
    expect(style).toContain('.jc2{stroke:#000000;}');
    // dark ルールは @media (prefers-color-scheme: dark) ブロック内に白。
    const darkBlock = style.slice(style.indexOf('@media (prefers-color-scheme: dark)'));
    expect(darkBlock).toContain('.jc2{stroke:#ffffff;}');
  });
});
