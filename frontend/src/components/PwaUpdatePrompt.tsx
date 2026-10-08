// PWA 更新プロンプト（design §7.6）。
// vite-plugin-pwa の virtual module `virtual:pwa-register/react` が提供する useRegisterSW で
// Service Worker を登録し、新バージョンが利用可能（needRefresh=true）なとき、または
// オフライン起動準備の完了・登録失敗を知らせる必要があるときだけ画面右下に通知バーを描画する。
// registerType:'prompt' のため、更新はユーザーが「更新する」を押したときに実行される
// （作業中に勝手に差し変わらない）。
//
// デザイントークン準拠（手書き dark: は使わず data-theme で自動追従）。ボタンは共通 Button。

import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from './ui/Button'

// 登録失敗時に原因を実機の画面だけで切り分けられるよう、エラーの実メッセージを文字列化する。
// chrome://inspect で PC 接続しなくても SecurityError / fetch 失敗などの種別が読める。
function formatRegisterError(error: unknown): string {
  if (error instanceof Error) {
    return error.name ? `${error.name}: ${error.message}` : error.message
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function PwaUpdatePrompt() {
  const [registrationError, setRegistrationError] = useState<string | null>(null)
  const [offlineReadyNotice, setOfflineReadyNotice] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onOfflineReady: () => setOfflineReadyNotice(true),
    onRegistered: () => setRegistrationError(null),
    onRegisterError: (error) => {
      console.error('Service Worker の登録に失敗しました', error)
      setRegistrationError(formatRegisterError(error))
    },
  })

  const showOfflineReady = offlineReady || offlineReadyNotice
  if (!needRefresh && !showOfflineReady && !registrationError) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded border border-border bg-surface-raised p-4 shadow"
      role={registrationError ? 'alert' : undefined}
    >
      {registrationError && (
        <div>
          <p className="text-fg text-sm">オフライン起動の準備に失敗しました</p>
          {/* 原因切り分け用に実エラーを表示（SecurityError・fetch 失敗など）。 */}
          <p className="text-fg-muted mt-1 break-words text-xs">{registrationError}</p>
          <div className="mt-3 flex justify-end">
            <Button variant="normal" onClick={() => setRegistrationError(null)}>
              閉じる
            </Button>
          </div>
        </div>
      )}
      {showOfflineReady && (
        <div>
          <p className="text-fg text-sm">オフライン起動の準備ができました</p>
          <div className="mt-3 flex justify-end">
            <Button
              variant="normal"
              onClick={() => {
                setOfflineReady(false)
                setOfflineReadyNotice(false)
              }}
            >
              閉じる
            </Button>
          </div>
        </div>
      )}
      {needRefresh && (
        <div>
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
      )}
    </div>
  )
}

export default PwaUpdatePrompt
