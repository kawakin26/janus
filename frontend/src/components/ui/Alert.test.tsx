// @vitest-environment jsdom
// 共通アラート Alert のユニットテスト（design.md §10）。
// variant 別の既定 role と下地クラス、role の明示上書き、children 表示を検証する（色は目視）。

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Alert } from './Alert'

describe('Alert', () => {
  it('error は role="alert" と bg-danger/10 text-danger を持つ', () => {
    render(<Alert variant="error">失敗しました</Alert>)
    const el = screen.getByRole('alert')
    expect(el).toHaveTextContent('失敗しました')
    expect(el).toHaveClass('bg-danger/10', 'text-danger')
  })

  it('warning は role="alert" と bg-warning/10 を持つ', () => {
    render(<Alert variant="warning">注意</Alert>)
    const el = screen.getByRole('alert')
    expect(el).toHaveClass('bg-warning/10')
  })

  it('success は role="status" と bg-success/10 text-success を持つ', () => {
    render(<Alert variant="success">完了</Alert>)
    const el = screen.getByRole('status')
    expect(el).toHaveClass('bg-success/10', 'text-success')
  })

  it('info（既定）は role="status" と bg-primary/10 を持つ', () => {
    render(<Alert>お知らせ</Alert>)
    const el = screen.getByRole('status')
    expect(el).toHaveClass('bg-primary/10')
  })

  it('role を明示指定すると既定 role を上書きする', () => {
    render(
      <Alert variant="info" role="alert">
        割り込み通知
      </Alert>,
    )
    // info の既定 role は status だが、明示指定の alert が勝つ。
    expect(screen.getByRole('alert')).toHaveTextContent('割り込み通知')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('aria-live などネイティブ属性を透過する', () => {
    render(
      <Alert variant="error" aria-live="assertive">
        エラー
      </Alert>,
    )
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
  })
})
