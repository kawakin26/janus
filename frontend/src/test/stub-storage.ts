// テスト用の StorageClient スタブ。

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
  getPage?: StorageClient['getPage']
  listChildren?: StorageClient['listChildren']
  createPage?: StorageClient['createPage']
  updatePage?: StorageClient['updatePage']
  deletePage?: StorageClient['deletePage']
  listFolders?: StorageClient['listFolders']
  createFolder?: StorageClient['createFolder']
  listAssets?: StorageClient['listAssets']
  uploadAsset?: StorageClient['uploadAsset']
  moveAsset?: StorageClient['moveAsset']
  getAssetFileUrl?: StorageClient['getAssetFileUrl']
  releaseAssetFileUrl?: StorageClient['releaseAssetFileUrl']
  resolveAssetUrl?: StorageClient['resolveAssetUrl']
}

/** 未指定メソッドはテスト中に呼ばれたことが分かるエラーを返す。 */
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
    listFolders: overrides.listFolders ?? notImplemented('listFolders'),
    createFolder: overrides.createFolder ?? notImplemented('createFolder'),
    listAssets: overrides.listAssets ?? notImplemented('listAssets'),
    uploadAsset: overrides.uploadAsset ?? notImplemented('uploadAsset'),
    moveAsset: overrides.moveAsset ?? notImplemented('moveAsset'),
    getAssetFileUrl: overrides.getAssetFileUrl ?? notImplemented('getAssetFileUrl'),
    releaseAssetFileUrl: overrides.releaseAssetFileUrl ?? vi.fn(),
    resolveAssetUrl: overrides.resolveAssetUrl ?? notImplemented('resolveAssetUrl'),
    search: notImplemented('search'),
  }
}
