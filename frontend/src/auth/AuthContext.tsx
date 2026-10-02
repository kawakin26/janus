// 認証状態管理（AuthContext）。
//
// 方針（計画の確定判断に接地）:
// - 状態は user: User|null と loading: boolean（初期復元中は true）。
//   マウント時に StorageClient.currentUser() でユーザーを復元する。復元中は loading を true に
//   保ち、ルートガードが /login へフラッシュ（ちらつき）しないようにする（design 9 章）。
// - login は失敗（ApiError）を握りつぶさず再 throw する。フォーム側が ApiError.detail を使って
//   メッセージを出し分けられるようにするため。
// - logout は user を null にする。失効トークンによる 401 捕捉時も、画面側が logout()（＝user=null）を
//   呼べばルートガードが /login へ誘導する経路が成立する。
// - StorageClient 契約型にのみ依存し、RestClient 具象は import しない（design 1 章）。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useStorage } from '../storage/StorageProvider'
import type { User } from '../storage/types'

/** useAuth() が返す認証コンテキストの公開形。 */
export interface AuthContextValue {
  /** 現在のユーザー。未認証または復元前は null。 */
  user: User | null
  /** 起動時のユーザー復元が完了するまで true。ルートガードのちらつき防止に使う。 */
  loading: boolean
  /** ログイン。成功で user を更新。失敗（ApiError 等）は呼び出し側へ再 throw する。 */
  login: (username: string, password: string) => Promise<void>
  /** ログアウト。user を null にする。 */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const storage = useStorage()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  // マウント時に現在ユーザーを復元する。me は未認証でも 200 で null を返す仕様なので、
  // 失敗（ネットワーク等）時も user=null として扱い、ガードが /login へ送れるようにする。
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const restored = await storage.currentUser()
        if (active) {
          setUser(restored)
        }
      } catch {
        // 復元に失敗したら未認証扱い。
        if (active) {
          setUser(null)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [storage])

  const login = useCallback(
    async (username: string, password: string) => {
      // 失敗（ApiError）はそのまま伝播させ、フォーム側で表示できるようにする。
      const { user: loggedIn } = await storage.login(username, password)
      setUser(loggedIn)
    },
    [storage],
  )

  const logout = useCallback(async () => {
    // logout は冪等（RestClient 側で例外を投げない）。必ず user を null にする。
    await storage.logout()
    setUser(null)
  }, [storage])

  const value: AuthContextValue = { user, loading, login, logout }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** 認証コンテキストを取得する。AuthProvider の外で使うと throw する。 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth は AuthProvider の内側で使用してください')
  }
  return value
}
