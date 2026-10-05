/// <reference lib="webworker" />
import { convertCadToSvg, type CadOrientation } from './convert';

// ==========================================
// CAD 変換用の module Worker エントリ。
//
// メインスレッドの UI をブロックしないよう、変換(特に大きな図面の SVG 生成)を
// Worker で行う。dispatcher(convert-dispatch.ts)から
// { bytes, orientation, filename } を受け取り、
// { ok:true, svg, filename } か { ok:false, name, message } を返す。
//
// ezjww の WASM は Worker 内でも同じ import + init() で初期化できる(SOURCE.md)。
// ==========================================

export interface CadWorkerRequest {
  bytes: Uint8Array;
  orientation: CadOrientation;
  filename: string;
}

export type CadWorkerResponse =
  | { ok: true; svg: string; filename: string }
  | { ok: false; name: string; message: string };

self.onmessage = async (ev: MessageEvent<CadWorkerRequest>) => {
  const { bytes, orientation, filename } = ev.data;
  try {
    // Worker 内では File を再構築して convertCadToSvg の経路をそのまま使う。
    // 素の ArrayBuffer にコピーして BlobPart の型要件(ArrayBuffer backing)を満たす。
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const file = new File([buffer], filename);
    const result = await convertCadToSvg(file, orientation);
    const res: CadWorkerResponse = { ok: true, svg: result.svg, filename: result.filename };
    (self as DedicatedWorkerGlobalScope).postMessage(res);
  } catch (err) {
    const res: CadWorkerResponse = {
      ok: false,
      name: err instanceof Error ? err.name : 'CadConversionError',
      message: err instanceof Error ? err.message : String(err),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(res);
  }
};
