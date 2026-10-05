/**
 * Shared search, filter, and view controls for catalog-style settings panels.
 *
 * The filters ride the host's SegmentedControl (one controlled tablist with
 * roving focus) and the view switch is one flat icon button, so the current mode
 * is always readable without hovering: the selected filter carries the host's
 * raised indicator, and the view button draws the mode in force in its glyph —
 * the grid or the list — while its accessible name says where a click leads.
 */
import { createElement as h, type ReactNode } from 'react'
import { IconSearchOutlineMedium, Input, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import rc from './resource-card.module.css'
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
  /**
   * Base id of the filter tablist. The host control derives each tab as
   * `<filterId>-<value>` and names `<filterId>-<value>-panel` as the panel it
   * controls, so the caller rendering that panel reuses this base and every
   * mounted toolbar owns a distinct one.
   */
  filterId: string
  /** Accessible name of the filter tablist; callers repeat an existing panel label. */
  filterLabel: string
  view: SearchFilterToolbarView
  /** Accessible name of the view button while the grid shows: it switches to the list. */
  toListLabel: string
  /** Accessible name of the view button while the list shows: it switches to the grid. */
  toGridLabel: string
  onViewChange: (view: SearchFilterToolbarView) => void
  /**
   * Trailing control rendered immediately left of the view switch. The text
   * view belongs to this cluster: it reads the same list the switch re-lays
   * out, so the two sit together at the row's trailing edge.
   */
  beforeView?: ReactNode
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
    // The host control derives each tab's id from this base id; the caller owns
    // the panels the tabs name and reuses the same base for their ids.
    h(SegmentedControl, {
      id: props.filterId,
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
    props.beforeView === undefined ? null : h('div', { className: css.beforeView }, props.beforeView),
    // One flat glyph, the same geometry as every other panel action: the icon
    // shows the mode in force, `aria-pressed` reports it, and the accessible
    // name says where a click leads.
    h(
      'button',
      {
        type: 'button',
        className: `${rc.iconBtn} ${css.viewSwitch}`,
        title: viewLabel,
        'aria-label': viewLabel,
        'aria-pressed': grid,
        'data-view-switch': props.view,
        onClick: () => props.onViewChange(grid ? 'list' : 'grid')
      },
      h(ViewIcon, { mode: props.view })
    )
  )
}

/**
 * The two view glyphs; the host icon set has no grid glyph, so both stay drawn
 * here in the platform's outline paint. An unfilled shape with no stroke of its
 * own renders nothing, so the shared stroke is what makes either glyph read —
 * at the pill's own colour, and at the host's medium outline weight.
 */
function ViewIcon({ mode }: { mode: SearchFilterToolbarView }): ReactNode {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeWidth: 1.3,
    'aria-hidden': true
  } as const
  return mode === 'list'
    ? h('svg', common, h('path', { d: 'M3 4h10M3 8h10M3 12h10' }))
    : h(
        'svg',
        common,
        // Four 4px squares on the same 3-13 bounds the list glyph spans.
        h('rect', { x: 3, y: 3, width: 4, height: 4, rx: 1 }),
        h('rect', { x: 9, y: 3, width: 4, height: 4, rx: 1 }),
        h('rect', { x: 3, y: 9, width: 4, height: 4, rx: 1 }),
        h('rect', { x: 9, y: 9, width: 4, height: 4, rx: 1 })
      )
}
