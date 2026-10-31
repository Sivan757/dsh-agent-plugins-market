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
import { Button, IconRefreshOutlineMedium, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { ServerConfigModal } from '../../ui/ServerConfigModal.js'
import { PanelHeader, PanelActions, ReadFailed } from '../../ui/panel.js'
import type { Translate } from '../../i18n.js'
import {
  fetchLspStatus,
  migrateLspSeam,
  restartLspServers,
  setLspServerEnabled,
  type LspLegacySeam,
  type LspLegacySeamMigration,
  type LspStatusEntry,
  type LspStatusPayload,
  type LspStatusState
} from '../../api.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { StatusBand, bandTone } from '../../ui/StatusBand.js'
import { FAILURE_GUIDANCE_LABEL, failureCause, failureGuidanceKey } from '../../ui/failure-guidance.js'
import { type ResourceState } from '../../ui/ResourceCard.js'
import { DetailRow, DetailRows, kvCell } from '../../ui/DetailRows.js'
import css from '../mcp/mcp-status.module.css'
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

/** Language-server inventory with per-state overview and per-server detail. */
export function LspStatusPanel({ t }: LspStatusPanelProps): ReactNode {
  const [payload, setPayload] = useState<LspStatusPayload>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
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

  // A restart is the one action that replaces a provider whose process died
  // underneath its mount: `ctx.lsp` reports no death, so nothing else would
  // ever re-verify that row. It names this row's mount, so a restart in one
  // service's dialog leaves every other language server's work alone. The
  // refreshed row goes back into the dialog, which is also what the echo below
  // the band reports from.
  const restart = (entry: LspStatusEntry): Promise<LspStatusEntry> =>
    restartLspServers(entry.id)
      .then(() => fetchLspStatus(true))
      .then(next => {
        setPayload(next)
        const refreshed = next.entries.find(item => item.id === entry.id) ?? entry
        setSelected(refreshed)
        return refreshed
      })

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

  // The filter tablist names this region, and the host derives its panel id
  // (`<filterId>-<value>-panel`) from the same base the toolbar receives.

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
    error === undefined ? null : h(ReadFailed, { message: error, retryLabel: t('readRetry'), onRetry: refresh }),
    // The shared renderer draws the list; the panel supplies entries, the detail and the editor.
    h(ResourceSurface, {
      t,
      entries: payload.entries.map(entry => ({
        id: entry.id,
        name: entry.serverKey,
        mono: true,
        tag: entry.kind === 'plugin' ? t('lspPlugin') : t('lspDirect'),
        description: entry.command,
        meta: entry.suiteName === undefined ? String(Object.keys(entry.extensions).length) : entry.suiteName,
        // A row that did not mount says why on the card, cause first: the advice
        // after the colon stays in the detail. A mounted row whose last call
        // failed is the other thing this panel can say, because the seam has no
        // death signal.
        ...(() => {
          if (entry.state === 'mounted' || entry.state === 'disabled') {
            return entry.observation === undefined || entry.observation.ok ? {} : { warning: t('lspLastCallShort') }
          }
          const guidance = failureGuidanceKey({ code: entry.code, reason: entry.reason, causes: entry.causes })
          const sentence = guidance === undefined ? entry.reason : t(FAILURE_GUIDANCE_LABEL[guidance])
          return sentence === undefined || sentence === '' ? {} : { warning: failureCause(sentence) }
        })(),
        state: lspCardState(entry.state),
        // The rail is colour only; this is what a screen reader hears.
        stateLabel: stateLabel(t, entry.state)
      })),
      capabilities: { toggle: true },
      searchLabel: t('lspSearch'),
      searchPlaceholder: t('lspSearch'),
      // A status surface earns its tabs from states, not from who declared the
      // row: the declaring suite is a chip the row already prints. Matching the
      // card's own state also drops the old comparison against translated copy.
      // A failed read has no counts to offer, so it has no tabs either.
      filters:
        payload.entries.length === 0 && error !== undefined
          ? []
          : [
              {
                id: 'attention',
                label: t('lspFilterAttention'),
                hint: t('lspFilterAttentionHint'),
                match: entry => entry.state === 'warning' || entry.state === 'error'
              },
              { id: 'disabled', label: t('panelFilterDisabled'), hint: t('lspFilterDisabledHint'), match: entry => entry.state === 'disabled' }
            ],
      // Nothing read is not nothing mounted: the alert says the read failed.
      emptyText: payload.entries.length === 0 && error !== undefined ? t('statusUnreadable') : loading && payload.entries.length === 0 ? t('loading') : t('lspEmpty'),
      onOpen: entryId => {
        const entry = payload.entries.find(item => item.id === entryId)
        if (entry !== undefined) setSelected(entry)
      },
      onToggle: entryId => {
        const entry = payload.entries.find(item => item.id === entryId)
        if (entry !== undefined) toggle(entry)
      },
      onEdit: entryId => {
        const entry = payload.entries.find(item => item.id === entryId)
        if (entry !== undefined) setEditing(entry)
      },
      isOn: entryId => payload.entries.find(item => item.id === entryId)?.state !== 'disabled'
    }),
    selected === undefined
      ? null
      : h(LspDetailModal, {
          entry: selected,
          t,
          onRestart: restart,
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

export function LspDetailModal({
  entry,
  t,
  onClose,
  onRestart
}: {
  entry: LspStatusEntry
  t: Translate
  onClose: () => void
  /** Rebuild this server's mount; absent in a read-only surface, which hides the action. */
  onRestart?: (entry: LspStatusEntry) => Promise<LspStatusEntry>
}): ReactNode {
  const guidance = failureGuidanceKey({ code: entry.code, reason: entry.reason, causes: entry.causes })
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  // A dead process and a failed mount are both replaced by the same rebuild. A
  // disabled, missing-package or conflicting row needs a different repair, so
  // the action is not offered for it.
  const restartable = onRestart !== undefined && (entry.state === 'mounted' || entry.state === 'failed')
  const restart = async (): Promise<void> => {
    if (onRestart === undefined) return
    setPending(true)
    setFeedback(undefined)
    try {
      const next = await onRestart(entry)
      // The reason itself is the band's own from the refreshed row, so this
      // echo only says what the action did.
      setFeedback({ error: next.state === 'failed', text: next.state === 'failed' ? t('lspRestartFailed') : t('lspRestartDone') })
    } catch (reason) {
      setFeedback({ error: true, text: t('actionFail') + ': ' + clientErrorMessage(t, reason) })
    } finally {
      setPending(false)
    }
  }
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
        ...(restartable
          ? {
              action: h(
                Button,
                {
                  variant: 'outline',
                  size: 'sm',
                  disabled: pending,
                  title: t('lspRestartHint'),
                  'aria-label': t('lspRestart'),
                  onClick: () => {
                    void restart()
                  }
                },
                h(IconRefreshOutlineMedium),
                t('lspRestart')
              )
            }
          : {}),
        ...(feedback === undefined ? {} : { echo: feedback }),
        ...(guidance === undefined ? {} : { guidance }),
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(entry.causes === undefined ? {} : { causes: entry.causes }),
        mono: [entry.command, ...entry.args].join(' ')
      }),
      // The last call the host routed to this provider: the only evidence that
      // a mounted server is not answering.
      entry.observation === undefined
        ? null
        : h(
            'div',
            { className: panelCss.block },
            h('h4', { className: panelCss.blockHead }, t('lspLastCall')),
            h('p', { className: panelCss.detailProse }, entry.observation.ok ? t('lspLastCallOk') : t('lspLastCallFailed', { error: entry.observation.error ?? '' }))
          ),
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
