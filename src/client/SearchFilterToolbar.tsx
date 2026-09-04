/**
 * Shared search, filter, and view controls for catalog-style settings panels.
 */
import { createElement as h, type ReactNode } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SearchFilterToolbar.module.css'

export type SearchFilterToolbarView = 'grid' | 'list'

export interface SearchFilterToolbarFilter {
  id: string
  label: string
  count: number
  icon: ReactNode
  active: boolean
  onSelect: () => void
  /** Extended hover/aria explanation; falls back to the label when absent. */
  hint?: string
}

export interface SearchFilterToolbarProps {
  search: string
  searchLabel: string
  searchPlaceholder: string
  onSearchChange: (search: string) => void
  filters: readonly SearchFilterToolbarFilter[]
  view: SearchFilterToolbarView
  gridLabel: string
  listLabel: string
  onViewChange: (view: SearchFilterToolbarView) => void
  className?: string
}

/**
 * Render a consistent control row for searchable grid and list content.
 *
 * @param props - Search state, selectable filters, and view-mode state.
 * @returns Search input, filter tabs, and an accessible grid/list toggle.
 */
export function SearchFilterToolbar(props: SearchFilterToolbarProps): ReactNode {
  const nextView: SearchFilterToolbarView = props.view === 'grid' ? 'list' : 'grid'
  const nextViewLabel = nextView === 'grid' ? props.gridLabel : props.listLabel
  return h('div', { className: props.className === undefined ? css.toolbar : `${css.toolbar} ${props.className}` },
    h(Input, {
      className: css.search,
      value: props.search,
      placeholder: props.searchPlaceholder,
      'aria-label': props.searchLabel,
      onChange: event => props.onSearchChange((event.target as HTMLInputElement).value),
    }),
    h('div', { className: css.filterGap }),
    ...props.filters.map(filter => h('button', {
      key: filter.id,
      type: 'button',
      className: filter.active ? css.filterOn : css.filter,
      title: filter.hint ?? `${filter.label} ${filter.count}`,
      'aria-label': filter.hint ?? `${filter.label} ${filter.count}`,
      onClick: filter.onSelect,
    }, filter.icon, h('span', { className: css.filterCount }, filter.count))),
    h('div', { className: css.viewGap }),
    h('button', {
      type: 'button',
      className: css.viewSwitch,
      'aria-label': nextViewLabel,
      title: nextViewLabel,
      onClick: () => props.onViewChange(nextView),
    }, h(ViewIcon, { mode: nextView })),
  )
}

function ViewIcon({ mode }: { mode: SearchFilterToolbarView }): ReactNode {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  return mode === 'list'
    ? h('svg', common, h('path', { d: 'M3 4h10M3 8h10M3 12h10' }))
    : h('svg', common, h('rect', { x: 2.5, y: 2.5, width: 4, height: 4, rx: .8 }), h('rect', { x: 9.5, y: 2.5, width: 4, height: 4, rx: .8 }), h('rect', { x: 2.5, y: 9.5, width: 4, height: 4, rx: .8 }), h('rect', { x: 9.5, y: 9.5, width: 4, height: 4, rx: .8 }))
}
