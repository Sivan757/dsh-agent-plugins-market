import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, IconRefreshOutline16, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './ui/DetailModal.js'
import { ServerConfigEditor } from './ui/ServerConfigEditor.js'
import { ServerConfigDetail } from './ui/ServerConfigDetail.js'
import { parseServerConfig } from './ui/server-form.js'
import { PanelActions, PanelHeader } from './ui/panel.js'
import { mcpDetailActions } from './features/mcp-status/detail-actions.js'
import type { Translate } from './index.js'
import { addMcpServer, fetchMcpStatus, reauthorizeMcpServer, retryMcpMounts, setMcpServerEnabled, type McpStatusEntry, type McpStatusPayload } from './api.js'
import type { CredentialApi } from './credentials.js'
import { McpCredentialEditor } from './McpCredentialEditor.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from './ui/ResourceCard.js'
import { useWorkspaceView } from './ui/workspace-view.js'
import { deriveMcpStatusViewModel, MCP_FILTERS, type McpStatusFilter } from './features/mcp-status/mcp-status-view-model.js'
import css from './mcp-status.module.css'
import rc from './ui/resource-card.module.css'
import panelCss from './ui/panel.module.css'
import { withBusyOperation } from './ui/busy-operation.js'
import { clientErrorMessage } from './ui/error-message.js'

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
              filtered.map(entry => h(McpCard, { key: entry.id, entry, t, onClick: () => setSelected(entry), onToggle: () => toggle(entry) }))
            ),
    adding
      ? h(McpAddModal, {
          t,
          onClose: () => setAdding(false),
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
          onClose: () => {
            setSelected(undefined)
            refresh()
          },
          onRetry: retry,
          onReauthorize: reauthorize,
          onRefresh: observe
        })
  )
}

/** The state tag's tone; a healthy server reads as success. */
function mcpTagTone(state: McpStatusEntry['state']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'connected') return 'success'
  if (state === 'failed' || state === 'orphaned') return 'danger'
  if (state === 'disabled' || state === 'foreign') return 'neutral'
  return 'warning'
}

/** The one-line verdict the detail's status band shows. */
function mcpStateLabel(t: Translate, state: McpStatusEntry['state']): string {
  if (state === 'connected') return t('mcpConnected')
  if (state === 'degraded') return t('mcpDegraded')
  if (state === 'failed') return t('mcpFailed')
  if (state === 'needs-credentials') return t('mcpNeedsCredentials')
  if (state === 'orphaned') return t('mcpOrphaned')
  if (state === 'foreign') return t('mcpForeign')
  // The same word the `已禁用` filter tab uses, so the chip and the tab that
  // finds it agree.
  return t('panelFilterDisabled')
}

/** One label/value pair in a detail dialog's overview grid. */
function kvCell(label: string, value: string, mono = false): ReactNode {
  return h('div', null, h('dt', { className: panelCss.kvKey }, label), h('dd', { className: mono ? `${panelCss.kvValue} ${panelCss.kvValueMono}` : panelCss.kvValue, title: value }, value))
}

/** The card dot colour: the states the detail dialog also reports. */
function mcpDotState(state: McpStatusEntry['state']): 'done' | 'warning' | 'error' | 'idle' {
  if (state === 'connected') return 'done'
  if (state === 'failed' || state === 'orphaned') return 'error'
  if (state === 'disabled' || state === 'foreign') return 'idle'
  return 'warning'
}

/**
 * One inventory card: the server name with its state tag on the identity row
 * and the enable switch on its trailing edge; the endpoint on the body row;
 * tool count and transport on the source row. The reason text, the state
 * label's long form, and the remaining actions (retry, reauthorize,
 * configuration) live in the detail dialog, so a wall of failing cards stays
 * scannable.
 */
