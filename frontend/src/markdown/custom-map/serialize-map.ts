// 記法シリアライザ（MapData → `:::custom-map` 記法テキスト）。
// `parse-map.ts` の `buildMapData` の逆関数であり、往復無損失を目的とする（設計 §7.1/§7.2）。
//
// 不変条件（設計 §7.1）:
// - コンテナのマップ参照は等号形式のみ（`filename="..."`/`aliasname="..."`）。
//   コロン形式は remark-directive がコンテナを解釈できず往復不成立。
// - マップ参照は 1 指定子のみ出力（複数指定子は先頭を代表採用して正規化）。
//   空 specifiers のときは参照属性を一切出力しない。
//
// エスケープは出力位置で挙動が異なる（実機で確認した remark の挙動に合わせる）:
// - コンテナ属性ブレース `{...}` は remark-directive が解釈し、値中にバックスラッシュ付き
//   クォートがあるとディレクティブ自体のパースに失敗する。したがってコンテナ値には
//   リテラル `"` を出力できない（folder/link は実運用で `"` を含まない前提）。`|`/`/`/`:` は可。
// - マーカー行・写真子リストは Markdown の段落テキストとしてパースされてから
//   `parseAttrEntries`/`readAttrValue`/`unescapeAttr` を通る。Markdown はバックスラッシュを
//   1 段消費するため、reader に `\"` を届けるにはソースへ `\\"`（バックスラッシュ 2 + クォート）を
//   出力する必要がある。これにより reader が `\"` を `"` へ復元する。
//
// 改行の扱い（§7.2）: GUI の textarea が与える生の改行(`\n`)は属性行を壊すため `|` に変換して
// 出力する。`buildMapData` は `|` をそのまま保持し、表示時に `CustomMapViewer.withLineBreaks` が
// `|` を改行へ戻す（`|` が改行表現であることは既存記法の規約）。
//
// `parse-map.ts`/`map-utils.ts`/`types.ts` は変更しない。

import type { AssetSpecifier } from '../../storage/types'
import type { MapData, MarkerData, PhotoData } from './types'
import { LABEL_SIZE_DEFAULT, PIN_SIZE_DEFAULT } from './map-utils'

// buildMapData が属性非存在時に補完する既定値（parse-map.ts と一致させる）。
const CX_DEFAULT = 50
const CY_DEFAULT = 50
const SCALE_DEFAULT = 1
const RESTORE_DEFAULT = 15
const ROTATE_DEFAULT = 0
const LINK_DEFAULT = ''
const TITLE_DEFAULT = ''
const MARKER_COLOR_DEFAULT = '#ff3b30'

/** 生の改行を `|`（既存記法の改行表現）へ変換する。CRLF/CR も正規化する。 */
function newlineToPipe(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '|')
}

/**
 * マーカー行・写真子リスト（Markdown 段落テキスト）用の属性値エスケープ。
 * 設計 §7.2 / tasks.md タスク8 の規則どおり、まず `\` を `\\` に、次に `"` を
 * エスケープする（`\` を先に処理して二重エスケープを避ける）。
 *
 * Markdown のバックスラッシュ 1 段消費を見越し、ソース上では各段をさらに 1 段
 * 多く出力する（`\` を含む値も往復するように）:
 * - `\`（1 個）→ ソース `\\`（Markdown が `\` 1 個へ戻す。reader はそのまま保持）。
 * - `"` → ソース `\\"`（Markdown が `\"` へ戻し、reader の `unescapeAttr` が `"` へ復元）。
 * 改行は `|` へ変換する。
 *
 * 既知の非対応（D-MAP-ESC・据え置き・設計 §7.2）: frozen な parse-map.ts の reader
 * （`readAttrValue`/`unescapeAttr`）は `\\` を畳まず、`\` を「クォートの直前」でのみ
 * 剥がす。これに Markdown の 1 段消費が合成されるため、「クォート直前の `\`」
 * （例 `a\"b`）・「値末尾の単独 `\`」は本質的に往復不可能で、serializer 単独のエスケープ
 * 強化では解決できない（ブルートフォースでも往復するソースが存在しないことを確認済み）。
 * 完全解決には parse-map.ts の reader 変更が必要だが、フェーズ1/2 非破壊・記法仕様の正は
 * foundation 側という大原則から parse-map.ts は変更しない。よって本件は
 * D-MAP-SLASH / D-MAP-PIPE / D-MAP-UNKNOWN / D-MAP-MULTISPEC と同列の既知据え置きとして
 * 扱う（GUI 入力制約は増やさない。ごく稀なエッジで費用対効果が低いため）。日常的な値
 * （Windows パス `C:\dir\x`・パス中クォート `C:\path\to"x`・`"北" / A:B`・改行→`|`）は往復する。
 */
