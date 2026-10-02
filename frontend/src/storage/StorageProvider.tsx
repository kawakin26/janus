// StorageClient の依存性注入（DI）。
//
// 方針（計画の確定判断に接地）:
// - RestClient 具象を new する箇所をこのファイル 1 箇所に閉じ込める。
//   画面・AuthContext は useStorage() が返す StorageClient 型にのみ依存し、
//   RestClient を直接 import しない（design 1 章「フロントは StorageClient 契約だけに依存」）。
// - トークン永続化は persistToken=true（リロード後もログイン保持）。
//   トークンは RestClient 内に封じ込められ、UI 層は localStorage を直接触らない。
//   XSS 時のリスクは design 5 章の将来方針（HttpOnly Cookie セッション移行）で対処予定。
// - テストや将来の LocalClient 差し替えのため、StorageProvider は任意の client prop を
//   受け取れる（未指定時のみ既定の RestClient を生成する）。注入点だけ用意し過剰設計は避ける。

import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { RestClient } from './rest-client'
import type { StorageClient } from './types'

/**
 * 既定の StorageClient を生成する唯一の箇所。
 * baseUrl は空文字（同一オリジンの /api/... を叩き、dev プロキシが backend へ転送）。
 * persistToken=true でリロード後もログインを保持する。
 */
export function createStorageClient(): StorageClient {
  return new RestClient('', { persistToken: true })
}

// Context の value 型は StorageClient 契約のみ。具象 RestClient 型は漏らさない。
const StorageContext = createContext<StorageClient | null>(null)

export interface StorageProviderProps {
  children: ReactNode
  /** 注入する StorageClient。未指定なら既定の RestClient を 1 度だけ生成する。 */
  client?: StorageClient
}

/**
 * StorageClient を配布する Provider。
 * client 未指定時は useState の遅延初期化で既定インスタンスを 1 度だけ生成し、
 * 再レンダーで作り直さない（安定参照）。
 */
export function StorageProvider({ children, client }: StorageProviderProps) {
  // 既定クライアントは初回レンダー時に一度だけ生成する（遅延初期化）。
  const [defaultClient] = useState<StorageClient>(() => createStorageClient())
  const value = client ?? defaultClient
  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
}

/**
 * StorageClient を取得する。StorageProvider の外で使うと分かりやすく throw する。
 */
export function useStorage(): StorageClient {
  const client = useContext(StorageContext)
  if (client === null) {
    throw new Error('useStorage は StorageProvider の内側で使用してください')
  }
  return client
}