function McpCard({ entry, t, onClick, onToggle }: { entry: McpStatusEntry; t: Translate; onClick: () => void; onToggle: () => void }): ReactNode {
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
      h(Tag, { tone: mcpTagTone(entry.state) }, mcpStateLabel(t, entry.state)),
      h('span', { className: rc.provenanceChip }, h(Tag, { tone: 'neutral' }, entry.kind === 'plugin' ? t('mcpPlugin') : t('mcpDirect')))
    ),
    h(
      'div',
      { className: rc.rowActions },
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
export function McpDetailModal({
  entry,
  t,
  credentials,
  onClose,
  onRetry,
  onReauthorize,
  onRefresh
}: {
  entry: McpStatusEntry
  t: Translate
  credentials?: CredentialApi
  onClose: () => void
  onRetry: (entryId: string) => Promise<McpStatusEntry>
  onReauthorize: (id: string, serverName: string) => Promise<McpStatusEntry>
  onRefresh: (id: string) => Promise<McpStatusEntry>
}): ReactNode {
  const [pending, setPending] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmAuth, setConfirmAuth] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  const actions = mcpDetailActions(entry)
  const run = async (authorize: boolean): Promise<void> => {
    setConfirmAuth(false)
    setPending(true)
    setFeedback(undefined)
    try {
      const current = authorize ? await onReauthorize(entry.id, entry.name) : await onRetry(entry.id)
      const connected = current.state === 'connected'
      setFeedback({ error: !connected, text: connected ? t('mcpRetrySuccess') : t('mcpStillUnavailable') + (current.reason ? ': ' + current.reason : '') })
    } catch (reason) {
      setFeedback({ error: true, text: t('actionFail') + ': ' + clientErrorMessage(t, reason) })
    } finally {
      setPending(false)
    }
  }
  return h(DetailModal, {
    open: true,
    onClose: () => {
      if (!pending) onClose()
    },
    title: entry.name,
    description: t('mcpServiceDetail'),
    closeLabel: t('mcpClose'),
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      actions.retry
        ? h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              disabled: pending || dirty,
              title: dirty ? t('mcpSaveFirst') : t('mcpRetryPreservesCredentials'),
              onClick: () => {
                void run(false)
              }
            },
            h(IconRefreshOutline16),
            t('mcpRetryConnection')
          )
        : null,
      actions.reauthorize
        ? h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              disabled: pending || dirty,
              title: dirty ? t('mcpSaveFirst') : t('mcpReauthExplain'),
              onClick: () => {
                setConfirmAuth(true)
                setFeedback(undefined)
              }
            },
            t('mcpReauthorize')
          )
        : null,
      h(Button, { variant: 'ghost', disabled: pending, onClick: onClose }, t('mcpClose'))
    ),
    children: h(
      'div',
      null,
      feedback ? h('p', { role: feedback.error ? 'alert' : 'status', className: feedback.error ? css.error : css.retryEchoSuccess }, feedback.text) : null,
      confirmAuth
        ? h(
            'section',
            { className: css.reasonBox, role: 'alert' },
            h('p', null, t('mcpReauthExplain')),
            h(Button, { variant: 'ghost', onClick: () => setConfirmAuth(false) }, t('cancel')),
            h(
              Button,
              {
                variant: 'primary',
                disabled: dirty || pending,
                onClick: () => {
                  void run(true)
                }
              },
              t('mcpConfirmReauth')
            )
          )
        : null,
      dirty && (actions.retry || actions.reauthorize) ? h('p', { className: css.reasonText }, t('mcpSaveFirst')) : null,
      entry.state === 'needs-credentials' ? h('p', { className: css.reasonText }, t('mcpConfigureCredentialsFirst')) : null,
      h(
        'div',
        { className: panelCss.hero },
        h(StateDot, { state: mcpDotState(entry.state) }),
        h(
          'div',
          { className: panelCss.heroText },
          h(
            'div',
            { className: panelCss.heroLine },
            h(Tag, { tone: mcpTagTone(entry.state) }, mcpStateLabel(t, entry.state)),
            h(Tag, null, entry.kind === 'plugin' ? t('mcpPlugin') : t('mcpDirect')),
            h(Tag, { tone: 'quiet' }, entry.transport),
            // A server that declares no `auth` block still runs the OAuth flow
            // when it answers 401, and the redacted configuration cannot show
            // that, so the note rides on the status band.
            entry.oauthDefault === true ? h(Tag, { tone: 'quiet' }, t('mcpOauthDefault')) : null
          ),
          h('p', { className: panelCss.heroMono }, entry.endpoint ?? t('mcpObservedEndpoint'))
        )
      ),
      h(
        'div',
        { className: panelCss.block },
        h('h4', { className: panelCss.blockHead }, t('overviewSection')),
        h(
          'dl',
          { className: panelCss.kvGrid },
          kvCell(t('sourceLabel'), entry.kind === 'plugin' ? entry.suiteId ?? entry.source ?? '—' : t('mcpDirect'), true),
          kvCell(t('detailTypeLabel'), entry.kind === 'plugin' ? t('panelSourcePlugin') : t('panelSourceUser')),
          kvCell(t('detailTransport'), entry.transport, true),
          kvCell(t('mcpServerKeyLabel'), entry.serverKey ?? entry.name, true)
        )
      ),
      // A foreign mount is informational: the localized hint (per cause —
      // another plugin, or another source's identical suite) replaces the raw
      // English reason, which drops to a dim secondary line for its details.
      entry.state === 'foreign'
        ? h(
            'div',
            { className: css.reasonBox },
            h('span', { className: css.reasonLabel }, t('mcpReasonLabel')),
            h('p', { className: css.reasonText }, entry.code === 'duplicate-mount' ? t('mcpDuplicateHint') : t('mcpForeignHint')),
            entry.reason === undefined ? null : h('p', { className: css.reasonRaw }, entry.reason)
          )
        : entry.reason === undefined
          ? null
          : h('div', { className: css.reasonBox }, h('span', { className: css.reasonLabel }, t('mcpReasonLabel')), h('p', { className: css.reasonText }, entry.reason)),
      entry.kind === 'direct' && !entry.managed ? h('div', { className: css.reasonBox }, h('p', { className: css.reasonText }, t('mcpDirectBoundary'))) : null,
      entry.credentialRefs?.length === 0 || entry.credentialRefs === undefined ? null : h(McpCredentialEditor, { t, api: credentials, refs: entry.credentialRefs }),
      h(
        'div',
        { className: panelCss.block },
        h('h4', { className: panelCss.blockHead }, t('serviceConfigLabel')),
        h(ServerConfigDetail, {
          kind: 'mcp',
          id: entry.id,
          t,
          onDirtyChange: setDirty,
          onSaved: () => {
            void onRefresh(entry.id).catch(reason => setFeedback({ error: true, text: t('mcpSavedStatusUnknown') + ': ' + String(reason) }))
          }
        })
      ),
      h(
        'div',
        { className: panelCss.block },
        h('h4', { className: panelCss.blockHead }, `${t('mcpTools')} (${entry.tools.length})`),
        entry.tools.length === 0
          ? h('p', { className: panelCss.detailProse }, entry.advertisedTools === false && entry.state === 'degraded' ? t('mcpZeroTools') : t('mcpNoTools'))
          : h(
              'div',
              { className: css.toolList },
              entry.tools.map(tool =>
                h(
                  'div',
                  { key: tool.name, className: css.tool },
                  h('span', { className: css.toolName }, tool.name),
                  tool.description === undefined || tool.description === '' ? null : h('span', { className: css.toolDescription }, tool.description)
                )
              )
            )
      )
    )
  })
}

