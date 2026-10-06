// drawio 閲覧ビューア React コンポーネント（タスク 16 / ブロック 4 FEAT-003）。
//
// 方針（design / context.json に接地）:
// - props の mxGraph XML を、同梱 GraphViewer（/drawio/viewer/viewer-static.min.js）で描画する。
//   外部 CDN（embed.diagrams.net 等）へは実行時接続せず、public/drawio/ 配下の同梱配布物のみ使う。
// - viewer スクリプトは document へ一度だけ動的 <script> ロードする。既ロード／ロード中なら
//   その Promise を再利用し、重複ロードを防ぐ（モジュールスコープで state を共有）。
// - GraphViewer は要素の data-mxgraph 属性（JSON 設定文字列。xml キーに mxGraph XML）を読み、
//   createViewerForElement(element) で描画する。本コンポーネントは ref コンテナへ
//   data-mxgraph を設定してから createViewerForElement を呼ぶ。
// - スクリプト未ロード/失敗や非ブラウザ環境（jsdom 等 window.GraphViewer 不在）では
//   クラッシュせずプレースホルダ表示にフォールバックする。jsdom テストでは実描画は走らず、
//   コンテナ/プレースホルダの生成のみ検証できる。
//
// rehype-raw は不採用のまま（生 HTML 無効）。XML は mxGraph テキストのみを扱い外部アセット依存なし。

import { useEffect, useRef, useState } from 'react'

/** 同梱 GraphViewer のスクリプトパス（public/ 配下＝外部参照ゼロ）。 */
const VIEWER_SCRIPT_SRC = '/drawio/viewer/viewer-static.min.js'

/** GraphViewer の最小型（必要な静的メソッドのみ）。 */
interface GraphViewerLike {
  createViewerForElement: (element: Element, callback?: (viewer: unknown) => void) => void
}

/** window に載る GraphViewer を安全に取り出す。非ブラウザ/未ロードなら null。 */
function getGraphViewer(): GraphViewerLike | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { GraphViewer?: unknown }).GraphViewer
  if (
    candidate != null &&
    typeof (candidate as GraphViewerLike).createViewerForElement === 'function'
  ) {
    return candidate as GraphViewerLike
  }
  return null
}

// スクリプトロードの状態をモジュールスコープで共有し、重複ロードを防ぐ。
let viewerScriptPromise: Promise<void> | null = null

/**
 * 同梱 GraphViewer スクリプトを一度だけ動的ロードする。
 * 既ロード／ロード中なら同じ Promise を返す。非ブラウザ環境では拒否する。
 */
function loadViewerScript(): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('document is not available'))
  }
  if (getGraphViewer() !== null) {
    return Promise.resolve()
  }
  if (viewerScriptPromise !== null) {
    return viewerScriptPromise
  }

  viewerScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-drawio-viewer="true"]`,
    )
    if (existing !== null) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('failed to load drawio viewer')))
      return
    }
    const script = document.createElement('script')
    script.src = VIEWER_SCRIPT_SRC
    script.async = true
    script.setAttribute('data-drawio-viewer', 'true')
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => {
      // 失敗時は次回再試行できるよう共有 Promise をクリアする。
      viewerScriptPromise = null
      reject(new Error('failed to load drawio viewer'))
    })
    document.head.appendChild(script)
  })
  return viewerScriptPromise
}

export interface DrawioViewerProps {
  /** 描画対象の mxGraph XML 文字列。 */
  xml: string
}

/** GraphViewer の data-mxgraph 設定（JSON 文字列化して属性へ入れる）。 */
function buildGraphConfig(xml: string): string {
  return JSON.stringify({
    highlight: '#0000ff',
    nav: true,
    resize: true,
    toolbar: 'zoom layers',
    // 図の背景を白（紙）に固定する。GraphViewer は背景未指定だと透明で描くため、
    // ダークモード（暗い surface）では XML の黒系ストロークが地色に沈んで「何も見えない」。
    // 図を常に白地のカードとして描くことでライト/ダーク両方で可読にする（設計 §3.3-A の
    // 生成コンテンツ割れ許容の範囲。「見えない」実害を避けることを優先）。
    backgroundColor: '#ffffff',
    xml,
  })
}

/**
 * mxGraph XML を同梱 GraphViewer で描画する閲覧コンポーネント。
 * スクリプト未ロード/失敗・非ブラウザ環境ではプレースホルダへフォールバックする。
 */
function DrawioViewer({ xml }: DrawioViewerProps) {
  // GraphViewer が DOM を直接差し替える受け皿。React は children を描かず、
  // 命令的な DOM 操作と React の再調整が衝突しないよう mount 用 div を分離する。
  const mountRef = useRef<HTMLDivElement>(null)
  // 'rendering'（描画試行中）/ 'rendered'（成功）/ 'fallback'（プレースホルダ）。
  const [status, setStatus] = useState<'rendering' | 'rendered' | 'fallback'>('rendering')

  useEffect(() => {
    let active = true

    const render = (viewer: GraphViewerLike): void => {
      const mount = mountRef.current
      if (mount === null) return
      try {
        mount.innerHTML = ''
        mount.setAttribute('data-mxgraph', buildGraphConfig(xml))
        viewer.createViewerForElement(mount)
        if (active) setStatus('rendered')
      } catch {
        if (active) setStatus('fallback')
      }
    }

    const ready = getGraphViewer()
    if (ready !== null) {
      render(ready)
      return () => {
        active = false
      }
    }

    void loadViewerScript()
      .then(() => {
        if (!active) return
        const viewer = getGraphViewer()
        if (viewer !== null) {
          render(viewer)
        } else {
          setStatus('fallback')
        }
      })
      .catch(() => {
        if (active) setStatus('fallback')
      })

    return () => {
      active = false
    }
  }, [xml])

  return (
    <div
      className="relative block max-w-full overflow-auto rounded border border-border bg-white"
      data-drawio-container="true"
    >
      {/* GraphViewer が描画する受け皿。children は React で描かず命令的に差し替える。
          図は白地（backgroundColor:#fff）で描くため、コンテナも白背景にして
          ダークモードでも「白い図カード」として自然に表示する。 */}
      <div ref={mountRef} />
      {status !== 'rendered' && (
        <div
          className="block rounded border border-dashed border-border bg-surface-raised px-4 py-3 text-sm text-fg-muted leading-normal whitespace-pre-wrap"
          role="img"
          aria-label="drawio 図"
        >
          {status === 'fallback' ? 'drawio 図を表示できません' : 'drawio 図を読み込み中…'}
        </div>
      )}
    </div>
  )
}

export default DrawioViewer
