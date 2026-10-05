// useTheme フック（設計 §3.2/§3.3）。
// ThemeProvider が提供する preference / setPreference / effectiveTheme を取り出す。

import { useContext } from 'react'
import { ThemeContext, type ThemeContextValue } from './ThemeProvider'

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx === null) {
    throw new Error('useTheme は ThemeProvider の内側で使用してください。')
  }
  return ctx
}