function McpAddModal({ t, onClose, onSaved }: { t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  const [name, setName] = useState('')
  const [config, setConfig] = useState('{"type":"stdio","command":""}')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    void Promise.resolve()
      .then(() => addMcpServer(name.trim(), parseServerConfig(config)))
      .then(onSaved)
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setBusy(false))
  }
  return h(DetailModal, {
    open: true,
    title: t('mcpAddTitle'),
    onClose: busy ? () => {} : onClose,
    closeLabel: t('cancel'),
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h('span', { className: css.modalFooterHint }, t('editorFooterCreate')),
      h('div', { className: css.modalFooterGrow }),
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, t('cancel')),
      h(Button, { variant: 'primary', disabled: busy || name.trim() === '' || !valid, onClick: save }, t('editorCreate'))
    ),
    children: h(
      'div',
      { className: css.detail },
      h(ServerConfigEditor, {
        kind: 'mcp',
        text: config,
        onChange: setConfig,
        t,
        disabled: busy,
        onValidityChange: setValid,
        nameField: {
          label: t('mcpServerName'),
          // A native control from the editors' own form sheet: the platform
          // `Input` draws its own edge, which nested a second box inside the field.
          control: h('input', {
            value: name,
            placeholder: t('mcpServerNamePh'),
            'aria-label': t('mcpServerName'),
            disabled: busy,
            onChange: (event: { target: { value: string } }) => setName(event.target.value)
          })
        }
      }),
      error === undefined ? null : h('div', { role: 'alert', className: css.error }, error)
    )
  })
}

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
