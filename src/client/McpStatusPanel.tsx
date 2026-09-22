import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, IconEditOutline16, IconRefreshOutline16, IconSearchOutline16, Input, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './ui/DetailModal.js'
import { ServerConfigEditor } from './ui/ServerConfigEditor.js'
import { ServerConfigDetail } from './ui/ServerConfigDetail.js'
import { fieldErrorsOf, MCP_TEMPLATES, parsePastedServer, parsePastedServers, parseServerConfig, type McpTemplate, type ServerConfig } from './ui/server-form.js'
import { PanelActions, PanelHeader } from './ui/panel.js'
import { mcpDetailActions } from './features/mcp-status/detail-actions.js'
import type { Translate } from './index.js'
import { addMcpServer, fetchMcpStatus, importMcpServers, reauthorizeMcpServer, retryMcpMounts, setMcpServerEnabled, setMcpServerTool, type McpStatusEntry, type McpStatusPayload } from './api.js'
import type { CredentialApi } from './credentials.js'
import { McpCredentialEditor } from './McpCredentialEditor.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from './ui/ResourceCard.js'
import { useWorkspaceView } from './ui/workspace-view.js'
import { deriveMcpStatusViewModel, mcpToolRows, MCP_FILTERS, type McpStatusFilter } from './features/mcp-status/mcp-status-view-model.js'
import { MCP_GUIDANCE_LABEL, mcpGuidanceKey } from './features/mcp-status/diagnostic-guidance.js'
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

