// テスト用の StorageClient スタブ。
// 認証 UI / ルートガードのコンポーネントテストで StorageProvider の client prop に注入し、
// 実バックエンド（fetch）に一切接続せず状態遷移だけを検証するために使う。
// 認証系（login / logout / currentUser）だけを差し替え可能にし、他メソッドは呼ばれたら throw する。

import { vi } from 'vitest'
import type { StorageClient, User } from '../storage/types'

/** テストでよく使うサンプルユーザー。 */
export const sampleUser: User = {
  id: 1,
  username: 'alice',
  is_staff: false,
  is_superuser: false,
}

export interface StubStorageOverrides {
  login?: StorageClient['login']
  logout?: StorageClient['logout']
  currentUser?: StorageClient['currentUser']
}

/**
 * 認証メソッドだけ差し替えられる StorageClient スタブを作る。
 * 未指定の認証メソッドは安全な既定（未認証）を返す。認証以外のメソッドは呼ばれたら throw。
 */
export function createStubStorage(overrides: StubStorageOverrides = {}): StorageClient {
  const notImplemented = (name: string) => () => {
    throw new Error(`stub storage: ${name}() はこのテストでは未実装です`)
  }

  return {
    login: overrides.login ?? vi.fn(async () => ({ token: 't', user: sampleUser })),
    logout: overrides.logout ?? vi.fn(async () => {}),
    currentUser: overrides.currentUser ?? vi.fn(async () => null),
    getPage: notImplemented('getPage'),
    listChildren: notImplemented('listChildren'),
    createPage: notImplemented('createPage'),
    updatePage: notImplemented('updatePage'),
    deletePage: notImplemented('deletePage'),
    listAssets: notImplemented('listAssets'),
    uploadAsset: notImplemented('uploadAsset'),
    resolveAssetUrl: notImplemented('resolveAssetUrl'),
    search: notImplemented('search'),
  }
}
