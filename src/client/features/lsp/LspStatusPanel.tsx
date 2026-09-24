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
import { Button, IconEditOutlineMedium, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { ServerConfigEditor } from '../../ui/ServerConfigEditor.js'
import { ServerConfigDetail } from '../../ui/ServerConfigDetail.js'
import { parseServerConfig } from '../../ui/server-form.js'
import { PanelHeader, PanelActions } from '../../ui/panel.js'
import type { Translate } from '../../index.js'
import {
  addLspServer,
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
import { FailureReport } from '../../ui/FailureReport.js'
import { failureGuidanceKey } from '../../ui/failure-guidance.js'
import { ResourceCard, ResourceCollection } from '../../ui/ResourceCard.js'
import { DetailRow, DetailRows } from '../../ui/DetailRows.js'
import { useWorkspaceView } from '../../ui/workspace-view.js'
import { LSP_FILTERS, deriveLspStatusViewModel, type LspStatusFilter } from './lsp-status-view-model.js'
import css from '../mcp/mcp-status.module.css'
import rc from '../../ui/resource-card.module.css'
import panelCss from '../../ui/panel.module.css'
import { clientErrorMessage } from '../../ui/error-message.js'
import { withBusyOperation } from '../../ui/busy-operation.js'

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

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, { title: t('lspStatusTitle'), subtitle: t('lspStatusSubtitle'), actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: () => setEditorOpen(true), refreshLabel: t('refresh'), onRefresh: refresh, busy: loading }) }),
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
      view,
      toListLabel: t('switchToList'),
      toGridLabel: t('switchToGrid'),
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
              { view },
              filtered.map(entry => h(LspRow, { key: entry.id, entry, t, onOpen: () => setSelected(entry), onToggle: () => toggle(entry), onEdit: () => setEditing(entry) }))
            ),
    selected === undefined ? null : h(LspDetailModal, { entry: selected, t, onClose: () => { setSelected(undefined); refresh() } }),
    // The editor is the dialog the add flow uses, opened from the card's own
    // edit action rather than from inside the detail report.
    editing === undefined ? null : h(LspConfigModal, { entry: editing, t, onClose: () => setEditing(undefined), onSaved: refresh }),
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
      setError(clientErrorMessage(t, reason))
    } finally {
      setBusy(false)
    }
  }

  return h(DetailModal, {
    open: true,
    onClose: busy ? () => {} : onClose,
    title: t('lspAddTitle'),
    // A short form: the dialog takes the form width, not the detail width.
    size: 'md',
    closeLabel: t('cancel'),
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h('span', { className: css.modalFooterHint }, t('editorFooterCreate')),
      h('div', { className: css.modalFooterGrow }),
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, t('cancel')),
      h(Button, { variant: 'primary', disabled: busy || !valid || name.trim() === '', onClick: () => { void save() } }, t('editorCreate'))
    ),
    children: h(
      'div',
      { className: css.detail },
      error === undefined ? null : h('div', { className: css.error }, error),
      h(ServerConfigEditor, {
        kind: 'lsp',
        text,
        onChange: setText,
        t,
        disabled: busy,
        createMode: true,
        onValidityChange: setValid,
        nameField: {
          label: t('lspServerName'),
          // A native control from the editors' own form sheet: the platform
          // `Input` draws its own edge, which nested a second box inside the field.
          control: h('input', {
            value: name,
            placeholder: t('lspServerNamePh'),
            disabled: busy,
            'aria-label': t('lspServerName'),
            onChange: (event: { target: { value: string } }) => setName(event.target.value)
          })
        }
      })
    )
  })
}

