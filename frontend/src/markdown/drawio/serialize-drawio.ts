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
 * mxGraph XML を `:::drawio` 記法テキストへ変換する。
 * 出力は remark-drawio の unified パイプラインで再パースすると data-drawio に
 * 同一の XML が復元される（行頭 `:::`・連続バッククォート・引用符・改行を保持）。
 */
export function serializeDrawio(xml: string): string {
  const colonLength = Math.max(MIN_FENCE_LENGTH, longestRun(xml, ':') + 1)
  const colons = ':'.repeat(colonLength)
  const codeFenceLength = Math.max(MIN_FENCE_LENGTH, longestRun(xml, '`') + 1)
  const codeFence = '`'.repeat(codeFenceLength)
  return [`${colons}drawio`, `${codeFence}xml`, xml, codeFence, colons].join('\n')
}
