// 共通アラート/通知（デザインシステム刷新・タスク 4 / design.md §5.1-②・§5.2・§8）。
//
// 調査（grep）で、role="alert" のエラー表示が 8 ファイル超（PageEditPage / CommentSection /
// LoginPage / PageListPage / PageViewPage / PageHistoryPage / PagePermissionPage / MapEditor /
// AssetLibraryPage）に、role="status" の成功/通知が AssetLibraryPage に繰り返し現れることを確認した。
// variant で役割別の下地と既定 role を切り替える。role は明示指定で上書き可能にし、既存の
// role="alert"/"status" のテスト契約（§7.1-2）へそのまま置換できる形にする。

import type { HTMLAttributes, ReactNode } from 'react'

export type AlertVariant = 'success' | 'warning' | 'error' | 'info'

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  // 役割（§5.2）。既定は info。
  variant?: AlertVariant
  children: ReactNode
}

// variant 別の下地（§5.2）。ライト/ダーク両方で地色に馴染むよう状態色の /10 下地を使う。
const VARIANTS: Record<AlertVariant, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10',
  error: 'bg-danger/10 text-danger',
  info: 'bg-primary/10',
}

// 役割別の既定 role（§5.2）。error/warning は割り込み的に伝える alert、success/info は status。
// 呼び出し側が role を明示指定した場合はそちら（rest 側）が勝つ。
const DEFAULT_ROLE: Record<AlertVariant, 'alert' | 'status'> = {
  success: 'status',
  warning: 'alert',
  error: 'alert',
  info: 'status',
}

export function Alert({ variant = 'info', className, role, children, ...rest }: AlertProps) {
  const classes = ['rounded px-3 py-2', VARIANTS[variant], className].filter(Boolean).join(' ')
  return (
    <div role={role ?? DEFAULT_ROLE[variant]} className={classes} {...rest}>
      {children}
    </div>
  )
}

export default Alert
