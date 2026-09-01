/**
 * LSP status panel: declared language servers of enabled suites with their
 * mount state. Rows come from the declaration-and-diagnostic model — the DSH
 * `ctx.lsp` seam has no provider snapshot, so "mounted" means the mount
 * registration succeeded, not that a process probe ran.
 *
 * Visual language mirrors McpStatusPanel: the same shared SearchFilterToolbar,
 * the same summary chips, cards, and state pills from mcp-status.module.css.
 * Cards stay lean (state dot + name + command + one state pill); the source
 * suite and the full extension map live in the detail dialog.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './index.js'
import { fetchLspServers, fetchLspStatus, saveLspServers, type LspStatusEntry, type LspStatusPayload, type LspStatusState } from './api.js'
import { SearchFilterToolbar, type SearchFilterToolbarView } from './SearchFilterToolbar.js'
import css from './mcp-status.module.css'

interface LspStatusPanelProps {
  t: Translate
}

const EMPTY_STATUS: LspStatusPayload = {
  entries: [],
  observedAt: '',
  totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 },
  hostMissing: true
}

type Filter = 'all' | 'plugin' | 'direct' | 'blocked'

const FILTER_KEYS: Filter[] = ['all', 'plugin', 'direct', 'blocked']

const FILTER_LABEL_KEYS: Record<Filter, 'lspAll' | 'lspPlugin' | 'lspDirect' | 'lspBlocked'> = {
  all: 'lspAll',
  plugin: 'lspPlugin',
  direct: 'lspDirect',
  blocked: 'lspBlocked'
}

/** Tooltip text per filter: the counts alone do not explain the grouping. */
const FILTER_HINT_KEYS: Partial<Record<Filter, 'lspFilterAllHint' | 'lspFilterPluginHint' | 'lspFilterDirectHint' | 'lspFilterBlockedHint'>> = {
  all: 'lspFilterAllHint',
  plugin: 'lspFilterPluginHint',
  direct: 'lspFilterDirectHint',
  blocked: 'lspFilterBlockedHint'
}
function matches(entry: LspStatusEntry, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'plugin' || filter === 'direct') return entry.kind === filter
  return entry.state === 'host-missing' || entry.state === 'conflict' || entry.state === 'failed'
}

function severity(entry: LspStatusEntry): number {
  if (entry.state === 'failed') return 0
  if (entry.state === 'conflict') return 1
  if (entry.state === 'host-missing') return 2
  if (entry.state === 'starting') return 3
  if (entry.state === 'disabled') return 4
  return 5
}

