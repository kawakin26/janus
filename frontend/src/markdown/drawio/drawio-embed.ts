// drawio embed プロトコル（postMessage / proto=json）の純ユーティリティ（タスク 17 / ブロック 4 FEAT-004）。
//
// 方針（context.json / FEAT-004 に接地）:
// - 同梱 webapp（/drawio/webapp/index.html?embed=1&proto=json）を自オリジン iframe で開き、
//   HTML5 Messaging API（postMessage）で XML を受け渡す。公開 embed.diagrams.net は不使用。
// - embed JSON プロトコル（セルフホスト同梱 v32.0.2）:
//     iframe → host:  {"event":"init"}           … エディタ初期化完了。host は load を返す。
//     host  → iframe: {"action":"load","xml":…}  … 既存 XML（新規は空）を読み込ませる。
//     iframe → host:  {"event":"save","xml":…}       … 保存操作（Save ボタン/Ctrl+S）。host は XML を取り出す。
//     iframe → host:  {"event":"autosave","xml":…}   … autosave:1 のとき編集のたび。host は XML を取り出す。
//     iframe → host:  {"event":"export","xml":…}     … host の {action:'export',format:'xml'} への応答。
//     iframe → host:  {"event":"exit","modified":…}  … 編集終了。※modified は draw.io 側で常に false 化され当てにできない。
// 注（embed プロトコル調査・v32.0.2 app.min.js 実読で確定）:
// - autosave:1 の自動保存は event 名 "save" ではなく "autosave" で届く。host は両方を拾う必要がある。
// - exit イベントの modified は draw.io が送出直前に false 化するため、host 側の未保存判定には使えない。
//   未保存の取りこぼし防止は「autosave を常時反映」＋「保存時に export で最新 XML を pull」で担保する。
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
  | { event: 'autosave'; xml?: string }
  | { event: 'export'; xml?: string; data?: string; format?: string }
  | { event: 'exit'; modified?: boolean }
  | { event: 'configure' }

/** embed プロトコルで host から iframe へ送るメッセージ。 */
export type DrawioHostMessage =
  | { action: 'load'; xml: string; autosave?: number }
  | { action: 'merge'; xml: string }
  | { action: 'status'; message?: string; modified?: boolean }
  | { action: 'export'; format: string }
  | { action: 'exit' }

/** ハンドラ生成時のコールバック群。いずれも任意。 */
export interface DrawioEmbedHandlers {
  /** init 受信（エディタ初期化完了）。既存 XML を load させる契機。 */
  onInit?: () => void
  /** save 受信（Save ボタン/Ctrl+S）。取り出した XML（未指定時は空文字）を渡す。exit は保存して閉じる要求。 */
  onSave?: (xml: string, options: { exit: boolean }) => void
  /** autosave 受信（autosave:1 時・編集のたび）。取り出した XML を本文へ反映する。 */
  onAutosave?: (xml: string) => void
  /** export 受信（host の {action:'export',format:'xml'} への応答）。pull した最新 XML を渡す。 */
  onExport?: (xml: string) => void
  /** exit 受信（編集終了）。modified は draw.io 側で常に false のため当てにしない（契機としてのみ使う）。 */
  onExit?: () => void
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
 * - init / save / autosave / export / exit を対応コールバックへ振り分ける。未知イベントは無視する。
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
      case 'autosave':
        // autosave:1 時に編集のたび届く。save と同様に本文へ反映して取りこぼしを防ぐ。
        handlers.onAutosave?.(message.xml ?? '')
        break
      case 'export':
        // host の {action:'export',format:'xml'} への応答。xml（無ければ data）を pull する。
        handlers.onExport?.(message.xml ?? message.data ?? '')
        break
      case 'exit':
        // modified は当てにできない（draw.io 側で常に false）。閉じる契機としてのみ扱う。
        handlers.onExit?.()
        break
      default:
        // load / configure 等 host 側で扱わないイベントは無視する。
        break
    }
  }
}

/**
 * host → iframe の load メッセージ（既存 XML を読み込ませる）を JSON 文字列化する。
 * autosave:1 を付けて draw.io の自動保存を有効化する。これにより編集のたびに save
 * イベントが飛び、本文 state が更新され続ける（「ファイル→保存」し忘れによるデータ損失を構造的に防ぐ）。
 */
export function buildLoadMessage(xml: string): string {
  const message: DrawioHostMessage = { action: 'load', xml, autosave: 1 }
  return JSON.stringify(message)
}

/**
 * host → iframe の export メッセージ（現在の図を指定 format で返させる）を JSON 文字列化する。
 * format:'xml' を送ると draw.io は {event:'export', xml} で最新 XML を返す。
 * 「ページを保存」押下時や「描画編集を閉じる」前にこれを送り、autosave 取りこぼしや
 * CHANGE 未発火のケースでも保存時点の確定 XML を本文へ回収するために使う。
 */
export function buildExportMessage(): string {
  const message: DrawioHostMessage = { action: 'export', format: 'xml' }
  return JSON.stringify(message)
}
