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
import { createElement as h, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CardActions, CardBody, CardCount, CardFoot, CardIdentity, CardWarning, ResourceCard, ResourceCollection, interactiveCardProps } from './ResourceCard.js'
import { hintProps, hoverHint } from './hover-hint.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { useWorkspaceView } from './workspace-view.js'
import type { Translate } from '../i18n.js'
import surface from './resource-surface.module.css'
import card from './resource-card.module.css'

/**
 * How many cards one page of the collection renders before the reader asks for
 * more. A market with a thousand suites should open in one frame, not spend a
 * third of a second mounting every card the reader will scroll past.
 */
export const RESOURCE_PAGE_SIZE = 120

/** One entry a surface lists. */
export interface ResourceEntry {
  id: string
  /** The card title: a file path, a style name, a plugin name. */
  name: string
  /** The version chip the identity row carries, for a suite. */
  version?: string
  /** A quiet qualifier after the title, such as the entry's own name or its raw name. */
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
  /**
   * The provenance token that leads the source row, in the identity row's mono
   * face: the owning suite, or the file's own location. A surface that names a
   * source keeps it apart from `meta`, which carries a trailing value such as a
   * transport or a size.
   */
  source?: string
  /** Render the body line in a monospace face, for endpoints and commands. */
  monoBody?: boolean
  /** Extra search text the eye cannot read off the card, such as a transport or a reason. */
  keywords?: string
  /** Accessible name of the switch; defaults to the entry name. */
  toggleLabel?: string
  /** Whether the surface offers an editor for this entry at all; undefined means yes. */
  canEdit?: boolean
  /** Whether that editor is unavailable right now, such as while a write is in flight. */
  editDisabled?: boolean
  /** The chip rides the narrow-grid provenance slot, so that layout can hide it. */
  chip?: boolean
  /**
   * One primary action on the card, such as installing a suite: the text button
   * that follows the icon actions and precedes the switch. Never destructive.
   */
  primary?: { label: string; title?: string; disabled?: boolean; onSelect: () => void }
  /** Flat icon actions that trail the cluster before the primary action. */
  actions?: readonly ResourceCardAction[]
  /** The surface this entry belongs to, for the one layout that treats MCP and LSP chips differently. */
  surface?: 'market' | 'skills' | 'commands' | 'personas' | 'mcp' | 'lsp' | 'hooks'
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

/** One flat icon action a surface wants on the card. */
export interface ResourceCardAction {
  /** Stable id, also the React key. */
  id: string
  /** Accessible name and hover title. */
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** A destructive action reads in the danger hover. */
  danger?: boolean
}

/** One selectable subset: the "all" filter is added by the surface itself. */
export interface ResourceFilter {
  id: string
  label: string
  /** Extended hover and accessible explanation; falls back to the label and count. */
  hint?: string
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
  /** Accessible names of the view switch, each saying where a click leads. */
  toListLabel?: string
  toGridLabel?: string
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
  const {
    t,
    entries,
    capabilities = {},
    searchLabel,
    searchPlaceholder,
    filters = [],
    beforeView,
    toListLabel,
    toGridLabel,
    emptyText,
    onOpen,
    onToggle,
    isOn,
    isToggleDisabled
  } = props
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
      return (
        entry.name.toLowerCase().includes(needle) ||
        (entry.description ?? '').toLowerCase().includes(needle) ||
        // Text the card renders elsewhere or not at all still has to be findable:
        // an endpoint, a transport, a recorded reason.
        (entry.keywords ?? '').toLowerCase().includes(needle)
      )
    })
  }, [active, entries, search])
  // The list pages itself: a filter or a search starts over, because keeping the
  // page would drop the reader into the middle of a set they never scrolled.
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
  }, [filter, search])
  const visible = shown.slice(0, page * RESOURCE_PAGE_SIZE)
  const remaining = shown.length - visible.length
  const moreRef = useRef<HTMLDivElement | null>(null)
  // The sentinel grows the page as it comes into view; the button beside it is
  // the same action for a reader who cannot scroll to it (and for a host without
  // IntersectionObserver).
  useEffect(() => {
    if (remaining <= 0) return
    const node = moreRef.current
    if (node === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      records => {
        if (records.some(record => record.isIntersecting)) setPage(current => current + 1)
      },
      { rootMargin: '240px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [remaining, visible.length])
  const grow = (): void => setPage(current => current + 1)
  const segments = [
    { id: 'all', label: t('filterAll'), count: entries.length, active: filter === 'all', onSelect: () => setFilter('all') },
    ...filters.map(entry => ({
      id: entry.id,
      label: entry.label,
      count: entries.filter(item => entry.match(item)).length,
      active: filter === entry.id,
      onSelect: () => setFilter(entry.id),
      ...(entry.hint === undefined ? {} : { hint: entry.hint })
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
          toListLabel: toListLabel ?? t('list'),
          toGridLabel: toGridLabel ?? t('grid'),
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
            visible.map(entry => {
              const stop = (event: { stopPropagation(): void }): void => event.stopPropagation()
              // One anatomy for every entry: identity row, body row, source row, actions.
              // Each slot is a named grid area, so a card never auto-places a slot into
              // another's cell when the surface renders fewer pieces than its neighbours.
              const actions: ReactNode[] = []
              // Secondary icon actions first, then the entry's primary action,
              // then the switch — the one control that always reads last.
              for (const action of entry.actions ?? []) {
                actions.push(
                  h(
                    'button',
                    {
                      key: action.id,
                      type: 'button',
                      className: `${card.iconBtn} ${action.danger === true ? card.iconBtnDanger : ''} ${card.revealOnHover}`,
                      'aria-label': action.label,
                      title: action.label,
                      disabled: action.disabled === true,
                      onClick: (event: { stopPropagation(): void }) => {
                        event.stopPropagation()
                        action.onSelect()
                      }
                    },
                    action.icon
                  )
                )
              }
              if (entry.primary !== undefined) {
                const primary = entry.primary
                actions.push(
                  h(
                    // The primary action stays visible at rest: it is the one
                    // thing a reader is meant to press on this row. Only the
                    // secondary icons fade in. In a grid of a thousand cards a
                    // filled button on every one of them competes with the
                    // content it sits on, so the grid reads it as quiet text and
                    // the list, one row per action, keeps the filled weight.
                    'span',
                    { key: 'primary', className: card.switchWrap, onClick: stop, onKeyDown: stop },
                    h(
                      Button,
                      {
                        variant: view === 'list' ? 'primary' : 'ghost',
                        size: 'sm',
                        disabled: primary.disabled === true,
                        ...(primary.title === undefined ? {} : { title: primary.title }),
                        onClick: primary.onSelect
                      },
                      primary.label
                    )
                  )
                )
              }
              // An entry can withhold its editor (a foreign mount, a row this
              // surface cannot write) and can be busy right now; both are the
              // entry's facts, not the surface's.
              if (props.onEdit !== undefined && entry.canEdit !== false) {
                actions.push(
                  h(
                    'button',
                    {
                      key: 'edit',
                      type: 'button',
                      className: `${card.iconBtn} ${card.revealOnHover}`,
                      'aria-label': t('panelEdit') + ' ' + entry.name,
                      title: t('panelEdit'),
                      disabled: entry.editDisabled === true,
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
                      // "Enable" and "Disable" say what the press does; the entry
                      // name alone leaves the direction to the state dot. The
                      // same words title the control, so a hover reads them too.
                      label: entry.toggleLabel ?? entry.name,
                      ...(entry.toggleLabel === undefined ? {} : { title: entry.toggleLabel })
                    })
                  )
                )
              }
              // The source row reads as one line of technical tokens in the
              // order the surface cares about: where it comes from, the counts
              // that are scanned for, then a trailing value such as a transport.
              const foot: ReactNode[] = []
              const source = entry.source ?? ''
              if (source !== '') foot.push(hoverHint(source, h('span', hintProps({ className: card.provenance }), source)))
              if (capabilities.counts === true && entry.counts !== undefined) {
                for (const item of entry.counts) foot.push(h(CardCount, { label: item.label, count: item.count, first: foot.length === 0 }))
              }
              const meta = entry.meta ?? ''
              if (meta !== '') {
                if (foot.length > 0) foot.push(h('span', { className: card.separator }, '·'))
                foot.push(hoverHint(meta, h('span', hintProps({ className: card.provenance }), meta)))
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
                  ...(entry.surface === undefined ? {} : { surface: entry.surface }),
                  ...interactiveCardProps(() => onOpen(entry.id))
                },
                h(CardIdentity, {
                  text: entry.name,
                  hint: entry.hint,
                  mono: entry.mono,
                  tag: entry.tag,
                  ...(entry.version === undefined ? {} : { version: entry.version }),
                  ...(entry.chip === true ? { chip: true } : {})
                }),
                actions.length === 0 ? null : h(CardActions, null, ...actions),
                entry.description === undefined
                  ? null
                  : h(CardBody, null, hoverHint(entry.description, h('p', hintProps({ className: entry.monoBody === true ? card.monoLine : card.desc }), entry.description))),
                foot.length === 0 ? null : h(CardFoot, null, ...foot)
              )
            }),
            // The collection pages itself: revealing the rest as the sentinel
            // arrives keeps a thousand-suite market to one frame of work.
            remaining <= 0
              ? null
              : h(
                  'div',
                  { ref: moreRef, className: surface.more, 'data-resource-more': '' },
                  h('button', { type: 'button', className: surface.moreButton, onClick: grow }, t('showMore', { count: String(Math.min(RESOURCE_PAGE_SIZE, remaining)) }))
                )
          )
    ),
    ['all', ...filters.map(entry => entry.id)]
      .filter(value => value !== filter)
      .map(value => h('div', { key: value, hidden: true, id: filterId + '-' + value + '-panel', role: 'tabpanel', 'aria-labelledby': filterId + '-' + value }))
  )
}