function escapeInlineAttrValue(value: string): string {
  // `\` を先に処理（二重エスケープ回避）。Markdown の 1 段消費分を見込んで `\\` を出力。
  return newlineToPipe(value).replace(/\\/g, '\\\\').replace(/"/g, '\\\\"')
}

/**
 * コンテナ属性ブレース用の属性値エスケープ。remark-directive がブレース内の
 * バックスラッシュ付きクォートでパース失敗するため、リテラル `"` は扱わない
 * （folder/link は `"` を含まない前提）。改行は `|` へ変換する。
 */
function escapeContainerAttrValue(value: string): string {
  return newlineToPipe(value)
}

/** マーカー/写真用 `key="escaped"` トークン。 */
function inlineAttr(key: string, value: string): string {
  return `${key}="${escapeInlineAttrValue(value)}"`
}

/** コンテナ用 `key="escaped"` トークン。 */
function containerAttr(key: string, value: string): string {
  return `${key}="${escapeContainerAttrValue(value)}"`
}

/** AssetSpecifier.kind をコンテナ属性キーへ対応付ける（等号形式・既定キー）。 */
function containerSpecifierAttr(spec: AssetSpecifier): string {
  const key = spec.kind === 'alias' ? 'aliasname' : 'filename'
  return containerAttr(key, spec.value)
}

/** AssetSpecifier.kind を写真子リストの属性キーへ対応付ける（等号形式）。 */
function photoSpecifierAttr(spec: AssetSpecifier): string {
  const key = spec.kind === 'alias' ? 'alias' : 'filename'
  return inlineAttr(key, spec.value)
}

/** コンテナ属性行 `:::custom-map{...}` を生成する。 */
function serializeContainerOpen(mapData: MapData): string {
  const tokens: string[] = []

  if (mapData.assetRef.baseFolderPath) {
    tokens.push(containerAttr('folder', mapData.assetRef.baseFolderPath))
  }

  // 数値/文字列属性は既定値と一致する場合に省略する（buildMapData が既定補完）。
  if (mapData.cx !== CX_DEFAULT) tokens.push(containerAttr('cx', String(mapData.cx)))
  if (mapData.cy !== CY_DEFAULT) tokens.push(containerAttr('cy', String(mapData.cy)))
  if (mapData.scale !== SCALE_DEFAULT) tokens.push(containerAttr('scale', String(mapData.scale)))
  if (mapData.restore !== RESTORE_DEFAULT) {
    tokens.push(containerAttr('restore', String(mapData.restore)))
  }
  if (mapData.rotate !== ROTATE_DEFAULT) tokens.push(containerAttr('rotate', String(mapData.rotate)))
  if (mapData.link !== LINK_DEFAULT) tokens.push(containerAttr('link', mapData.link))
  // title は link と同じ扱い（既定の空文字なら省略、エスケープも containerAttr に揃える）。
  if (mapData.title !== TITLE_DEFAULT) tokens.push(containerAttr('title', mapData.title))
  if (mapData.pinSize !== PIN_SIZE_DEFAULT) {
    tokens.push(containerAttr('pinSize', String(mapData.pinSize)))
  }
  if (mapData.labelSize !== LABEL_SIZE_DEFAULT) {
    tokens.push(containerAttr('labelSize', String(mapData.labelSize)))
  }

  // マップ参照は 1 指定子のみ（先頭を代表採用）。空なら一切出力しない。
  const representative = mapData.assetRef.specifiers[0]
  if (representative) {
    tokens.push(containerSpecifierAttr(representative))
  }

  return tokens.length > 0 ? `:::custom-map{${tokens.join(' ')}}` : ':::custom-map'
}

/** マーカー配下の写真子リスト行を生成する（等号形式・2 スペースインデント）。 */
function serializePhoto(photo: PhotoData): string | null {
  // parsePhotoLine は指定子が無ければ null になるため、指定子の無い写真は出力しない。
  const representative = photo.assetRef.specifiers[0]
  if (!representative) return null
  const tokens = [photoSpecifierAttr(representative)]
  if (photo.desc) tokens.push(inlineAttr('desc', photo.desc))
  return `  - ${tokens.join(' ')}`
}

/** マーカー行（＋写真子リスト）を生成する。 */
function serializeMarker(marker: MarkerData): string {
  // x/y は常に出力する（parseMarkerLine は x または y があればマーカーと認識する）。
  const tokens = [`x=${marker.x}`, `y=${marker.y}`]
  if (marker.label) tokens.push(inlineAttr('label', marker.label))
  if (marker.desc) tokens.push(inlineAttr('desc', marker.desc))
  if (marker.color && marker.color !== MARKER_COLOR_DEFAULT) {
    tokens.push(inlineAttr('color', marker.color))
  }

  const lines = [`- ${tokens.join(' ')}`]
  for (const photo of marker.photos) {
    const line = serializePhoto(photo)
    if (line !== null) lines.push(line)
  }
  return lines.join('\n')
}

/**
 * MapData を `:::custom-map` 記法テキストへ変換する。
 * 出力は必ず `buildMapData` が同一の MapData（参照は代表 1 件に正規化・改行は `|` 表現）に
 * 読み戻せる。
 */
export function serializeMapData(mapData: MapData): string {
  const lines = [serializeContainerOpen(mapData)]
  // コンテナ直後に空行を挟む（既存記法・テストの流儀に合わせる）。
  lines.push('')
  for (const marker of mapData.markers) {
    lines.push(serializeMarker(marker))
  }
  lines.push(':::')
  return lines.join('\n')
}
