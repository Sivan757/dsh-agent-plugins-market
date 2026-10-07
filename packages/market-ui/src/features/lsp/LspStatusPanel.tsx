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
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, IconEditOutlineMedium, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { ServerConfigModal } from '../../ui/ServerConfigModal.js'
import { PanelHeader, PanelActions } from '../../ui/panel.js'
import type { Translate } from '../../i18n.js'
import {
  fetchLspStatus,
  migrateLspSeam,
  setLspServerEnabled,
  type LspLegacySeam,
  type LspLegacySeamMigration,
  type LspStatusEntry,
  type LspStatusPayload,
  type LspStatusState
} from '../../api.js'
import { SearchFilterToolbar } from '../../ui/SearchFilterToolbar.js'
import { StatusBand, bandTone } from '../../ui/StatusBand.js'
import { failureGuidanceKey } from '../../ui/failure-guidance.js'
import { interactiveCardProps, ResourceCard, ResourceCollection, type ResourceState } from '../../ui/ResourceCard.js'
import { DetailRow, DetailRows, kvCell } from '../../ui/DetailRows.js'
import { useWorkspaceView } from '../../ui/workspace-view.js'
import { LSP_FILTERS, deriveLspStatusViewModel, type LspStatusFilter } from './lsp-status-view-model.js'
import css from '../mcp/mcp-status.module.css'
import rc from '../../ui/resource-card.module.css'
import panelCss from '../../ui/panel.module.css'
import { clientErrorMessage } from '../../ui/error-message.js'
import { withBusyOperation } from '../../ui/busy-operation.js'
import { hintProps, hoverHint } from '../../ui/hover-hint.js'

interface LspStatusPanelProps {
  t: Translate
}

const EMPTY_STATUS: LspStatusPayload = {
  entries: [],
  observedAt: '',
  totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 },
  hostMissing: true
}

/** Filter tab label; the switched-off tab reuses the shared panel wording. */
function lspFilterLabel(t: Translate, kind: LspStatusFilter): string {
  if (kind === 'plugin') return t('lspPlugin')
  if (kind === 'direct') return t('lspDirect')
  if (kind === 'disabled') return t('panelFilterDisabled')
  return t('lspAll')
}

