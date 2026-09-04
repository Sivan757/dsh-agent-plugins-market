import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './index.js'
import { fetchMcpStatus, reauthorizeMcpServer, retryMcpMounts, type McpStatusEntry, type McpStatusPayload } from './api.js'
import type { CredentialApi } from './credentials.js'
import { McpCredentialEditor } from './McpCredentialEditor.js'
import { SearchFilterToolbar, type SearchFilterToolbarView } from './SearchFilterToolbar.js'
import { deriveMcpStatusViewModel, type McpStatusFilter } from './features/mcp-status/mcp-status-view-model.js'
import css from './mcp-status.module.css'

interface McpStatusPanelProps {
  t: Translate
  credentials?: CredentialApi
}

type Filter = McpStatusFilter
type ViewMode = SearchFilterToolbarView

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
  const [view, setView] = useState<ViewMode>('grid')
  const [selected, setSelected] = useState<McpStatusEntry | undefined>(undefined)

  const retry = (entryId: string): Promise<boolean> => {
    return retryMcpMounts()
      .then(async () => {
        // The POST only acknowledges that a reconcile ran; the mount's real
        // verdict arrives in the refreshed status, so the outcome echo reads
        // the state instead of trusting the request.
        const refreshed = await fetchMcpStatus().catch(() => undefined)
        if (refreshed !== undefined) setPayload(refreshed)
        return refreshed?.entries.some(entry => entry.id === entryId && entry.state === 'connected') === true
      })
      .catch(async caught => {
        setError(caught instanceof Error ? caught.message : String(caught))
        // Still re-read: the failure may be transport-level while the mount
        // actually settled; the echo follows the observed state.
        const refreshed = await fetchMcpStatus().catch(() => undefined)
        if (refreshed !== undefined) setPayload(refreshed)
        return refreshed?.entries.some(entry => entry.id === entryId && entry.state === 'connected') === true
      })
      .finally(() => setLoading(false))
  }
  const reauthorize = (serverName: string): Promise<void> => {
    return reauthorizeMcpServer(serverName)
      .then(() => retryMcpMounts())
      .then(async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
        const refreshed = await fetchMcpStatus().catch(() => undefined)
        if (refreshed !== undefined) setPayload(refreshed)
      })
  }

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchMcpStatus()
      .then(setPayload)
      .catch(caught => {
        setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  const viewModel = deriveMcpStatusViewModel(payload, filter, search)
  const { activeEntries, filtered, filterCounts, visibleTotals } = viewModel
  // Hide the summary bar entirely while every active row is connected: the
  // green confirmation above an all-green list is noise, not information.
  const allHealthy = activeEntries.length > 0 && visibleTotals.connected === activeEntries.length

  return h(
    'div',
    { className: css.surface },
    h(
      'header',
      { className: css.header },
      h(
        'div',
        { className: css.headerText },
        h('h2', { className: css.title }, t('mcpStatusTitle')),
        h('p', { className: css.subtitle }, t('mcpStatusSubtitle'))
      ),
      h(
        'div',
        { className: css.headerActions },
        h(Button, { variant: 'ghost', size: 'sm', onClick: refresh, disabled: loading, title: t('refresh') }, `↻ ${t('refresh')}`)
      )
    ),
    activeEntries.length === 0 || allHealthy || loading
      ? null
      : h(StatusSummaryBar, { t, totals: visibleTotals, observedAt: payload.observedAt }),
    h(SearchFilterToolbar, {
      className: css.toolbar,
      search,
      searchLabel: t('mcpSearch'),
      searchPlaceholder: t('mcpSearch'),
      onSearchChange: setSearch,
      filters: (['all', 'plugin', 'direct'] as Filter[]).map(kind => ({
        id: kind,
        label: filterLabel(t, kind),
        count: filterCounts[kind],
        icon: h(McpFilterIcon, { kind }),
        active: filter === kind,
        onSelect: () => setFilter(kind),
        hint: mcpFilterHint(t, kind)
      })),
      view,
      gridLabel: t('grid'),
      listLabel: t('list'),
      onViewChange: nextView => setView(nextView)
    }),
    error !== undefined
      ? h('div', { className: css.error }, error, h(Button, { variant: 'ghost', size: 'sm', onClick: refresh }, t('mcpRetry')))
      : loading && activeEntries.length === 0
        ? h('div', { className: css.empty }, t('loading'))
        : filtered.length === 0
          ? h('div', { className: css.empty }, t('mcpEmpty'))
          : h(
              'div',
              { className: view === 'grid' ? css.grid : css.list },
              filtered.map(entry => h(McpCard, { key: entry.id, entry, t, onClick: () => setSelected(entry) }))
            ),
    selected === undefined ? null : h(McpDetailModal, { entry: selected, t, credentials, onClose: () => setSelected(undefined), onRetry: retry, onReauthorize: reauthorize })
  )
}

/**
 * One chip per non-healthy state, shown only when that state is non-zero.
 *
 * The chips are ordered by severity so the first one the eye lands on is the
 * state that most needs attention, and the whole bar collapses to a single
 * "all connected" confirmation when nothing is wrong.
 */
function StatusSummaryBar({ t, totals, observedAt }: { t: Translate; totals: McpStatusPayload['totals']; observedAt: string }): ReactNode {
  const chips: Array<{ key: string; count: number; label: string }> = [
    { key: 'orphaned', count: totals.orphaned, label: t('mcpOrphaned') },
    { key: 'failed', count: totals.failed, label: t('mcpFailed') },
    { key: 'needsCredentials', count: totals.needsCredentials, label: t('mcpNeedsCredentials') },
    { key: 'degraded', count: totals.degraded, label: t('mcpDegraded') },
    { key: 'foreign', count: totals.foreign, label: t('mcpForeign') },
    { key: 'disabled', count: totals.disabled, label: t('mcpDisabled') }
  ].filter(chip => chip.count > 0)

  return h(
    'div',
    { className: css.summaryBar },
    chips.length === 0
      ? h('span', { className: css.summaryAllGood }, h('span', { className: css.summaryDotGreen }), t('mcpAllConnected'))
      : chips.map(chip =>
          h(
            'span',
            { key: chip.key, className: `${css.summaryChip} ${css[`chip${chip.key}`]}`, title: `${chip.count} ${chip.label}` },
            h('span', { className: css[`summaryDot${dotTone(chip.key)}`] }),
            h('span', { className: css.summaryCount }, chip.count),
            h('span', { className: css.summaryLabel }, chip.label)
          )
        ),
    h('span', { className: css.observedAt }, observedAt === '' ? '' : formatObservedAt(observedAt))
  )
}

function dotTone(key: string): string {
  if (key === 'foreign') return 'Info'
  if (key === 'degraded' || key === 'needsCredentials') return 'Warn'
  return 'Red'
}

function formatObservedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString()
}

