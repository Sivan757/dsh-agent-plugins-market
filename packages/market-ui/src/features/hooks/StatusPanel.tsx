/**
 * The settings workspace's Hooks panel: the same event-grouped presentation
 * the preset manager's Hooks tab renders, in read-only mode.
 *
 * Rows come from the sessionless hooks overview route, so the panel shows the
 * same identities and support verdicts as the manager. Support status stands
 * in for the enable switch this surface has no right to carry: a supported
 * event reads as a normal row, a partial or not-yet-executable event reads as
 * a warning with its localized reason, and no row offers a toggle — the
 * declarations are edited in the hooks files under the Agent layout root, not
 * here.
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { SegmentedTabs, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../../i18n.js'
import { fetchHooksOverview } from '../../api.js'
import type { ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { useHookEvents } from '../../ui/hook-event-grouping.js'
import { PanelHeader, PanelActions } from '../../ui/panel.js'
import { SearchFilterToolbar } from '../../ui/SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from '../../ui/ResourceCard.js'
import { useWorkspaceView } from '../../ui/workspace-view.js'
import { hoverHint } from '../../ui/hover-hint.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import rc from '../../ui/resource-card.module.css'
import css from '../mcp/mcp-status.module.css'
import workspace from '../../workspace/workspace.module.css'

type Filter = 'all' | 'supported' | 'limited'

/** The configured command hooks of both sources, grouped by event, read-only. */
export function HooksStatusPanel({ t }: { t: Translate }): ReactNode {
  const [rows, setRows] = useState<ExtensionResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useWorkspaceView()

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

  const reasonKey = (row: ExtensionResource): string => (row.unavailableReason === 'hook-event-partial' ? 'epHookEventPartial' : 'epHookEventUnsupported')

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
      h(
        'div',
        { className: workspace.tabRow },
        h(SegmentedTabs, {
          value: hook.active,
          onChange: value => {
            if (hook.events.includes(value)) hook.setRequested(value)
          },
          label: t('workspaceTabHooks'),
          items: hook.events.map(name => ({
            value: name,
            label: h('span', { className: 'event-tab-label' }, h(StateDot, { state: hook.dotFor(name) }), name),
            id: 'hooks-panel-event-' + name,
            panelId: 'hooks-panel-event-panel'
          })) as never
        })
      ),
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
                h(
                  ResourceCard,
                  { key: row.id, surface: 'hooks', state: limited(row) ? 'warning' : 'active' },
                  h('div', { className: rc.rowId }, hoverHint(row.name, h('span', { className: rc.name }, row.name))),
                  h(
                    'div',
                    { className: rc.rowFoot },
                    hoverHint(row.source, h('span', { ...{}, className: rc.provenance }, row.source)),
                    limited(row) ? h(Tag, { tone: 'warning' }, t(reasonKey(row) as never)) : null
                  )
                )
              )
            )
  )
}
