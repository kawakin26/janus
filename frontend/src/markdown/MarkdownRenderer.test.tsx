// @vitest-environment jsdom
// Markdown レンダラ MarkdownRenderer のテスト（サブタスク 10.1）。
// 見出し/段落/リスト/GFM 表の描画、未対応ディレクティブ（custom-map）の無害化、
// 生 HTML が実要素化されず素通しされること、外部リンクの安全属性を検証する。

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarkdownRenderer from './MarkdownRenderer'
import { StorageProvider } from '../storage/StorageProvider'
import { AuthProvider } from '../auth/AuthContext'
import { createStubStorage } from '../test/stub-storage'

describe('MarkdownRenderer', () => {
  it('見出し・段落・リストを描画する', () => {
    const { container } = render(
      <MarkdownRenderer body={'# 見出し\n\n段落です。\n\n- 項目A\n- 項目B'} />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('見出し')
    expect(container.querySelector('p')).toHaveTextContent('段落です。')
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('項目A')
  })

  it('GFM の表をテーブルとして描画する', () => {
    const body = ['| 名前 | 値 |', '| --- | --- |', '| foo | 1 |'].join('\n')
    const { container } = render(<MarkdownRenderer body={body} />)
    expect(container.querySelector('table')).not.toBeNull()
    expect(screen.getByRole('cell', { name: 'foo' })).toBeInTheDocument()
  })

  it('custom-map をマップビューア（「マップを開く」ボタン）として描画する', () => {
    const body = ':::custom-map{folder="maps" filename="map.png"}\n\n- x=10 y=20 label="A"\n:::'
    render(
      <StorageProvider client={createStubStorage({ resolveAssetUrl: async () => null })}>
        <MemoryRouter>
          <AuthProvider>
            <MarkdownRenderer body={body} />
          </AuthProvider>
        </MemoryRouter>
      </StorageProvider>,
    )
    // custom-map は fallback のプレースホルダではなく専用ビューアに差し替わる。
    expect(screen.getByRole('button', { name: 'マップを開く' })).toBeInTheDocument()
  })

  it('custom-map 以外の未対応ディレクティブはプレースホルダ化する（fallback 不変）', () => {
    const body = ':::unknown-directive{foo="bar"}\n本文\n:::'
    const { container } = render(<MarkdownRenderer body={body} />)
    const placeholder = container.querySelector('[data-directive="unknown-directive"]')
    expect(placeholder).not.toBeNull()
    expect(placeholder).toHaveTextContent('本文')
  })

  it('生 HTML を実要素化せずテキストとして素通しする（XSS 回避）', () => {
    const { container } = render(
      <MarkdownRenderer body={'<script>alert(1)</script> と <b>太字</b>'} />,
    )
    // 生 HTML は無効なので script / b 要素は生成されない。
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container).toHaveTextContent('<b>太字</b>')
  })

  it('外部リンクに安全な rel/target を付ける', () => {
    const { container } = render(
      <MarkdownRenderer body={'[外部](https://example.com) と [内部](/docs/intro)'} />,
    )
    const external = container.querySelector('a[href="https://example.com"]')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
    expect(external).toHaveAttribute('target', '_blank')
    const internal = container.querySelector('a[href="/docs/intro"]')
    expect(internal).not.toHaveAttribute('target')
    expect(internal).not.toHaveAttribute('rel')
  })

  it('body が空のときは何も描画しない', () => {
    const { container } = render(<MarkdownRenderer body={''} />)
    expect(container).toBeEmptyDOMElement()
  })

  // ---- drawio（タスク 16 / FEAT-003）----
  // jsdom では同梱 GraphViewer の実描画は走らないため、data-drawio 分岐での
  // DrawioViewer コンテナ生成と、既存記法との共存非破壊を検証する（描画結果でなく分岐・生成）。

  it('drawio を DrawioViewer コンテナとして描画する', () => {
    const body = ':::drawio\n```xml\n<mxGraphModel/>\n```\n:::'
    const { container } = render(<MarkdownRenderer body={body} />)
    // data-drawio は専用コンテナへ差し替わり、素の data-drawio 属性は残らない。
    expect(container.querySelector('[data-drawio-container="true"]')).not.toBeNull()
    expect(container.querySelector('[data-drawio]')).toBeNull()
  })

  it('drawio と custom-map と GFM が共存して壊れない', () => {
    const body = [
      '# 見出し',
      '',
      ':::drawio',
      '```xml',
      '<mxGraphModel/>',
      '```',
      ':::',
      '',
      ':::custom-map{folder="maps" filename="map.png"}',
      '',
      '- x=10 y=20 label="A"',
      ':::',
      '',
      '| 名前 | 値 |',
      '| --- | --- |',
      '| foo | 1 |',
    ].join('\n')
    const { container } = render(
      <StorageProvider client={createStubStorage({ resolveAssetUrl: async () => null })}>
        <MemoryRouter>
          <AuthProvider>
            <MarkdownRenderer body={body} />
          </AuthProvider>
        </MemoryRouter>
      </StorageProvider>,
    )
    // drawio は専用コンテナ、custom-map は従来どおりビューアボタン、GFM 表は table。
    expect(container.querySelector('[data-drawio-container="true"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'マップを開く' })).toBeInTheDocument()
    expect(container.querySelector('table')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('見出し')
  })

  it('drawio の XML 内に生 HTML があっても実要素化しない（生 HTML 無効維持）', () => {
    const body = ':::drawio\n```xml\n<mxGraphModel><script>alert(1)</script></mxGraphModel>\n```\n:::'
    const { container } = render(<MarkdownRenderer body={body} />)
    // コンテナは生成されるが、XML 本文は属性/設定として渡るだけで script 要素は生成されない。
    expect(container.querySelector('[data-drawio-container="true"]')).not.toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })
})
