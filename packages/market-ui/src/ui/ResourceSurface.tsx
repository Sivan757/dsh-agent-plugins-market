/**
 * The one resource list: search, counted filters, grid/list, and one card per entry.
 *
 * Every surface that lists resources renders through this component. A surface supplies
 * entries and the capabilities it needs; it does not render a toolbar, a collection, or a
 * card of its own. The interaction contract is fixed here, once:
 *
 * - a card click opens the entry (the surface decides whether that is a dialog or a route);
 * - an entry-level switch is a separate control inside the card, never the card itself;
 * - destructive actions belong to the detail the card opens, not to the card.
 *
 * @module client/ui/ResourceSurface
 */
import { createElement as h, useId, useMemo, useState, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CardActions, CardBody, CardCount, CardFoot, CardIdentity, CardWarning, ResourceCard, ResourceCollection, interactiveCardProps } from './ResourceCard.js'
import { hintProps, hoverHint } from './hover-hint.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { useWorkspaceView } from './workspace-view.js'
import type { Translate } from '../i18n.js'
import surface from './resource-surface.module.css'
import card from './resource-card.module.css'

/** One entry a surface lists. */
export interface ResourceEntry {
  id: string
  /** The card title: a file path, a style name, a plugin name. */
  name: string
  /** A quiet qualifier after the title, such as the entry's own name or its version. */
  hint?: string
  /** Render the title in a monospace face, for paths and identifiers. */
  mono?: boolean
  /** The chip that names the entry's family or origin. */
  tag?: string
  /** Stable identity behind the chip, so a filter matches without comparing copy. */
  tagId?: string
  /** One sentence under the title. */
  description?: string
  /** The counts line the market cards carry, one per declared surface. */
  counts?: readonly { label: string; count: number }[]
  /** The quiet line at the bottom: size, source, or file name. */
  meta?: string
  /** A warning the entry needs beside its title. */
  warning?: string
  /** Whether the entry can be used as it stands. */
  disabled?: boolean
  /** Explicit card chrome when the surface needs a state the flag cannot express. */
  state?: 'active' | 'disabled' | 'warning' | 'error'
  /** The switch does not apply to this entry at all, so the card shows no control. */
  hideToggle?: boolean
}

/** What one surface allows. A capability that is false removes the control, not the card. */
export interface ResourceCapabilities {
  /** Entries carry an enable switch; the callback receives the requested state. */
  toggle?: boolean
  /** The card shows a count line (market cards). */
  counts?: boolean
}

/** One selectable subset: the "all" filter is added by the surface itself. */
export interface ResourceFilter {
  id: string
  label: string
  match: (entry: ResourceEntry) => boolean
}

export interface ResourceSurfaceProps {
  t: Translate
  entries: readonly ResourceEntry[]
  capabilities?: ResourceCapabilities
  /** Accessible name and placeholder of the search field; omitted hides the toolbar. */
  searchLabel?: string
  searchPlaceholder?: string
  /** Extra filters beside "all". */
  filters?: readonly ResourceFilter[]
  /** Trailing control before the view switch, such as the text toggle. */
  beforeView?: ReactNode
  /** Shown when nothing matches. */
  emptyText: string
  /** Opens one entry. Required: the card's click always means "open", never "toggle". */
  onOpen: (id: string) => void
  /** Called when an entry's switch changes; required when `capabilities.toggle` is set. */
  onToggle?: (id: string, enabled: boolean) => void
  /** Opens the entry's own editor. Editing is not destructive, so it stays on the card. */
  onEdit?: (id: string) => void
  /** Which entries are currently on; the switch state. */
  isOn?: (id: string) => boolean
  /** Whether an entry's switch is disabled. */
  isToggleDisabled?: (id: string) => boolean
}

/**
 * Render the shared resource list.
 * @param props - entries, capabilities, labels, and the open/toggle callbacks.
 * @returns the toolbar and the cards, or an empty line.
 */
