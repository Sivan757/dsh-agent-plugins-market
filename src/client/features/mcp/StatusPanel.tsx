import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, IconEditOutlineMedium, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { PanelActions, PanelHeader } from '../../ui/panel.js'
import type { Translate } from '../../index.js'
import type { CredentialApi } from '../../credentials.js'
import { fetchMcpStatus, reauthorizeMcpServer, retryMcpMounts, setMcpServerEnabled, type McpStatusEntry, type McpStatusPayload } from '../../api.js'
import { SearchFilterToolbar } from '../../ui/SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from '../../ui/ResourceCard.js'
import { useWorkspaceView } from '../../ui/workspace-view.js'
import { deriveMcpStatusViewModel, MCP_FILTERS, type McpStatusFilter } from './mcp-status-view-model.js'
import { withBusyOperation } from '../../ui/busy-operation.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { McpDetailModal } from './McpDetailModal.js'
import { McpConfigModal } from './McpConfigModal.js'
import { McpAddModal } from './McpAddModal.js'
import css from './mcp-status.module.css'
import rc from '../../ui/resource-card.module.css'


interface McpStatusPanelProps {
  t: Translate
  credentials?: CredentialApi
}

type Filter = McpStatusFilter

const EMPTY_STATUS: McpStatusPayload = {
  entries: [],
  observedAt: '',
  totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
}

/** DSH-native MCP inventory with a per-state overview and per-service detail. */
export function McpStatusPanel({ t, credentials }: McpStatusPanelProps): ReactNode {
  const [payload, setPayload] = useState<McpStatusPayload>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useWorkspaceView()
  const [selected, setSelected] = useState<McpStatusEntry | undefined>(undefined)
  const [editing, setEditing] = useState<McpStatusEntry>()
  const [adding, setAdding] = useState(false)

  const observe = async (id: string): Promise<McpStatusEntry> => {
    const refreshed = await fetchMcpStatus()
    setPayload(refreshed)
    const current = refreshed.entries.find(item => item.id === id)
    if (!current) throw new Error(t('mcpEntryGone'))
    setSelected(current)
    return current
  }
  const retry = (id: string): Promise<McpStatusEntry> =>
    withBusyOperation(async () => {
      await retryMcpMounts()
      return observe(id)
    })
  const reauthorize = (id: string, serverName: string): Promise<McpStatusEntry> =>
    withBusyOperation(async () => {
      await reauthorizeMcpServer(serverName)
      return observe(id)
    })

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchMcpStatus()
      .then(setPayload)
      .catch(caught => {
        setError(clientErrorMessage(t, caught))
      })
      .finally(() => setLoading(false))
  }

  // Written through the suite's override record, so the suite's own `mcp.json`
  // stays source-owned. Disabled servers are not mounted at all.
  const toggle = (entry: McpStatusEntry): void => {
    const suiteId = entry.suiteId
    const serverKey = entry.serverKey
    if (suiteId === undefined || serverKey === undefined) return
    setError(undefined)
    withBusyOperation(() => setMcpServerEnabled(suiteId, serverKey, entry.state === 'disabled'))
      .then(() => fetchMcpStatus())
      .then(setPayload)
      .catch(caught => {
        setError(clientErrorMessage(t, caught))
      })
  }

  useEffect(() => {
    refresh()
  }, [])

  const { activeEntries, filtered, filterCounts } = deriveMcpStatusViewModel(payload, filter, search)

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, {
      title: t('mcpStatusTitle'),
      subtitle: t('mcpStatusSubtitle'),
      actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: () => setAdding(true), refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
    }),
    h(SearchFilterToolbar, {
      className: css.toolbar,
      search,
      searchLabel: t('mcpSearch'),
      searchPlaceholder: t('mcpSearch'),
      onSearchChange: setSearch,
      filters: MCP_FILTERS.map(kind => ({
        id: kind,
        label: filterLabel(t, kind),
        count: filterCounts[kind],
        active: filter === kind,
        onSelect: () => setFilter(kind),
        hint: mcpFilterHint(t, kind)
      })),
      view,
      toListLabel: t('switchToList'),
      toGridLabel: t('switchToGrid'),
      onViewChange: nextView => setView(nextView)
    }),
    error !== undefined
      ? h('div', { className: css.error }, error, h(Button, { variant: 'ghost', size: 'sm', onClick: refresh }, t('mcpRetry')))
      : loading && activeEntries.length === 0
        ? h('div', { className: css.empty }, t('loading'))
        : filtered.length === 0
          ? h('div', { className: css.empty }, t('mcpEmpty'))
          : h(
              ResourceCollection,
              { view },
              filtered.map(entry => h(McpCard, { key: entry.id, entry, t, onClick: () => setSelected(entry), onToggle: () => toggle(entry), onEdit: () => setEditing(entry) }))
            ),
    adding
      ? h(McpAddModal, {
          t,
          onClose: () => setAdding(false),
          onChanged: refresh,
          onSaved: () => {
            setAdding(false)
            refresh()
          }
        })
      : null,
    selected === undefined
      ? null
      : h(McpDetailModal, {
          entry: selected,
          t,
          credentials,
          backend: payload.backend ?? 'builtin',
          onClose: () => {
            setSelected(undefined)
            refresh()
          },
          onRetry: retry,
          onReauthorize: reauthorize,
          onRefresh: observe
        }),
    // The editor is the dialog the add flow uses, opened from the card's own
    // edit action rather than from inside the detail report.
    editing === undefined
      ? null
      : h(McpConfigModal, {
          entry: editing,
          t,
          onClose: () => setEditing(undefined),
          onSaved: refresh
        })
  )
}