/** How many tool rows a collapsed capability list shows before its expand row. */
const TOOL_PAGE_SIZE = 8

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
            h(IconEditOutline16)
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
export function McpDetailModal({
  entry,
  t,
  credentials,
  backend,
  onClose,
  onRetry,
  onReauthorize,
  onRefresh
}: {
  entry: McpStatusEntry
  t: Translate
  credentials?: CredentialApi
  /** The mount backend; `host` cannot enforce tool filters. */
  backend: 'builtin' | 'host'
  onClose: () => void
  onRetry: (entryId: string) => Promise<McpStatusEntry>
  onReauthorize: (id: string, serverName: string) => Promise<McpStatusEntry>
  onRefresh: (id: string) => Promise<McpStatusEntry>
}): ReactNode {
  const [pending, setPending] = useState(false)
  const [confirmAuth, setConfirmAuth] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  const [toolBusy, setToolBusy] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [toolSearch, setToolSearch] = useState('')
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [enabledBusy, setEnabledBusy] = useState(false)
  const actions = mcpDetailActions(entry)
  const guidance = mcpGuidanceKey(entry.code, entry.reason)
  const tools = mcpToolRows(entry)
  const needle = toolSearch.trim().toLowerCase()
  const matchingTools = needle === '' ? tools : tools.filter(tool => tool.name.toLowerCase().includes(needle))
  const shownTools = toolsExpanded ? matchingTools : matchingTools.slice(0, TOOL_PAGE_SIZE)
  const hiddenToolCount = matchingTools.length - shownTools.length
  // A foreign mount belongs to another owner, and a host-observed row has no
  // declaration here, so those tool lists stay read-only; a declared server
  // keeps a switch per tool.
  /** A server this plugin owns: it can be edited, probed, and have its tools chosen. */
  const editableServer = entry.suiteId !== undefined && entry.serverKey !== undefined && entry.state !== 'foreign'
  const toolsEditable = editableServer
  const toggleTool = (tool: string, enabled: boolean): void => {
    const suiteId = entry.suiteId
    const serverKey = entry.serverKey
    if (suiteId === undefined || serverKey === undefined) return
    setToolBusy(true)
    setFeedback(undefined)
    void setMcpServerTool(suiteId, serverKey, tool, enabled)
      .then(() => onRefresh(entry.id))
      .catch(reason => setFeedback({ error: true, text: clientErrorMessage(t, reason) }))
      .finally(() => setToolBusy(false))
  }
  /** Switch the whole server on or off through the same override the card's switch writes. */
  const toggleEnabled = (): void => {
    const suiteId = entry.suiteId
    const serverKey = entry.serverKey
    if (suiteId === undefined || serverKey === undefined) return
    setEnabledBusy(true)
    setFeedback(undefined)
    void setMcpServerEnabled(suiteId, serverKey, entry.state === 'disabled')
      .then(() => onRefresh(entry.id))
      .catch(reason => setFeedback({ error: true, text: clientErrorMessage(t, reason) }))
      .finally(() => setEnabledBusy(false))
  }
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
      actions.reauthorize
        ? h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              disabled: pending,
              title: t('mcpReauthExplain'),
              onClick: () => {
                setConfirmAuth(true)
                setFeedback(undefined)
              }
            },
            t('mcpReauthorize')
          )
        : null,
      h(Button, { variant: 'ghost', disabled: pending, onClick: onClose }, t('mcpClose')),
      // The one switch reads last, at the action cluster's trailing edge.
      entry.suiteId === undefined || entry.serverKey === undefined
        ? null
        : h(Switch, {
            checked: entry.state !== 'disabled',
            disabled: pending || enabledBusy,
            label: t('mcpEnabledLabel'),
            title: t('mcpEnabledLabel'),
            onChange: () => toggleEnabled()
          })
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
                disabled: pending,
                onClick: () => {
                  void run(true)
                }
              },
              t('mcpConfirmReauth')
            )
          )
        : null,
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
        : entry.reason === undefined && !actions.retry
          ? null
          : h(
              'div',
              { className: css.reasonBox },
              entry.reason === undefined ? null : h('span', { className: css.reasonLabel }, t('mcpReasonLabel')),
              entry.reason === undefined ? null : h('p', { className: css.reasonText }, entry.reason),
              guidance === undefined ? null : h('p', { className: css.reasonHint }, t(MCP_GUIDANCE_LABEL[guidance])),
              // The state names one way out; the dialog footer keeps the rest.
              actions.retry
                ? h(
                    'div',
                    { className: css.reasonActions },
                    h(
                      Button,
                      {
                        variant: 'outline',
                        size: 'sm',
                        disabled: pending,
                        title: t('mcpRetryPreservesCredentials'),
                        onClick: () => {
                          void run(false)
                        }
                      },
                      h(IconRefreshOutline16),
                      t('mcpRetryConnection')
                    )
                  )
                : null
            ),
      entry.kind === 'direct' && !entry.managed ? h('div', { className: css.reasonBox }, h('p', { className: css.reasonText }, t('mcpDirectBoundary'))) : null,
      h(
        'div',
        { className: panelCss.block },
        h(
          'div',
          { className: css.blockHeadRow },
          h('h4', { className: panelCss.blockHead }, `${t('mcpTools')} (${tools.length})`),
          // A long capability list is worth filtering; a short one needs no
          // control above it.
          tools.length > TOOL_PAGE_SIZE
            ? h(
                'label',
                { className: css.toolSearch },
                h(Input, {
                  icon: h(IconSearchOutline16),
                  value: toolSearch,
                  placeholder: t('mcpToolsSearch'),
                  'aria-label': t('mcpToolsSearch'),
                  onChange: (event: { target: { value: string } }) => setToolSearch(event.target.value)
                })
              )
            : null
        ),
        toolsEditable && backend === 'host' ? h('p', { className: css.blockSub }, t('mcpHostToolsUnsupported')) : null,
        tools.length === 0
          ? h('p', { className: panelCss.detailProse }, entry.advertisedTools === false && entry.state === 'degraded' ? t('mcpZeroTools') : t('mcpNoTools'))
          : matchingTools.length === 0
            ? h('p', { className: panelCss.detailProse }, t('mcpToolsNoMatch'))
            : h(
                'div',
                { className: css.toolList },
                shownTools.map(tool =>
                  h(
                    'div',
                    { key: tool.name, className: css.tool },
                    h(
                      'span',
                      { className: css.toolIdentity },
                      toolsEditable
                        ? h('input', {
                            type: 'checkbox',
                            checked: tool.allowed,
                            disabled: toolBusy || tool.suiteLimited || backend === 'host',
                            'aria-label': `${t('mcpAllowTool')} ${tool.name}`,
                            onChange: (event: { target: HTMLInputElement }) => toggleTool(tool.name, event.target.checked)
                          })
                        : null,
                      // A name with a schema is the control that reveals what the tool takes.
                      tool.parameters === undefined
                        ? h('span', { className: css.toolName }, tool.name)
                        : h(
                            'button',
                            {
                              type: 'button',
                              className: `${css.toolName} ${css.toolNameButton}`,
                              'aria-expanded': expandedTools[tool.name] === true,
                              onClick: () => setExpandedTools(current => ({ ...current, [tool.name]: current[tool.name] !== true }))
                            },
                            tool.name
                          )
                    ),
                    h('span', { className: css.toolDescription }, tool.description ?? ''),
                    h('span', { className: css.toolNote }, tool.suiteLimited ? t('mcpToolSuiteLimited') : ''),
                    expandedTools[tool.name] === true ? h('div', { className: css.toolParams }, toolParameterRows(tool.parameters, t)) : null
                  )
                ),
                hiddenToolCount > 0
                  ? h(
                      'button',
                      { type: 'button', className: css.toolMore, onClick: () => setToolsExpanded(true) },
                      t('mcpToolsMore', { count: hiddenToolCount })
                    )
                  : null
              )
      ),
      entry.credentialRefs?.length === 0 || entry.credentialRefs === undefined
        ? null
        : h(McpCredentialEditor, { t, api: credentials, refs: entry.credentialRefs, usage: credentialUsage(t, entry.config) })
    )
  })
}

