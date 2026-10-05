import DxfParser from 'dxf-parser';
import { config } from './config';

// ==========================================
// DXF バイト列の文字コードを判定して文字列にデコードする。
// DXF には Shift-JIS(CP932) 保存と UTF-8 保存の両方が存在する。
// 方針(実体優先): まずバイト列が妥当な UTF-8 かを厳密判定し、妥当なら UTF-8。
// 妥当でなければ $DWGCODEPAGE ヘッダ(例 ANSI_932=CP932)を見てデコードする。
// ヘッダの宣言と実体が食い違うファイルがあるため、ヘッダのみを信用せず
// 実体のバイト列判定を優先する。
//
// 参照実装(temp/dxf-to-svg.js)は Node Buffer + iconv-lite を使うが、
// ブラウザ向けに Uint8Array + TextDecoder へ全面的に置き換えてある。
// ==========================================

export type DxfOrientation = 0 | 90 | 180 | 270;

// バイト列が厳密に妥当な UTF-8 か(不正シーケンスがないか)を判定する。
const isValidUtf8 = (bytes: Uint8Array): boolean => {
  try {
    // fatal:true で不正バイト列があれば例外。BOM 有無は問わない。
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

// DXF ヘッダの $DWGCODEPAGE を読む(ヘッダは ASCII なので latin1 で十分)。
// 例: "$DWGCODEPAGE\n  3\nANSI_932" → "ANSI_932"。無ければ null。
const readDwgCodePage = (bytes: Uint8Array): string | null => {
  // 先頭 64KB だけ見れば十分(ヘッダは冒頭にある)。
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const m = /\$DWGCODEPAGE\s*\r?\n\s*3\r?\n\s*([A-Za-z0-9_]+)/.exec(head);
  return m ? m[1].toUpperCase() : null;
};

// ANSI コードページ名 → TextDecoder のラベル。
// 注意: $DWGCODEPAGE は必ずしも実体と一致しない。LibreCAD は実体が Shift-JIS でも
// ANSI_1252 と書き出すため、1252 は「不明扱い」にして CP932 判定に回す。
const ANSI_TO_LABEL: Record<string, string> = {
  ANSI_932: 'shift_jis', // 日本語(CP932)
  ANSI_936: 'gbk', // 簡体字中国語
  ANSI_949: 'euc-kr', // 韓国語
  ANSI_950: 'big5', // 繁体字中国語
  // ANSI_1252 は意図的に載せない(LibreCAD 対策。CP932 妥当性判定へ委ねる)
};

// 指定ラベルでデコードし、置換文字(U+FFFD)が無ければ「妥当」とみなす。
// TextDecoder は未知のバイトを U+FFFD にするので、これでデコード成否を判定できる。
// 未対応ラベルは TextDecoder のコンストラクタが例外を投げるので null を返す。
const tryDecode = (bytes: Uint8Array, label: string): string | null => {
  try {
    const s = new TextDecoder(label).decode(bytes);
    return s.includes('\uFFFD') ? null : s;
  } catch {
    return null;
  }
};

// DXF バイト列を適切な文字コードでデコードして文字列を返す。
// 方針(実体優先):
//   1. 妥当な UTF-8 なら UTF-8
//   2. 明示的な非日本語宣言(936/949/950)があればそれを優先
//   3. それ以外(932/1252/不明)は CP932 を試し、化けなければ CP932
//   4. CP932 が化けるなら、宣言ラベル → 最後は latin1(西欧)でフォールバック
export const decodeDxfBuffer = (bytes: Uint8Array): string => {
  // 1. 実体が妥当な UTF-8 ならそのまま UTF-8(BOM は除去)。
  if (isValidUtf8(bytes)) {
    const s = new TextDecoder('utf-8').decode(bytes);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  const cp = readDwgCodePage(bytes);
  const declared = cp ? ANSI_TO_LABEL[cp] ?? null : null;

  // 2. 明示的な非日本語(中国語/韓国語)宣言は尊重する。
  if (declared && declared !== 'shift_jis') {
    const s = tryDecode(bytes, declared);
    if (s != null) return s;
  }

  // 3. CP932 を試す(化けなければ採用)。日本語 CAD の大多数がここに該当。
  const sjis = tryDecode(bytes, 'shift_jis');
  if (sjis != null) return sjis;

  // 4. 宣言ラベル → latin1 の順でフォールバック(化け許容の最終手段)。
  if (declared) {
    const s = tryDecode(bytes, declared);
    if (s != null) return s;
  }
  return new TextDecoder('latin1').decode(bytes);
};

// ==========================================
// DXF を SVG に変換する。
// 基本エンティティ(LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE, TEXT, MTEXT, POINT)に対応。
// DXF は Y 軸が上向き、SVG は下向きなので、変換時に Y を反転する。
// rotate(0/90/180/270)で図面の向きを変更できる。
// ==========================================

// dxf-parser が返すエンティティの、本変換で参照するフィールドのみを型化する。
interface DxfPoint {
  x: number;
  y: number;
}

interface DxfEntity {
  type: string;
  color?: number;
  colorIndex?: number;
  vertices?: DxfPoint[];
  shape?: boolean;
  closed?: boolean;
  center?: DxfPoint;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  majorAxisEndPoint?: DxfPoint;
  axisRatio?: number;
  position?: DxfPoint;
  startPoint?: DxfPoint;
  text?: string;
  textHeight?: number;
  height?: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// AutoCAD Color Index (ACI) の代表色。0/256/7 は既定色(黒)扱い。
const ACI_COLORS: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#000000',
  8: '#808080',
  9: '#c0c0c0',
};

const colorOf = (entity: DxfEntity): string => {
  const aci = entity.color ?? entity.colorIndex;
  if (aci != null && ACI_COLORS[aci]) return ACI_COLORS[aci];
  return '#000000';
};

// 数値を SVG 用に丸める(小数 3 桁)
const n = (v: number): number => Math.round(v * 1000) / 1000;

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch));

// 座標の集計用に境界を更新する
const extend = (bounds: Bounds, x: number, y: number): void => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
};