/** The card dot colour, and the tag tone a non-mounted state renders with. */
function lspDotState(state: LspStatusState): 'done' | 'warning' | 'ongoing' | 'error' | 'idle' {
  if (state === 'mounted') return 'done'
  if (state === 'starting') return 'ongoing'
  if (state === 'failed' || state === 'conflict') return 'error'
  if (state === 'disabled') return 'idle'
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
  const extensions = Object.keys(entry.extensions).length
  const disabled = entry.state === 'disabled'
  return h(
    ResourceCard,
    { state: entry.state === 'mounted' ? 'active' : disabled ? 'disabled' : entry.state === 'failed' || entry.state === 'conflict' ? 'error' : 'warning', surface: 'lsp', ...interactive },
    h(
      'div',
      { className: rc.rowId },
      h('span', { className: `${rc.name} ${rc.nameMono}` }, entry.serverKey),
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
    h('p', { className: `${rc.rowBody} ${rc.monoLine}` }, [entry.command, ...entry.args].join(' ')),
    h(
      'div',
      { className: rc.rowFoot },
      h('span', { className: rc.provenance, title: entry.kind === 'plugin' ? entry.suiteName : entry.serverKey }, entry.kind === 'plugin' ? entry.suiteName : t('lspDirect')),
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
    description: t('lspDetailSubtitle'),
    closeLabel: t('cancel'),
    contentClassName: css.detailBody,
    footer: h('div', { className: css.modalFooter }, h(Button, { variant: 'ghost', onClick: onClose }, t('detailDone'))),
    children: h(
      'div',
      null,
      h(
        'div',
        { className: panelCss.hero },
        h(StateDot, { state: lspDotState(entry.state) }),
        h(
          'div',
          { className: panelCss.heroText },
          h(
            'div',
            { className: panelCss.heroLine },
            h(Tag, { tone: lspTagTone(entry.state) }, stateLabel(t, entry.state)),
            h(Tag, null, entry.kind === 'plugin' ? t('lspPlugin') : t('lspDirect')),
            entry.kind === 'plugin' ? h(Tag, { tone: 'quiet' }, entry.suiteName) : null
          ),
          h('p', { className: panelCss.heroMono }, [entry.command, ...entry.args].join(' '))
        )
      ),
      h(
        'div',
        { className: panelCss.block },
        h('h4', { className: panelCss.blockHead }, t('overviewSection')),
        h(
          'dl',
          { className: panelCss.kvGrid },
          kv(t('sourceLabel'), entry.kind === 'plugin' ? entry.suiteName : t('lspDirect'), false),
          kv(t('detailTypeLabel'), entry.kind === 'plugin' ? t('panelSourcePlugin') : t('panelSourceUser'), false),
          kv(t('lspDeclaredInLabel'), entry.kind === 'plugin' ? `lsp.json · ${entry.suiteName}` : 'lsp.json', true)
        )
      ),
      entry.reason === undefined
        ? null
        : h(
            'div',
            { className: panelCss.block },
            h('h4', { className: panelCss.blockHead }, t('lspReasonLabel')),
            h(FailureReport, {
              t,
              tone: entry.state === 'disabled' ? 'info' : 'error',
              ...(guidance === undefined ? {} : { guidance }),
              detail: [entry.reason, ...(entry.causes ?? [])]
            })
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
      ),
    )
  })
}

/**
 * The editor dialog for one language server: a form of its own, opened from the
 * card's edit action and sharing the add flow's dialog.
 */
function LspConfigModal({ entry, t, onClose, onSaved }: { entry: LspStatusEntry; t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  return h(DetailModal, {
    open: true,
    title: t('lspEditTitle'),
    description: entry.serverKey,
    closeLabel: t('cancel'),
    onClose,
    size: 'md',
    contentClassName: css.detailBody,
    footer: h('div', { className: css.modalFooter }, h(Button, { variant: 'ghost', onClick: onClose }, t('cancel'))),
    children: h(ServerConfigDetail, { kind: 'lsp', id: entry.id, t, onSaved })
  })
}

/** One label/value pair in a detail dialog's overview grid. */
function kv(label: string, value: string, mono = false): ReactNode {
  return h('div', null, h('dt', { className: panelCss.kvKey }, label), h('dd', { className: mono ? `${panelCss.kvValue} ${panelCss.kvValueMono}` : panelCss.kvValue, title: value }, value))
}

function stateLabel(t: Translate, state: LspStatusState): string {
  if (state === 'mounted') return t('lspMounted')
  if (state === 'starting') return t('lspStarting')
  if (state === 'host-missing') return t('lspHostMissingShort')
  if (state === 'failed') return t('lspFailed')
  if (state === 'conflict') return t('lspConflict')
  return t('lspDisabled')
}
