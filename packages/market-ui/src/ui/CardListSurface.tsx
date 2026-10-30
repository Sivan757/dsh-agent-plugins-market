/**
 * A searchable card grid for panels whose entries are files, styles, or similar records.
 *
 * The catalogue panels already speak this language: a search field, a filter segment with
 * counts, a grid/list switch, and one card per entry that opens it. This is the same set of
 * primitives, so those panels reuse the look instead of inventing a second one.
 * @module client/ui/CardListSurface
 */
import { createElement as h, useId, useMemo, useState, type ReactNode } from 'react'
import { CardIdentity, ResourceCard, ResourceCollection, interactiveCardProps } from './ResourceCard.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { useWorkspaceView } from './workspace-view.js'
import type { Translate } from '../i18n.js'
import surface from './card-list-surface.module.css'

/** One entry: what it is called, which family it belongs to, and its one line of detail. */
export interface CardListItem {
  id: string
  /** The card's title: a path for a file, a name for a style. */
  name: string
  /** The chip after the title. */
  tag: string
  /** Stable identity behind the chip, so a filter can match without comparing copy. */
  tagId?: string
  /** One sentence under the title; omitted when the entry has none. */
  description?: string
  /** The quiet line at the bottom: size, scope, or the source it came from. */
  meta: string
  /** Whether the entry can be used as it stands. */
  disabled?: boolean
}

/** One selectable subset of the list: the "all" filter is added by the surface itself. */
export interface CardListFilter {
  id: string
  label: string
  /** Whether one entry belongs to this filter. */
  match: (item: CardListItem) => boolean
}

export interface CardListSurfaceProps {
  t: Translate
  items: readonly CardListItem[]
  /** Accessible name and placeholder of the search field; omitted hides the toolbar. */
  searchLabel?: string
  searchPlaceholder?: string
  /** Extra filters beside "all"; omitted leaves the segment with a single count. */
  filters?: readonly CardListFilter[]
  /** Trailing control rendered just before the view switch, such as the text toggle. */
  beforeView?: ReactNode
  /** Shown when the list, or the search, leaves nothing to render. */
  emptyText: string
  /** Opens one entry. */
  onOpen: (id: string) => void
}

/**
 * Render the shared searchable card grid.
 * @param props - the entries, the filter set, the labels, and the open callback.
 * @returns the toolbar and the cards, or an empty line.
 */
export function CardListSurface({ t, items, searchLabel, searchPlaceholder, filters = [], beforeView, emptyText, onOpen }: CardListSurfaceProps): ReactNode {
  const [view, setView] = useWorkspaceView()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const filterId = useId()
  const active = filters.find(entry => entry.id === filter)
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items.filter(item => {
      if (active !== undefined && !active.match(item)) return false
      if (needle === '') return true
      return item.name.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle)
    })
  }, [active, items, search])
  const segments = [
    { id: 'all', label: t('filterAll'), count: items.length, active: filter === 'all', onSelect: () => setFilter('all') },
    ...filters.map(entry => ({
      id: entry.id,
      label: entry.label,
      count: items.filter(item => entry.match(item)).length,
      active: filter === entry.id,
      onSelect: () => setFilter(entry.id)
    }))
  ]
  return h(
    'div',
    { className: surface.surface },
    searchLabel === undefined
      ? null
      : h(SearchFilterToolbar, {
          search,
          searchLabel,
          searchPlaceholder: searchPlaceholder ?? searchLabel,
          onSearchChange: setSearch,
          filters: segments,
          filterId,
          filterLabel: searchLabel,
          view,
          toListLabel: t('list'),
          toGridLabel: t('grid'),
          onViewChange: setView,
          beforeView
        }),
    shown.length === 0
      ? h('p', { className: surface.empty }, emptyText)
      : h(
          ResourceCollection,
          { view },
          shown.map(item =>
            h(
              ResourceCard,
              {
                key: item.id,
                state: item.disabled === true ? 'disabled' : 'active',
                ...interactiveCardProps(() => onOpen(item.id))
              },
              h(CardIdentity, { text: item.name, mono: true }),
              h('span', { className: surface.tag }, item.tag),
              item.description === undefined ? null : h('p', { className: surface.description }, item.description),
              h('span', { className: surface.meta }, item.meta)
            )
          )
        )
  )
}
