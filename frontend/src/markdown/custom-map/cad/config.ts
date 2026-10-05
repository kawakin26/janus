// CAD→SVG 変換の設定値。
//
// 参照実装（temp/jww-to-svg.js・temp/dxf-to-svg.js）が読む `config.js` は
// 参考アセットに含まれないため、ここで新規に定義する。ポート側は
// config.maxEntities / config.jww.* / config.dxf.* を参照実装と同じキーで読む。
//
// 色は Jw_cad の画面表示色（LCOLLOR）に準拠したペン色（jc1〜jc8）。
// lightColors は白背景用、darkColors は黒背景用で、SVG 内 <style> の
// prefers-color-scheme で切り替える。

export interface CadConfig {
  /** DoS 対策。エンティティ数の上限（0 以下で無制限）。 */
  maxEntities: number;
  /** 変換を受け付ける最大ファイルサイズ（バイト）。 */
  maxFileBytes: number;
  jww: {
    /** 白背景用ペン色 jc1..jc8。 */
    lightColors: [string, string, string, string, string, string, string, string];
    /** 黒背景用ペン色 jc1..jc8。 */
    darkColors: [string, string, string, string, string, string, string, string];
    /** SOLID がほぼ白のときのフォールバック塗り色。 */
    solidLight: string;
    /** 補助線（線種 9）を描くか。 */
    drawAuxLines: boolean;
    /** 線種ダッシュ長の基準分母。 */
    dashDivisor: number;
    /** 線幅の基準分母。 */
    strokeDivisor: number;
  };
  dxf: {
    /** 線幅の基準分母。 */
    strokeDivisor: number;
    /** viewBox 余白の割合。 */
    padRatio: number;
  };
}

export const config: CadConfig = {
  maxEntities: 100000,
  maxFileBytes: 30 * 1024 * 1024,
  jww: {
    // Jw_cad の既定ペン色に合わせた白背景向けの色。
    //   jc1 黒 / jc2 赤 / jc3 緑 / jc4 青 / jc5 シアン / jc6 マゼンタ / jc7 黄緑 / jc8 灰
    lightColors: [
      '#000000',
      '#ff0000',
      '#008000',
      '#0000ff',
      '#00aaaa',
      '#aa00aa',
      '#808000',
      '#808080',
    ],
    // 黒背景で視認できるよう明度を上げた同系色。
    darkColors: [
      '#ffffff',
      '#ff6060',
      '#40ff40',
      '#6090ff',
      '#40ffff',
      '#ff60ff',
      '#dddd40',
      '#c0c0c0',
    ],
    solidLight: '#c8c8c8',
    drawAuxLines: false,
    dashDivisor: 600,
    strokeDivisor: 1600,
  },
  dxf: {
    strokeDivisor: 800,
    padRatio: 0.02,
  },
};
