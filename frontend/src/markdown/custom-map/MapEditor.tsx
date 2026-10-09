// マップ GUI 編集コンポーネント（設計 §7.4/§8・要件 3A-MAP-1/5/7/8・3A-PHOTO-1〜5）。
//
// 方針:
// - props は編集対象 MapData と onChange(next) のみ（保存は PageEditPage が担う）。
// - マップ画像は AssetClient の listFolders/listAssets/resolveAssetUrl で選択・プレビューする。
// - 画像上クリックでマーカー配置、ドラッグで移動、削除ボタンで削除。各マーカーの
//   label/color/desc/x/y を編集する。座標系・クランプ・色は既存 map-utils.ts を流用する。
// - 参考写真は撮影またはファイル選択から既存 AssetClient.uploadAsset で登録し、
//   写真子リスト（AssetRef）に紐付ける。
// - StorageClient/AssetClient に新規メソッドは足さない。既存 CustomMapViewer/parse-map.ts は不変。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { useStorage } from '../../storage/StorageProvider'
import { usePageError } from '../../pages/use-page-error'
import { readMode } from '../../storage/mode'
import type { AssetRef, Asset, Folder } from '../../storage/types'
import type { MapData, MarkerData, PhotoData } from './types'
import { clamp } from './map-utils'

// field（ラベル付き入力の縦積み）。ラベルは可読性のため text-fg（薄い muted ではなく本文色）。
const FIELD_CLASS = 'grid gap-1 [&>label]:text-sm [&>label]:text-fg'

// 破壊的操作（マーカー削除）用のボタン体裁。危険色で削除であることを明示する
// （Button コンポーネントの danger variant と同一ユーティリティ）。
const DANGER_BUTTON_CLASS =
  'inline-flex items-center rounded border border-danger px-3 py-1.5 text-danger ' +
  'hover:bg-danger hover:text-primary-contrast ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

export interface MapEditorProps {
  mapData: MapData
  onChange: (next: MapData) => void
}

const DEFAULT_MARKER_COLOR = '#ff3b30'

/** 座標を 0〜100(%) にクランプし小数第 1 位へ丸める（座標系は map-utils の思想を流用）。 */
function clampCoord(value: number): number {
  return Math.round(clamp(value, 0, 100) * 10) / 10
}

/** 指定 index のマーカーだけを置換した markers 配列を返す。 */
function replaceMarker(markers: MarkerData[], index: number, next: MarkerData): MarkerData[] {
  return markers.map((m, i) => (i === index ? next : m))
}