export function ResourceSurface(props: ResourceSurfaceProps): ReactNode {
  const { t, entries, capabilities = {}, searchLabel, searchPlaceholder, filters = [], beforeView, emptyText, onOpen, onToggle, isOn, isToggleDisabled } = props
  const [view, setView] = useWorkspaceView()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const filterId = useId()
  const active = filters.find(entry => entry.id === filter)
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return entries.filter(entry => {
      if (active !== undefined && !active.match(entry)) return false
      if (needle === '') return true
      return entry.name.toLowerCase().includes(needle) || (entry.description ?? '').toLowerCase().includes(needle)
    })
  }, [active, entries, search])
  const segments = [
    { id: 'all', label: t('filterAll'), count: entries.length, active: filter === 'all', onSelect: () => setFilter('all') },
    ...filters.map(entry => ({
      id: entry.id,
      label: entry.label,
      count: entries.filter(item => entry.match(item)).length,
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
    // The segmented control points aria-controls at one panel per filter, so every filter
    // owns a panel and the active one is the one holding the collection.
    h(
      'div',
      { className: surface.results, role: 'tabpanel', id: filterId + '-' + filter + '-panel', 'aria-labelledby': filterId + '-' + filter },
      shown.length === 0
        ? h('p', { className: surface.empty }, emptyText)
        : h(
            ResourceCollection,
            { view },
            shown.map(entry => {
              const stop = (event: { stopPropagation(): void }): void => event.stopPropagation()
              // One anatomy for every entry: identity row, body row, source row, actions.
              // Each slot is a named grid area, so a card never auto-places a slot into
              // another's cell when the surface renders fewer pieces than its neighbours.
              const actions: ReactNode[] = []
              if (props.onEdit !== undefined) {
                actions.push(
                  h(
                    'button',
                    {
                      key: 'edit',
                      type: 'button',
                      className: `${card.iconBtn} ${card.revealOnHover}`,
                      'aria-label': t('panelEdit') + ' ' + entry.name,
                      title: t('panelEdit'),
                      onClick: (event: { stopPropagation(): void }) => {
                        event.stopPropagation()
                        props.onEdit?.(entry.id)
                      }
                    },
                    '✎'
                  )
                )
              }
              if (capabilities.toggle === true && onToggle !== undefined && entry.hideToggle !== true) {
                actions.push(
                  h(
                    'span',
                    { key: 'toggle', className: card.switchWrap, onClick: stop, onKeyDown: stop },
                    h(Switch, {
                      checked: isOn?.(entry.id) === true,
                      disabled: isToggleDisabled?.(entry.id) === true,
                      onChange: (enabled: boolean) => onToggle(entry.id, enabled),
                      label: entry.name
                    })
                  )
                )
              }
              const foot: ReactNode[] = []
              const meta = entry.meta ?? ''
              if (meta !== '') foot.push(hoverHint(meta, h('span', hintProps({ className: card.provenance }), meta)))
              if (capabilities.counts === true && entry.counts !== undefined) {
                for (const item of entry.counts) foot.push(h(CardCount, { label: item.label, count: item.count, first: foot.length === 0 }))
              }
              if (entry.warning !== undefined) {
                if (foot.length > 0) foot.push(h('span', { className: card.separator }, '·'))
                foot.push(h(CardWarning, { text: entry.warning, label: entry.warning }))
              }
              return h(
                ResourceCard,
                {
                  key: entry.id,
                  'data-resource-id': entry.id,
                  state: entry.state ?? (entry.disabled === true ? 'disabled' : 'active'),
                  ...interactiveCardProps(() => onOpen(entry.id))
                },
                h(CardIdentity, { text: entry.name, hint: entry.hint, mono: entry.mono, tag: entry.tag }),
                actions.length === 0 ? null : h(CardActions, null, ...actions),
                entry.description === undefined ? null : h(CardBody, null, hoverHint(entry.description, h('p', hintProps({ className: card.desc }), entry.description))),
                foot.length === 0 ? null : h(CardFoot, null, ...foot)
              )
            })
          )
    ),
    ['all', ...filters.map(entry => entry.id)]
      .filter(value => value !== filter)
      .map(value => h('div', { key: value, hidden: true, id: filterId + '-' + value + '-panel', role: 'tabpanel', 'aria-labelledby': filterId + '-' + value }))
  )
}