/** Language-server inventory with per-state overview and per-server detail. */
export function LspStatusPanel({ t }: LspStatusPanelProps): ReactNode {
  const [payload, setPayload] = useState<LspStatusPayload>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<SearchFilterToolbarView>('grid')
  const [selected, setSelected] = useState<LspStatusEntry | undefined>(undefined)
  const [editorOpen, setEditorOpen] = useState(false)

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchLspStatus()
      .then(setPayload)
      .catch(caught => {
        setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  // Startup follows a race: the reconciler mounts LSP servers in the host
  // process after discovery, so an early read can observe `starting` rows.
  // Poll quietly until every row settles (or the window closes) instead of
  // freezing a stale verdict on screen.
  const anyStarting = payload.entries.some(entry => entry.state === 'starting')
  useEffect(() => {
    if (!anyStarting) return
    let cancelled = false
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      if (cancelled || attempts > 20) {
        clearInterval(timer)
        return
      }
      fetchLspStatus()
        .then(value => {
          if (!cancelled) setPayload(value)
        })
        .catch(() => {})
    }, 1_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [anyStarting])

  const needle = search.trim().toLowerCase()
  const counts = FILTER_KEYS.reduce<Record<string, number>>((acc, key) => {
    acc[key] = payload.entries.filter(entry => matches(entry, key)).length
    return acc
  }, {})
  const visible = payload.entries
    .filter(entry => matches(entry, filter))
    .filter(entry => needle === '' || `${entry.serverKey} ${entry.suiteName} ${entry.command}`.toLowerCase().includes(needle))
  const settled = payload.entries.filter(entry => entry.state !== 'starting')
  const allHealthy = settled.length > 0 && settled.every(entry => entry.state === 'mounted')

  return h(
    'div',
    { className: css.surface },
    h(
      'header',
      { className: css.header },
      h(
        'div',
        { className: css.headerText },
        h('h2', { className: css.title }, t('lspStatusTitle')),
        h('p', { className: css.subtitle }, t('lspStatusSubtitle'))
      ),
      h(
        'div',
        { className: css.headerActions },
        h(Button, { variant: 'ghost', size: 'sm', onClick: () => setEditorOpen(true), disabled: loading, title: t('lspConfigure') }, t('lspConfigure')),
        h(Button, { variant: 'ghost', size: 'sm', onClick: refresh, disabled: loading, title: t('refresh') }, `↻ ${t('refresh')}`)
      )
    ),
    // The summary bar appears only when attention is needed; a healthy panel
    // is silent (the green card accents already say "mounted").
    allHealthy || payload.entries.length === 0 || loading
      ? null
      : h(
          'div',
          { className: css.summaryBar },
          payload.hostMissing
            ? h('span', { className: `${css.summaryChip} ${css.chipblocked}`, title: t('lspHostMissing') }, t('lspHostMissingShort'))
            : ([
                { key: 'failed', count: payload.totals.failed, label: t('lspFailed') },
                { key: 'blocked', count: payload.totals.blocked, label: t('lspBlocked') },
                { key: 'disabled', count: payload.totals.disabled, label: t('lspDisabled') }
              ] as Array<{ key: string; count: number; label: string }>)
                .filter(chip => chip.count > 0)
                .map(chip =>
                  h(
                    'span',
                    { key: chip.key, className: `${css.summaryChip} ${css[`chip${chip.key}`]}`, title: `${chip.count} ${chip.label}` },
                    h('span', { className: css.summaryCount }, chip.count),
                    h('span', { className: css.summaryLabel }, chip.label)
                  )
                ),
          h('span', { className: css.observedAt }, formatObservedAt(payload.observedAt))
        ),
    h(SearchFilterToolbar, {
      className: css.toolbar,
      search,
      searchLabel: t('lspSearch'),
      searchPlaceholder: t('lspSearch'),
      onSearchChange: setSearch,
      filters: FILTER_KEYS.map(key => ({
        id: key,
        label: t(FILTER_LABEL_KEYS[key]),
        count: counts[key] ?? 0,
        icon: h(LspFilterIcon, { k: key }),
        active: filter === key,
        onSelect: () => setFilter(key),
        hint: FILTER_HINT_KEYS[key] === undefined ? undefined : t(FILTER_HINT_KEYS[key]!)
      })),
      view,
      gridLabel: t('grid'),
      listLabel: t('list'),
      onViewChange: nextView => setView(nextView)
    }),
    error !== undefined
      ? h('div', { className: css.error }, error, h(Button, { variant: 'ghost', size: 'sm', onClick: refresh }, t('mcpRetry')))
      : loading && payload.entries.length === 0
        ? h('div', { className: css.empty }, t('loading'))
        : visible.length === 0
          ? h('div', { className: css.empty }, t('lspEmpty'))
          : h(
              'div',
              { className: view === 'grid' ? css.grid : css.list },
              [...visible].sort((left, right) => severity(left) - severity(right)).map(entry => h(LspRow, { key: entry.id, entry, t, onOpen: () => setSelected(entry) }))
            ),
    selected === undefined ? null : h(LspDetailModal, { entry: selected, t, onClose: () => setSelected(undefined) }),
    editorOpen
      ? h(LspConfigEditor, {
          t,
          onClose: () => setEditorOpen(false),
          onSaved: () => {
            setEditorOpen(false)
            refresh()
          }
        })
      : null
  )
}

/**
 * Direct LSP configuration editor: one JSON document shaped like Claude
 * Code's `lspServers` table. The host validates with the same fail-closed
 * rules as suite declarations and mounts direct servers on the next
 * reconcile pass.
 */
function LspConfigEditor({ t, onClose, onSaved }: { t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  const [text, setText] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetchLspServers()
      .then(servers => {
        if (cancelled) return
        setText(JSON.stringify({ lspServers: servers }, null, 2))
      })
      .catch(reason => {
        if (cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const parsed: unknown = JSON.parse(text ?? '')
      await saveLspServers(parsed)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return h(Modal, {
    open: true,
    onClose,
    title: t('lspConfigure'),
    description: t('lspConfigureHint'),
    closeLabel: t('cancel'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h(Button, { variant: 'ghost', onClick: onClose }, t('cancel')),
      h(Button, { variant: 'primary', disabled: busy || text === undefined, onClick: () => { void save() } }, t('lspSave'))
    ),
    children: h(
      'div',
      { className: css.detail },
      error === undefined ? null : h('div', { className: css.error }, error),
      text === undefined
        ? h('div', { className: css.empty }, t('loading'))
        : h('textarea', {
            className: css.config,
            rows: 16,
            spellcheck: false,
            value: text,
            onChange: (event: { target: { value: string } }) => setText(event.target.value)
          })
    )
  })
}

/** Lean row: state dot, server key, command. The card accent + status dot
 *  carry the state; no redundant pill for the healthy case. Kind badge shows
 *  where the declaration comes from (suite vs user configuration). */
function LspRow({ entry, t, onOpen }: { entry: LspStatusEntry; t: Translate; onOpen: () => void }): ReactNode {
  const interactive = {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen()
    }
  }
  const showPill = entry.state !== 'mounted'
  return h(
    'div',
    { className: `${css.card} ${css[`card${accentClass(entry.state)}`]}`, ...interactive },
    h(
      'div',
      { className: css.cardBody },
      h(
        'div',
        { className: css.cardTop },
        h('span', { className: `${css.statusDot} ${css[`status${dotClass(entry.state)}`]}`, 'aria-hidden': true }),
        h('span', { className: css.service }, h('span', { className: css.name }, entry.serverKey)),
        entry.kind === 'plugin'
          ? h('span', { className: css.sourcePlugin }, entry.suiteName)
          : h('span', { className: css.sourceDirect }, t('lspDirect')),
        showPill ? h('span', { className: `${css.statePill} ${css[`state${pillClass(entry.state)}`]}` }, stateLabel(t, entry.state)) : null
      ),
      h('p', { className: css.endpoint }, [entry.command, ...entry.args].join(' '))
    )
  )
}

function LspDetailModal({ entry, t, onClose }: { entry: LspStatusEntry; t: Translate; onClose: () => void }): ReactNode {
  const extensions = Object.entries(entry.extensions)
  return h(Modal, {
    open: true,
    onClose,
    title: entry.serverKey,
    description: t('lspDetailSubtitle'),
    closeLabel: t('cancel'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h('div', { className: css.modalFooter }, h(Button, { variant: 'ghost', onClick: onClose }, t('cancel'))),
    children: h(
      'div',
      { className: css.detail },
      h(
        'div',
        { className: css.detailHero },
        h('span', { className: `${css.statusDot} ${css[`status${dotClass(entry.state)}`]}`, 'aria-hidden': true }),
        h(
          'div',
          { className: css.detailHeroText },
          // The status dot carries the healthy verdict; only non-healthy
          // states get an explicit pill.
          entry.state === 'mounted' ? null : h('span', { className: `${css.statePill} ${css[`state${pillClass(entry.state)}`]}` }, stateLabel(t, entry.state)),
          h('p', { className: css.detailEndpoint }, `${entry.suiteName} · ${entry.sourceId}`)
        )
      ),
      entry.reason === undefined
        ? null
        : h(
            'div',
            { className: css.reasonBox },
            h('span', { className: css.reasonLabel }, t('lspReasonLabel')),
            h('p', { className: css.reasonText }, entry.reason)
          ),
      h(
        'section',
        { className: css.detailSection },
        h('h4', { className: css.detailHead }, t('lspDetailCommand')),
        h('pre', { className: css.config }, [entry.command, ...entry.args].join(' '))
      ),
      h(
        'section',
        { className: css.detailSection },
        h('h4', { className: css.detailHead }, `${t('lspDetailExtensions')} (${extensions.length})`),
        h(
          'div',
          { className: css.toolList },
          extensions.map(([ext, languageId]) =>
            h(
              'div',
              { key: ext, className: css.extRow },
              h('span', { className: css.extName }, ext),
              h('span', { className: css.extArrow, 'aria-hidden': true }, '→'),
              h('span', { className: css.extLanguage }, languageId)
            )
          )
        )
      )
    )
  })
}

/** Filter icons mirroring McpFilterIcon's language: shared glyph shapes for
 *  all/plugin/direct so the two panels read as one system, plus a warning
 *  triangle for the blocked state. */
function LspFilterIcon({ k }: { k: string }): ReactNode {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  if (k === 'plugin') {
    return h('svg', common, h('path', { d: 'M6 2.5v2H4A1.5 1.5 0 0 0 2.5 6v2h2a1.5 1.5 0 1 1 0 3h-2v2A1.5 1.5 0 0 0 4 14.5h2v-2a1.5 1.5 0 1 1 3 0v2h2a1.5 1.5 0 0 0 1.5-1.5v-2h-2a1.5 1.5 0 1 1 0-3h2V6A1.5 1.5 0 0 0 11 4.5H9v-2a1.5 1.5 0 1 0-3 0Z' }))
  }
  if (k === 'direct') {
    return h('svg', common, h('circle', { cx: 8, cy: 5, r: 2.2 }), h('path', { d: 'M3.5 13c.6-2.2 2.1-3.3 4.5-3.3s3.9 1.1 4.5 3.3' }))
  }
  if (k === 'blocked') {
    return h('svg', common, h('path', { d: 'M8 2.5 14 13H2L8 2.5Z', stroke: 'currentColor', strokeLinejoin: 'round' }), h('path', { d: 'M8 6.5v3M8 11.2v.3', stroke: 'currentColor', strokeLinecap: 'round' }))
  }
  return h('svg', common, h('path', { d: 'M2.5 5 8 2.5 13.5 5 8 7.5 2.5 5Zm0 3L8 10.5 13.5 8M2.5 11 8 13.5 13.5 11' }))
}

/** The card-accent CSS suffix; host-missing uses the warn palette. */
function accentClass(state: LspStatusState): string {
  if (state === 'mounted') return 'Mounted'
  if (state === 'host-missing') return 'HostMissing'
  if (state === 'conflict') return 'Conflict'
  if (state === 'failed') return 'Failed'
  return 'Disabled'
}

/** The status-dot CSS suffix (lowercase state names in the stylesheet). */
function dotClass(state: LspStatusState): string {
  return state === 'host-missing' ? 'host-missing' : state
}

/** The state-pill CSS suffix; conflict borrows the failed palette and
 *  starting borrows the warn palette. */
function pillClass(state: LspStatusState): string {
  if (state === 'conflict') return 'failed'
  if (state === 'starting') return 'host-missing'
  return state
}

function stateLabel(t: Translate, state: LspStatusState): string {
  if (state === 'mounted') return t('lspMounted')
  if (state === 'starting') return t('lspStarting')
  if (state === 'host-missing') return t('lspHostMissingShort')
  if (state === 'failed') return t('lspFailed')
  if (state === 'conflict') return t('lspConflict')
  return t('lspDisabled')
}

function formatObservedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString()
}