const extendArc = (bounds: Bounds, cx: number, cy: number, r: number): void => {
  extend(bounds, cx - r, cy - r);
  extend(bounds, cx + r, cy + r);
};

// エンティティ配列から SVG 要素文字列と境界を生成する。
// 座標は「DXF 原座標」のまま出力し、Y 反転・回転は外側の <g> transform でまとめて行う。
const buildElements = (entities: DxfEntity[], bounds: Bounds): string[] => {
  const parts: string[] = [];

  for (const e of entities) {
    const stroke = colorOf(e);
    switch (e.type) {
      case 'LINE': {
        const [s, t] = e.vertices ?? [];
        if (!s || !t) break;
        extend(bounds, s.x, s.y);
        extend(bounds, t.x, t.y);
        parts.push(
          `<line x1="${n(s.x)}" y1="${n(s.y)}" x2="${n(t.x)}" y2="${n(t.y)}" stroke="${stroke}" />`,
        );
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = e.vertices ?? [];
        if (verts.length < 2) break;
        verts.forEach((v) => extend(bounds, v.x, v.y));
        const pts = verts.map((v) => `${n(v.x)},${n(v.y)}`).join(' ');
        const closed = e.shape || e.closed;
        const tag = closed ? 'polygon' : 'polyline';
        parts.push(`<${tag} points="${pts}" fill="none" stroke="${stroke}" />`);
        break;
      }
      case 'CIRCLE': {
        const c = e.center;
        if (!c || e.radius == null) break;
        extendArc(bounds, c.x, c.y, e.radius);
        parts.push(
          `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(e.radius)}" fill="none" stroke="${stroke}" />`,
        );
        break;
      }
      case 'ARC': {
        const c = e.center;
        if (!c || e.radius == null) break;
        const r = e.radius;
        extendArc(bounds, c.x, c.y, r);
        // dxf-parser は startAngle/endAngle をラジアンで返す。度に変換せずそのまま使う。
        const a0 = e.startAngle ?? 0;
        const a1 = e.endAngle ?? 0;
        const x0 = c.x + r * Math.cos(a0);
        const y0 = c.y + r * Math.sin(a0);
        const x1 = c.x + r * Math.cos(a1);
        const y1 = c.y + r * Math.sin(a1);
        // 反時計回り(DXF の正方向)の掃引角をラジアンで求める。
        const TWO_PI = Math.PI * 2;
        let sweep = a1 - a0;
        sweep = ((sweep % TWO_PI) + TWO_PI) % TWO_PI; // 0..2π に正規化
        const largeArc = sweep > Math.PI ? 1 : 0;
        // DXF の円弧は反時計回り。Y 反転済みの座標系では sweep-flag=1 が反時計回りに対応する。
        parts.push(
          `<path d="M ${n(x0)} ${n(y0)} A ${n(r)} ${n(r)} 0 ${largeArc} 1 ${n(x1)} ${n(y1)}" fill="none" stroke="${stroke}" />`,
        );
        break;
      }
      case 'ELLIPSE': {
        // DXF ELLIPSE: center, majorAxisEndPoint(中心からの相対ベクトル),
        // axisRatio(短軸/長軸), startAngle/endAngle(ラジアン, 長軸基準の媒介変数角)。
        const c = e.center;
        const maj = e.majorAxisEndPoint;
        if (!c || !maj) break;
        const rMajor = Math.hypot(maj.x, maj.y);
        const rMinor = rMajor * (e.axisRatio ?? 1);
        const tilt = Math.atan2(maj.y, maj.x); // 長軸の傾き(ラジアン)
        const TWO_PI = Math.PI * 2;
        const a0 = e.startAngle ?? 0;
        const a1 = e.endAngle ?? TWO_PI;
        // 媒介変数 t の点(楕円の傾きを反映)を返す
        const ptAt = (t: number): DxfPoint => {
          const ex = rMajor * Math.cos(t);
          const ey = rMinor * Math.sin(t);
          return {
            x: c.x + ex * Math.cos(tilt) - ey * Math.sin(tilt),
            y: c.y + ex * Math.sin(tilt) + ey * Math.cos(tilt),
          };
        };
        let sweep = a1 - a0;
        sweep = ((sweep % TWO_PI) + TWO_PI) % TWO_PI;
        const isFull = sweep < 1e-6 || Math.abs(sweep - TWO_PI) < 1e-6;
        // 境界は長軸半径で近似(厳密な外接矩形でなくてよい)
        extend(bounds, c.x - rMajor, c.y - rMajor);
        extend(bounds, c.x + rMajor, c.y + rMajor);
        const rot = (tilt * 180) / Math.PI;
        if (isFull) {
          // 全周楕円は 2 本の半周 arc で描く(A コマンドは 360 度を一度に描けない)
          const p0 = ptAt(0);
          const pMid = ptAt(Math.PI);
          parts.push(
            `<path d="M ${n(p0.x)} ${n(p0.y)} A ${n(rMajor)} ${n(rMinor)} ${n(rot)} 1 1 ${n(pMid.x)} ${n(pMid.y)} A ${n(rMajor)} ${n(rMinor)} ${n(rot)} 1 1 ${n(p0.x)} ${n(p0.y)}" fill="none" stroke="${stroke}" />`,
          );
        } else {
          const p0 = ptAt(a0);
          const p1 = ptAt(a1);
          const largeArc = sweep > Math.PI ? 1 : 0;
          parts.push(
            `<path d="M ${n(p0.x)} ${n(p0.y)} A ${n(rMajor)} ${n(rMinor)} ${n(rot)} ${largeArc} 1 ${n(p1.x)} ${n(p1.y)}" fill="none" stroke="${stroke}" />`,
          );
        }
        break;
      }
      case 'POINT': {
        const p = e.position;
        if (!p) break;
        extend(bounds, p.x, p.y);
        parts.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="0.5" fill="${stroke}" />`);
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        const p = e.startPoint || e.position;
        const text = esc(e.text ?? '');
        if (!p || !text) break;
        extend(bounds, p.x, p.y);
        const size = e.textHeight || e.height || 2.5;
        // 外側で Y 反転(と回転)がかかるため、テキストだけは可読になるよう個別に打ち消す。
        parts.push(
          `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(size)}" fill="${stroke}" data-text="1" transform="translate(${n(p.x)},${n(p.y)}) scale(1,-1) translate(${n(-p.x)},${n(-p.y)})">${text}</text>`,
        );
        break;
      }
      default:
        break;
    }
  }

  return parts;
};

