/**
 * Shared search, filter, and view controls for catalog-style settings panels.
 *
 * The filters are one segmented control and the view switch is a single icon
 * button, so the current mode is always readable without hovering: the active
 * filter carries the platform's pressed fill, and the view button shows the
 * mode in force with that same fill.
 */
import { createElement as h, type ReactNode } from 'react'
import { IconSearchOutline16, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SearchFilterToolbar.module.css'

export type SearchFilterToolbarView = 'grid' | 'list'

export interface SearchFilterToolbarFilter {
  id: string
  label: string
  count: number
  active: boolean
  onSelect: () => void
  /** Extended hover/aria explanation; falls back to the label and count. */
  hint?: string
}

export interface SearchFilterToolbarProps {
  search: string
  searchLabel: string
  searchPlaceholder: string
  onSearchChange: (search: string) => void
  filters: readonly SearchFilterToolbarFilter[]
  view: SearchFilterToolbarView
  /** Accessible name of the view button while the grid shows: it switches to the list. */
  toListLabel: string
  /** Accessible name of the view button while the list shows: it switches to the grid. */
  toGridLabel: string
  onViewChange: (view: SearchFilterToolbarView) => void
  className?: string
}

/**
 * Render a consistent control row for searchable grid and list content.
 *
 * @param props - Search state, selectable filters, and view-mode state.
 * @returns Search input, a filter segment, and a one-button view switch.
 */
export function SearchFilterToolbar(props: SearchFilterToolbarProps): ReactNode {
  const grid = props.view === 'grid'
  const viewLabel = grid ? props.toListLabel : props.toGridLabel
  return h(
    'div',
    { className: props.className === undefined ? css.toolbar : `${css.toolbar} ${props.className}`, 'data-panel-toolbar': true },
    h(
      'label',
      { className: css.search },
      h(Input, {
        className: css.searchInput,
        icon: h(IconSearchOutline16),
        value: props.search,
        placeholder: props.searchPlaceholder,
        'aria-label': props.searchLabel,
        onChange: event => props.onSearchChange((event.target).value)
      })
    ),
    h(
      'div',
      { className: css.segment, role: 'group' },
      ...props.filters.map(filter =>
        h(
          Pill,
          {
            key: filter.id,
            active: filter.active,
            title: filter.hint ?? `${filter.label} ${filter.count}`,
            'aria-label': filter.hint ?? `${filter.label} ${filter.count}`,
            'aria-pressed': filter.active,
            onClick: filter.onSelect
          },
          filter.label,
          h('span', { className: css.count }, filter.count)
        )
      )
    ),
    // One button, permanently pressed: the glyph and the fill report the mode in
    // force and its accessible name says where a click leads, so the control
    // states the present mode instead of only naming the mode it would switch to.
    h(
      'div',
      { className: css.segment },
      h(
        Pill,
        {
          active: true,
          title: viewLabel,
          'aria-label': viewLabel,
          'aria-pressed': true,
          onClick: () => props.onViewChange(grid ? 'list' : 'grid')
        },
        h(ViewIcon, { mode: props.view })
      )
    )
  )
}

/** The two view glyphs; the host icon set has no grid glyph, so both stay drawn here. */
function ViewIcon({ mode }: { mode: SearchFilterToolbarView }): ReactNode {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  return mode === 'list'
    ? h('svg', common, h('path', { d: 'M3 4h10M3 8h10M3 12h10' }))
    : h(
        'svg',
        common,
        h('rect', { x: 2.5, y: 2.5, width: 4, height: 4, rx: 0.8 }),
        h('rect', { x: 9.5, y: 2.5, width: 4, height: 4, rx: 0.8 }),
        h('rect', { x: 2.5, y: 9.5, width: 4, height: 4, rx: 0.8 }),
        h('rect', { x: 9.5, y: 9.5, width: 4, height: 4, rx: 0.8 })
      )
}
