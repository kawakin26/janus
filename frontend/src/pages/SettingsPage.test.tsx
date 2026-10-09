// @vitest-environment jsdom
// 設定画面 SettingsPage のテスト（タスク 15）。
//
// 検証対象（tasks.md タスク15）:
// - エクスポート/インポートボタンの描画
// - エクスポート押下で export-import.ts の exportAndDownload が呼ばれる（export-import.ts をモック）
// - インポート: ファイル選択 → confirm → importFromZip 呼出 → location.reload
// - モード切替で clearMode + location.reload が呼ばれる
// - サーバーモード時（readMode()==='server'）はエクスポート/インポートを非表示にする
//
// idb.ts の openDb はテストで実 IndexedDB を開かないようモックする。export-import.ts と mode.ts も
// モックして SettingsPage のロジック呼び出しだけを検証する。location.reload は jsdom で読み取り専用の
// ため ModeGate.test.tsx の流儀で差し替える。AppLayout が AuthProvider/StorageProvider/ThemeProvider/
// Router を要求するため、それらでラップして描画する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import { ThemeProvider } from '../theme/ThemeProvider'
import SettingsPage from './SettingsPage'
import { createStubStorage, sampleUser } from '../test/stub-storage'
import type { StorageClient } from '../storage/types'

// --- モック ---
vi.mock('../storage/idb', () => ({
  openDb: vi.fn(async () => ({}) as IDBDatabase),
}))
vi.mock('../storage/export-import', () => ({
  exportAndDownload: vi.fn(async () => {}),
  importFromZip: vi.fn(async () => ({ pageCount: 2, assetCount: 3 })),
}))
vi.mock('../storage/mode', () => ({
  readMode: vi.fn(() => 'local'),
  clearMode: vi.fn(),
}))
// 長押し閾値モジュール（FEAT-002）をモックして SettingsPage の『マップ編集』
// セクションの保存/既定リセットの呼び出しだけを検証する。
vi.mock('../markdown/custom-map/longpress-config', () => ({
  LONGPRESS_MS_MIN: 500,
  resolveDefaultMs: vi.fn(() => 500),
  readUserLongPressMs: vi.fn(() => null),
  writeUserLongPressMs: vi.fn(),
  clearUserLongPressMs: vi.fn(),
}))

import { exportAndDownload, importFromZip } from '../storage/export-import'
import { clearMode, readMode } from '../storage/mode'
import {
  clearUserLongPressMs,
  readUserLongPressMs,
  resolveDefaultMs,
  writeUserLongPressMs,
} from '../markdown/custom-map/longpress-config'

const mockedReadMode = vi.mocked(readMode)
const mockedExportAndDownload = vi.mocked(exportAndDownload)
const mockedImportFromZip = vi.mocked(importFromZip)
const mockedClearMode = vi.mocked(clearMode)
const mockedResolveDefaultMs = vi.mocked(resolveDefaultMs)
const mockedReadUserLongPressMs = vi.mocked(readUserLongPressMs)
const mockedWriteUserLongPressMs = vi.mocked(writeUserLongPressMs)
const mockedClearUserLongPressMs = vi.mocked(clearUserLongPressMs)

// matchMedia のスタブ（AppLayout 内の ThemeToggle が useTheme を要求するため）。
function installMatchMedia(initialMatches = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: initialMatches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }))
}

const originalLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  installMatchMedia(false)
  mockedReadMode.mockReturnValue('local')
  mockedImportFromZip.mockResolvedValue({ pageCount: 2, assetCount: 3 })
  mockedExportAndDownload.mockResolvedValue()
  mockedResolveDefaultMs.mockReturnValue(500)
  mockedReadUserLongPressMs.mockReturnValue(null)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: vi.fn() },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
  vi.restoreAllMocks()
  mockedReadMode.mockReturnValue('local')
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

function renderSettings(client?: StorageClient) {
  const storage =
    client ??
    createStubStorage({
      currentUser: vi.fn(async () => sampleUser),
      getPageTree: vi.fn(async () => []),
    })
  render(
    <StorageProvider client={storage}>
      <AuthProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/settings']}>
            <SettingsPage />
          </MemoryRouter>
        </ThemeProvider>
      </AuthProvider>
    </StorageProvider>,
  )
}

// SettingsPage 本体の「モード」セクション内のモード切替ボタンを取得する。
// AppLayout ヘッダーにも既存の「モード切替」ボタンがあるため（タスク12・非破壊で残す）、
// 画面内に 2 つ存在する。本テストでは SettingsPage が置くボタンだけを検証したいので、
// aria-labelledby="mode-heading" の region（アクセシブル名「モード」）にスコープする。
function getPageModeButton() {
  const region = screen.getByRole('region', { name: 'モード' })
  return within(region).getByRole('button', { name: 'モード切替' })
}

