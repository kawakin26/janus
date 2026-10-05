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
    /** SOLID 塗りの黒背景用色（参考実装は未使用。config に保持のみ）。 */
    solidDark: string;
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
    // Jw_cad の線色 1〜8（LCOLLOR）に準拠した白背景用ペン色。
    // 索引 0 が線色1、索引 7 が線色8。white_back_settings.JWF の LCOLLOR 準拠。
    // 線色2 は標準線（light=黒）。
    lightColors: [
      '#00c0c0', // 1
      '#000000', // 2 (標準線=黒)
      '#00c000', // 3
      '#c0c000', // 4
      '#c000c0', // 5
      '#0000ff', // 6
      '#008080', // 7
      '#ff0080', // 8
    ],
    // 黒背景用ペン色。black_back_settings.JWF の LCOLLOR 準拠。
    // 線色2 は標準線（dark=白）。
    darkColors: [
      '#00ffff', // 1
      '#ffffff', // 2 (標準線=白)
      '#00ff00', // 3
      '#ffff00', // 4
      '#c000c0', // 5
      '#2020ff', // 6
      '#008080', // 7
      '#a00000', // 8
    ],
    solidLight: '#c0c0c0',
    solidDark: '#404040',
    drawAuxLines: false,
    dashDivisor: 600,
    strokeDivisor: 1600,
  },
  dxf: {
    strokeDivisor: 800,
    padRatio: 0.02,
  },
};