/** The state tag's tone; a healthy server reads as success. */
/**
 * One inventory card: the server name with its state tag on the identity row
 * and the enable switch on its trailing edge; the endpoint on the body row;
 * tool count and transport on the source row. The reason text, the state
 * label's long form, and the remaining actions (retry, reauthorize,
 * configuration) live in the detail dialog, so a wall of failing cards stays
 * scannable.
 */
function McpCard({ entry, t, onClick, onToggle, onEdit }: { entry: McpStatusEntry; t: Translate; onClick: () => void; onToggle: () => void; onEdit: () => void }): ReactNode {
  const interactive = {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      // Enter and Space activate a role="button" the same way a native one does.
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onClick()
    }
  }
  const toolCount = entry.tools.length === 1 ? t('mcpTool') : t('mcpTools')
  // A foreign mount belongs to another MCP client, so this plugin cannot
  // switch it; everything else it declared is its own to enable or disable.
  const switchable = entry.suiteId !== undefined && entry.serverKey !== undefined && entry.state !== 'foreign'
  const disabled = entry.state === 'disabled'
  return h(
    ResourceCard,
    {
      state: entry.state === 'connected' ? 'active' : entry.state === 'disabled' ? 'disabled' : entry.state === 'failed' || entry.state === 'orphaned' ? 'error' : 'warning',
      surface: 'mcp',
      ...interactive
    },
    h(
      'div',
      { className: rc.rowId },
      h('span', { className: `${rc.name} ${rc.nameMono}` }, entry.name),
      // The state rail on the card's left edge carries the state; a written
      // label beside it would say the same thing twice.
      h('span', { className: rc.provenanceChip }, h(Tag, { tone: 'neutral' }, entry.kind === 'plugin' ? t('mcpPlugin') : t('mcpDirect')))
    ),
    h(
      'div',
      { className: rc.rowActions },
      // The editor is the dialog the add flow uses; it sits just before the
      // switch, where the row's actions end.
      switchable
        ? h(
            'button',
            {
              type: 'button',
              className: rc.iconBtn,
              title: t('panelEdit'),
              'aria-label': `${t('panelEdit')} ${entry.name}`,
              onClick: (event: { stopPropagation(): void }) => {
                event.stopPropagation()
                onEdit()
              }
            },
            h(IconEditOutlineMedium)
          )
        : null,
      h(
        'span',
        { className: rc.switchWrap, onClick: (event: { stopPropagation(): void }) => event.stopPropagation() },
        h(Switch, {
          checked: !disabled,
          disabled: !switchable,
          label: disabled ? t('enable') : t('disable'),
          title: disabled ? t('enable') : t('disable'),
          onChange: onToggle
        })
      )
    ),
    h('p', { className: `${rc.rowBody} ${rc.monoLine}` }, entry.endpoint ?? t('mcpObservedEndpoint')),
    h(
      'div',
      { className: rc.rowFoot },
      h('span', { className: rc.provenance, title: entry.suiteId ?? entry.source }, entry.kind === 'plugin' ? entry.suiteId ?? entry.source ?? '—' : t('mcpDirect')),
      h('span', { className: rc.separator }, '·'),
      h('span', { className: rc.count }, h('span', { className: rc.countValue }, String(entry.tools.length)), ' ', toolCount),
      h('span', { className: rc.separator }, '·'),
      h('span', { className: rc.count }, entry.transport)
    )
  )
}


/**
 * The detail dialog owns every action and every long text: state, reason,
 * credentials, config, tools, and the retry control with its in-place result
 * echo. The state pill is dropped entirely — the dot and the reason box carry
 * that information without a second red stamp.
 */
function filterLabel(t: Translate, kind: Filter): string {
  if (kind === 'plugin') return t('mcpPlugin')
  if (kind === 'direct') return t('mcpDirect')
  if (kind === 'disabled') return t('panelFilterDisabled')
  return t('mcpAll')
}

/** Hover/aria explanation for each MCP filter tab. */
function mcpFilterHint(t: Translate, kind: Filter): string {
  if (kind === 'plugin') return t('mcpFilterPluginHint')
  if (kind === 'direct') return t('mcpFilterDirectHint')
  if (kind === 'disabled') return t('mcpFilterDisabledHint')
  return t('mcpFilterAllHint')
}

/**
 * Where each credential reference is used, as `<field label> <key>` entries read
 * from the server configuration: a token named in a request header and an
 * environment variable are the two seams the mount-time expander fills.
 */
/**
 * The parameters one tool advertises: name, type, whether it is required, and
 * the server's own description. A nested schema keeps its type name; the full
 * definition stays with the tool list the model already receives.
 */
