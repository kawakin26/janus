import { describe, it, expect, vi, beforeEach } from 'vitest';

// jww-to-svg は ezjww(WASM)を import する。convert の DXF/サイズ/非対応経路の
// テストでは WASM を実行させたくないので、モジュールごとモックする。
// isJwwFile は既定で false(= JWW ではない)を返し、ensureJwwInit は解決する。
const isJwwFileMock = vi.fn<(bytes: Uint8Array) => boolean>(() => false);
const jwwToSvgMock = vi.fn<() => Promise<string>>(async () => '<svg></svg>');
const ensureJwwInitMock = vi.fn<() => Promise<unknown>>(async () => undefined);

vi.mock('./jww-to-svg', () => ({
  isJwwFile: (bytes: Uint8Array) => isJwwFileMock(bytes),
  ensureJwwInit: () => ensureJwwInitMock(),
  jwwToSvg: () => jwwToSvgMock(),
}));

import {
  convertCadToSvg,
  CadUnsupportedError,
  CadTooLargeError,
  CadTooManyEntitiesError,
  CadConversionError,
} from './convert';
import { config } from './config';

// 既知寸法の最小 DXF(LINE + CIRCLE)。
const validDxf = [
  '0', 'SECTION',
  '2', 'ENTITIES',
  '0', 'LINE',
  '8', '0',
  '10', '0',
  '20', '0',
  '11', '100',
  '21', '0',
  '0', 'CIRCLE',
  '8', '0',
  '10', '100',
  '20', '50',
  '40', '20',
  '0', 'ENDSEC',
  '0', 'EOF',
  '',
].join('\n');

const makeFile = (content: string | Uint8Array, name: string): File => {
  if (typeof content === 'string') return new File([content], name);
  // 素の ArrayBuffer にコピーして BlobPart の型要件を満たす。
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  return new File([buffer], name);
};

beforeEach(() => {
  isJwwFileMock.mockReset();
  isJwwFileMock.mockReturnValue(false);
  jwwToSvgMock.mockReset();
  jwwToSvgMock.mockResolvedValue('<svg></svg>');
  ensureJwwInitMock.mockReset();
  ensureJwwInitMock.mockResolvedValue(undefined);
});

describe('convertCadToSvg: filename 正規化', () => {
  it('plan.dxf -> plan.svg', async () => {
    const { filename } = await convertCadToSvg(makeFile(validDxf, 'plan.dxf'));
    expect(filename).toBe('plan.svg');
  });

  it('大文字 .DXF でもルーティングし .svg に正規化する', async () => {
    const { filename } = await convertCadToSvg(makeFile(validDxf, 'PLAN.DXF'));
    expect(filename).toBe('PLAN.svg');
  });

  it('パス区切りを除去する', async () => {
    const { filename } = await convertCadToSvg(makeFile(validDxf, 'dir/sub\\plan.dxf'));
    expect(filename).toBe('plan.svg');
  });
});

describe('convertCadToSvg: 失敗分岐の型付きエラー', () => {
  it('サイズ超過 -> CadTooLargeError', async () => {
    const big = makeFile(validDxf, 'plan.dxf');
    Object.defineProperty(big, 'size', { value: config.maxFileBytes + 1 });
    await expect(convertCadToSvg(big)).rejects.toBeInstanceOf(CadTooLargeError);
  });

  it('未知バイト + 非 .dxf 拡張子 -> CadUnsupportedError', async () => {
    const f = makeFile(new Uint8Array([1, 2, 3, 4]), 'mystery.bin');
    await expect(convertCadToSvg(f)).rejects.toBeInstanceOf(CadUnsupportedError);
  });

  it('壊れた DXF -> CadConversionError', async () => {
    const f = makeFile('not a real dxf at all', 'broken.dxf');
    await expect(convertCadToSvg(f)).rejects.toBeInstanceOf(CadConversionError);
  });

  it('エンティティ数上限超過 -> CadTooManyEntitiesError', async () => {
    const original = config.maxEntities;
    config.maxEntities = 1;
    try {
      const f = makeFile(validDxf, 'plan.dxf'); // LINE + CIRCLE = 2 > 1
      await expect(convertCadToSvg(f)).rejects.toBeInstanceOf(CadTooManyEntitiesError);
    } finally {
      config.maxEntities = original;
    }
  });
});