function McpCard({ entry, t, onClick }: { entry: McpStatusEntry; t: Translate; onClick: () => void }): ReactNode {
  const interactive = { role: 'button' as const, tabIndex: 0, onClick, onKeyDown: (event: { key: string; preventDefault: () => void }) => {
    // Enter and Space activate a role="button" the same way a native one does.
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onClick()
  } }
  return h(
    'div',
    { className: `${css.card} ${css[`card${stateClass(entry.state)}`]}`, ...interactive },
    h(
      'div',
      { className: css.cardBody },
      h(
        'div',
        { className: css.cardTop },
        h('span', { className: `${css.statusDot} ${css[`status${entry.state}`]}`, 'aria-hidden': true }),
        h('span', { className: css.service }, h('span', { className: css.name }, entry.name)),
        h('span', { className: css.toolCount }, entry.tools.length === 1 ? `${entry.tools.length} ${t('mcpTool')}` : `${entry.tools.length} ${t('mcpTools')}`)
      ),
      h('p', { className: css.endpoint }, entry.endpoint ?? t('mcpObservedEndpoint'))
      // Reason text, the state pill, and every action (retry, configure,
      // details) live in the detail dialog: the card keeps only the identity
      // line and the endpoint, so a wall of red cards stays scannable.
    )
  )
}

