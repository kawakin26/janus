// 記法パーサ（mdast → MapData）。
// filename/file と aliasname/alias の指定子を記法上の出現順で保持する。

import type { ContainerDirective } from 'mdast-util-directive'
import type { Nodes } from 'mdast'
import type { AssetRef, AssetSpecifier } from '../../storage/types'
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

interface AttributeEntry {
  key: string
  value: string
}

const COLON_KEYS = new Set(['filename', 'file', 'aliasname', 'alias'])

function unescapeAttr(s: string): string {
  return s.replace(/\\(["'])/g, '$1')
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char)
}

interface ParsedValue {
  value: string
  nextIndex: number
}

function readAttrValue(text: string, start: number): ParsedValue | null {
  const quote = text[start]
  if (quote === '"' || quote === "'") {
    let index = start + 1
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2
        continue
      }
      if (text[index] === quote) {
        return {
          value: unescapeAttr(text.slice(start + 1, index)),
          nextIndex: index + 1,
        }
      }
      index += 1
    }
    return null
  }

  let index = start
  while (index < text.length && !/\s/.test(text[index])) index += 1
  if (index === start) return null
  return { value: unescapeAttr(text.slice(start, index)), nextIndex: index }
}

/** key=value と filename:value の両方を読み、入力位置順に返す。 */
function parseAttrEntries(text: string): AttributeEntry[] {
  const entries: AttributeEntry[] = []
  let index = 0

  while (index < text.length) {
    // 属性値でない引用符付きテキストもひとまとまりとして読み飛ばし、
    // 値の中に書かれた file:/alias: を指定子として解釈しない。
    if (text[index] === '"' || text[index] === "'") {
      const quoted = readAttrValue(text, index)
      index = quoted?.nextIndex ?? text.length
      continue
    }

    if (!isWordChar(text[index]) || isWordChar(text[index - 1])) {
      index += 1
      continue
    }

    const keyStart = index
    while (index < text.length && isWordChar(text[index])) index += 1
    const key = text.slice(keyStart, index)
    while (/\s/.test(text[index] ?? '')) index += 1
    const operator = text[index]
    if (operator !== '=' && !(operator === ':' && COLON_KEYS.has(key))) continue

    index += 1
    while (/\s/.test(text[index] ?? '')) index += 1
    const parsed = readAttrValue(text, index)
    if (parsed === null) continue
    entries.push({ key, value: parsed.value })
    index = parsed.nextIndex
  }

  return entries
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const { key, value } of parseAttrEntries(text)) attrs[key] = value
  return attrs
}

function specifierKind(key: string): AssetSpecifier['kind'] | null {
  if (key === 'filename' || key === 'file') return 'filename'
  if (key === 'aliasname' || key === 'alias') return 'alias'
  return null
}

function makeAssetRef(
  entries: AttributeEntry[],
  baseFolderPath?: string,
): AssetRef {
  const specifiers: AssetSpecifier[] = []
  for (const { key, value } of entries) {
    const kind = specifierKind(key)
    if (kind !== null && value) specifiers.push({ kind, value })
  }
  return {
    ...(baseFolderPath ? { baseFolderPath } : {}),
    specifiers,
  }
}

function entriesFromAttributes(attributes: Record<string, string | null | undefined>): AttributeEntry[] {
  return Object.entries(attributes)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, value }))
}

/** マーカー行を MarkerData に変換。xもyも無い行はマーカーではない。 */
function parseMarkerLine(text: string): MarkerData | null {
  const attrs = parseAttrs(text)
  if (attrs.x == null && attrs.y == null) return null
  return {
    x: toNumber(attrs.x, 50),
    y: toNumber(attrs.y, 50),
    label: attrs.label || '',
    desc: attrs.desc || '',
    color: attrs.color || '#ff3b30',
    photos: [],
  }
}

/** 写真の子リスト行をPhotoDataへ変換。指定子が無ければnull。 */
function parsePhotoLine(text: string, baseFolderPath?: string): PhotoData | null {
  const entries = parseAttrEntries(text)
  const attrs = parseAttrs(text)
  const assetRef = makeAssetRef(entries, baseFolderPath)
  if (assetRef.specifiers.length === 0) return null
  return { assetRef, desc: attrs.desc || '' }
}

