import init, { isJwwFile, readDocument } from '../../../vendor/ezjww-web/ezjww_wasm.js';
import { config } from './config';

// ==========================================
// JWW(JW_CAD) を SVG に変換する。
//
// JWW の独自バイナリは ezjww(Rust コア/WASM)で解釈する。全エンティティを
// 生 JWW ドキュメント(readDocument)から直接 SVG 化する。
//
// 色は Jw_cad の画面表示色 LCOLLOR に準拠し、ペン色ごとに class(jc1〜jc8)を付ける。
// SVG 内 <style> で prefers-color-scheme に応じて白背景用/黒背景用の色を切り替える。
//
// 対応エンティティ: LINE, ARC/CIRCLE(楕円含む), SOLID, TEXT, POINT
// 座標は JWW 原座標のまま出力し、Y 反転・回転は外側の <g> transform で行う。
//
// 参照実装は temp/jww-to-svg.js。ezjww は `--target web` ビルドのため、
// 使用前に init() を一度 await する必要がある(module scope で memoize)。
// ==========================================

export type JwwOrientation = 0 | 90 | 180 | 270;

// readDocument が返すエンティティの、本変換で参照するフィールドのみ型化する。
interface JwwEntityBase {
  pen_color?: number;
  pen_style?: number;
}

interface JwwEntity {
  type: string;
  base?: JwwEntityBase;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  center_x?: number;
  center_y?: number;
  radius?: number;
  flatness?: number;
  tilt_angle?: number;
  is_full_circle?: boolean;
  start_angle?: number;
  arc_angle?: number;
  point1_x?: number;
  point1_y?: number;
  point2_x?: number;
  point2_y?: number;
  point3_x?: number;
  point3_y?: number;
  point4_x?: number;
  point4_y?: number;
  color?: number;
  x?: number;
  y?: number;
  content?: string;
  size_x?: number;
  size_y?: number;
  angle?: number;
}

interface JwwDocument {
  entities: JwwEntity[];
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const AUX_LINE_STYLE = 9; // 補助線: 画面表示専用で印刷されない

// ezjww の init() は一度だけ呼べば良い。module scope で Promise を memoize する。
// 本番(ブラウザ/Worker)は引数なしで呼び、グルーが
// new URL('ezjww_wasm_bg.wasm', import.meta.url) を fetch する既定経路になる。
// jsdom では import.meta.url が file: にならず自動 fetch が効かないため、
// テストは .wasm バイト列を渡して同一の初期化経路を使える(SOURCE.md / スパイク準拠)。
type JwwInitInput = Parameters<typeof init>[0];
let initPromise: Promise<unknown> | null = null;
const ensureInit = (moduleOrPath?: JwwInitInput): Promise<unknown> => {
  if (!initPromise) {
    initPromise = moduleOrPath === undefined ? init() : init(moduleOrPath);
  }
  return initPromise;
};

const n = (v: number): number => Math.round(v * 1000) / 1000;

const esc = (s: string): string =>
  String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch));

const extend = (bounds: Bounds, x: number | undefined, y: number | undefined): void => {
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
};

const extendArc = (bounds: Bounds, cx: number, cy: number, r: number): void => {
  extend(bounds, cx - r, cy - r);
  extend(bounds, cx + r, cy + r);
};

// ペン色番号(1〜8)→ CSS クラス名。範囲外は 2(標準線)に寄せる。
const penClass = (penColor: number | undefined): string => {
  const p = Number(penColor);
  if (Number.isInteger(p) && p >= 1 && p <= 8) return `jc${p}`;
  return 'jc2';
};

// SOLID(多角形塗り)の色。JWW の SOLID はエンティティ固有の RGB 整数
// (color フィールド, 0x00RRGGBB)で塗り色を持つ。これを #rrggbb にする。
// 白に近すぎて白背景で見えない場合のみ config の solidLight にフォールバックする。
const solidFill = (colorInt: number | undefined): string => {
  if (colorInt == null || !Number.isFinite(colorInt)) return config.jww.solidLight;
  const v = colorInt >>> 0;
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luma > 245) return config.jww.solidLight; // ほぼ白 → 白背景で見えないので既定色
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

