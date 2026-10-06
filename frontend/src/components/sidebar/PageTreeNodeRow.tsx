// ページツリーのノード行（再帰）。design §3.8 状態表 / §3.9 / §3.11 / §3.12。
//
// 2 クリック対象:
// - マーカー（<button>）: ▶/▼ をトグルするだけ。遷移しない。
// - ページ名本体: 実ページ（hasPage=true）は /view/<path> への <Link>、
//   仮想ノード（hasPage=false）は非対話 <span>（グレーアウト・遷移無効）。
// hasChildren=false のときはマーカーを同幅プレースホルダに置き換えて桁揃えする。

import { Link } from 'react-router-dom'
import type { PageTreeNode } from '../../storage/types'

// フォーカスリング（既存 NavItems/Button と完全一致）。
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

// 深さ→インデント（Tailwind pl-*）。上限でクランプしてマジックナンバー直書きを避ける。
const INDENT_CLASSES = ['pl-2', 'pl-4', 'pl-6', 'pl-8', 'pl-10', 'pl-12'] as const

function indentClass(depth: number): string {
  return INDENT_CLASSES[Math.min(depth, INDENT_CLASSES.length - 1)]
}

export interface PageTreeNodeRowProps {
  node: PageTreeNode
  depth: number
  expanded: Set<string>
  isCurrent: (path: string) => boolean
  onToggle: (path: string) => void
  onNavigate?: () => void
}

export function PageTreeNodeRow({
  node,
  depth,
  expanded,
  isCurrent,
  onToggle,
  onNavigate,
}: PageTreeNodeRowProps) {
  const isExpanded = node.hasChildren && expanded.has(node.path)
  const current = node.hasPage && isCurrent(node.path)

  // ページ名本体の配色（§3.8/§3.11）。
  const nameBase = 'block flex-1 rounded px-2 py-1 text-sm no-underline'
  const nameActive = 'bg-primary/10 text-primary'
  const nameNormal = 'text-fg hover:bg-surface'

  return (
    <li
      role="treeitem"
      aria-expanded={node.hasChildren ? isExpanded : undefined}
      aria-current={current ? 'page' : undefined}
    >
      <div className={'flex items-center gap-1 ' + indentClass(depth)}>
        {node.hasChildren ? (
          <button
            type="button"
            aria-label="展開/折り畳み"
            onClick={() => onToggle(node.path)}
            className={
              'inline-flex w-4 shrink-0 items-center justify-center rounded text-fg-muted ' +
              FOCUS_RING
            }
          >
            <span aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
          </button>
        ) : (
          // 桁揃え用の非操作プレースホルダ（マーカーと同幅）。
          <span className="w-4 shrink-0" aria-hidden="true" />
        )}

        {node.hasPage ? (
          <Link
            to={'/view' + node.path}
            onClick={onNavigate}
            className={
              nameBase +
              ' ' +
              FOCUS_RING +
              ' ' +
              (current ? nameActive : nameNormal)
            }
          >
            {node.title}
          </Link>
        ) : (
          <span className={nameBase + ' text-fg-muted cursor-default'}>
            {node.title}
          </span>
        )}
      </div>

      {isExpanded && (
        <ul role="group" className="flex flex-col">
          {node.children.map((child) => (
            <PageTreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              isCurrent={isCurrent}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default PageTreeNodeRow
