// 共通ボタン（デザインシステム刷新・タスク 4 / design.md §5.1-②・§5.2）。
//
// 調査（grep）で、意味的に 3 系統のボタンが複数ページで繰り返し使われていることを確認した:
//   - normal : 保存 / 作成 / ログアウト / 付与 / ページング 等（ほぼ全ページ）
//   - accent : 編集導線（PageViewPage .editButton=青）/ CommentSection .primaryButton=青
//   - danger : 削除導線（PageViewPage .deleteButton=赤）/ コメント削除
// variant で 3 系統の体裁を切り替える。ネイティブ <button> の属性（type/onClick/disabled/
// aria-* 等）は ButtonHTMLAttributes として透過（spread）する。見た目は Tailwind v4 ユーティリティ
// で与え、Preflight をそのまま活かす（UA 既定へ revert する一時互換コードは書かない）。

import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'normal' | 'accent' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  // 体裁の系統（§5.2）。既定は normal。
  variant?: ButtonVariant
}

// 全 variant 共通の土台。操作要素なので focus-visible リング（§8）と disabled 体裁を含む。
const BASE =
  'inline-flex items-center rounded px-3 py-1.5 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

// variant 別の体裁（§5.2 の体裁基準 + 視認性/ホバー強調の改善）。
// normal は地色トークン control で面として見せ、hover で control-hover に変化させて
// 複数ボタンが並ぶ場面でも輪郭と押下対象が明確になるようにする。
// accent は hover で primary-hover（別トークン）へ、danger は hover で塗りに切り替えて強調する。
const VARIANTS: Record<ButtonVariant, string> = {
  normal:
    'border border-border bg-control text-fg hover:bg-control-hover hover:border-fg-muted',
  accent: 'bg-primary text-primary-contrast hover:bg-primary-hover',
  danger:
    'border border-danger text-danger hover:bg-danger hover:text-primary-contrast',
}

export function Button({ variant = 'normal', className, type, ...rest }: ButtonProps) {
  // type は暗黙の submit を避けるため既定 'button'（呼び出し側で 'submit' を明示上書き可能）。
  const classes = [BASE, VARIANTS[variant], className].filter(Boolean).join(' ')
  return <button type={type ?? 'button'} className={classes} {...rest} />
}

export default Button
