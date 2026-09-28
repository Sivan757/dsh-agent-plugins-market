/**
 * Shared search, filter, and view controls for catalog-style settings panels.
 *
 * The filters ride the host's SegmentedControl (one controlled tablist with
 * roving focus) and the view switch stays a single always-pressed Pill, so the
 * current mode is always readable without hovering: the selected filter
 * carries the host's raised indicator, and the view button shows the mode in
 * force with its pressed fill.
 */
import { createElement as h, type ReactNode } from 'react'
import { IconSearchOutlineMedium, Input, Pill, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
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
  /** Accessible name of the filter tablist; callers repeat an existing panel label. */
  filterLabel: string
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
        icon: h(IconSearchOutlineMedium),
        value: props.search,
        placeholder: props.searchPlaceholder,
        'aria-label': props.searchLabel,
        onChange: event => props.onSearchChange((event.target).value)
      })
    ),
    // The host control derives each tab's id from this base id; the caller
    // owns the panels the tabs name, so the panel half stays a suffix stub.
    h(SegmentedControl, {
      // The literal id assumes one live toolbar per document — true for every
  // current consumer; a second mounted copy would share the generated tab ids.
  id: 'panel-filter',
      value: props.filters.find(filter => filter.active)?.id ?? props.filters[0]?.id ?? '',
      // The host option label is a plain string, so the count rides the same
      // text the previous pills put in their accessible name.
      options: props.filters.map(filter => ({
        value: filter.id,
        label: `${filter.label} ${filter.count}`,
        ...(filter.hint === undefined ? {} : { title: filter.hint })
      })),
      onChange: id => props.filters.find(filter => filter.id === id)?.onSelect(),
      label: props.filterLabel,
      className: css.segment
    }),
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