// ---- 線種(pen_style → SVG stroke-dasharray) ----
// JWW の標準線種番号におおよそ対応させる。ダッシュ長は基準単位 unit でスケールする。
const dashForStyle = (penStyle: number | undefined, unit: number): string | null => {
  const u = unit;
  switch (Number(penStyle)) {
    case 2:
      return `${u * 3},${u * 2}`;
    case 3:
      return `${u * 1.5},${u * 1.5}`;
    case 4:
      return `${u},${u * 2}`;
    case 5:
      return `${u * 6},${u * 2},${u},${u * 2}`;
    case 6:
      return `${u * 8},${u * 2},${u * 1.5},${u * 2}`;
    case 7:
      return `${u * 6},${u * 2},${u},${u * 2},${u},${u * 2}`;
    case 8:
      return `${u * 8},${u * 2},${u * 1.5},${u * 2},${u * 1.5},${u * 2}`;
    default:
      return null; // 1 や未知は実線
  }
};

// SVG 内に埋め込む <style>。prefers-color-scheme で色を切り替える。
export const buildStyle = (): string => {
  const light = config.jww.lightColors;
  const dark = config.jww.darkColors;
  const lightRules = light.map((c, i) => `.jc${i + 1}{stroke:${c};}`).join('');
  const darkRules = dark.map((c, i) => `.jc${i + 1}{stroke:${c};}`).join('');
  return `<style>
text{stroke:none;}
${lightRules}
.jc1t,.jc2t,.jc3t,.jc4t,.jc5t,.jc6t,.jc7t,.jc8t{stroke:none;}
${light.map((c, i) => `.jc${i + 1}t{fill:${c};}`).join('')}
@media (prefers-color-scheme: dark){
${darkRules}
${dark.map((c, i) => `.jc${i + 1}t{fill:${c};}`).join('')}
}
</style>`;
};

