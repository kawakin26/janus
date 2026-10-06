// 起動時のモード選択画面（design.md §2.3）。
// モード未設定（readMode() が null）のときに main.tsx の Root が描画する。
// 2 択（ローカル / サーバー）を選ぶと writeMode でモードを永続化し、location.reload() で
// 再起動して選択済みの経路（LocalClient / RestClient）に入る。
// デザイントークン厳守・既存 Button（variant accent/normal）使用・アイコンライブラリ非使用・
// dark: 手書き禁止（data-theme 自動追従）。

import { Button } from './ui/Button'
import { writeMode } from '../storage/mode'
import type { Mode } from '../storage/mode'

// モードを永続化してアプリを再起動する（§2.3）。
function selectMode(mode: Mode): void {
  writeMode(mode)
  location.reload()
}

export function ModeGate() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-fg px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-raised p-8 text-center">
        <h1 className="text-2xl font-semibold">Janus</h1>
        <p className="mt-2 text-sm text-fg-muted">
          使い方を選んでください。あとから切り替えられます。
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Button
            variant="accent"
            className="justify-center"
            onClick={() => selectMode('local')}
          >
            ローカルモード — サーバー不要
          </Button>
          <Button
            variant="normal"
            className="justify-center"
            onClick={() => selectMode('server')}
          >
            サーバーモード — ログインして使う
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ModeGate
