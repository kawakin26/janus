// 独立アセットライブラリの最小管理画面（FEAT-003）。
// データ操作はStorageClient契約を通し、移動UIは後続フェーズに残す。

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import AppLayout from '../components/AppLayout'
import { useStorage } from '../storage/StorageProvider'
import type { Asset, Folder } from '../storage/types'
import { ApiError } from '../storage/types'
import { usePageError } from './use-page-error'
import { convertCadToSvgDispatch } from '../markdown/custom-map/cad/convert-dispatch'
import { isCadFile } from '../markdown/custom-map/map-utils'
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

// 統合アップロード input の accept ヒント（画像/SVG + CAD）。
// あくまで UI ヒントで、実処理の分岐は isCadFile によるファイル名判定で行う（accept は信頼しない）。
const UPLOAD_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.jww,.dxf'

// アップロードフォーム内メッセージの種別（赤文字エラー / 通常ステータス）。
type UploadNotice = { text: string; kind: 'error' | 'status' }

// 通常画像/SVG アップロードへの誘導文（design 5.5）。
const CAD_UPLOAD_GUIDANCE =
  '変換できない場合は、通常の画像/SVG アップロードフォームからご登録ください。'

// 同名 SVG で 409 になったときのリネーム案内（design 5.5「リネーム再送を促す」）。
const CAD_DUPLICATE_GUIDANCE =
  '登録ファイル名または alias を変えて再登録してください。'