export const dxfToSvg = (bytes: Uint8Array, rotate: DxfOrientation = 0): string => {
  const dxfText = decodeDxfBuffer(bytes);

  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf || !Array.isArray(dxf.entities)) {
    throw new Error('DXF に描画可能なエンティティが見つかりません');
  }
  // DoS 対策: エンティティ数が極端に多い CAD は SVG 生成で CPU/メモリを大量消費する。
  // ファイルサイズ制限を通っても弾けるよう、パース直後に上限で拒否する。
  if (config.maxEntities > 0 && dxf.entities.length > config.maxEntities) {
    throw new Error(
      `DXF のエンティティ数が上限(${config.maxEntities})を超えています: ${dxf.entities.length}`,
    );
  }

  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const elements = buildElements(dxf.entities as DxfEntity[], bounds);

  if (!Number.isFinite(bounds.minX)) {
    throw new Error('DXF から有効な座標を取得できませんでした');
  }

  const width = bounds.maxX - bounds.minX || 1;
  const height = bounds.maxY - bounds.minY || 1;
  const pad = Math.max(width, height) * config.dxf.padRatio;

  // ---- 座標変換の組み立て ----
  // 基本変換 T0: DXF(Y上) → 画面(Y下)。scale(1,-1)。Y 範囲は [-maxY, -minY] に移る。
  // 回転 R: 画面座標系で rotate 度回す。
  // 最終的に <g transform="rotate(θ) scale(1,-1)"> とし、その境界を viewBox にする。

  // T0 適用後の 4 隅(Y 反転のみ)
  const cornersBase = [
    { x: bounds.minX, y: -bounds.maxY },
    { x: bounds.maxX, y: -bounds.maxY },
    { x: bounds.maxX, y: -bounds.minY },
    { x: bounds.minX, y: -bounds.minY },
  ];

  // 回転を適用する関数(画面座標、時計回り正: SVG の rotate は時計回り)
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotPoint = ({ x, y }: DxfPoint): DxfPoint => ({
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  });

  const rotated = cornersBase.map(rotPoint);
  const rb = {
    minX: Math.min(...rotated.map((p) => p.x)) - pad,
    minY: Math.min(...rotated.map((p) => p.y)) - pad,
    maxX: Math.max(...rotated.map((p) => p.x)) + pad,
    maxY: Math.max(...rotated.map((p) => p.y)) + pad,
  };
  const vbW = rb.maxX - rb.minX;
  const vbH = rb.maxY - rb.minY;

  const strokeW = Math.max(width, height) / config.dxf.strokeDivisor;

  // <g> の transform は「rotate してから Y 反転」= rotate(θ) scale(1,-1)。
  const gTransform = rotate === 0 ? 'scale(1,-1)' : `rotate(${rotate}) scale(1,-1)`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(rb.minX)} ${n(rb.minY)} ${n(vbW)} ${n(vbH)}" width="100%" preserveAspectRatio="xMidYMid meet">
<g transform="${gTransform}" stroke-width="${n(strokeW)}" vector-effect="non-scaling-stroke" fill="none">
${elements.join('\n')}
</g>
</svg>`;
};
