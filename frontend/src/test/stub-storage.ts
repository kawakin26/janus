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
  // ページ系メソッド（タスク 10 の画面テスト用）。未指定なら呼ばれると throw する既定を保つ。
  getPage?: StorageClient['getPage']
  listChildren?: StorageClient['listChildren']
  createPage?: StorageClient['createPage']
  updatePage?: StorageClient['updatePage']
  deletePage?: StorageClient['deletePage']
  // アセット系メソッド（タスク 11 の地図ビューアテスト用）。未指定なら throw する既定を保つ。
  listAssets?: StorageClient['listAssets']
  uploadAsset?: StorageClient['uploadAsset']
  resolveAssetUrl?: StorageClient['resolveAssetUrl']
}

/**
 * 認証メソッドとページ系メソッドを差し替えられる StorageClient スタブを作る。
 * 未指定の認証メソッドは安全な既定（未認証）を返す。
 * 未指定のページ系・アセット系メソッドおよび検索メソッドは呼ばれたら throw する（後方互換）。
 */
export function createStubStorage(overrides: StubStorageOverrides = {}): StorageClient {
  const notImplemented = (name: string) => () => {
    throw new Error(`stub storage: ${name}() はこのテストでは未実装です`)
  }

  return {
    login: overrides.login ?? vi.fn(async () => ({ token: 't', user: sampleUser })),
    logout: overrides.logout ?? vi.fn(async () => {}),
    currentUser: overrides.currentUser ?? vi.fn(async () => null),
    getPage: overrides.getPage ?? notImplemented('getPage'),
    listChildren: overrides.listChildren ?? notImplemented('listChildren'),
    createPage: overrides.createPage ?? notImplemented('createPage'),
    updatePage: overrides.updatePage ?? notImplemented('updatePage'),
    deletePage: overrides.deletePage ?? notImplemented('deletePage'),
    listAssets: overrides.listAssets ?? notImplemented('listAssets'),
    uploadAsset: overrides.uploadAsset ?? notImplemented('uploadAsset'),
    resolveAssetUrl: overrides.resolveAssetUrl ?? notImplemented('resolveAssetUrl'),
    search: notImplemented('search'),
  }
}
