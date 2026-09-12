/**
 * LSP status panel: declared language servers of enabled suites with their
 * mount state. Rows come from the declaration-and-diagnostic model — the DSH
 * `ctx.lsp` seam has no provider snapshot, so "mounted" means the mount
 * registration succeeded, not that a process probe ran.
 *
 * Visual language mirrors McpStatusPanel: the same shared SearchFilterToolbar
 * and the same cards, state pills, and detail dialog from mcp-status.module.css.
 * Cards stay lean (state dot + name + command + one state pill); the source
 * suite and the full extension map live in the detail dialog.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './ui/DetailModal.js'
import { ServerConfigEditor } from './ui/ServerConfigEditor.js'
import { ServerConfigDetail } from './ui/ServerConfigDetail.js'
import { parseServerConfig } from './ui/server-form.js'
import { PanelHeader, PanelActions } from './ui/panel.js'
import type { Translate } from './index.js'
import { addLspServer, fetchLspStatus, type LspStatusEntry, type LspStatusPayload, type LspStatusState } from './api.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from './ui/ResourceCard.js'
import { useWorkspaceView } from './ui/workspace-view.js'
import { LSP_FILTERS, deriveLspStatusViewModel, type LspStatusFilter } from './features/lsp-status/lsp-status-view-model.js'
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

const FILTER_LABEL_KEYS: Record<LspStatusFilter, 'lspAll' | 'lspPlugin' | 'lspDirect'> = {
  all: 'lspAll',
  plugin: 'lspPlugin',
  direct: 'lspDirect'
}

/** Tooltip text per filter: the counts alone do not explain the grouping. */
const FILTER_HINT_KEYS: Record<LspStatusFilter, 'lspFilterAllHint' | 'lspFilterPluginHint' | 'lspFilterDirectHint'> = {
  all: 'lspFilterAllHint',
  plugin: 'lspFilterPluginHint',
  direct: 'lspFilterDirectHint'
}

/** Language-server inventory with per-state overview and per-server detail. */
export function LspStatusPanel({ t }: LspStatusPanelProps): ReactNode {
  const [payload, setPayload] = useState<LspStatusPayload>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState<LspStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useWorkspaceView()
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
      fetchLspStatus(true)
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

  const { filtered, filterCounts } = deriveLspStatusViewModel(payload, filter, search)

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, { title: t('lspStatusTitle'), subtitle: t('lspStatusSubtitle'), actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: () => setEditorOpen(true), refreshLabel: t('refresh'), onRefresh: refresh, busy: loading }) }),
    h(SearchFilterToolbar, {
      className: css.toolbar,
      search,
      searchLabel: t('lspSearch'),
      searchPlaceholder: t('lspSearch'),
      onSearchChange: setSearch,
      filters: LSP_FILTERS.map(key => ({
        id: key,
        label: t(FILTER_LABEL_KEYS[key]),
        count: filterCounts[key],
        icon: h(LspFilterIcon, { k: key }),
        active: filter === key,
        onSelect: () => setFilter(key),
        hint: t(FILTER_HINT_KEYS[key])
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
        : filtered.length === 0
          ? h('div', { className: css.empty }, t('lspEmpty'))
          : h(
              ResourceCollection,
              { view, className: view === 'grid' ? css.grid : css.list },
              filtered.map(entry => h(LspRow, { key: entry.id, entry, t, onOpen: () => setSelected(entry) }))
            ),
    selected === undefined ? null : h(LspDetailModal, { entry: selected, t, onClose: () => { setSelected(undefined); refresh() } }),
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
  const [text, setText] = useState('{"command":"","extensionToLanguage":{}}')
  const [name, setName] = useState('')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await addLspServer(name.trim(), parseServerConfig(text))
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return h(DetailModal, {
    open: true,
    onClose: busy ? () => {} : onClose,
    title: t('lspAddTitle'),
    closeLabel: t('cancel'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h(Button, { variant: 'ghost', disabled: busy, onClick: onClose }, t('cancel')),
      h(Button, { variant: 'primary', disabled: busy || !valid || name.trim() === '', onClick: () => { void save() } }, t('lspSave'))
    ),
    children: h(
      'div',
      { className: css.detail },
      error === undefined ? null : h('div', { className: css.error }, error),
      h('label', null, t('lspServerName'), h(Input, { value: name, disabled: busy, 'aria-label': t('lspServerName'), onChange: (event: { target: { value: string } }) => setName(event.target.value) })),
      h(ServerConfigEditor, { kind: 'lsp', text, onChange: setText, t, disabled: busy, onValidityChange: setValid })
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
    ResourceCard,
    { className: css.card, state: entry.state === 'mounted' ? 'active' : entry.state === 'disabled' ? 'disabled' : entry.state === 'failed' || entry.state === 'conflict' ? 'error' : 'warning', ...interactive },
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
      h('p', { className: css.endpoint }, [entry.command, ...entry.args].join(' ')),
    )
  )
}

function LspDetailModal({ entry, t, onClose }: { entry: LspStatusEntry; t: Translate; onClose: () => void }): ReactNode {
  return h(DetailModal, {
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
      h(ServerConfigDetail, { kind: 'lsp', id: entry.id, t })
    )
  })
}

/** Filter icons mirroring McpFilterIcon's language: shared glyph shapes for
 *  all/plugin/direct so the two panels read as one system. */
function LspFilterIcon({ k }: { k: LspStatusFilter }): ReactNode {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  if (k === 'plugin') {
    return h('svg', common, h('path', { d: 'M6 2.5v2H4A1.5 1.5 0 0 0 2.5 6v2h2a1.5 1.5 0 1 1 0 3h-2v2A1.5 1.5 0 0 0 4 14.5h2v-2a1.5 1.5 0 1 1 3 0v2h2a1.5 1.5 0 0 0 1.5-1.5v-2h-2a1.5 1.5 0 1 1 0-3h2V6A1.5 1.5 0 0 0 11 4.5H9v-2a1.5 1.5 0 1 0-3 0Z' }))
  }
  if (k === 'direct') {
    return h('svg', common, h('circle', { cx: 8, cy: 5, r: 2.2 }), h('path', { d: 'M3.5 13c.6-2.2 2.1-3.3 4.5-3.3s3.9 1.1 4.5 3.3' }))
  }
  return h('svg', common, h('path', { d: 'M2.5 5 8 2.5 13.5 5 8 7.5 2.5 5Zm0 3L8 10.5 13.5 8M2.5 11 8 13.5 13.5 11' }))
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
