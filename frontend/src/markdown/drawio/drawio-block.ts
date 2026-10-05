// 本文中の `:::drawio` ブロック境界ユーティリティ（タスク 17 / ブロック 4 FEAT-004）。
//
// map-block.ts と同形。GUI 編集はブロック単位で非破壊編集する: 対象 `:::drawio` 開始行〜
// 対応する終了 `:::` 行の範囲だけを差し替え、ブロック外の本文は保持する。本文全体は再生成しない。
// 複数図は出現順インデックスで区別する。純関数として単体テスト可能。
//
// 注意: serialize-drawio は XML 内に行頭 `:::` 連続があるとコンテナのコロン数を 4 連以上へ
// 動的拡張する。そのため開始/終了行の判定はコロン数「3 以上」を受理し、開始/終了で同じ長さを
// 要求する（長さ不一致の内部コロン行で誤って閉じないようにする）。コードフェンス内の `:::` は
// インデント無しの単独コロン行でない限り終了に合致しないが、本ユーティリティは行頭パターンのみを
// 見るため、終了判定を「開始と同じコロン数」に揃えることで内部コロン行との衝突を避ける。

/** 本文中の 1 つの `:::drawio` ブロックの範囲。 */
export interface DrawioBlock {
  /** 出現順インデックス（0 始まり）。 */
  index: number
  /** 開始オフセット（開始行 `:::drawio` の先頭）。 */
  start: number
  /** 終了オフセット（終了行の末尾の次。body.slice(start, end) がブロック全体）。 */
  end: number
}

// 行頭（空白許容）の `:::`（3 連以上）に続けて drawio 名を持つ開始行。
// 捕捉グループ 1 にコロン列を取り、終了行は同じ長さのコロンのみに一致させる。
const OPEN_RE = /^[ \t]*(:{3,})drawio[ \t]*$/

/** 指定長のコロンのみ（他ディレクティブ名を伴わない）終了行かを判定する。 */
function isCloseLine(line: string, colonLength: number): boolean {
  const re = new RegExp(`^[ \\t]*:{${colonLength}}[ \\t]*$`)
  return re.test(line)
}

/**
 * 本文から `:::drawio` ブロックの範囲一覧を出現順で返す。
 * 終了行（開始と同じコロン数の単独コロン行）が見つからないブロックは本文末尾までを範囲とする。
 */
export function findDrawioBlocks(body: string): DrawioBlock[] {
  const blocks: DrawioBlock[] = []
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
    const open = OPEN_RE.exec(lines[i])
    if (open === null) {
      i += 1
      continue
    }
    const colonLength = open[1].length
    const start = lineOffsets[i]
    // 対応する終了行（開始と同じコロン数）を探す。
    let closeLine = -1
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isCloseLine(lines[j], colonLength)) {
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
 * block は findDrawioBlocks が返した範囲（同じ body に対するもの）を渡す。
 */
export function replaceDrawioBlock(body: string, block: DrawioBlock, newText: string): string {
  return body.slice(0, block.start) + newText + body.slice(block.end)
}
