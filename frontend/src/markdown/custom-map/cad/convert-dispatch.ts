import {
  convertCadToSvg,
  CadUnsupportedError,
  CadTooLargeError,
  CadTooManyEntitiesError,
  CadConversionError,
  CadEngineUnavailableError,
  type CadOrientation,
} from './convert';
import type { CadWorkerRequest, CadWorkerResponse } from './convert-worker';

// ==========================================
// CAD 変換のディスパッチャ。
//
// Worker が使える環境では module Worker 上で変換し、UI スレッドをブロックしない。
// Worker が無い(jsdom/テスト等)/ Worker がエラーになった場合は、
// メインスレッドの convertCadToSvg にフォールバックする(design 5.6)。
// ==========================================

// Worker が返したエラー名を、対応する型付きエラークラスに復元する。
const errorFromName = (name: string, message: string): Error => {
  switch (name) {
    case 'CadUnsupportedError':
      return new CadUnsupportedError(message);
    case 'CadTooLargeError':
      return new CadTooLargeError(message);
    case 'CadTooManyEntitiesError':
      return new CadTooManyEntitiesError(message);
    case 'CadEngineUnavailableError':
      return new CadEngineUnavailableError(message);
    case 'CadConversionError':
      return new CadConversionError(message);
    default:
      return new CadConversionError(message);
  }
};

const convertInWorker = (
  file: File,
  orientation: CadOrientation,
): Promise<{ svg: string; filename: string }> =>
  new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./convert-worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }

    const cleanup = (): void => {
      worker.terminate();
    };

    worker.onmessage = (ev: MessageEvent<CadWorkerResponse>) => {
      const data = ev.data;
      cleanup();
      if (data.ok) {
        resolve({ svg: data.svg, filename: data.filename });
      } else {
        reject(errorFromName(data.name, data.message));
      }
    };

    worker.onerror = (ev) => {
      cleanup();
      reject(ev.error instanceof Error ? ev.error : new Error(ev.message || 'Worker error'));
    };

    // バイト列化と postMessage は非同期なので、executor 本体は同期に保ち、
    // Promise チェーンで失敗を reject する(no-async-promise-executor 回避)。
    file
      .arrayBuffer()
      .then((buf) => {
        const req: CadWorkerRequest = {
          bytes: new Uint8Array(buf),
          orientation,
          filename: file.name,
        };
        worker.postMessage(req);
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });

// 型付きエラー(convert.ts が投げるもの)はそのまま伝播させ、
// Worker 起動やメッセージングの失敗だけメインスレッドにフォールバックする。
const isTypedCadError = (err: unknown): boolean =>
  err instanceof CadUnsupportedError ||
  err instanceof CadTooLargeError ||
  err instanceof CadTooManyEntitiesError ||
  err instanceof CadConversionError ||
  err instanceof CadEngineUnavailableError;

export const convertCadToSvgDispatch = async (
  file: File,
  orientation: CadOrientation = 0,
): Promise<{ svg: string; filename: string }> => {
  if (typeof Worker === 'undefined') {
    return convertCadToSvg(file, orientation);
  }
  try {
    return await convertInWorker(file, orientation);
  } catch (err) {
    // 変換ロジックが出した型付きエラーは確定した結果なので再フォールバックしない。
    if (isTypedCadError(err)) {
      throw err;
    }
    // Worker の起動/通信失敗はメインスレッドで再試行する。
    return convertCadToSvg(file, orientation);
  }
};
