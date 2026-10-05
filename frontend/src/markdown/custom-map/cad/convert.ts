import { config } from './config';
import { dxfToSvg } from './dxf-to-svg';
import { jwwToSvg, ensureJwwInit, isJwwFile } from './jww-to-svg';

// ==========================================
// CAD(JWW / DXF)ファイルを SVG に変換する統合エントリ。
//
// 純粋な File → SVG 変換で副作用を持たない(uploadAsset を呼ばない / 呼べない)。
// 変換結果の登録は呼び出し側が既存の uploadAsset で行う(design 5.4 / 9.2)。
// ==========================================

export type CadOrientation = 0 | 90 | 180 | 270;

/** JWW/DXF いずれとしても認識できないファイル。 */
export class CadUnsupportedError extends Error {
  constructor(message = 'JWW または DXF として認識できないファイルです') {
    super(message);
    this.name = 'CadUnsupportedError';
  }
}

/** ファイルサイズが上限を超えている。 */
export class CadTooLargeError extends Error {
  constructor(message = 'ファイルサイズが上限を超えています') {
    super(message);
    this.name = 'CadTooLargeError';
  }
}

/** エンティティ数が上限を超えている。 */
export class CadTooManyEntitiesError extends Error {
  constructor(message = 'エンティティ数が上限を超えています') {
    super(message);
    this.name = 'CadTooManyEntitiesError';
  }
}

/** パース失敗・描画不能・不正座標など、変換そのものの失敗。 */
export class CadConversionError extends Error {
  constructor(message = 'CAD の変換に失敗しました') {
    super(message);
    this.name = 'CadConversionError';
  }
}

/** ezjww(WASM)の初期化・実行に失敗した(エンジン利用不可)。 */
export class CadEngineUnavailableError extends Error {
  constructor(message = 'CAD 変換エンジンを初期化できませんでした') {
    super(message);
    this.name = 'CadEngineUnavailableError';
  }
}

const DXF_EXT_RE = /\.dxf$/i;

// ファイル名を .svg に正規化する。
// パス区切り(/ と \)を除去し、既存拡張子を .svg に置換、無ければ付加する。
const toSvgFilename = (name: string): string => {
  const base = name.split(/[/\\]/).pop() || 'drawing';
  const stripped = base.replace(/\.[^.]*$/, '');
  const stem = stripped === '' ? base : stripped;
  return `${stem}.svg`;
};

// エンティティ上限超過メッセージの検出(ポートが投げる Error を型付きに割り当てるため)。
const isEntityCapMessage = (message: string): boolean =>
  message.includes('エンティティ数が上限');

export const convertCadToSvg = async (
  file: File,
  orientation: CadOrientation = 0,
): Promise<{ svg: string; filename: string }> => {
  // (1) サイズ上限。
  if (file.size > config.maxFileBytes) {
    throw new CadTooLargeError(
      `ファイルサイズが上限(${config.maxFileBytes} バイト)を超えています: ${file.size} バイト`,
    );
  }

  // (2) ArrayBuffer → Uint8Array。
  const bytes = new Uint8Array(await file.arrayBuffer());

  // (3) ルーティング: まず JWW として判定(ezjww init を要する)、
  //     次に拡張子 .dxf、どちらでもなければ非対応。
  let isJww: boolean;
  try {
    await ensureJwwInit();
    isJww = isJwwFile(bytes);
  } catch (err) {
    // init / WASM の失敗はエンジン利用不可として扱う。
    throw new CadEngineUnavailableError(
      err instanceof Error ? err.message : 'CAD 変換エンジンを初期化できませんでした',
    );
  }

  if (isJww) {
    try {
      const svg = await jwwToSvg(bytes, orientation);
      return { svg, filename: toSvgFilename(file.name) };
    } catch (err) {
      throw mapConversionError(err);
    }
  }

  if (DXF_EXT_RE.test(file.name)) {
    try {
      const svg = dxfToSvg(bytes, orientation);
      return { svg, filename: toSvgFilename(file.name) };
    } catch (err) {
      throw mapConversionError(err);
    }
  }

  throw new CadUnsupportedError();
};

// ポートが投げる素の Error を型付きエラークラスに割り当てる。
const mapConversionError = (err: unknown): Error => {
  const message = err instanceof Error ? err.message : String(err);
  if (isEntityCapMessage(message)) {
    return new CadTooManyEntitiesError(message);
  }
  return new CadConversionError(message);
};
