// ページ画面共通のエラーハンドリング（D5）。
//
// 方針（過剰設計を避ける）:
// - 各画面（View/Edit/List）で 401（認証切れ）処理を重複させないための小さなフック。
//   新しいグローバル state や抽象レイヤは作らず、useAuth / useNavigate に依存するだけ。
// - 401 を捕捉したら logout()（user を null にする）＋ /login へ誘導し、null を返す
//   （画面側はメッセージ表示をスキップしてよい）。
// - それ以外の ApiError は detail があればそれを、無ければ渡された汎用メッセージ文字列を返す。
// - ApiError 以外（ネットワーク等）も汎用メッセージを返す。

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../storage/types'

/** エラーを人間可読な日本語メッセージへ変換する関数の型。401 は null を返す（遷移済み）。 */
export type PageErrorHandler = (err: unknown, fallbackMessage: string) => string | null

/**
 * ページ画面向けの共通エラーハンドラを返すフック。
 * 401 のときは logout＋/login 遷移を行い null を返す。それ以外は表示用メッセージ文字列を返す。
 */
export function usePageError(): PageErrorHandler {
  const { logout } = useAuth()
  const navigate = useNavigate()

  return useCallback(
    (err: unknown, fallbackMessage: string): string | null => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          // 認証切れ: user を null にして /login へ誘導する。
          void logout().finally(() => {
            navigate('/login', { replace: true })
          })
          return null
        }
        if (err.status === 403) {
          // 権限不足: サーバー固定の detail ではなく画面指定の文言を出す
          //（閲覧系は「閲覧権限がありません」、編集・権限設定系は「編集権限がありません」）。
          return fallbackMessage
        }
        // detail があれば優先、無ければ汎用メッセージ。
        return err.detail ?? fallbackMessage
      }
      return fallbackMessage
    },
    [logout, navigate],
  )
}
