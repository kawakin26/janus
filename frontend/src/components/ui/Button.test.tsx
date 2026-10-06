// @vitest-environment jsdom
// 共通ボタン Button のユニットテスト（design.md §10）。
// CSS の色は jsdom で評価できないため「クラスが付く」ことと role/属性/キーボード/disabled 挙動を検証する。

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('button 要素を描画し、既定 type は "button"', () => {
    render(<Button>保存</Button>)
    const btn = screen.getByRole('button', { name: '保存' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('variant="normal"（既定）は border/control 地色のクラスが付く', () => {
    render(<Button>通常</Button>)
    const btn = screen.getByRole('button', { name: '通常' })
    expect(btn).toHaveClass('border', 'border-border', 'bg-control')
  })

  it('variant="accent" は bg-primary / text-primary-contrast のクラスが付く', () => {
    render(<Button variant="accent">編集</Button>)
    const btn = screen.getByRole('button', { name: '編集' })
    expect(btn).toHaveClass('bg-primary', 'text-primary-contrast')
  })

  it('variant="danger" は border-danger / text-danger のクラスが付く', () => {
    render(<Button variant="danger">削除</Button>)
    const btn = screen.getByRole('button', { name: '削除' })
    expect(btn).toHaveClass('border-danger', 'text-danger')
  })

  it('focus-visible リングと disabled 体裁のクラスを常に持つ', () => {
    render(<Button>x</Button>)
    const btn = screen.getByRole('button', { name: 'x' })
    expect(btn).toHaveClass('focus-visible:outline-ring', 'disabled:opacity-50', 'disabled:cursor-not-allowed')
  })

  it('type="submit" を明示指定すると上書きされる', () => {
    render(<Button type="submit">送信</Button>)
    expect(screen.getByRole('button', { name: '送信' })).toHaveAttribute('type', 'submit')
  })

  it('ネイティブ props（onClick/aria-*）を透過する', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} aria-label="操作">
        ○
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '操作' })
    const user = userEvent.setup()
    await user.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('フォーカス後に Enter で onClick が発火する（キーボード操作）', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('button', { name: '保存' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('フォーカス後に Space で onClick が発火する（キーボード操作）', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('button', { name: '保存' })).toHaveFocus()
    await user.keyboard('[Space]')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled のときキーボード操作でも onClick が呼ばれない', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        無効
      </Button>,
    )
    const user = userEvent.setup()
    await user.tab()
    // disabled な button はフォーカスを受け取らない。
    expect(screen.getByRole('button', { name: '無効' })).not.toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard('[Space]')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('disabled のときクリックしても onClick が呼ばれない', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        無効
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '無効' })
    expect(btn).toBeDisabled()
    const user = userEvent.setup()
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('className を追記合成できる', () => {
    render(<Button className="w-full">広い</Button>)
    const btn = screen.getByRole('button', { name: '広い' })
    expect(btn).toHaveClass('w-full', 'inline-flex')
  })
})
