// 設定画面（ローカルモードのエクスポート/インポート/モード切替・タスク 15）。
//
// 方針（design §3.9/§3.11・tasks.md タスク15）:
// - エクスポート/インポート/モード切替をまとめた画面。AppLayout でラップし既存ページと同体裁にする。
// - DB ハンドルは storage/idb.ts の openDb() を直接呼んで得る（最も疎結合。StorageClient 契約は不変）。
//   export-import.ts の公開 API は引数が IDBDatabase なので、ここで開いた接続をそのまま渡す。
// - サーバーモード（readMode() === 'server'）ではエクスポート/インポートを非表示にし、
//   「サーバーモードでは未対応」と案内する（design §3.9）。
//
// サーバー側取り込みは本要件では実装しない（design §3.10）。
// 将来方針として以下を記録のみ:
//   - Django management command: `python manage.py import_janus_zip <path-to-zip>`
//   - 専用インポート API: `POST /api/import`（認証必須・is_superuser のみ・multipart で ZIP 受領）
// いずれもサーバー側に Page/Revision/Comment/Asset/Folder を一括作成する。

import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import AppLayout from '../components/AppLayout'
import { Button } from '../components/ui/Button'
import { openDb } from '../storage/idb'
import {
  exportAndDownload,
  importFromZip,
  type ImportResult,
} from '../storage/export-import'
import { clearMode, readMode } from '../storage/mode'
import { ApiError } from '../storage/types'
import {
  LONGPRESS_MS_MIN,
  clearUserLongPressMs,
  readUserLongPressMs,
  resolveDefaultMs,
  writeUserLongPressMs,
} from '../markdown/custom-map/longpress-config'

