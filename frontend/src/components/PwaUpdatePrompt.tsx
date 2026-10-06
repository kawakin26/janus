// PWA 更新プロンプト（design §7.6）。
// vite-plugin-pwa の virtual module `virtual:pwa-register/react` が提供する useRegisterSW で
// Service Worker を登録し、新バージョンが利用可能（needRefresh=true）なときだけ画面右下に
// 通知バーを描画する。registerType:'prompt' のため、更新はユーザーが「更新する」を押したときに
// 実行される（作業中に勝手に差し変わらない）。
//
// デザイントークン準拠（手書き dark: は使わず data-theme で自動追従）。ボタンは共通 Button。

import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from './ui/Button'

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded border border-border bg-surface-raised p-4 shadow">
      <p className="text-fg text-sm">新しいバージョンが利用可能です</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="normal" onClick={() => setNeedRefresh(false)}>
          後で
        </Button>
        <Button variant="accent" onClick={() => updateServiceWorker(true)}>
          更新する
        </Button>
      </div>
    </div>
  )
}

export default PwaUpdatePrompt