describe('SettingsPage（ローカルモード）', () => {
  it('エクスポート/インポート/モード切替のボタンを描画する', async () => {
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })
    expect(screen.getByRole('button', { name: 'エクスポート' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'インポート' })).toBeInTheDocument()
    expect(getPageModeButton()).toBeInTheDocument()
  })

  it('エクスポート押下で exportAndDownload が呼ばれる', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    await user.click(screen.getByRole('button', { name: 'エクスポート' }))

    await waitFor(() => {
      expect(mockedExportAndDownload).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText('エクスポートが完了しました')).toBeInTheDocument()
  })

  it('インポート: 確認 OK で importFromZip 呼出 → location.reload', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    const input = screen.getByLabelText('インポートする ZIP ファイル') as HTMLInputElement
    const file = new File(['dummy'], 'export.zip', { type: 'application/zip' })
    await user.upload(input, file)

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => {
      expect(mockedImportFromZip).toHaveBeenCalledTimes(1)
    })
    expect(mockedImportFromZip.mock.calls[0][1]).toBe(file)
    await waitFor(() => {
      expect(window.location.reload).toHaveBeenCalled()
    })
  })

  it('インポート: 確認キャンセルで importFromZip を呼ばない', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    const input = screen.getByLabelText('インポートする ZIP ファイル') as HTMLInputElement
    const file = new File(['dummy'], 'export.zip', { type: 'application/zip' })
    await user.upload(input, file)

    expect(mockedImportFromZip).not.toHaveBeenCalled()
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('モード切替押下で clearMode + location.reload が呼ばれる', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    await user.click(getPageModeButton())

    expect(mockedClearMode).toHaveBeenCalledTimes(1)
    expect(window.location.reload).toHaveBeenCalled()
  })
})

describe('SettingsPage（サーバーモード）', () => {
  it('サーバーモードではエクスポート/インポートを出さず未対応案内を表示する', async () => {
    mockedReadMode.mockReturnValue('server')
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    expect(screen.queryByRole('button', { name: 'エクスポート' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'インポート' })).toBeNull()
    expect(
      screen.getByText('エクスポート/インポートはサーバーモードでは未対応です。'),
    ).toBeInTheDocument()
    // モード切替は常に出る。
    expect(getPageModeButton()).toBeInTheDocument()
  })
})

describe('SettingsPage（マップ編集セクション）', () => {
  // 『マップ編集』セクションの長押し時間入力を取得する。
  function getLongPressInput() {
    return screen.getByLabelText('長押し時間（ミリ秒）') as HTMLInputElement
  }
  // セクション内の保存/既定に戻すボタンを region スコープで取得する。
  function getMapEditRegion() {
    return screen.getByRole('region', { name: 'マップ編集' })
  }

  it('500 未満の入力は保存されず role=alert の警告を表示する', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    const input = getLongPressInput()
    await user.clear(input)
    await user.type(input, '300')
    await user.click(within(getMapEditRegion()).getByRole('button', { name: '保存' }))

    expect(mockedWriteUserLongPressMs).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('500 以上の数値を入力してください')
  })

  it('正常値の保存で writeUserLongPressMs が呼ばれ role=status を表示する', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    const input = getLongPressInput()
    await user.clear(input)
    await user.type(input, '800')
    await user.click(within(getMapEditRegion()).getByRole('button', { name: '保存' }))

    expect(mockedWriteUserLongPressMs).toHaveBeenCalledTimes(1)
    expect(mockedWriteUserLongPressMs).toHaveBeenCalledWith(800)
    expect(screen.getByRole('status')).toHaveTextContent('保存しました')
  })

  it('『既定に戻す』で clearUserLongPressMs が呼ばれ入力が既定へ戻る', async () => {
    const user = userEvent.setup()
    mockedResolveDefaultMs.mockReturnValue(700)
    mockedReadUserLongPressMs.mockReturnValue(1200)
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    const input = getLongPressInput()
    expect(input.value).toBe('1200')

    await user.click(within(getMapEditRegion()).getByRole('button', { name: '既定に戻す' }))

    expect(mockedClearUserLongPressMs).toHaveBeenCalledTimes(1)
    expect(getLongPressInput().value).toBe('700')
    expect(screen.getByRole('status')).toHaveTextContent('既定に戻しました')
  })

  it('サーバーモードでもマップ編集セクションを表示する（モード非依存）', async () => {
    mockedReadMode.mockReturnValue('server')
    renderSettings()
    await screen.findByRole('heading', { name: '設定' })

    expect(screen.getByRole('region', { name: 'マップ編集' })).toBeInTheDocument()
    expect(screen.getByLabelText('長押し時間（ミリ秒）')).toBeInTheDocument()
  })
})
