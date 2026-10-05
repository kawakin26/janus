// 独立アセットライブラリの最小管理画面（FEAT-003）。
// データ操作はStorageClient契約を通し、移動UIは後続フェーズに残す。

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import AppLayout from '../components/AppLayout'
import { useStorage } from '../storage/StorageProvider'
import type { Asset, Folder } from '../storage/types'
import { usePageError } from './use-page-error'
import { convertCadToSvgDispatch } from '../markdown/custom-map/cad/convert-dispatch'
import {
  CadUnsupportedError,
  CadTooLargeError,
  CadTooManyEntitiesError,
  CadConversionError,
  CadEngineUnavailableError,
  type CadOrientation,
} from '../markdown/custom-map/cad/convert'
import styles from './AssetLibraryPage.module.css'

const CAD_ORIENTATIONS: CadOrientation[] = [0, 90, 180, 270]

// 通常画像/SVG アップロードへの誘導文（design 5.5）。
const CAD_UPLOAD_GUIDANCE =
  '変換できない場合は、通常の画像/SVG アップロードフォームからご登録ください。'

// 型付き変換失敗を日本語メッセージへ変換する（design 5.5）。失敗時は uploadAsset を呼ばない。
function cadFailureMessage(err: unknown): string | null {
  if (err instanceof CadTooLargeError) {
    return `ファイルサイズが上限を超えています。${CAD_UPLOAD_GUIDANCE}`
  }
  if (err instanceof CadUnsupportedError) {
    return `対応していないファイルです（.jww / .dxf のみ変換できます）。${CAD_UPLOAD_GUIDANCE}`
  }
  if (err instanceof CadTooManyEntitiesError) {
    return `図面のエンティティ数が上限を超えています。${CAD_UPLOAD_GUIDANCE}`
  }
  if (err instanceof CadEngineUnavailableError) {
    return `この環境では CAD 変換を実行できません。${CAD_UPLOAD_GUIDANCE}`
  }
  if (err instanceof CadConversionError) {
    return `CAD の変換に失敗しました。${CAD_UPLOAD_GUIDANCE}`
  }
  return null
}