// 生 JWW エンティティ配列を SVG 要素文字列に変換する。
const buildElements = (entities: JwwEntity[], dashUnit: number): string[] => {
  const parts: string[] = [];
  const TWO_PI = Math.PI * 2;
  const drawAux = config.jww.drawAuxLines;

  for (const e of entities) {
    const penStyle = e.base ? e.base.pen_style : 1;
    if (!drawAux && Number(penStyle) === AUX_LINE_STYLE) continue;

    const penColor = e.base ? e.base.pen_color : 2;
    const cls = penClass(penColor); // 線・円弧用(stroke)
    const clsText = `${cls}t`; // テキスト用(fill)
    const dash = dashForStyle(penStyle, dashUnit);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';

    switch (e.type) {
      case 'LINE': {
        parts.push(
          `<line class="${cls}" x1="${n(e.start_x ?? 0)}" y1="${n(e.start_y ?? 0)}" x2="${n(e.end_x ?? 0)}" y2="${n(e.end_y ?? 0)}"${dashAttr} />`,
        );
        break;
      }
      case 'ARC':
      case 'CIRCLE': {
        const cx = e.center_x;
        const cy = e.center_y;
        const rMajor = e.radius;
        if (
          cx == null ||
          cy == null ||
          rMajor == null ||
          !Number.isFinite(cx) ||
          !Number.isFinite(cy) ||
          !Number.isFinite(rMajor)
        ) {
          break;
        }
        const flat = e.flatness == null ? 1 : e.flatness;
        const rMinor = rMajor * flat;
        const tilt = e.tilt_angle || 0;
        const isEllipse = Math.abs(flat - 1) > 1e-6;

        const ptAt = (t: number): { x: number; y: number } => {
          const ex = rMajor * Math.cos(t);
          const ey = rMinor * Math.sin(t);
          return {
            x: cx + ex * Math.cos(tilt) - ey * Math.sin(tilt),
            y: cy + ex * Math.sin(tilt) + ey * Math.cos(tilt),
          };
        };
        const rotDeg = (tilt * 180) / Math.PI;

        if (e.is_full_circle) {
          if (isEllipse) {
            const p0 = ptAt(0);
            const pMid = ptAt(Math.PI);
            parts.push(
              `<path class="${cls}" d="M ${n(p0.x)} ${n(p0.y)} A ${n(rMajor)} ${n(rMinor)} ${n(rotDeg)} 1 1 ${n(pMid.x)} ${n(pMid.y)} A ${n(rMajor)} ${n(rMinor)} ${n(rotDeg)} 1 1 ${n(p0.x)} ${n(p0.y)}" fill="none"${dashAttr} />`,
            );
          } else {
            parts.push(
              `<circle class="${cls}" cx="${n(cx)}" cy="${n(cy)}" r="${n(rMajor)}" fill="none"${dashAttr} />`,
            );
          }
          break;
        }

        const t0 = e.start_angle || 0;
        const arc = e.arc_angle || 0;
        const t1 = t0 + arc;
        const p0 = ptAt(t0);
        const p1 = ptAt(t1);
        const absSweep = Math.abs(arc) % TWO_PI;
        const largeArc = absSweep > Math.PI ? 1 : 0;
        // arc_angle>0(反時計回り)を sweep-flag=1、負(時計回り)を 0(実データ照合で確定)。
        const sweepFlag = arc > 0 ? 1 : 0;
        const pathRot = isEllipse ? rotDeg : 0;
        parts.push(
          `<path class="${cls}" d="M ${n(p0.x)} ${n(p0.y)} A ${n(rMajor)} ${n(rMinor)} ${n(pathRot)} ${largeArc} ${sweepFlag} ${n(p1.x)} ${n(p1.y)}" fill="none"${dashAttr} />`,
        );
        break;
      }
      case 'SOLID': {
        const pts: string[] = [];
        const push = (x: number | undefined, y: number | undefined): void => {
          if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return;
          pts.push(`${n(x)},${n(y)}`);
        };
        // 実データ照合の結果、point1 → point3 → point2 → point4 の順で
        // 自己交差しない四角形になる。
        push(e.point1_x, e.point1_y);
        push(e.point3_x, e.point3_y);
        push(e.point2_x, e.point2_y);
        push(e.point4_x, e.point4_y);
        if (pts.length >= 3) {
          const fill = solidFill(e.color);
          parts.push(`<polygon points="${pts.join(' ')}" fill="${fill}" stroke="none" />`);
        }
        break;
      }
      case 'POINT': {
        parts.push(`<circle class="${clsText}" cx="${n(e.x ?? 0)}" cy="${n(e.y ?? 0)}" r="0.5" />`);
        break;
      }
      case 'TEXT': {
        const text = esc(e.content ?? '');
        if (text === '') break;
        const px = e.start_x;
        const py = e.start_y;
        if (px == null || py == null || !Number.isFinite(px) || !Number.isFinite(py)) break;
        const size = e.size_y || e.size_x || 2.5;
        const textRot = Number(e.angle) || 0;
        const localTransform = textRot
          ? `translate(${n(px)},${n(py)}) scale(1,-1) rotate(${n(-textRot)}) translate(${n(-px)},${n(-py)})`
          : `translate(${n(px)},${n(py)}) scale(1,-1) translate(${n(-px)},${n(-py)})`;
        parts.push(
          `<text class="${clsText}" x="${n(px)}" y="${n(py)}" font-size="${n(size)}" transform="${localTransform}">${text}</text>`,
        );
        break;
      }
      default:
        break;
    }
  }

  return parts;
};