// ユーザー指定の登録ファイル名を .svg 拡張子へ正規化する。空なら null（従来どおり変換結果の filename を使う）。
// convert.ts の toSvgFilename ロジックは変えず、ユーザー指定時のみ呼び出し側で上書きする。
function normalizeSvgFilename(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return null
  const base = trimmed.split(/[/\\]/).pop() || 'drawing'
  const stripped = base.replace(/\.[^.]*$/, '')
  const stem = stripped === '' ? base : stripped
  return `${stem}.svg`
}

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
  // 統合アップロードフォーム: 画像/SVG と CAD を 1 つの input で受け、拡張子で処理を分岐する。
  // 選択ファイルは state で保持し、input value は onChange で常にクリアする
  //（同一ファイル再選択でも onChange を再発火させるため・エラー時も選択を失わないため）。
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  // 登録ファイル名・alias は両分岐で共通（空なら元ファイル名 / 変換結果 filename / alias なし）。
  // 同名による 409 を避けてリネーム再登録できるようにする（設計 §5.5）。
  const [uploadFilename, setUploadFilename] = useState('')
  const [uploadAlias, setUploadAlias] = useState('')
  const [cadOrientation, setCadOrientation] = useState<CadOrientation>(0)
  const [cadConverting, setCadConverting] = useState(false)
  // アップロードフォーム専用のメッセージ（フォーム近傍に表示。エラーは赤文字 role=alert）。
  const [uploadNotice, setUploadNotice] = useState<UploadNotice | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [uploadedAsset, setUploadedAsset] = useState<Asset | null>(null)
  const [assetUrls, setAssetUrls] = useState<Record<number, string>>({})
  const assetUrlsRef = useRef<Record<number, string>>({})
  // 視覚的に隠したネイティブ file input を自前ボタンから発火させるための参照。
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // 統合送信ハンドラ。選択ファイルの拡張子（isCadFile）で CAD 経路／画像経路へ分岐する。
  // CAD は convertCadToSvgDispatch で SVG 変換後に uploadAsset、画像/SVG はそのまま uploadAsset。
  // 変換失敗（型付きエラー）では uploadAsset を呼ばない（サーバー副作用ゼロ）。
  // 成功時のみ選択・入力をリセットし、エラー時（変換失敗・409・その他）は selectedFile を維持する。
  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selectedFile === null) return
    setUploadNotice(null)
    const alias = uploadAlias.trim()

    if (isCadFile(selectedFile.name)) {
      // --- CAD 分岐: ブラウザ変換 → SVG を登録 ---
      setCadConverting(true)
      let converted: { svg: string; filename: string }
      try {
        converted = await convertCadToSvgDispatch(selectedFile, cadOrientation)
      } catch (err) {
        // 401 は handleError 側で遷移済み・null を返すため、通知は出さない。
        const failure = cadFailureMessage(err) ?? handleError(err, 'CAD の変換に失敗しました')
        if (failure !== null) setUploadNotice({ text: failure, kind: 'error' })
        setCadConverting(false)
        return
      }
      try {
        // 登録ファイル名が入力されていれば .svg 正規化して使い、空なら変換結果の filename を使う。
        const filename = normalizeSvgFilename(uploadFilename) ?? converted.filename
        const svgFile = new File([converted.svg], filename, { type: 'image/svg+xml' })
        const uploaded = await storage.uploadAsset({
          folderId,
          file: svgFile,
          ...(alias ? { alias } : {}),
        })
        finishUploadSuccess(uploaded)
      } catch (err) {
        handleUploadError(err)
      } finally {
        setCadConverting(false)
      }
      return
    }

    // --- 画像/SVG 分岐: そのまま uploadAsset ---
    try {
      const name = uploadFilename.trim()
      const file =
        name === ''
          ? selectedFile
          : new File([selectedFile], name, { type: selectedFile.type })
      const uploaded = await storage.uploadAsset({
        folderId,
        file,
        ...(alias ? { alias } : {}),
      })
      finishUploadSuccess(uploaded)
    } catch (err) {
      handleUploadError(err)
    }
  }

  // 成功時: 一覧へ反映し、選択・入力・回転をリセットして成功メッセージを出す。
  const finishUploadSuccess = (uploaded: Asset) => {
    setAssets((current) =>
      current.some((asset) => asset.id === uploaded.id) ? current : [...current, uploaded],
    )
    setUploadedAsset(uploaded)
    setSelectedFile(null)
    setUploadFilename('')
    setUploadAlias('')
    setCadOrientation(0)
    setUploadNotice({ text: 'アセットを登録しました', kind: 'status' })
  }

  // 登録段階のエラー。409（同名）はリネーム案内を添え、どちらも赤文字で表示（selectedFile は維持）。
  const handleUploadError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      setUploadNotice({
        text: `${err.detail ?? '同一フォルダ内に同名のファイルまたは別名が既に存在します。'}${CAD_DUPLICATE_GUIDANCE}`,
        kind: 'error',
      })
    } else {
      // 401 は handleError 側で遷移済み・null を返すため、通知は出さない。
      const text = handleError(err, 'アセットの登録に失敗しました')
      if (text !== null) setUploadNotice({ text, kind: 'error' })
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
            ref={fileInputRef}
            className={styles.visuallyHiddenInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] ?? null)
              // 同一ファイルの再選択でも onChange が発火するよう値をクリアする
              //（MapEditor の写真 input と同じ流儀）。選択の保持は state 側で行う。
              event.target.value = ''
            }}
          />
          {/* ネイティブ input を隠し、自前ボタン＋ファイル名表示に 1 箇所へ統合して二重表示を解消する。 */}
          <div className={styles.fileField}>
            <button
              type="button"
              className={styles.fileButton}
              onClick={() => fileInputRef.current?.click()}
              aria-describedby="asset-file-name"
            >
              ファイルを選択
            </button>
            <span
              id="asset-file-name"
              className={selectedFile !== null ? styles.fileName : styles.fileNameEmpty}
              aria-live="polite"
            >
              {selectedFile !== null ? `選択中: ${selectedFile.name}` : 'ファイルが選択されていません'}
            </span>
          </div>
          <label htmlFor="asset-orientation">回転</label>
          <select
            id="asset-orientation"
            value={cadOrientation}
            onChange={(event) => setCadOrientation(Number(event.target.value) as CadOrientation)}
            disabled={selectedFile === null || !isCadFile(selectedFile.name)}
          >
            {CAD_ORIENTATIONS.map((deg) => (
              <option key={deg} value={deg}>
                {deg}°
              </option>
            ))}
          </select>
          <label htmlFor="asset-filename">登録ファイル名（任意）</label>
          <input
            id="asset-filename"
            value={uploadFilename}
            onChange={(event) => setUploadFilename(event.target.value)}
          />
          <label htmlFor="asset-alias">alias（任意）</label>
          <input
            id="asset-alias"
            value={uploadAlias}
            onChange={(event) => setUploadAlias(event.target.value)}
          />
          <button type="submit" disabled={selectedFile === null || cadConverting}>
            アップロード
          </button>
          {cadConverting && <span role="status">変換中...</span>}
          {uploadNotice !== null &&
            (uploadNotice.kind === 'error' ? (
              <p role="alert" className={styles.error}>
                {uploadNotice.text}
              </p>
            ) : (
              <p role="status">{uploadNotice.text}</p>
            ))}
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
