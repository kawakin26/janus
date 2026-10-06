// @vitest-environment jsdom
//
// drawio embed プロトコル（postMessage / proto=json）ハンドラの単体テスト（ブロック 4 FEAT-004）。
// origin 検証（自オリジン以外を無視）・init/save/exit の振り分け・XML 受け渡しを検証する。
// iframe 実体は対象外（ハンドラ本体＝純ロジックのみ）。

import { describe, expect, it, vi } from 'vitest'
import {
  buildExportMessage,
  buildLoadMessage,
  createDrawioMessageHandler,
  isSameOrigin,
  parseDrawioMessage,
} from './drawio-embed'

/** 自オリジンの MessageEvent を組み立てる（jsdom の既定 origin を使う）。 */
function sameOriginEvent(data: unknown): MessageEvent {
  return new MessageEvent('message', { data, origin: window.location.origin })
}

/** 任意オリジンの MessageEvent を組み立てる。 */
function foreignOriginEvent(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin })
}

describe('isSameOrigin', () => {
  it('自オリジンと一致すれば true', () => {
    expect(isSameOrigin({ origin: window.location.origin })).toBe(true)
  })

  it('別オリジンは false', () => {
    expect(isSameOrigin({ origin: 'https://embed.diagrams.net' })).toBe(false)
  })
})

describe('parseDrawioMessage', () => {
  it('JSON 文字列を embed イベントへパースする', () => {
    expect(parseDrawioMessage('{"event":"init"}')).toEqual({ event: 'init' })
  })

  it('オブジェクトもそのまま受理する', () => {
    expect(parseDrawioMessage({ event: 'save', xml: '<x/>' })).toEqual({
      event: 'save',
      xml: '<x/>',
    })
  })

  it('空文字・非 JSON 文字列・event 欠落は null', () => {
    expect(parseDrawioMessage('')).toBeNull()
    expect(parseDrawioMessage('ready')).toBeNull()
    expect(parseDrawioMessage({ foo: 'bar' })).toBeNull()
    expect(parseDrawioMessage(null)).toBeNull()
    expect(parseDrawioMessage(42)).toBeNull()
  })
})

describe('createDrawioMessageHandler: origin 検証', () => {
  it('自オリジン以外の message は無視する', () => {
    const onInit = vi.fn()
    const onSave = vi.fn()
    const onExit = vi.fn()
    const handler = createDrawioMessageHandler({ onInit, onSave, onExit })

    handler(foreignOriginEvent('{"event":"init"}', 'https://embed.diagrams.net'))
    handler(foreignOriginEvent('{"event":"save","xml":"<x/>"}', 'https://evil.example'))

    expect(onInit).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('createDrawioMessageHandler: イベント振り分け', () => {
  it('init を受けて onInit を呼ぶ', () => {
    const onInit = vi.fn()
    const handler = createDrawioMessageHandler({ onInit })
    handler(sameOriginEvent('{"event":"init"}'))
    expect(onInit).toHaveBeenCalledTimes(1)
  })

  it('save の XML をコールバックへ渡す（exit=false）', () => {
    const onSave = vi.fn()
    const handler = createDrawioMessageHandler({ onSave })
    handler(sameOriginEvent('{"event":"save","xml":"<mxGraphModel/>"}'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('<mxGraphModel/>', { exit: false })
  })

  it('save に exit:true が付くと exit=true で渡す', () => {
    const onSave = vi.fn()
    const handler = createDrawioMessageHandler({ onSave })
    handler(sameOriginEvent({ event: 'save', xml: '<x/>', exit: true }))
    expect(onSave).toHaveBeenCalledWith('<x/>', { exit: true })
  })

  it('xml が無い save は空文字で渡す', () => {
    const onSave = vi.fn()
    const handler = createDrawioMessageHandler({ onSave })
    handler(sameOriginEvent({ event: 'save' }))
    expect(onSave).toHaveBeenCalledWith('', { exit: false })
  })

  it('autosave の XML を onAutosave へ渡す（autosave:1 時に編集のたび届く）', () => {
    const onAutosave = vi.fn()
    const handler = createDrawioMessageHandler({ onAutosave })
    handler(sameOriginEvent({ event: 'autosave', xml: '<mxGraphModel/>' }))
    expect(onAutosave).toHaveBeenCalledWith('<mxGraphModel/>')
  })

  it('xml が無い autosave は空文字で渡す', () => {
    const onAutosave = vi.fn()
    const handler = createDrawioMessageHandler({ onAutosave })
    handler(sameOriginEvent({ event: 'autosave' }))
    expect(onAutosave).toHaveBeenCalledWith('')
  })

  it('export の XML を onExport へ渡す（xml 優先、無ければ data）', () => {
    const onExport = vi.fn()
    const handler = createDrawioMessageHandler({ onExport })
    handler(sameOriginEvent({ event: 'export', xml: '<x/>', format: 'xml' }))
    expect(onExport).toHaveBeenCalledWith('<x/>')
    handler(sameOriginEvent({ event: 'export', data: '<y/>' }))
    expect(onExport).toHaveBeenCalledWith('<y/>')
  })

  it('exit を受けて onExit を呼ぶ（modified は使わない・引数なし）', () => {
    const onExit = vi.fn()
    const handler = createDrawioMessageHandler({ onExit })
    handler(sameOriginEvent({ event: 'exit', modified: true }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('未知イベント・load は無視する（例外を投げない）', () => {
    const onInit = vi.fn()
    const onSave = vi.fn()
    const onExit = vi.fn()
    const handler = createDrawioMessageHandler({ onInit, onSave, onExit })
    expect(() => {
      handler(sameOriginEvent({ event: 'load', xml: '<x/>' }))
      handler(sameOriginEvent({ event: 'configure' }))
    }).not.toThrow()
    expect(onInit).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('コールバック未指定でも例外を投げない', () => {
    const handler = createDrawioMessageHandler({})
    expect(() => {
      handler(sameOriginEvent('{"event":"init"}'))
      handler(sameOriginEvent({ event: 'save', xml: '<x/>' }))
      handler(sameOriginEvent({ event: 'exit' }))
    }).not.toThrow()
  })
})

describe('buildLoadMessage', () => {
  it('load アクションと XML・autosave を含む JSON 文字列を生成する', () => {
    const parsed = JSON.parse(buildLoadMessage('<mxGraphModel/>'))
    expect(parsed).toEqual({ action: 'load', xml: '<mxGraphModel/>', autosave: 1 })
  })

  it('空 XML（新規図）でも load を autosave 付きで生成する', () => {
    const parsed = JSON.parse(buildLoadMessage(''))
    expect(parsed).toEqual({ action: 'load', xml: '', autosave: 1 })
  })
})

describe('buildExportMessage', () => {
  it('export アクション（format:xml）の JSON 文字列を生成する（最新 XML の pull 用）', () => {
    const parsed = JSON.parse(buildExportMessage())
    expect(parsed).toEqual({ action: 'export', format: 'xml' })
  })
})
