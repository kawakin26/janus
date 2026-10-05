// drawio embed プロトコル（postMessage / proto=json）の純ユーティリティ（タスク 17 / ブロック 4 FEAT-004）。
//
// 方針（context.json / FEAT-004 に接地）:
// - 同梱 webapp（/drawio/webapp/index.html?embed=1&proto=json）を自オリジン iframe で開き、
//   HTML5 Messaging API（postMessage）で XML を受け渡す。公開 embed.diagrams.net は不使用。
// - embed JSON プロトコル（セルフホスト同梱 v32.0.2）:
//     iframe → host:  {"event":"init"}           … エディタ初期化完了。host は load を返す。
//     host  → iframe: {"action":"load","xml":…}  … 既存 XML（新規は空）を読み込ませる。
//     iframe → host:  {"event":"save","xml":…}   … 保存操作。host は XML を取り出す。
//     iframe → host:  {"event":"exit"}            … 編集終了（破棄）。host はクローズする。
// - iframe DOM に依存しないハンドラ本体を切り出し、単体テスト可能にする。
//   origin 検証は自オリジン（window.location.origin）に固定し、他オリジンの message は無視する。
//
// 本モジュールは postMessage の受信（MessageEvent）を解釈してコールバックへ振り分けるだけで、
// iframe の生成/破棄や XML のブロック化（serialize-drawio / drawio-block）は呼び出し側が担う。

/** iframe から受信する embed イベント種別（本連携で扱うもの）。 */
export type DrawioEmbedEvent =
  | { event: 'init' }
  | { event: 'load'; xml?: string }
  | { event: 'save'; xml?: string; exit?: boolean }
  | { event: 'exit'; modified?: boolean }
  | { event: 'configure' }

/** embed プロトコルで host から iframe へ送るメッセージ。 */
export type DrawioHostMessage =
  | { action: 'load'; xml: string; autosave?: number }
  | { action: 'merge'; xml: string }
  | { action: 'status'; message?: string; modified?: boolean }
  | { action: 'exit' }

/** ハンドラ生成時のコールバック群。いずれも任意。 */
export interface DrawioEmbedHandlers {
  /** init 受信（エディタ初期化完了）。既存 XML を load させる契機。 */
  onInit?: () => void
  /** save 受信。取り出した XML（未指定時は空文字）を渡す。exit は保存して閉じる要求。 */
  onSave?: (xml: string, options: { exit: boolean }) => void
  /** exit 受信（保存せず閉じる）。modified は未保存変更の有無。 */
  onExit?: (options: { modified: boolean }) => void
}

/**
 * MessageEvent の origin が自オリジン（window.location.origin）と一致するか判定する。
 * 非ブラウザ環境では常に false（検証不能なメッセージは受理しない）。
 */
export function isSameOrigin(event: Pick<MessageEvent, 'origin'>): boolean {
  if (typeof window === 'undefined') return false
  return event.origin === window.location.origin
}

/** data を embed イベントとして安全にパースする。文字列 JSON とオブジェクトの双方を受理。無効なら null。 */
export function parseDrawioMessage(data: unknown): DrawioEmbedEvent | null {
  let value: unknown = data
  if (typeof value === 'string') {
    // 空文字や embed プロトコル外の文字列（'ready' 等）は無視する。
    if (value.length === 0) return null
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (value === null || typeof value !== 'object') return null
  const event = (value as { event?: unknown }).event
  if (typeof event !== 'string') return null
  return value as DrawioEmbedEvent
}

/**
 * embed の postMessage を解釈し、origin 検証を通ったメッセージだけをハンドラへ振り分ける
 * message リスナ本体を生成する。window.addEventListener('message', handler) で登録する。
 *
 * - 自オリジン以外の message は無視する（origin 固定）。
 * - init / save / exit を対応コールバックへ振り分ける。未知イベントは無視する。
 */
export function createDrawioMessageHandler(
  handlers: DrawioEmbedHandlers,
): (event: MessageEvent) => void {
  return (event: MessageEvent): void => {
    if (!isSameOrigin(event)) return
    const message = parseDrawioMessage(event.data)
    if (message === null) return

    switch (message.event) {
      case 'init':
        handlers.onInit?.()
        break
      case 'save':
        handlers.onSave?.(message.xml ?? '', { exit: message.exit === true })
        break
      case 'exit':
        handlers.onExit?.({ modified: message.modified === true })
        break
      default:
        // load / configure 等 host 側で扱わないイベントは無視する。
        break
    }
  }
}

/** host → iframe の load メッセージ（既存 XML を読み込ませる）を JSON 文字列化する。 */
export function buildLoadMessage(xml: string): string {
  const message: DrawioHostMessage = { action: 'load', xml }
  return JSON.stringify(message)
}
