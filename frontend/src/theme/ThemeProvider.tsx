// 軽量 ThemeProvider（Context 1 枚・設計 §3.2/§3.3）。
// preference 状態・setPreference・実効テーマ（light/dark）を提供する。
// 既存 Provider 入れ子（BrowserRouter > StorageProvider > AuthProvider）を複雑化させないため、
// main.tsx のルート直下に 1 枚だけ足す（設計 §3.2）。

import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  applyEffectiveTheme,
  getSystemTheme,
  readStoredPreference,
  resolveEffectiveTheme,
  writeStoredPreference,
  type EffectiveTheme,
  type ThemePreference,
} from './theme-core'

export interface ThemeContextValue {
  // ユーザー設定（system/light/dark）。
  preference: ThemePreference
  // 設定を更新する（localStorage 永続化 + <html data-theme> 反映）。
  setPreference: (preference: ThemePreference) => void
  // 実際に適用されている解決済みテーマ（light/dark）。
  effectiveTheme: EffectiveTheme
}

// eslint-disable-next-line react-refresh/only-export-components
export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 初期値は FOUC スクリプトと同一ルールで localStorage から読む（不正値→system）。
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference())
  // OS の配色（prefers-color-scheme）。system 追従のためだけに保持し、
  // matchMedia の change でのみ更新する（外部システムの購読＝正当な setState）。
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => getSystemTheme())

  // 実効テーマは preference と systemTheme からレンダー中に導出する（state を増やさない）。
  const effectiveTheme: EffectiveTheme =
    preference === 'system' ? systemTheme : resolveEffectiveTheme(preference)

  // <html data-theme> への反映は外部システム（DOM）への同期なので effect で行う。
  useEffect(() => {
    applyEffectiveTheme(effectiveTheme)
  }, [effectiveTheme])

  // system のときだけ OS の配色変更に追従する（設計 §3.1）。
  // matchMedia 不在時（設計 §11）は購読をスキップする。
  useEffect(() => {
    if (preference !== 'system') return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemTheme(getSystemTheme())
    // 購読開始時点の OS 値へ同期しておく（購読前に変化していた場合に備える）。
    handleChange()
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    writeStoredPreference(next)
    // system 復帰時は、選択時点の OS 値を同じ更新で取り込む（設計 §3.1）。
    // 明示テーマ中に OS 配色が変わっていても、キャッシュ済みの古い systemTheme を
    // 一度適用してしまう（stale な配色のちらつき）を防ぐ。
    if (next === 'system') {
      setSystemTheme(getSystemTheme())
    }
    setPreferenceState(next)
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, setPreference, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
