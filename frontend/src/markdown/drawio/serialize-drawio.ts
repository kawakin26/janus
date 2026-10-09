// drawio シリアライザ（mxGraph XML → `:::drawio` 記法テキスト）。
// remark-drawio.ts のパースと往復無損失になることを目的とする（ブロック 4 FEAT-002）。
//
// 格納形式:
//   :::drawio
//   ```xml
//   <mxGraphModel ...>...</mxGraphModel>
//   ```
//   :::
//
// 往復リスクの中核（2 点）:
// - 行頭 `:::`: XML 本文に行頭 `:::` が現れてもコンテナが早期終了しないようにする。
//   本文はコードフェンス（```xml ... ```）内に収めるため行途中の `:::` は保たれるが、
//   remark-directive はコンテナ終了マーカー（開きと同じ長さの単独コロン行）をコードフェンス
//   より優先して照合する。そこで開閉コンテナのコロン数も「XML 内の最長連続コロン数 + 1」
//   （最低 3）へ動的拡張し、XML 本文中のどのコロン行とも長さが一致しないようにする。
// - 連続バッククォート: XML 本文に ``` が含まれるとコードフェンスが途中で閉じうる。CommonMark は
//   開きフェンスより長い（同数以上の）閉じフェンスを要求するため、開閉フェンスの
//   バッククォート数を「XML 内の最長連続バッククォート数 + 1」（最低 3）に動的拡張する。

const MIN_FENCE_LENGTH = 3

/** 文字列中の指定文字の最長連続数を返す。 */
function longestRun(value: string, char: string): number {
  let longest = 0
  let current = 0
  for (const ch of value) {
    if (ch === char) {
      current += 1
      if (current > longest) longest = current
    } else {
      current = 0
    }
  }
  return longest
}

/**
 * title をブレース内 `"..."` へ安全に出すための正規化。
 * 閲覧経路（remark-directive → remark-drawio）が受理できる文字集合へ寄せる（実測で確定）:
 * - `"` / `'` を含む開始行は remark-directive が container directive として認識せず、
 *   閲覧側で drawio ブロックが消える（XML 抽出が落ちる）。そこで `"`→`”`、`'`→`’`（全角）へ置換する。
 *   これは custom-map の escapeContainerAttrValue（コンテナ値にリテラル引用符を出さない）と同じ流儀。
 * - 改行は空白へ畳む（title は 1 行想定・属性行を壊さない）。
 * - `}` はブレースを閉じて開始行を壊すため値へ出さない（全角 `｝` へ置換）。
 * - バックスラッシュ `\` は remark-directive がブレース内で literal 保持する（畳まない）ため、
 *   エスケープせずそのまま出す。アンエスケープ（drawio-block の extractTitleAttr）も不要（対称に「何もしない」）。
 * この正規化は非可逆（`"`→`”` 等は元に戻らない）だが、title は識別用ラベルであり視認上ほぼ等価で、
 * 引用符入り title で図が丸ごと消える静かなデータ破壊を避けることを最優先する（意図的仕様）。
 */
function escapeDrawioTitle(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '”')
    .replace(/'/g, '’')
    .replace(/}/g, '｝')
}

/**
 * mxGraph XML を `:::drawio` 記法テキストへ変換する。
 * 出力は remark-drawio の unified パイプラインで再パースすると data-drawio に
 * 同一の XML が復元される（行頭 `:::`・連続バッククォート・引用符・改行を保持）。
 *
 * title が非空のときは開始行を `:::drawio{title="<正規化後>"}` にする（後方互換のため既定は空）。
 * title が空なら従来どおり属性なし `:::drawio` を出す。title の正規化は escapeDrawioTitle 参照。
 */
export function serializeDrawio(xml: string, title = ''): string {
  const colonLength = Math.max(MIN_FENCE_LENGTH, longestRun(xml, ':') + 1)
  const colons = ':'.repeat(colonLength)
  const codeFenceLength = Math.max(MIN_FENCE_LENGTH, longestRun(xml, '`') + 1)
  const codeFence = '`'.repeat(codeFenceLength)
  const open =
    title !== '' ? `${colons}drawio{title="${escapeDrawioTitle(title)}"}` : `${colons}drawio`
  return [open, `${codeFence}xml`, xml, codeFence, colons].join('\n')
}