function stateClass(state: string): string {
  return state
    .split('-')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
    .replace(/^./, char => char.toUpperCase())
}

function McpSourceIcon({ kind }: { kind: 'plugin' | 'direct' }): ReactNode {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  return kind === 'plugin'
    ? h(
        'svg',
        common,
        h('path', {
          d: 'M6 2.5v2H4A1.5 1.5 0 0 0 2.5 6v2h2a1.5 1.5 0 1 1 0 3h-2v2A1.5 1.5 0 0 0 4 14.5h2v-2a1.5 1.5 0 1 1 3 0v2h2a1.5 1.5 0 0 0 1.5-1.5v-2h-2a1.5 1.5 0 1 1 0-3h2V6A1.5 1.5 0 0 0 11 4.5H9v-2a1.5 1.5 0 1 0-3 0Z'
        })
      )
    : h('svg', common, h('circle', { cx: 8, cy: 5, r: 2.2 }), h('path', { d: 'M3.5 13c.6-2.2 2.1-3.3 4.5-3.3s3.9 1.1 4.5 3.3' }))
}

function McpFilterIcon({ kind }: { kind: Filter }): ReactNode {
  if (kind === 'plugin') return h(McpSourceIcon, { kind: 'plugin' })
  if (kind === 'direct') return h(McpSourceIcon, { kind: 'direct' })
  return h(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M2.5 5 8 2.5 13.5 5 8 7.5 2.5 5Zm0 3L8 10.5 13.5 8M2.5 11 8 13.5 13.5 11' })
  )
}

/**
 * The detail dialog owns every action and every long text: state, reason,
 * credentials, config, tools, and the retry control with its in-place result
 * echo. The state pill is dropped entirely — the dot and the reason box carry
 * that information without a second red stamp.
 */