function SettingsPage() {
  // 現在のモード。サーバーモードならエクスポート/インポートを出さない（design §3.9）。
  const mode = readMode()
  const isServer = mode === 'server'

  // エクスポート/インポートの進捗・エラー・完了メッセージ。
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // マップ編集（長押し閾値）セクション（design §9）。モード非依存で常に表示する。
  // 初期値はユーザー設定（localStorage）があればそれ、無ければシステム既定（env or 500）。
  const [longPressMs, setLongPressMs] = useState<string>(() =>
    String(readUserLongPressMs() ?? resolveDefaultMs()),
  )
  const [longPressStatus, setLongPressStatus] = useState<string | null>(null)
  const [longPressError, setLongPressError] = useState<string | null>(null)

  // 保存: 500 未満/非数は保存せず alert。正常なら writeUserLongPressMs → status。
  const handleSaveLongPress = () => {
    const value = Number(longPressMs)
    if (!Number.isFinite(value) || value < LONGPRESS_MS_MIN) {
      setLongPressStatus(null)
      setLongPressError(`${LONGPRESS_MS_MIN} 以上の数値を入力してください`)
      return
    }
    writeUserLongPressMs(value)
    setLongPressError(null)
    setLongPressStatus('保存しました')
  }

  // 既定に戻す: ユーザー設定を削除し、入力欄をシステム既定へ戻す。
  const handleResetLongPress = () => {
    clearUserLongPressMs()
    setLongPressMs(String(resolveDefaultMs()))
    setLongPressError(null)
    setLongPressStatus('既定に戻しました')
  }

  // エクスポート: openDb() で DB を開き exportAndDownload に渡す。進捗テキストを表示する。
  const handleExport = async () => {
    setError(null)
    setProgress('エクスポートを準備中…')
    setBusy(true)
    try {
      const db = await openDb()
      await exportAndDownload(db, (message) => setProgress(message))
      setProgress('エクスポートが完了しました')
    } catch (err) {
      setProgress(null)
      setError(
        err instanceof ApiError
          ? err.message
          : 'エクスポートに失敗しました',
      )
    } finally {
      setBusy(false)
    }
  }

  // インポート: ファイル選択 → window.confirm で確認 → importFromZip → 成功後 location.reload()。
  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    // 同一ファイル再選択でも onChange が再発火するよう値をクリアする。
    event.target.value = ''
    if (file === null) return

    const confirmed = window.confirm(
      'インポートすると現在のローカルデータはすべて置き換えられます。続行しますか？',
    )
    if (!confirmed) return

    setError(null)
    setProgress('インポートを準備中…')
    setBusy(true)
    try {
      const db = await openDb()
      const result: ImportResult = await importFromZip(db, file, (message) =>
        setProgress(message),
      )
      setProgress(
        `インポートが完了しました（ページ ${result.pageCount} 件 / アセット ${result.assetCount} 件）。再読み込みします…`,
      )
      // 復元後は in-memory の状態と IDB を一致させるためリロードする。
      location.reload()
    } catch (err) {
      setProgress(null)
      setError(
        err instanceof ApiError ? err.message : 'インポートに失敗しました',
      )
      setBusy(false)
    }
  }

  // モード切替: モードを消してリロードする（起動時に ModeGate が再び選択を促す）。
  const handleSwitchMode = () => {
    clearMode()
    location.reload()
  }

  return (
    <AppLayout>
      <h1>設定</h1>

      <section className="my-6" aria-labelledby="data-heading">
        <h2 id="data-heading">データ</h2>
        {isServer ? (
          <p className="text-fg-muted">
            エクスポート/インポートはサーバーモードでは未対応です。
          </p>
        ) : (
          <div className="grid gap-4 max-w-lg">
            <div className="grid gap-2">
              <p className="text-sm text-fg-muted">
                ローカルの全データを ZIP ファイルとして書き出します。
              </p>
              <div>
                <Button type="button" onClick={() => void handleExport()} disabled={busy}>
                  エクスポート
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <p className="text-sm text-fg-muted">
                ZIP ファイルから復元します。現在のローカルデータは置き換えられます。
              </p>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".zip"
                aria-label="インポートする ZIP ファイル"
                onChange={(event) => void handleImportFileChange(event)}
              />
              <div>
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  インポート
                </Button>
              </div>
            </div>

            {progress !== null && <p role="status">{progress}</p>}
            {error !== null && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="my-6" aria-labelledby="mode-heading">
        <h2 id="mode-heading">モード</h2>
        <p className="text-sm text-fg-muted mb-2">
          動作モード（ローカル / サーバー）を選び直します。
        </p>
        <Button type="button" onClick={handleSwitchMode}>
          モード切替
        </Button>
      </section>

      <section className="my-6" aria-labelledby="map-edit-heading">
        <h2 id="map-edit-heading">マップ編集</h2>
        <div className="grid gap-2 max-w-lg">
          <p className="text-sm text-fg-muted">
            マーカー追加の長押し時間（ミリ秒）を調整できます。最小 {LONGPRESS_MS_MIN}ms。
          </p>
          <p className="text-sm text-fg-muted">
            システム既定: {resolveDefaultMs()}ms
          </p>
          <div className="grid gap-2">
            <label htmlFor="map-longpress-ms" className="text-sm">
              長押し時間（ミリ秒）
            </label>
            <input
              id="map-longpress-ms"
              type="number"
              min={LONGPRESS_MS_MIN}
              step={50}
              value={longPressMs}
              onChange={(event) => setLongPressMs(event.target.value)}
              className="max-w-40 rounded border border-border bg-control px-2 py-1 text-fg"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={handleSaveLongPress}>
              保存
            </Button>
            <Button type="button" onClick={handleResetLongPress}>
              既定に戻す
            </Button>
          </div>
          {longPressStatus !== null && <p role="status">{longPressStatus}</p>}
          {longPressError !== null && (
            <p role="alert" className="text-danger">
              {longPressError}
            </p>
          )}
        </div>
      </section>
    </AppLayout>
  )
}

export default SettingsPage
