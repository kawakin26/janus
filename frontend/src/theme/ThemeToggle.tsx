// 配色テーマ切替 UI（設計 §3.1/§8）。
// 3 状態（system/light/dark）を切り替える button 群。AppLayout への設置は本タスクでは行わず、
// 単体コンポーネントとして import して使える API にする（タスク 3 でヘッダーに置く）。

import { useTheme } from './useTheme'
import type { ThemePreference } from './theme-core'

// 各状態の表示（アイコン + 支援技術向けラベル）。
const OPTIONS: { value: ThemePreference; icon: string; label: string }[] = [
  { value: 'system', icon: '🖥', label: 'システム設定に従う' },
  { value: 'light', icon: '☀', label: 'ライト' },
  { value: 'dark', icon: '🌙', label: 'ダーク' },
]

export function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <div
      role="group"
      aria-label="配色テーマ切替"
      className="inline-flex items-center gap-1 rounded border border-border bg-surface-raised p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = preference === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={option.label}
            onClick={() => setPreference(option.value)}
            className={
              'inline-flex items-center justify-center rounded px-2 py-1 text-sm ' +
              'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ' +
              (selected
                ? 'bg-primary text-primary-contrast'
                : 'text-fg-muted hover:bg-surface hover:text-fg')
            }
          >
            <span aria-hidden="true">{option.icon}</span>
            <span className="sr-only">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