function MapEditor({ mapData, onChange }: MapEditorProps) {
  const storage = useStorage()
  const handleError = usePageError()

  // ローカルモードのときだけカメラ撮影 UI を促す（capture="environment"）。
  // readMode() が null/`server` の場合は capture なし（サーバー相当）に安全に倒す。
  // レンダー時に 1 回評価すれば十分で、Context 導入や契約変更は行わない（タスク14 LM-6）。
  const isLocalMode = readMode() === 'local'

  const [folders, setFolders] = useState<Folder[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  // マップ画像・写真アップロード先のフォルダ（ルート=null）。
  const [folderId, setFolderId] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)
  const cameraInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([])

  // マップ参照の代表指定子（表示用）。
  const mapSpecifier = mapData.assetRef.specifiers[0] ?? null

  // フォルダ一覧の取得（マウント時と folderId 変更時）。
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [fs, as] = await Promise.all([
          storage.listFolders(folderId),
          storage.listAssets(folderId),
        ])
        if (!active) return
        setFolders(fs)
        setAssets(as)
      } catch (err) {
        if (active) setError(handleError(err, 'アセット一覧の取得に失敗しました'))
      }
    })()
    return () => {
      active = false
    }
  }, [storage, folderId, handleError])

  // マップ画像プレビュー URL の解決（参照が変わるたび）。state 更新は非同期分岐内で
  // active ガードして行う（効果本体での同期的 setState を避ける）。
  useEffect(() => {
    let active = true
    const hasRef = mapData.assetRef.specifiers.length > 0
    void (async () => {
      try {
        const url = hasRef ? await storage.resolveAssetUrl(mapData.assetRef) : null
        if (!active) {
          if (url) storage.releaseAssetFileUrl(url)
          return
        }
        setPreviewUrl(url)
      } catch (err) {
        if (active) setError(handleError(err, 'マップ画像の取得に失敗しました'))
      }
    })()
    return () => {
      active = false
    }
  }, [storage, mapData.assetRef, handleError])

  // 解決した一時 URL は不要になったら解放する。
  useEffect(() => {
    if (previewUrl === null) return
    return () => storage.releaseAssetFileUrl(previewUrl)
  }, [previewUrl, storage])

  const patchMarker = useCallback(
    (index: number, patch: Partial<MarkerData>) => {
      const current = mapData.markers[index]
      if (!current) return
      onChange({ ...mapData, markers: replaceMarker(mapData.markers, index, { ...current, ...patch }) })
    },
    [mapData, onChange],
  )

  // マップ画像を選択する（代表 1 指定子に正規化。filename 優先、無ければ alias）。
  const selectMapAsset = useCallback(
    (asset: Asset) => {
      const specifiers: AssetRef['specifiers'] = asset.filename
        ? [{ kind: 'filename', value: asset.filename }]
        : asset.alias
          ? [{ kind: 'alias', value: asset.alias }]
          : []
      onChange({
        ...mapData,
        assetRef: {
          ...(mapData.assetRef.baseFolderPath
            ? { baseFolderPath: mapData.assetRef.baseFolderPath }
            : {}),
          specifiers,
        },
      })
    },
    [mapData, onChange],
  )

  // 画像上クリックでマーカーを追加する（既にマーカー上なら無視）。
  const handlePreviewClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragging.current !== null) return
      if ((e.target as HTMLElement).closest('[aria-label^="マーカー"]')) return
      const rect = previewRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return
      const x = clampCoord(((e.clientX - rect.left) / rect.width) * 100)
      const y = clampCoord(((e.clientY - rect.top) / rect.height) * 100)
      const next: MarkerData = { x, y, label: '', desc: '', color: DEFAULT_MARKER_COLOR, photos: [] }
      onChange({ ...mapData, markers: [...mapData.markers, next] })
      setSelected(mapData.markers.length)
    },
    [mapData, onChange],
  )

  // マーカーのドラッグ移動。
  const onMarkerPointerDown = useCallback(
    (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      dragging.current = index
      setSelected(index)
      try {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    },
    [],
  )

  const onMarkerPointerMove = useCallback(
    (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragging.current !== index) return
      const rect = previewRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return
      const x = clampCoord(((e.clientX - rect.left) / rect.width) * 100)
      const y = clampCoord(((e.clientY - rect.top) / rect.height) * 100)
      patchMarker(index, { x, y })
    },
    [patchMarker],
  )

  const onMarkerPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    dragging.current = null
  }, [])

  const removeMarker = useCallback(
    (index: number) => {
      onChange({ ...mapData, markers: mapData.markers.filter((_, i) => i !== index) })
      setSelected(null)
    },
    [mapData, onChange],
  )

  // 参考写真の添付: ファイル選択 → 既存 uploadAsset → 写真子リストへ紐付け。
  const attachPhoto = useCallback(
    async (index: number, file: File) => {
      setError(null)
      try {
        const asset = await storage.uploadAsset({ folderId, file })
        const specifier: AssetRef['specifiers'][number] = asset.filename
          ? { kind: 'filename', value: asset.filename }
          : { kind: 'alias', value: asset.alias }
        const photo: PhotoData = {
          assetRef: {
            ...(mapData.assetRef.baseFolderPath
              ? { baseFolderPath: mapData.assetRef.baseFolderPath }
              : {}),
            specifiers: [specifier],
          },
          desc: '',
        }
        const current = mapData.markers[index]
        if (!current) return
        patchMarker(index, { photos: [...current.photos, photo] })
      } catch (err) {
        setError(handleError(err, '写真のアップロードに失敗しました'))
      }
    },
    [storage, folderId, mapData, patchMarker, handleError],
  )

  const removePhoto = useCallback(
    (markerIndex: number, photoIndex: number) => {
      const current = mapData.markers[markerIndex]
      if (!current) return
      patchMarker(markerIndex, { photos: current.photos.filter((_, i) => i !== photoIndex) })
    },
    [mapData.markers, patchMarker],
  )

  const folderOptions = useMemo(
    () => folders.map((f) => ({ id: f.id, name: f.name })),
    [folders],
  )

  return (
    <div className="grid gap-4 max-w-5xl">
      {error !== null && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className={FIELD_CLASS}>
          <label htmlFor="map-editor-folder">フォルダ</label>
          <select
            id="map-editor-folder"
            value={folderId ?? ''}
            onChange={(e) => setFolderId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">ルート</option>
            {folderOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className={FIELD_CLASS}>
          <label htmlFor="map-editor-asset">マップ画像</label>
          <select
            id="map-editor-asset"
            value={mapSpecifier?.value ?? ''}
            onChange={(e) => {
              const asset = assets.find(
                (a) => a.filename === e.target.value || a.alias === e.target.value,
              )
              if (asset) selectMapAsset(asset)
            }}
          >
            <option value="">（未選択）</option>
            {assets.map((a) => (
              <option key={a.id} value={a.filename || a.alias}>
                {a.alias || a.filename}
              </option>
            ))}
          </select>
        </div>
      </div>

      {previewUrl !== null ? (
        <div
          ref={previewRef}
          className="relative inline-block max-w-full overflow-hidden rounded border border-border bg-surface-raised cursor-crosshair"
          onPointerDown={handlePreviewClick}
          data-testid="map-editor-preview"
        >
          <img className="block max-w-full h-auto select-none" src={previewUrl} alt="マッププレビュー" draggable={false} />
          {mapData.markers.map((marker, i) => (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_1px_3px_rgba(0,0,0,0.4)] cursor-grab touch-none data-[selected=true]:outline data-[selected=true]:outline-2 data-[selected=true]:outline-primary data-[selected=true]:outline-offset-2"
              data-selected={selected === i ? 'true' : 'false'}
              style={{ left: `${marker.x}%`, top: `${marker.y}%`, backgroundColor: marker.color }}
              onPointerDown={onMarkerPointerDown(i)}
              onPointerMove={onMarkerPointerMove(i)}
              onPointerUp={onMarkerPointerUp}
              aria-label={`マーカー ${i + 1}`}
            />
          ))}
        </div>
      ) : (
        <div className="p-8 text-center text-fg-muted">
          マップ画像を選択すると、画像上をクリックしてマーカーを配置できます。
        </div>
      )}

      <div className="grid gap-3">
        <h3>マーカー ({mapData.markers.length})</h3>
        {mapData.markers.map((marker, i) => (
          <div
            key={i}
            className="grid gap-2 rounded border border-border p-3 data-[selected=true]:border-primary"
            data-selected={selected === i ? 'true' : 'false'}
          >
            <div className="flex flex-wrap gap-3">
              <div className={FIELD_CLASS}>
                <label htmlFor={`marker-${i}-label`}>ラベル</label>
                <input
                  id={`marker-${i}-label`}
                  type="text"
                  value={marker.label}
                  onFocus={() => setSelected(i)}
                  onChange={(e) => patchMarker(i, { label: e.target.value })}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor={`marker-${i}-color`}>色</label>
                <input
                  id={`marker-${i}-color`}
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(marker.color) ? marker.color : DEFAULT_MARKER_COLOR}
                  onChange={(e) => patchMarker(i, { color: e.target.value })}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor={`marker-${i}-x`}>X (%)</label>
                <input
                  id={`marker-${i}-x`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={marker.x}
                  onChange={(e) => patchMarker(i, { x: clampCoord(Number(e.target.value)) })}
                />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor={`marker-${i}-y`}>Y (%)</label>
                <input
                  id={`marker-${i}-y`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={marker.y}
                  onChange={(e) => patchMarker(i, { y: clampCoord(Number(e.target.value)) })}
                />
              </div>
            </div>
            <div className={FIELD_CLASS}>
              <label htmlFor={`marker-${i}-desc`}>説明</label>
              <textarea
                id={`marker-${i}-desc`}
                value={marker.desc}
                rows={2}
                onChange={(e) => patchMarker(i, { desc: e.target.value })}
              />
            </div>

            {marker.photos.length > 0 && (
              <ul className="list-disc pl-5 my-1 [&>li]:my-1">
                {marker.photos.map((photo, pi) => (
                  <li key={pi}>
                    {photoLabel(photo.assetRef)}
                    <button type="button" onClick={() => removePhoto(i, pi)}>
                      写真を削除
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className={FIELD_CLASS}>
              <span className="text-sm text-fg">参考写真を追加</span>
              <div className="flex flex-wrap gap-2">
                <label className="sr-only" htmlFor={`marker-${i}-photo-camera`}>
                  カメラで撮影
                </label>
                <input
                  id={`marker-${i}-photo-camera`}
                  ref={(element) => {
                    cameraInputRefs.current[i] = element
                  }}
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture={isLocalMode ? 'environment' : undefined}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void attachPhoto(i, file)
                    e.target.value = ''
                  }}
                />
                <Button type="button" onClick={() => cameraInputRefs.current[i]?.click()}>
                  カメラで撮影
                </Button>
                <label className="sr-only" htmlFor={`marker-${i}-photo-file`}>
                  ファイルを選択
                </label>
                <input
                  id={`marker-${i}-photo-file`}
                  ref={(element) => {
                    fileInputRefs.current[i] = element
                  }}
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void attachPhoto(i, file)
                    e.target.value = ''
                  }}
                />
                <Button type="button" onClick={() => fileInputRefs.current[i]?.click()}>
                  ファイルを選択
                </Button>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => removeMarker(i)}
                className={DANGER_BUTTON_CLASS}
              >
                マーカーを削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 写真の表示用ラベル（代表指定子の値）。 */
function photoLabel(ref: AssetRef): string {
  return ref.specifiers[0]?.value ?? '(参照なし)'
}

export default MapEditor
