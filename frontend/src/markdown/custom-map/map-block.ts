// 本文中の `:::custom-map` ブロック境界ユーティリティ（設計 §7.3）。
//
// GUI 編集はブロック単位で非破壊編集する: 対象 `:::custom-map` 開始行〜対応する
// 終了 `:::` 行の範囲だけを差し替え、ブロック外の本文は保持する。本文全体は再生成しない。
// 複数ブロックは出現順インデックスで区別する。純関数として単体テスト可能。

/** 本文中の 1 つの `:::custom-map` ブロックの範囲。 */
export interface CustomMapBlock {
  /** 出現順インデックス（0 始まり）。 */
  index: number
  /** 開始オフセット（開始行 `:::custom-map` の先頭）。 */
  start: number
  /** 終了オフセット（終了行 `:::` の末尾の次。body.slice(start, end) がブロック全体）。 */
  end: number
}

// 行頭（空白許容）の `:::custom-map`（属性ブレース有無は問わない）開始行。
const OPEN_RE = /^[ \t]*:::custom-map(\{.*\})?[ \t]*$/
// 行頭（空白許容）の `:::` のみ（他ディレクティブ名を伴わない）終了行。
const CLOSE_RE = /^[ \t]*:::[ \t]*$/

/**
 * 本文から `:::custom-map` ブロックの範囲一覧を出現順で返す。
 * 終了 `:::` が見つからないブロックは本文末尾までを範囲とする（寛容に扱う）。
 */
export function findCustomMapBlocks(body: string): CustomMapBlock[] {
  const blocks: CustomMapBlock[] = []
  const lines = body.split('\n')

  // 各行の開始オフセットを事前計算する（`\n` 1 文字分を含める）。
  const lineOffsets: number[] = []
  let offset = 0
  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + 1 // 改行分
  }

  let index = 0
  let i = 0
  while (i < lines.length) {
    if (!OPEN_RE.test(lines[i])) {
      i += 1
      continue
    }
    const start = lineOffsets[i]
    // 対応する終了 `:::` 行を探す。
    let closeLine = -1
    for (let j = i + 1; j < lines.length; j += 1) {
      if (CLOSE_RE.test(lines[j])) {
        closeLine = j
        break
      }
    }
    let end: number
    let nextLine: number
    if (closeLine === -1) {
      // 終了が無ければ本文末尾まで。
      end = body.length
      nextLine = lines.length
    } else {
      end = lineOffsets[closeLine] + lines[closeLine].length
      nextLine = closeLine + 1
    }
    blocks.push({ index, start, end })
    index += 1
    i = nextLine
  }

  return blocks
}

/**
 * 指定ブロック範囲だけを newText で置換し、ブロック外の本文を保持した新しい本文を返す。
 * block は findCustomMapBlocks が返した範囲（同じ body に対するもの）を渡す。
 */
export function replaceCustomMapBlock(
  body: string,
  block: CustomMapBlock,
  newText: string,
): string {
  return body.slice(0, block.start) + newText + body.slice(block.end)
}
