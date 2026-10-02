// 記法パーサ（mdast → MapData）（タスク 11 / 要件 3-1, 3-2）。
//
// 出典: GROWI プラグイン growi-plugin-custom-map v0.3.1 の src/viewer.ts からの移植。
// `:::custom-map` コンテナディレクティブノードを受け取り、GROWI 非依存の純関数として
// MapData を構築する。HTML 文字列の再パースはせず mdast から直接組み立てる（堅牢）。
// 記法仕様（属性名・既定値・クランプ範囲）は不変に保つ。

import type { ContainerDirective } from 'mdast-util-directive'
import type { Nodes } from 'mdast'
import type { MapData, MarkerData, PhotoData } from './types'
import {
  LABEL_SIZE_DEFAULT,
  LABEL_SIZE_MAX,
  LABEL_SIZE_MIN,
  PIN_SIZE_DEFAULT,
  PIN_SIZE_MAX,
  PIN_SIZE_MIN,
  clamp,
  normalizeRotate,
  toNumber,
} from './map-utils'

// editor 側 attrStr のエスケープ（"→\"）に対応するため、\" \' を許容して拾う。
const KV_REGEX = /(\w+)\s*=\s*(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|(\S+))/g

/** エスケープされた \" \' を元に戻す（editor 側 attrStr の逆）。 */
function unescapeAttr(s: string): string {
  return s.replace(/\\(["'])/g, '$1')
}

/** `key=value`（クォート/エスケープ対応）の列を属性オブジェクトへ。 */
function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let m: RegExpExecArray | null
  KV_REGEX.lastIndex = 0
  while ((m = KV_REGEX.exec(text)) !== null) {
    const key = m[1]
    const raw = m[2] ?? m[3] ?? m[4] ?? ''
    attrs[key] = unescapeAttr(raw)
  }
  return attrs
}

/**
 * マーカー行を MarkerData に変換。photos は空で返し、子リストは呼び出し側で足す。
 * 後方互換: 同じ行に photo= があれば写真 1 枚として photos に取り込む。
 * x も y も無い行はマーカーではないとみなし null。
 */
function parseMarkerLine(text: string): MarkerData | null {
  const attrs = parseAttrs(text)
  if (attrs.x == null && attrs.y == null) return null
  const photos: PhotoData[] = []
  if (attrs.photo) photos.push({ photo: attrs.photo, desc: attrs.desc || '' })
  return {
    x: toNumber(attrs.x, 50),
    y: toNumber(attrs.y, 50),
    label: attrs.label || '',
    photo: attrs.photo || '',
    photoSrc: attrs.photoSrc || attrs.photosrc || '',
    desc: attrs.desc || '',
    color: attrs.color || '#ff3b30',
    photos,
  }
}

/** 写真の子リスト行を PhotoData に変換。photo が無ければ null。 */
function parsePhotoLine(text: string): PhotoData | null {
  const attrs = parseAttrs(text)
  if (!attrs.photo) return null
  return { photo: attrs.photo, desc: attrs.desc || '' }
}

/** ノード配下の text / inlineCode を連結して素のテキストを取り出す。 */
function extractTextFromNode(node: Nodes): string {
  if (node == null) return ''
  if (
    (node.type === 'text' || node.type === 'inlineCode') &&
    typeof node.value === 'string'
  ) {
    return node.value
  }
  const children = 'children' in node && Array.isArray(node.children) ? node.children : []
  let text = ''
  for (const child of children) {
    text += extractTextFromNode(child as Nodes)
  }
  return text
}

/**
 * custom-map ブロック直下の「最初の list」を探して、そのトップレベル listItem 群を返す。
 * これらがマーカー行。各 listItem 内にネストした list があればそれが写真（子）。
 * 「全 listItem を平坦収集」だと写真行までマーカー扱いになるため、階層を保つ。
 */
function findTopLevelListItems(node: Nodes): Nodes[] {
  let list: Nodes | null = null
  const findList = (n: Nodes): void => {
    if (list || n == null) return
    if (n.type === 'list') {
      list = n
      return
    }
    const children = 'children' in n && Array.isArray(n.children) ? n.children : []
    for (const c of children) {
      findList(c as Nodes)
      if (list) return
    }
  }
  findList(node)
  if (!list) return []
  const listChildren = 'children' in list && Array.isArray((list as Nodes & { children: Nodes[] }).children)
    ? (list as Nodes & { children: Nodes[] }).children
    : []
  return listChildren.filter((c): c is Nodes => c != null && c.type === 'listItem')
}

/**
 * listItem の「直下 paragraph」だけのテキストを取る（ネストした子リストは含めない）。
 * マーカー行の属性はこの直下テキストにある。
 */
function directItemText(listItem: Nodes): string {
  const children = 'children' in listItem && Array.isArray(listItem.children)
    ? listItem.children
    : []
  let text = ''
  for (const c of children) {
    if (c && (c as Nodes).type === 'list') continue // 子リスト（写真）は除外
    text += extractTextFromNode(c as Nodes)
  }
  return text.trim()
}

/** listItem 内のネストした list の listItem 群（=写真行）を返す。 */
function nestedPhotoItems(listItem: Nodes): Nodes[] {
  const children = 'children' in listItem && Array.isArray(listItem.children)
    ? listItem.children
    : []
  const out: Nodes[] = []
  for (const c of children) {
    if (c && (c as Nodes).type === 'list') {
      const liChildren = 'children' in c && Array.isArray((c as Nodes & { children: Nodes[] }).children)
        ? (c as Nodes & { children: Nodes[] }).children
        : []
      for (const li of liChildren) {
        if (li && (li as Nodes).type === 'listItem') out.push(li as Nodes)
      }
    }
  }
  return out
}

/**
 * `:::custom-map` コンテナディレクティブノードから MapData を構築する純関数。
 * コンテナ属性と、箇条書き（マーカー＋ネスト写真）を解釈する。
 */
export function buildMapData(node: ContainerDirective): MapData {
  const attributes = node.attributes ?? {}
  const attr = (key: string): string | undefined => {
    const v = attributes[key]
    return v == null ? undefined : v
  }
  const markers: MarkerData[] = []

  const listItems = findTopLevelListItems(node as Nodes)
  for (const listItem of listItems) {
    const line = directItemText(listItem)
    const marker = parseMarkerLine(line)
    if (!marker) continue
    // ネストした子リスト行を写真として取り込む。子リストがあれば新方式なので、
    // 旧記法互換で入れた「同一行 photo」の photos は子リスト側で上書きする。
    const photoItems = nestedPhotoItems(listItem)
    if (photoItems.length > 0) {
      const photos: PhotoData[] = []
      for (const pi of photoItems) {
        const photo = parsePhotoLine(directItemText(pi))
        if (photo) photos.push(photo)
      }
      marker.photos = photos
    }
    markers.push(marker)
  }

  return {
    file: attr('file') ?? '',
    src: attr('src') ?? '',
    cx: toNumber(attr('cx'), 50),
    cy: toNumber(attr('cy'), 50),
    scale: toNumber(attr('scale'), 1),
    restore: toNumber(attr('restore'), 15),
    rotate: normalizeRotate(toNumber(attr('rotate'), 0)),
    link: attr('link') ?? '',
    pinSize: clamp(toNumber(attr('pinSize'), PIN_SIZE_DEFAULT), PIN_SIZE_MIN, PIN_SIZE_MAX),
    labelSize: clamp(
      toNumber(attr('labelSize'), LABEL_SIZE_DEFAULT),
      LABEL_SIZE_MIN,
      LABEL_SIZE_MAX,
    ),
    markers,
  }
}