/** Tooltip text per filter: the counts alone do not explain the grouping. */
function lspFilterHint(t: Translate, kind: LspStatusFilter): string {
  if (kind === 'plugin') return t('lspFilterPluginHint')
  if (kind === 'direct') return t('lspFilterDirectHint')
  if (kind === 'disabled') return t('lspFilterDisabledHint')
  return t('lspFilterAllHint')
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
  const [editing, setEditing] = useState<LspStatusEntry>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [seamMigration, setSeamMigration] = useState<LspLegacySeamMigration | undefined>(undefined)
  // One reading mode for the whole panel: the switch lifts to this surface so a
  // single click re-reads every card and the detail dialog under it.

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchLspStatus()
      .then(setPayload)
      .catch(caught => {
        setError(clientErrorMessage(t, caught))
      })
      .finally(() => setLoading(false))
  }

  // Switching a server off keeps its declaration on disk and drops the mount;
  // the failure detail the user saw before is not rewritten.
  const toggle = (entry: LspStatusEntry): void => {
    setError(undefined)
    withBusyOperation(() => setLspServerEnabled(entry.id, entry.state === 'disabled'))
      .then(() => fetchLspStatus())
      .then(setPayload)
      .catch(caught => {
        setError(clientErrorMessage(t, caught))
      })
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
  // The filter tablist names this region, and the host derives its panel id
  // (`<filterId>-<value>-panel`) from the same base the toolbar receives.
  const filterId = 'lsp-status-filter'
  const panelProps = {
    role: 'tabpanel' as const,
    id: `${filterId}-${filter}-panel`,
    'aria-labelledby': `${filterId}-${filter}`
  }

  return h(
    'div',
    { className: css.surface },
    // The tab row already names this panel; the description is the part that
    // says something the tab does not.
    h(PanelHeader, {
      subtitle: t('lspStatusSubtitle'),
      actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: () => setEditorOpen(true), refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
    }),
    payload.legacySeam === undefined
      ? seamMigration === undefined
        ? null
        : h(SeamResult, { result: seamMigration, t })
      : h(SeamBanner, {
          seam: payload.legacySeam,
          t,
          onMigrated: result => {
            setSeamMigration(result)
            refresh()
          }
        }),
    h(SearchFilterToolbar, {
      className: css.toolbar,
      search,
      searchLabel: t('lspSearch'),
      searchPlaceholder: t('lspSearch'),
      onSearchChange: setSearch,
      filters: LSP_FILTERS.map(key => ({
        id: key,
        label: lspFilterLabel(t, key),
        count: filterCounts[key],
        active: filter === key,
        onSelect: () => setFilter(key),
        hint: lspFilterHint(t, key)
      })),
      // The panel's own title names the filter segment for assistive tech.
      filterId,
      filterLabel: t('lspStatusTitle'),
      view,
      toListLabel: t('switchToList'),
      toGridLabel: t('switchToGrid'),
      onViewChange: nextView => setView(nextView)
    }),
    error !== undefined
      ? h('div', { className: css.error, ...panelProps }, error, h(Button, { variant: 'ghost', size: 'sm', onClick: refresh }, t('mcpRetry')))
      : loading && payload.entries.length === 0
        ? h('div', { className: css.empty, ...panelProps }, t('loading'))
        : filtered.length === 0
          ? h('div', { className: css.empty, ...panelProps }, t('lspEmpty'))
          : h(
              ResourceCollection,
              { view, ...panelProps },
              filtered.map(entry =>
                h(LspRow, {
                  key: entry.id,
                  entry,
                  t,
                  onOpen: () => setSelected(entry),
                  onToggle: () => toggle(entry),
                  onEdit: () => setEditing(entry)
                })
              )
            ),
    selected === undefined
      ? null
      : h(LspDetailModal, {
          entry: selected,
          t,
          onClose: () => {
            setSelected(undefined)
            refresh()
          }
        }),
    // The editor is the dialog the add flow uses, opened from the card's own
    // edit action rather than from inside the detail report.
    editing === undefined ? null : h(LspConfigModal, { entry: editing, t, onClose: () => setEditing(undefined), onSaved: refresh }),
    editorOpen
      ? h(LspAddModal, {
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
 * One-action upgrade repair for a profile that still carries the hand-written
 * LSP layer the pre-self-provisioning instructions asked for. The panel only
 * offers this while a `seam-conflict` is actually reported, and the action
 * edits exactly the one profile named here.
 */
function SeamBanner({ seam, t, onMigrated }: { seam: LspLegacySeam; t: Translate; onMigrated: (result: LspLegacySeamMigration) => void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const migrate = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      onMigrated(await migrateLspSeam(seam.profile))
    } catch (reason) {
      setError(clientErrorMessage(t, reason))
    } finally {
      setBusy(false)
    }
  }

  return h(
    'div',
    { className: css.seamBanner, role: 'status' },
    h('span', { className: css.seamTitle }, t('lspSeamTitle')),
    h('p', { className: css.seamBody }, t('lspSeamBody')),
    h('span', { className: css.seamPathLabel }, t('lspSeamFile')),
    h('p', { className: css.seamPath }, seam.patchPath),
    seam.otherProfiles.length === 0 ? null : h('p', { className: css.seamOther }, `${t('lspSeamOther')} ${seam.otherProfiles.join(', ')}`),
    error === undefined ? null : h('div', { className: css.error }, error),
    h(
      'div',
      { className: css.modalFooter },
      h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => void migrate() }, busy ? t('lspSeamRemoving') : t('lspSeamRemove'))
    )
  )
}

/**
 * The outcome of a removal, held by the panel rather than the banner: the
 * refresh that follows takes the banner away, and the confirmation — with the
 * backup path that makes the edit reversible — must outlive it.
 */
function SeamResult({ result, t }: { result: LspLegacySeamMigration; t: Translate }): ReactNode {
  return h(
    'div',
    { className: css.seamBanner, role: 'status' },
    h('p', { className: css.seamDone }, result.restartRequired ? t('lspSeamRestart') : t('lspSeamDone')),
    h('p', { className: css.seamPath }, `${t('lspSeamBackup')} ${result.backupPath}`)
  )
}

function LspAddModal({ t, onClose, onSaved }: { t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  return h(ServerConfigModal, { kind: 'lsp', t, onClose, onSaved })
}

/** The card dot colour, and the tag tone a non-mounted state renders with. */
function lspDotState(state: LspStatusState): 'done' | 'warning' | 'ongoing' | 'error' | 'idle' {
  if (state === 'mounted') return 'done'
  if (state === 'starting') return 'ongoing'
  if (state === 'failed' || state === 'conflict') return 'error'
  if (state === 'disabled') return 'idle'
  return 'warning'
}

/**
 * The inventory card's state for one row. The detail band derives its edge from
 * this same value, so a server cannot read one colour on its card and another
 * in its detail dialog.
 */
function lspCardState(state: LspStatusState): ResourceState {
  if (state === 'mounted') return 'active'
  if (state === 'disabled') return 'disabled'
  if (state === 'failed' || state === 'conflict') return 'error'
  return 'warning'
}

function lspTagTone(state: LspStatusState): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'mounted') return 'success'
  if (state === 'failed' || state === 'conflict') return 'danger'
  if (state === 'disabled') return 'neutral'
  return 'warning'
}

/**
 * One language-server card: the server key with its state tag on the identity
 * row and the enable switch on its trailing edge; the command on the body row;
 * the declaring suite and the extension count on the source row.
 */