/** ノード配下の text / inlineCode を連結して素のテキストを取り出す。 */
function extractTextFromNode(node: Nodes): string {
  if (node == null) return ''
  if (node.type === 'textDirective' && 'name' in node && typeof node.name === 'string') {
    return `:${node.name}`
  }
  if ((node.type === 'text' || node.type === 'inlineCode') && typeof node.value === 'string') {
    return node.value
  }
  const children = 'children' in node && Array.isArray(node.children) ? node.children : []
  let text = ''
  for (const child of children) text += extractTextFromNode(child as Nodes)
  return text
}

/** custom-mapブロック直下の最初のlistのトップレベルlistItemを返す。 */
function findTopLevelListItems(node: Nodes): Nodes[] {
  let list: Nodes | null = null
  const findList = (current: Nodes): void => {
    if (list || current == null) return
    if (current.type === 'list') {
      list = current
      return
    }
    const children = 'children' in current && Array.isArray(current.children) ? current.children : []
    for (const child of children) {
      findList(child as Nodes)
      if (list) return
    }
  }
  findList(node)
  if (!list) return []
  const listNode = list as unknown as { children?: Nodes[] }
  const children: Nodes[] = Array.isArray(listNode.children) ? listNode.children : []
  return children.filter((child: Nodes): child is Nodes => child != null && child.type === 'listItem')
}

/** listItemの直下テキストだけを取り出す（ネストした写真リストは除外）。 */
function directItemText(listItem: Nodes): string {
  const children = 'children' in listItem && Array.isArray(listItem.children) ? listItem.children : []
  let text = ''
  for (const child of children) {
    if (child && (child as Nodes).type === 'list') continue
    text += extractTextFromNode(child as Nodes)
  }
  return text.trim()
}

/** listItem内のネストした写真リストのlistItem群を返す。 */
function nestedPhotoItems(listItem: Nodes): Nodes[] {
  const children = 'children' in listItem && Array.isArray(listItem.children) ? listItem.children : []
  const out: Nodes[] = []
  for (const child of children) {
    if (child && (child as Nodes).type === 'list') {
      const listChildren = 'children' in child && Array.isArray(child.children) ? child.children : []
      for (const item of listChildren) {
        if (item && (item as Nodes).type === 'listItem') out.push(item as Nodes)
      }
    }
  }
  return out
}

/** `:::custom-map` コンテナディレクティブからMapDataを構築する。 */
export function buildMapData(node: ContainerDirective): MapData {
  const attributes = node.attributes ?? {}
  const attr = (key: string): string | undefined => {
    const value = attributes[key]
    return value == null ? undefined : value
  }
  const baseFolderPath = attr('folder') || undefined
  const mapAssetRef = makeAssetRef(entriesFromAttributes(attributes), baseFolderPath)
  const markers: MarkerData[] = []

  for (const listItem of findTopLevelListItems(node as Nodes)) {
    const marker = parseMarkerLine(directItemText(listItem))
    if (!marker) continue
    const photos = nestedPhotoItems(listItem)
      .map((item) => parsePhotoLine(directItemText(item), baseFolderPath))
      .filter((photo): photo is PhotoData => photo !== null)
    marker.photos = photos
    markers.push(marker)
  }

  return {
    assetRef: mapAssetRef,
    cx: toNumber(attr('cx'), 50),
    cy: toNumber(attr('cy'), 50),
    scale: toNumber(attr('scale'), 1),
    restore: toNumber(attr('restore'), 15),
    rotate: normalizeRotate(toNumber(attr('rotate'), 0)),
    link: attr('link') ?? '',
    // 属性が無ければ空文字へフォールバック（title 未指定の既存記法を壊さない後方互換）。
    title: attr('title') ?? '',
    pinSize: clamp(toNumber(attr('pinSize'), PIN_SIZE_DEFAULT), PIN_SIZE_MIN, PIN_SIZE_MAX),
    labelSize: clamp(toNumber(attr('labelSize'), LABEL_SIZE_DEFAULT), LABEL_SIZE_MIN, LABEL_SIZE_MAX),
    markers,
  }
}
