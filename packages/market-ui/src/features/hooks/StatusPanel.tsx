/**
 * The settings workspace's Hooks panel: the manager's event-grouped presentation
 * in read-only form. Rows come from the sessionless hooks overview route and
 * render through the shared tab row and hook card, whose support Tag stands in
 * for the switch this surface has no right to carry.
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { ExtensionTranslate } from '../../i18n.js'
import { fetchHooksOverview } from '../../api.js'
import type { ExtensionDetail, ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { useHookEvents } from '../../ui/hook-event-grouping.js'
import { PanelHeader, PanelActions } from '../../ui/panel.js'
import { ResourceTabs } from '../../ui/ResourceTabs.js'
import { HookResourceCard } from '../../ui/HookResourceCard.js'
import { ResourceCollection } from '../../ui/ResourceCard.js'
import { SearchFilterToolbar } from '../../ui/SearchFilterToolbar.js'
import { useWorkspaceView } from '../../ui/workspace-view.js'
import { HookDetailModal } from '../../ui/HookDetailModal.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import css from '../mcp/mcp-status.module.css'

type Filter = 'all' | 'supported' | 'limited'

/** One hook's detail address, as the shared card opens it. */
type HookDetail = Extract<ExtensionDetail, { kind: 'hook' }>

/** The configured command hooks of both sources, grouped by event, read-only. */
export function HooksStatusPanel({ t }: { t: ExtensionTranslate }): ReactNode {
  const [rows, setRows] = useState<ExtensionResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useWorkspaceView()
  const [detail, setDetail] = useState<HookDetail | undefined>(undefined)

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchHooksOverview()
      .then(next => setRows(next.rows))
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  // The shared presentation model: same events, same dot, same grouping as
  // the manager. Read-only means no isSelected, so supported events read idle.
  const hook = useHookEvents(rows, undefined)
  const eventRows = hook.rowsFor(hook.active)
  const limited = (row: ExtensionResource): boolean => row.control === 'global-only'
  const needle = search.trim().toLowerCase()
  const filtered = eventRows.filter(
    row => (filter === 'all' || (filter === 'supported') === !limited(row)) && (needle === '' || (row.name + ' ' + row.source).toLowerCase().includes(needle))
  )
  const filters = [
    { id: 'all' as const, label: t('tabAll'), count: rows.length, active: filter === 'all', onSelect: () => setFilter('all') },
    {
      id: 'supported' as const,
      label: t('hooksFilterSupported'),
      count: rows.filter(row => !limited(row)).length,
      active: filter === 'supported',
      onSelect: () => setFilter('supported')
    },
    { id: 'limited' as const, label: t('hooksFilterLimited'), count: rows.filter(limited).length, active: filter === 'limited', onSelect: () => setFilter('limited') }
  ]
  const filterId = 'hooks-panel-filter'
  // One opener for the whole panel: the card reports the row, and the detail
  // comes from that row's own address, so no other hook can be opened here.
  const openDetail = (row: ExtensionResource): void => {
    if (row.detail.kind === 'hook') setDetail(row.detail)
  }

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, {
      subtitle: t('hooksPanelSubtitle'),
      actions: h(PanelActions, { refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
    }),
    h(SearchFilterToolbar, {
      className: css.toolbar,
      search,
      searchLabel: t('hooksPanelSearch'),
      searchPlaceholder: t('hooksPanelSearch'),
      onSearchChange: setSearch,
      filters,
      filterId,
      filterLabel: t('workspaceTabHooks'),
      view,
      toListLabel: t('switchToList'),
      toGridLabel: t('switchToGrid'),
      onViewChange: nextView => setView(nextView)
    }),
    hook.events.length > 0 &&
      h(ResourceTabs, {
        value: hook.active,
        onChange: value => {
          if (hook.events.includes(value)) hook.setRequested(value)
        },
        label: t('workspaceTabHooks'),
        items: hook.events.map(name => ({
          value: name,
          text: name,
          dot: hook.dotFor(name),
          id: 'hooks-panel-event-' + name,
          panelId: 'hooks-panel-event-panel'
        }))
      }),
    error !== undefined
      ? h('div', { className: css.error, role: 'status' }, error)
      : loading && rows.length === 0
        ? h('div', { className: css.empty, role: 'status' }, t('loading'))
        : filtered.length === 0
          ? h('div', { className: css.empty, role: 'status' }, t('hooksPanelEmpty'))
          : h(
              ResourceCollection,
              { view },
              filtered.map(row =>
                h(HookResourceCard, {
                  key: row.id,
                  row,
                  t,
                  // Read-only chrome: a limited declaration warns, everything
                  // else the host can run reads active.
                  state: limited(row) ? 'warning' : 'active',
                  onView: openDetail
                })
              )
            ),
    detail === undefined ? null : h(HookDetailModal, { detail, t, onClose: () => setDetail(undefined) })
  )
}