function LspRow({ entry, t, onOpen, onToggle, onEdit }: { entry: LspStatusEntry; t: Translate; onOpen: () => void; onToggle: () => void; onEdit: () => void }): ReactNode {
  const interactive = interactiveCardProps(onOpen)
  const extensions = Object.keys(entry.extensions).length
  const disabled = entry.state === 'disabled'
  return h(
    ResourceCard,
    { state: lspCardState(entry.state), surface: 'lsp', ...interactive },
    h(
      'div',
      { className: rc.rowId },
      hoverHint(entry.serverKey, h('span', hintProps({ className: `${rc.name} ${rc.nameMono}` }), entry.serverKey)),
      // The state rail on the card's leading edge carries the state; a written
      // label beside it would say the same thing twice.
      h('span', { className: rc.provenanceChip }, h(Tag, { tone: 'neutral' }, entry.kind === 'plugin' ? t('lspPlugin') : t('lspDirect')))
    ),
    h(
      'div',
      { className: rc.rowActions },
      // The editor is the dialog the add flow uses; it sits just before the
      // switch, where the row's actions end.
      h(
        'button',
        {
          type: 'button',
          className: rc.iconBtn,
          title: t('panelEdit'),
          'aria-label': `${t('panelEdit')} ${entry.serverKey}`,
          onClick: (event: { stopPropagation(): void }) => {
            event.stopPropagation()
            onEdit()
          }
        },
        h(IconEditOutlineMedium)
      ),
      h(
        'span',
        { className: rc.switchWrap, onClick: (event: { stopPropagation(): void }) => event.stopPropagation() },
        h(Switch, {
          checked: !disabled,
          label: disabled ? t('enable') : t('disable'),
          title: disabled ? t('enable') : t('disable'),
          onChange: onToggle
        })
      )
    ),
    // The card clips this line to one row, so it carries the full command as a hint.
    hoverHint([entry.command, ...entry.args].join(' '), h('p', hintProps({ className: `${rc.rowBody} ${rc.monoLine}` }), [entry.command, ...entry.args].join(' '))),
    h(
      'div',
      { className: rc.rowFoot },
      hoverHint(
        entry.kind === 'plugin' ? entry.suiteName : entry.serverKey,
        h('span', hintProps({ className: rc.provenance }), entry.kind === 'plugin' ? entry.suiteName : t('lspDirect'))
      ),
      h('span', { className: rc.separator }, '·'),
      h('span', { className: rc.count }, h('span', { className: rc.countValue }, String(extensions)), ' ', t('lspExtensionCount'))
    )
  )
}

export function LspDetailModal({ entry, t, onClose }: { entry: LspStatusEntry; t: Translate; onClose: () => void }): ReactNode {
  const guidance = failureGuidanceKey({ code: entry.code, reason: entry.reason, causes: entry.causes })
  return h(DetailModal, {
    open: true,
    onClose,
    title: entry.serverKey,
    closeLabel: t('cancel'),
    contentClassName: css.detailBody,
    footer: h('div', { className: css.modalFooter }, h(Button, { variant: 'ghost', onClick: onClose }, t('detailDone'))),
    children: h(
      'div',
      null,
      h(StatusBand, {
        t,
        dot: lspDotState(entry.state),
        tone: bandTone(lspCardState(entry.state)),
        labels: h(
          Fragment,
          null,
          h(Tag, { tone: lspTagTone(entry.state) }, stateLabel(t, entry.state)),
          h(Tag, null, entry.kind === 'plugin' ? t('lspPlugin') : t('lspDirect')),
          entry.kind === 'plugin' ? h(Tag, { tone: 'quiet' }, entry.suiteName) : null
        ),
        ...(guidance === undefined ? {} : { guidance }),
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(entry.causes === undefined ? {} : { causes: entry.causes }),
        mono: [entry.command, ...entry.args].join(' ')
      }),
      h(
        'div',
        { className: panelCss.block },
        h('h4', { className: panelCss.blockHead }, t('overviewSection')),
        h(
          'dl',
          { className: panelCss.kvGrid },
          kvCell(t('sourceLabel'), entry.kind === 'plugin' ? entry.suiteName : t('lspDirect'), false),
          kvCell(t('detailTypeLabel'), entry.kind === 'plugin' ? t('panelSourcePlugin') : t('panelSourceUser'), false),
          kvCell(t('lspDeclaredInLabel'), entry.kind === 'plugin' ? `lsp.json · ${entry.suiteName}` : 'lsp.json', true)
        )
      ),
      h(
        'div',
        { className: panelCss.block },
        h('h4', { className: panelCss.blockHead }, `${t('detailExtensions')} (${Object.keys(entry.extensions).length})`),
        h(
          DetailRows,
          null,
          ...Object.entries(entry.extensions).map(([extension, language]) => h(DetailRow, { key: extension, name: extension, summary: language, expandable: false }))
        )
      )
    )
  })
}

function LspConfigModal({ entry, t, onClose, onSaved }: { entry: LspStatusEntry; t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  return h(ServerConfigModal, { kind: 'lsp', id: entry.id, t, onClose, onSaved })
}

function stateLabel(t: Translate, state: LspStatusState): string {
  if (state === 'mounted') return t('lspMounted')
  if (state === 'starting') return t('lspStarting')
  if (state === 'host-missing') return t('lspHostMissingShort')
  if (state === 'failed') return t('lspFailed')
  if (state === 'conflict') return t('lspConflict')
  return t('lspDisabled')
}