// 全エンティティの座標から図面境界を求める。
const collectBounds = (entities: JwwEntity[], bounds: Bounds): void => {
  for (const e of entities) {
    switch (e.type) {
      case 'LINE':
        extend(bounds, e.start_x, e.start_y);
        extend(bounds, e.end_x, e.end_y);
        break;
      case 'ARC':
      case 'CIRCLE':
        if (
          e.center_x != null &&
          e.center_y != null &&
          e.radius != null &&
          Number.isFinite(e.center_x) &&
          Number.isFinite(e.center_y) &&
          Number.isFinite(e.radius)
        ) {
          extendArc(bounds, e.center_x, e.center_y, e.radius);
        }
        break;
      case 'SOLID':
        extend(bounds, e.point1_x, e.point1_y);
        extend(bounds, e.point2_x, e.point2_y);
        extend(bounds, e.point3_x, e.point3_y);
        extend(bounds, e.point4_x, e.point4_y);
        break;
      case 'POINT':
        extend(bounds, e.x, e.y);
        break;
      case 'TEXT':
        extend(bounds, e.start_x, e.start_y);
        break;
      default:
        break;
    }
  }
};

// JWW バイト列(Uint8Array)を SVG 文字列に変換する。
export const jwwToSvg = async (bytes: Uint8Array, rotate: JwwOrientation = 0): Promise<string> => {
  await ensureInit();

  if (!isJwwFile(bytes)) {
    throw new Error('JWW ファイルとして認識できませんでした');
  }

  const doc = readDocument(bytes) as JwwDocument | null;
  if (!doc || !Array.isArray(doc.entities)) {
    throw new Error('JWW に描画可能なエンティティが見つかりません');
  }
  // DoS 対策: パース直後にエンティティ数の上限で拒否する。
  if (config.maxEntities > 0 && doc.entities.length > config.maxEntities) {
    throw new Error(
      `JWW のエンティティ数が上限(${config.maxEntities})を超えています: ${doc.entities.length}`,
    );
  }

  // 1 パス目: 図面境界を確定(線種ダッシュ長を図面サイズに合わせるため)。
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  collectBounds(doc.entities, bounds);

  if (!Number.isFinite(bounds.minX)) {
    throw new Error('JWW から有効な座標を取得できませんでした');
  }

  const width = bounds.maxX - bounds.minX || 1;
  const height = bounds.maxY - bounds.minY || 1;
  const pad = Math.max(width, height) * 0.02;

  // 線種ダッシュ基準長(図面座標)。config で分母を調整可能。
  const dashUnit = Math.max(width, height) / (config.jww.dashDivisor || 600);

  // 2 パス目: 要素生成。
  const elements = buildElements(doc.entities, dashUnit);

  // ---- 座標変換(dxf-to-svg と同じ考え方) ----
  const cornersBase = [
    { x: bounds.minX, y: -bounds.maxY },
    { x: bounds.maxX, y: -bounds.maxY },
    { x: bounds.maxX, y: -bounds.minY },
    { x: bounds.minX, y: -bounds.minY },
  ];

  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = ({ x, y }: { x: number; y: number }): { x: number; y: number } => ({
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  });

  const rotated = cornersBase.map(rot);
  const rb = {
    minX: Math.min(...rotated.map((p) => p.x)) - pad,
    minY: Math.min(...rotated.map((p) => p.y)) - pad,
    maxX: Math.max(...rotated.map((p) => p.x)) + pad,
    maxY: Math.max(...rotated.map((p) => p.y)) + pad,
  };
  const vbW = rb.maxX - rb.minX;
  const vbH = rb.maxY - rb.minY;

  const strokeW = Math.max(width, height) / (config.jww.strokeDivisor || 1600);

  const gTransform = rotate === 0 ? 'scale(1,-1)' : `rotate(${rotate}) scale(1,-1)`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(rb.minX)} ${n(rb.minY)} ${n(vbW)} ${n(vbH)}" width="100%" preserveAspectRatio="xMidYMid meet">
${buildStyle()}
<g transform="${gTransform}" stroke-width="${n(strokeW)}" vector-effect="non-scaling-stroke" fill="none">
${elements.join('\n')}
</g>
</svg>`;
};

// init() を外部から事前実行/ルーティング判定に使えるよう公開する。
// 本番は引数なしで呼ぶ。テストは jsdom 制約を回避するため .wasm バイト列を渡せる。
export { ensureInit as ensureJwwInit, isJwwFile };
export type { JwwInitInput };