/**
 * The editor dialog: one scroll column of form fields, opened from the detail
 * dialog's service-configuration block. Reporting and changing live in separate
 * dialogs, so neither has to share the other's layout.
 */
export function McpConfigModal({ entry, t, onClose, onSaved }: { entry: McpStatusEntry; t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  return h(DetailModal, {
    open: true,
    title: t('mcpEditTitle'),
    description: entry.name,
    closeLabel: t('cancel'),
    onClose,
    // The same width the add dialog uses: one form, one shape.
    size: 'md',
    contentClassName: css.detailBody,
    footer: h('div', { className: css.modalFooter }, h(Button, { variant: 'ghost', onClick: onClose }, t('cancel'))),
    children: h(ServerConfigDetail, { kind: 'mcp', id: entry.id, t, onSaved })
  })
}

function McpAddModal({ t, onClose, onSaved, onChanged }: { t: Translate; onClose: () => void; onSaved: () => void; onChanged?: () => void }): ReactNode {
  const [name, setName] = useState('')
  const [config, setConfig] = useState('{"type":"stdio","command":""}')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>()
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string>()
  const [overwrite, setOverwrite] = useState(false)
  const [pasteOutcome, setPasteOutcome] = useState<{ imported: string[]; skipped: Array<{ name: string; reason: string }> }>()
  // Parsed on every render: the preview and the import button read the same
  // result, and a half-typed paste simply offers no action yet.
  const pasted = pasteOpen && pasteText.trim() !== '' ? parsePastedServersOrUndefined(pasteText) : undefined
  const applyTemplate = (template: McpTemplate): void => {
    setConfig(JSON.stringify(template.config, null, 2))
    setTemplatesOpen(false)
    setPasteError(undefined)
  }
  const applyPaste = (): void => {
    try {
      const pasted = parsePastedServer(pasteText)
      if (pasted.name !== undefined && name.trim() === '') setName(pasted.name)
      setConfig(JSON.stringify(pasted.config, null, 2))
      setPasteOpen(false)
      setPasteError(undefined)
    } catch (reason) {
      setPasteError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const runImport = (): void => {
    if (pasted === undefined) return
    const named = pasted.filter((entry): entry is { name: string; config: ServerConfig } => entry.name !== undefined && entry.name !== '')
    const unnamed = pasted.length - named.length
    if (named.length === 0) {
      setPasteOutcome({ imported: [], skipped: [{ name: '—', reason: t('mcpPasteUnnamed') }] })
      return
    }
    setBusy(true)
    setPasteError(undefined)
    setPasteOutcome(undefined)
    void importMcpServers(
      named.map(entry => ({ name: entry.name, config: entry.config })),
      overwrite
    )
      .then(result => {
        const skipped = [...result.skipped, ...(unnamed === 0 ? [] : [{ name: '—', reason: t('mcpPasteUnnamed') }])]
        setPasteOutcome({ imported: result.imported, skipped })
        if (result.imported.length > 0) onChanged?.()
      })
      .catch(reason => setPasteError(clientErrorMessage(t, reason)))
      .finally(() => setBusy(false))
  }
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    setFieldErrors(undefined)
    void Promise.resolve()
      .then(() => addMcpServer(name.trim(), parseServerConfig(config)))
      .then(onSaved)
      .catch(caught => {
        setError(clientErrorMessage(t, caught))
        setFieldErrors(fieldErrorsOf(caught))
      })
      .finally(() => setBusy(false))
  }
  return h(DetailModal, {
    open: true,
    title: t('mcpAddTitle'),
    // A short form: the dialog takes the form width, not the detail width.
    size: 'md',
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
      // Two ways in that skip the form: a known service, or a definition copied
      // from another client's configuration file.
      h(
        'div',
        { className: css.starter },
        h(
          Button,
          { variant: 'outline', size: 'sm', type: 'button', disabled: busy, 'aria-expanded': templatesOpen, onClick: () => setTemplatesOpen(value => !value) },
          t('mcpStarterTemplates')
        ),
        h(
          Button,
          { variant: 'outline', size: 'sm', type: 'button', disabled: busy, 'aria-expanded': pasteOpen, onClick: () => setPasteOpen(value => !value) },
          t('mcpStarterPaste')
        )
      ),
      templatesOpen
        ? h(
            'div',
            { className: css.starterList },
            ...MCP_TEMPLATES.map(template =>
              h(Button, { key: template.id, variant: 'ghost', size: 'sm', type: 'button', disabled: busy, onClick: () => applyTemplate(template) }, t(template.labelKey))
            )
          )
        : null,
      pasteOpen
        ? h(
            'div',
            { className: css.starterPaste },
            h('textarea', {
              className: css.pasteArea,
              value: pasteText,
              spellCheck: false,
              'aria-label': t('mcpStarterPaste'),
              placeholder: t('mcpPastePlaceholder'),
              disabled: busy,
              onChange: (event: { target: { value: string } }) => {
                setPasteText(event.target.value)
                setPasteOutcome(undefined)
                setPasteError(undefined)
              }
            }),
            pasted === undefined ? null : h('p', { className: css.pasteNote }, t('mcpPasteFound', { count: pasted.length })),
            h(
              'div',
              { className: css.starter },
              // One definition can also be reviewed in the form; a whole map is
              // imported as it stands.
              pasted !== undefined && pasted.length === 1
                ? h(Button, { variant: 'outline', size: 'sm', type: 'button', disabled: busy, onClick: applyPaste }, t('mcpPasteApply'))
                : null,
              pasted === undefined
                ? null
                : h(Button, { variant: 'primary', size: 'sm', type: 'button', disabled: busy, onClick: runImport }, t('mcpPasteImport'))
            ),
            pasted !== undefined && pasted.length > 1
              ? h(
                  'label',
                  { className: css.pasteCheck },
                  h('input', { type: 'checkbox', checked: overwrite, disabled: busy, onChange: (event: { target: { checked: boolean } }) => setOverwrite(event.target.checked) }),
                  ' ',
                  t('mcpPasteOverwrite')
                )
              : null,
            pasteOutcome === undefined
              ? null
              : h(
                  'div',
                  { className: css.pasteOutcome },
                  pasteOutcome.imported.length === 0 ? null : h('p', null, t('mcpPasteImported', { names: pasteOutcome.imported.join(', ') })),
                  pasteOutcome.skipped.length === 0
                    ? null
                    : h('p', null, t('mcpPasteSkipped', { detail: pasteOutcome.skipped.map(entry => `${entry.name} (${entry.reason})`).join(', ') }))
                ),
            pasteError === undefined ? null : h('div', { role: 'alert', className: css.error }, pasteError)
          )
        : null,
      h(ServerConfigEditor, {
        kind: 'mcp',
        text: config,
        onChange: setConfig,
        t,
        disabled: busy,
        createMode: true,
        ...(fieldErrors === undefined ? {} : { fieldErrors }),
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
function toolParameterRows(parameters: unknown, t: Translate): ReactNode {
  const schema = (parameters ?? {}) as { properties?: unknown; required?: unknown }
  const properties = schema.properties
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties) || Object.keys(properties).length === 0) {
    return h('p', { className: css.toolParamsEmpty }, t('mcpToolNoParameters'))
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [])
  return h(
    'div',
    { className: css.toolParamsGrid },
    ...Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
      const node = (raw ?? {}) as Record<string, unknown>
      const type = typeof node.type === 'string' ? node.type : Array.isArray(node.enum) ? 'enum' : 'any'
      return h(
        'div',
        { key: name, className: css.toolParam },
        h('span', { className: css.toolParamName }, name),
        h('span', { className: css.toolParamType }, type),
        h('span', { className: css.toolParamRequired }, required.has(name) ? t('mcpToolParamRequired') : ''),
        h('span', { className: css.toolParamDesc }, typeof node.description === 'string' ? node.description : '')
      )
    })
  )
}

/** Parse a pasted document, or nothing while it is still half-typed. */
function parsePastedServersOrUndefined(text: string): Array<{ name?: string; config: ServerConfig }> | undefined {
  try {
    return parsePastedServers(text)
  } catch {
    return undefined
  }
}

function credentialUsage(t: Translate, config: Record<string, unknown> | undefined): Record<string, string[]> {
  const usage: Record<string, string[]> = {}
  if (config === undefined) return usage
  for (const [field, label] of [
    ['headers', t('detailHeaders')],
    ['env', t('detailEnv')]
  ] as const) {
    const values = config[field]
    if (typeof values !== 'object' || values === null) continue
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g)) {
        const name = match[1]
        if (name === undefined) continue
        const entries = usage[name] ?? []
        entries.push(`${label} ${key}`)
        usage[name] = entries
      }
    }
  }
  return usage
}