function McpDetailModal({ entry, t, credentials, onClose, onRetry, onReauthorize }: {
  entry: McpStatusEntry
  t: Translate
  credentials?: CredentialApi
  onClose: () => void
  onRetry: (entryId: string) => Promise<boolean>
  onReauthorize: (serverName: string) => Promise<void>
}): ReactNode {
  const [retrying, setRetrying] = useState(false)
  const [retryOutcome, setRetryOutcome] = useState<'success' | 'failure' | undefined>(undefined)
  const [reauthorizing, setReauthorizing] = useState(false)
  const [reauthOutcome, setReauthOutcome] = useState<'success' | 'failure' | undefined>(undefined)
  const retry = (): void => {
    setRetrying(true)
    setRetryOutcome(undefined)
    onRetry(entry.id)
      .then(success => setRetryOutcome(success ? 'success' : 'failure'))
      .catch(() => setRetryOutcome('failure'))
      .finally(() => setRetrying(false))
  }
  const reauthorize = (): void => {
    setReauthorizing(true)
    setReauthOutcome(undefined)
    onReauthorize(entry.name)
      .then(() => setReauthOutcome('success'))
      .catch(() => setReauthOutcome('failure'))
      .finally(() => setReauthorizing(false))
  }
  return h(Modal, {
    open: true,
    onClose,
    title: entry.name,
    description: t('mcpServiceDetail'),
    closeLabel: t('cancel'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      entry.kind === 'direct' || entry.state === 'connected' || entry.state === 'disabled' || entry.state === 'foreign'
        ? null
        : h(
            'span',
            { className: css.retryStack },
            retryOutcome === 'success'
              ? h('span', { className: css.retryEchoSuccess, role: 'status' }, `✓ ${t('mcpRetrySuccess')}`)
              : retryOutcome === 'failure'
                ? h('span', { className: css.retryEchoFailure, role: 'alert' }, `✕ ${t('mcpRetryFailure')}`)
                : null,
            h(
              Button,
              { variant: 'ghost', size: 'sm', disabled: retrying, onClick: retry },
              h('span', { className: retrying ? `${css.retrySpinner} ${css.spinning}` : css.retrySpinner, 'aria-hidden': true }, '↻'),
              retrying ? t('mcpRetrying') : t('mcpRetry')
            )
          ),
      entry.kind === 'plugin'
        ? h(
            'span',
            { className: css.retryStack },
            reauthOutcome === 'success'
              ? h('span', { className: css.retryEchoSuccess, role: 'status' }, `✓ ${t('mcpReauthSuccess')}`)
              : reauthOutcome === 'failure'
                ? h('span', { className: css.retryEchoFailure, role: 'alert' }, `✕ ${t('mcpReauthFailure')}`)
                : null,
            h(
              Button,
              { variant: 'ghost', size: 'sm', disabled: reauthorizing, title: entry.state === 'failed' ? t('mcpConnectHint') : t('mcpReauthHint'), onClick: reauthorize },
              reauthorizing ? t('mcpReauthorizing') : entry.state === 'failed' ? t('mcpConnect') : t('mcpReauthorize')
            )
          )
        : null,
      h(Button, { variant: 'ghost', onClick: onClose }, t('cancel'))
    ),
    children: h(
      'div',
      { className: css.detail },
      h(
        'div',
        { className: css.detailHero },
        h('span', { className: `${css.statusDot} ${css[`status${entry.state}`]}`, 'aria-hidden': true }),
        h(
          'div',
          { className: css.detailHeroText },
          entry.endpoint === undefined ? null : h('p', { className: css.detailEndpoint }, entry.endpoint),
          // Source and transport moved here from the card meta row.
          h('p', { className: css.detailEndpoint }, [
            entry.kind === 'plugin' ? `${t('mcpPlugin')}: ${entry.source ?? '—'}` : t('mcpDirect'),
            entry.transport
          ].join(' · '))
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
          : h(
              'div',
              { className: css.reasonBox },
              h('span', { className: css.reasonLabel }, t('mcpReasonLabel')),
              h('p', { className: css.reasonText }, entry.reason)
            ),
      entry.kind === 'direct' ? h('div', { className: css.reasonBox }, h('p', { className: css.reasonText }, t('mcpDirectBoundary'))) : null,
      entry.credentialRefs?.length === 0 || entry.credentialRefs === undefined ? null : h(McpCredentialEditor, { t, api: credentials, refs: entry.credentialRefs }),
      h(
        'section',
        { className: css.detailSection },
        h('h4', { className: css.detailHead }, t('mcpConfig')),
        entry.config === undefined
          ? h('div', { className: css.detailEmpty }, t('mcpDirectConfigUnavailable'))
          : h('pre', { className: css.config }, JSON.stringify(entry.config, null, 2))
      ),
      h(
        'section',
        { className: css.detailSection },
        h('h4', { className: css.detailHead }, `${t('mcpTools')} (${entry.tools.length})`),
        entry.tools.length === 0
          ? h('div', { className: css.detailEmpty }, entry.advertisedTools === false && entry.state === 'degraded' ? t('mcpZeroTools') : t('mcpNoTools'))
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

function filterLabel(t: Translate, kind: Filter): string {
  if (kind === 'plugin') return t('mcpPlugin')
  if (kind === 'direct') return t('mcpDirect')
  return t('mcpAll')
}

/** Hover/aria explanation for each MCP filter tab. */
function mcpFilterHint(t: Translate, kind: Filter): string {
  if (kind === 'plugin') return t('mcpFilterPluginHint')
  if (kind === 'direct') return t('mcpFilterDirectHint')
  return t('mcpFilterAllHint')
}

