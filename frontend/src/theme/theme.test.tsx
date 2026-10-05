// @vitest-environment jsdom
// テーマ機構のユニットテスト（設計 §10/§11・jsdom 必須）。
// window.matchMedia は jsdom に存在しないため vi.fn() スタブでモックする。
// CSS の色変化は jsdom で評価できないため検証しない（目視に委ねる）。検証するのは:
//  (a) localStorage 永続化（setPreference で janus-theme に 3 値が保存される）
//  (b) 不正値正規化（janus-theme に不正値→実効テーマが system 扱い＝OS 追従）
//  (c) system 時の matchMedia 追従（prefers-color-scheme 変化で data-theme が切替わる）
//  (d) トグル操作で preference と data-theme（解決値 light/dark）が変わる
//  (e) matchMedia 不在ガード・localStorage 例外時に落ちない

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import { useTheme } from './useTheme'
import {
  normalizePreference,
  readStoredPreference,
  resolveEffectiveTheme,
  THEME_STORAGE_KEY,
} from './theme-core'

// matchMedia のスタブ。matches と change リスナ発火をテストから制御できるようにする。
type MediaStub = {
  matches: boolean
  listeners: Array<() => void>
  fireChange: (matches: boolean) => void
}

function installMatchMedia(initialMatches: boolean): MediaStub {
  const stub: MediaStub = {
    matches: initialMatches,
    listeners: [],
    fireChange(matches: boolean) {
      stub.matches = matches
      stub.listeners.forEach((l) => l())
    },
  }
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: stub.matches,
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: () => void) => stub.listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      stub.listeners = stub.listeners.filter((l) => l !== cb)
    },
    addListener: (cb: () => void) => stub.listeners.push(cb),
    removeListener: (cb: () => void) => {
      stub.listeners = stub.listeners.filter((l) => l !== cb)
    },
    dispatchEvent: () => true,
  }))
  return stub
}

// useTheme の値を DOM に露出する小さなプローブコンポーネント。
function Probe() {
  const { preference, effectiveTheme } = useTheme()
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="effective">{effectiveTheme}</span>
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('theme-core（純粋ロジック）', () => {
  it('normalizePreference は許可リスト外を system に正規化する', () => {
    expect(normalizePreference('system')).toBe('system')
    expect(normalizePreference('light')).toBe('light')
    expect(normalizePreference('dark')).toBe('dark')
    expect(normalizePreference('dark-blue')).toBe('system')
    expect(normalizePreference('')).toBe('system')
    expect(normalizePreference(null)).toBe('system')
    expect(normalizePreference(undefined)).toBe('system')
  })

  it('resolveEffectiveTheme は system のとき OS 設定、他は preference そのもの', () => {
    installMatchMedia(true) // OS = dark
    expect(resolveEffectiveTheme('system')).toBe('dark')
    expect(resolveEffectiveTheme('light')).toBe('light')
    expect(resolveEffectiveTheme('dark')).toBe('dark')
    installMatchMedia(false) // OS = light
    expect(resolveEffectiveTheme('system')).toBe('light')
  })

  it('readStoredPreference は localStorage の不正値を system に正規化する', () => {
    installMatchMedia(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark-blue')
    expect(readStoredPreference()).toBe('system')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readStoredPreference()).toBe('dark')
  })
})

describe('ThemeProvider / ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('(a) setPreference（トグル操作）で janus-theme に 3 値が保存される', async () => {
    installMatchMedia(false)
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'ダーク' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'ライト' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    await user.click(screen.getByRole('button', { name: 'システム設定に従う' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('(b) 不正値が入っていると system 扱い（OS 追従）になる', () => {
    const media = installMatchMedia(true) // OS = dark
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark-blue')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('preference')).toHaveTextContent('system')
    // OS=dark に追従して data-theme=dark に解決される。
    expect(screen.getByTestId('effective')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(media).toBeTruthy()
  })

  it('(c) system 時に OS の prefers-color-scheme 変化で data-theme が切替わる', () => {
    const media = installMatchMedia(false) // OS = light
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.dataset.theme).toBe('light')

    // OS がダークに変わったら追従する。
    act(() => media.fireChange(true))
    expect(screen.getByTestId('effective')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('(d) トグル操作で preference と data-theme（解決値）が変わる', async () => {
    installMatchMedia(false) // OS = light
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'ダーク' }))
    expect(screen.getByTestId('preference')).toHaveTextContent('dark')
    expect(screen.getByTestId('effective')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'ライト' }))
    expect(screen.getByTestId('preference')).toHaveTextContent('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    // 選択中のボタンは aria-pressed=true になる（支援技術へ現在状態を伝える）。
    expect(screen.getByRole('button', { name: 'ライト' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'ダーク' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('(f) 明示テーマ中に OS 配色が変わってから system へ戻すと stale な配色を経由せず現在の OS 値へ解決する', async () => {
    // OS=dark で起動 → 明示 light に切替（この間 system 購読は停止）。
    const media = installMatchMedia(true) // OS = dark
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')

    // 各レンダーの effectiveTheme を記録するプローブ。stale な中間レンダーも捕捉できる。
    const renders: string[] = []
    function RecordingProbe() {
      const { preference, effectiveTheme } = useTheme()
      renders.push(effectiveTheme)
      return (
        <>
          <span data-testid="preference">{preference}</span>
          <span data-testid="effective">{effectiveTheme}</span>
        </>
      )
    }

    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeToggle />
        <RecordingProbe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('preference')).toHaveTextContent('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    // 明示 light の間（system 購読は停止中）に OS がライトへ変わる。
    // この時点では change リスナが無いため、修正前は systemTheme が dark のまま（stale）。
    act(() => media.fireChange(false)) // OS = light

    // system へ戻す。選択時点の OS 値を同じ更新で取り込むため、
    // 古い dark を一度も経由せず最初のレンダーから light に解決される（設計 §3.1）。
    renders.length = 0
    await user.click(screen.getByRole('button', { name: 'システム設定に従う' }))

    expect(screen.getByTestId('preference')).toHaveTextContent('system')
    expect(screen.getByTestId('effective')).toHaveTextContent('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    // system 復帰後に記録された effectiveTheme はすべて light（stale な dark を経由しない）。
    expect(renders).not.toContain('dark')
  })

  it('(e-1) matchMedia 不在でも落ちず light 既定で解決する', () => {
    // matchMedia を未定義にする（SSR/一部テスト環境を模す）。
    // @ts-expect-error 故意に削除してガードを検証する
    delete window.matchMedia
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    expect(() =>
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      ),
    ).not.toThrow()
    expect(screen.getByTestId('effective')).toHaveTextContent('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('(e-2) localStorage の書き込み失敗を握りつぶして実効テーマ適用を継続する', async () => {
    installMatchMedia(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceeded')
      })
    const user = userEvent.setup()

    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    )

    // 書き込みが失敗しても例外は外に漏れず、実効テーマは適用される。
    await user.click(screen.getByRole('button', { name: 'ダーク' }))
    expect(screen.getByTestId('preference')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(warn).toHaveBeenCalled()

    setItem.mockRestore()
  })

  it('(e-3) localStorage の読み取り失敗時は system にフォールバックする', () => {
    installMatchMedia(false)
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError')
      })

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('preference')).toHaveTextContent('system')
    expect(screen.getByTestId('effective')).toHaveTextContent('light')

    getItem.mockRestore()
  })
})