function AssetLibraryPage() {
  const storage = useStorage()
  const handleError = usePageError()
  const [folderId, setFolderId] = useState<number | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')
  const [alias, setAlias] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [cadFile, setCadFile] = useState<File | null>(null)
  const [cadOrientation, setCadOrientation] = useState<CadOrientation>(0)
  const [cadConverting, setCadConverting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [uploadedAsset, setUploadedAsset] = useState<Asset | null>(null)
  const [assetUrls, setAssetUrls] = useState<Record<number, string>>({})
  const assetUrlsRef = useRef<Record<number, string>>({})

  useEffect(() => {
    assetUrlsRef.current = assetUrls
  }, [assetUrls])

  useEffect(() => {
    return () => {
      for (const url of Object.values(assetUrlsRef.current)) {
        storage.releaseAssetFileUrl(url)
      }
    }
  }, [storage])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [nextFolders, nextAssets] = await Promise.all([
          storage.listFolders(folderId),
          storage.listAssets(folderId),
        ])
        if (active) {
          setFolders(nextFolders)
          setAssets(nextAssets)
        }
      } catch (err) {
        if (active) setError(handleError(err, 'アセット一覧の取得に失敗しました'))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [folderId, storage, handleError])

  const handleCreateFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = folderName.trim()
    if (!name) return
    setMessage(null)
    try {
      const created = await storage.createFolder({ parentId: folderId, name })
      setFolders((current) =>
        current.some((folder) => folder.id === created.id) ? current : [...current, created],
      )
      setFolderName('')
      setMessage('フォルダを作成しました')
    } catch (err) {
      setMessage(handleError(err, 'フォルダの作成に失敗しました'))
    }
  }

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    if (file === null) return
    setMessage(null)
    try {
      const uploaded = await storage.uploadAsset({
        folderId,
        file,
        ...(alias.trim() ? { alias: alias.trim() } : {}),
      })
      setAssets((current) =>
        current.some((asset) => asset.id === uploaded.id) ? current : [...current, uploaded],
      )
      setUploadedAsset(uploaded)
      setFile(null)
      setAlias('')
      form.reset()
      setMessage('アセットを登録しました')
    } catch (err) {
      setMessage(handleError(err, 'アセットの登録に失敗しました'))
    }
  }

  // CAD（.jww / .dxf）をブラウザ上で SVG に変換し、既存の uploadAsset で登録する。
  // 変換そのものの失敗（型付きエラー）では uploadAsset を呼ばない（サーバー副作用ゼロ）。
  const handleCadConvertUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    if (cadFile === null) return
    setMessage(null)
    setCadConverting(true)
    let converted: { svg: string; filename: string }
    try {
      converted = await convertCadToSvgDispatch(cadFile, cadOrientation)
    } catch (err) {
      const failure = cadFailureMessage(err)
      setMessage(failure ?? handleError(err, 'CAD の変換に失敗しました'))
      setCadConverting(false)
      return
    }
    try {
      const svgFile = new File([converted.svg], converted.filename, { type: 'image/svg+xml' })
      const uploaded = await storage.uploadAsset({
        folderId,
        file: svgFile,
        ...(alias.trim() ? { alias: alias.trim() } : {}),
      })
      setAssets((current) =>
        current.some((asset) => asset.id === uploaded.id) ? current : [...current, uploaded],
      )
      setUploadedAsset(uploaded)
      setCadFile(null)
      setCadOrientation(0)
      setAlias('')
      form.reset()
      setMessage('アセットを登録しました')
    } catch (err) {
      // 409 を含む登録段階のエラーは既存の ApiError 分岐で処理する（変換失敗ではない）。
      setMessage(handleError(err, 'アセットの登録に失敗しました'))
    } finally {
      setCadConverting(false)
    }
  }

  const handleAssetFileOpen = async (asset: Asset) => {
    try {
      const url = await storage.getAssetFileUrl(asset)
      const previousUrl = assetUrlsRef.current[asset.id]
      if (previousUrl !== undefined && previousUrl !== url) {
        storage.releaseAssetFileUrl(previousUrl)
      }
      assetUrlsRef.current = { ...assetUrlsRef.current, [asset.id]: url }
      setAssetUrls((current) => ({ ...current, [asset.id]: url }))
    } catch (err) {
      setMessage(handleError(err, 'アセットファイルの取得に失敗しました'))
    }
  }

  return (
    <AppLayout>
      <h1>アセットライブラリ</h1>
      <p className={styles.location}>
        場所: {folderId === null ? 'ルート' : `フォルダ ${folderId}`}
        {folderId !== null && (
          <button type="button" onClick={() => setFolderId(null)}>
            ルートへ戻る
          </button>
        )}
      </p>

      <section className={styles.section} aria-labelledby="folder-heading">
        <h2 id="folder-heading">フォルダ</h2>
        <form onSubmit={handleCreateFolder} className={styles.form}>
          <label htmlFor="folder-name">新しいフォルダ名</label>
          <input
            id="folder-name"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
          />
          <button type="submit">フォルダ作成</button>
        </form>
        {loading ? null : folders.length === 0 ? (
          <p>フォルダがありません</p>
        ) : (
          <ul className={styles.list}>
            {folders.map((folder) => (
              <li key={folder.id}>
                <button type="button" onClick={() => setFolderId(folder.id)}>
                  {folder.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="asset-heading">
        <h2 id="asset-heading">アセット</h2>
        <form onSubmit={handleUpload} className={styles.form}>
          <label htmlFor="asset-file">ファイル</label>
          <input
            id="asset-file"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <label htmlFor="asset-alias">alias（任意）</label>
          <input id="asset-alias" value={alias} onChange={(event) => setAlias(event.target.value)} />
          <button type="submit" disabled={file === null}>
            アップロード
          </button>
        </form>
        <form onSubmit={handleCadConvertUpload} className={styles.form}>
          <label htmlFor="cad-file">CADファイル（.jww / .dxf）</label>
          <input
            id="cad-file"
            type="file"
            accept=".jww,.dxf"
            onChange={(event) => setCadFile(event.target.files?.[0] ?? null)}
          />
          <label htmlFor="cad-orientation">回転</label>
          <select
            id="cad-orientation"
            value={cadOrientation}
            onChange={(event) => setCadOrientation(Number(event.target.value) as CadOrientation)}
          >
            {CAD_ORIENTATIONS.map((deg) => (
              <option key={deg} value={deg}>
                {deg}°
              </option>
            ))}
          </select>
          <button type="submit" disabled={cadFile === null || cadConverting}>
            変換して登録
          </button>
          {cadConverting && <span role="status">変換中...</span>}
        </form>
        {loading ? null : assets.length === 0 ? (
          <p>アセットがありません</p>
        ) : (
          <ul className={styles.list}>
            {assets.map((asset) => (
              <li key={asset.id}>
                <span>{asset.alias || asset.filename}</span>{' '}
                {assetUrls[asset.id] !== undefined ? (
                  <a href={assetUrls[asset.id]} target="_blank" rel="noreferrer">
                    URLを確認
                  </a>
                ) : (
                  <button type="button" onClick={() => void handleAssetFileOpen(asset)}>
                    URLを確認
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading && <p>読み込み中...</p>}
      {error !== null && <p role="alert">{error}</p>}
      {message !== null && <p role="status">{message}</p>}
      {uploadedAsset !== null && (
        <p>
          登録URL: {uploadedAsset.url}{' '}
          {assetUrls[uploadedAsset.id] !== undefined ? (
            <a href={assetUrls[uploadedAsset.id]} target="_blank" rel="noreferrer">
              URLを確認
            </a>
          ) : (
            <button type="button" onClick={() => void handleAssetFileOpen(uploadedAsset)}>
              URLを確認
            </button>
          )}
        </p>
      )}
    </AppLayout>
  )
}

export default AssetLibraryPage
