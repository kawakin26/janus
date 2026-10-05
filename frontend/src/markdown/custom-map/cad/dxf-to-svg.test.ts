import { describe, it, expect } from 'vitest';
import { dxfToSvg } from './dxf-to-svg';
import type { DxfOrientation } from './dxf-to-svg';

// 既知寸法の DXF を最小構成で組み立てる。
// LINE: (0,0)→(100,0)、CIRCLE: 中心 (100,50) 半径 20。
// → コンテンツ境界は x:[0,120], y:[0,70]。
const buildDxf = (text?: string): string => {
  const entities: string[] = [
    // LINE
    '0', 'LINE',
    '8', '0',
    '10', '0',
    '20', '0',
    '30', '0',
    '11', '100',
    '21', '0',
    '31', '0',
    // CIRCLE
    '0', 'CIRCLE',
    '8', '0',
    '10', '100',
    '20', '50',
    '30', '0',
    '40', '20',
  ];
  if (text != null) {
    entities.push(
      '0', 'TEXT',
      '8', '0',
      '10', '10',
      '20', '10',
      '30', '0',
      '40', '2.5',
      '1', text,
    );
  }
  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    ...entities,
    '0', 'ENDSEC',
    '0', 'EOF',
    '',
  ].join('\n');
};

const toBytes = (s: string): Uint8Array => new TextEncoder().encode(s);

// viewBox="minX minY w h" を数値に分解する。
const parseViewBox = (svg: string): { minX: number; minY: number; w: number; h: number } => {
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  if (!m) throw new Error('viewBox not found');
  return { minX: Number(m[1]), minY: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
};

// Y 反転(scale(1,-1))後に rotate を適用した座標を返す。dxfToSvg と同じ変換。
const transform = (
  x: number,
  y: number,
  rotate: DxfOrientation,
): { x: number; y: number } => {
  const fy = -y; // scale(1,-1)
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - fy * sin, y: x * sin + fy * cos };
};

describe('dxfToSvg', () => {
  it('有効な <svg> を生成する', () => {
    const svg = dxfToSvg(toBytes(buildDxf()));
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<line');
    expect(svg).toContain('<circle');
  });

  const orientations: DxfOrientation[] = [0, 90, 180, 270];
  it.each(orientations)(
    'rotate=%s の viewBox が回転後のコンテンツ境界を内包する（クリップしない）',
    (rotate) => {
      const svg = dxfToSvg(toBytes(buildDxf()), rotate);
      const vb = parseViewBox(svg);

      // コンテンツ境界の 4 隅（x:[0,120], y:[0,70]）を変換してすべて viewBox 内にあることを確認。
      const corners = [
        [0, 0],
        [120, 0],
        [120, 70],
        [0, 70],
      ];
      for (const [cx, cy] of corners) {
        const p = transform(cx, cy, rotate);
        expect(p.x).toBeGreaterThanOrEqual(vb.minX - 1e-6);
        expect(p.x).toBeLessThanOrEqual(vb.minX + vb.w + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(vb.minY - 1e-6);
        expect(p.y).toBeLessThanOrEqual(vb.minY + vb.h + 1e-6);
      }
      expect(vb.w).toBeGreaterThan(0);
      expect(vb.h).toBeGreaterThan(0);
    },
  );

  it('<script>/foreignObject/外部参照を含まない', () => {
    const svg = dxfToSvg(toBytes(buildDxf('plain')));
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('xlink:href');
    expect(svg).not.toMatch(/\shref=/);
    // xmlns の名前空間 URI(http://www.w3.org/2000/svg)は外部参照ではないので除外する。
    const withoutNs = svg.replace(/xmlns="[^"]*"/g, '');
    expect(withoutNs).not.toMatch(/https?:\/\//);
  });

  it('TEXT の & < > をエスケープする', () => {
    const svg = dxfToSvg(toBytes(buildDxf('a & b < c > d')));
    expect(svg).toContain('a &amp; b &lt; c &gt; d');
    expect(svg).not.toContain('a & b < c > d');
  });
});
