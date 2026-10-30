import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmModal, PanelActions, PanelHeader, type PanelConfirmState } from '../../ui/panel.js'
import type { Translate } from '../../i18n.js'
import type { CredentialApi } from '../../credentials.js'
import { fetchMcpStatus, reauthorizeMcpServer, removeMcpServer, retryMcpMounts, setMcpServerEnabled, type McpStatusEntry, type McpStatusPayload } from '../../api.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { pollUntilTranslated } from '../../ui/translation-settle.js'
import { matchesMcpFilter, MCP_FILTERS, nextConnectionRead, type McpStatusFilter } from './mcp-status-view-model.js'
import { mcpCardState, mcpConnectionNote, mcpDisplayName } from './state-helpers.js'
import { withBusyOperation } from '../../ui/busy-operation.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { BilingualToggle } from '../../ui/BilingualToggle.js'
import { useTranslationRefresh } from '../../ui/translation-enabled.js'
import { McpDetailModal } from './McpDetailModal.js'
import { McpConfigModal } from './McpConfigModal.js'
import { McpAddModal } from './McpAddModal.js'
import css from './mcp-status.module.css'

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
  const [selected, setSelected] = useState<McpStatusEntry | undefined>(undefined)
  const [editing, setEditing] = useState<McpStatusEntry>()
  const [confirmDelete, setConfirmDelete] = useState<PanelConfirmState>()
  const [adding, setAdding] = useState(false)
  // One reading mode for the whole panel: the switch lifts to this surface so a
  // single click re-reads every card and the detail dialog under it.
  const [showOriginal, setShowOriginal] = useState(false)
  const flipOriginal = (): void => setShowOriginal(current => !current)
  const language = t('localeProbeLang')
  const languageRef = useRef(language)
  languageRef.current = language
  const [payloadLanguage, setPayloadLanguage] = useState<string | undefined>()

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

  // One settle poll at a time: every refresh restarts it, and the effect's
  // cleanup stops the previous one so an unmounted panel never keeps polling.
  const settle = useRef<{ stop: () => void } | undefined>(undefined)
  const refreshSequence = useRef(0)
  const acceptPayload = (next: McpStatusPayload): void => {
    setPayload(next)
    setSelected(current => (current === undefined ? undefined : (next.entries.find(entry => entry.id === current.id) ?? current)))
  }

  const refresh = (): void => {
    const sequence = ++refreshSequence.current
    const requestedLanguage = languageRef.current
    setLoading(true)
    setError(undefined)
    settle.current?.stop()
    settle.current = undefined
    fetchMcpStatus()
      .then(next => {
        if (refreshSequence.current !== sequence || languageRef.current !== requestedLanguage) return
        setPayloadLanguage(requestedLanguage)
        acceptPayload(next)
        // Tool descriptions are translated off the read path, so the first read
        // carries authored text and a count. Polling until the count clears is
        // what swaps the translated text in without a manual refresh.
        if ((next.translationPending ?? 0) > 0) {
          settle.current = pollUntilTranslated({
            read: async () => {
              const polled = await fetchMcpStatus()
              return { value: polled, pending: polled.translationPending ?? 0 }
            },
            report: acceptPayload,
            isStopped: () => refreshSequence.current !== sequence || languageRef.current !== requestedLanguage
          })
        }
      })
      .catch(caught => {
        if (refreshSequence.current === sequence) setError(clientErrorMessage(t, caught))
      })
      .finally(() => {
        if (refreshSequence.current === sequence) setLoading(false)
      })
  }

  useTranslationRefresh(t, refresh)

  /**
   * Delete one user-owned server. A suite-declared server belongs to its
   * source, so the backend refuses it and the card offers no such action; the
   * row disappears from the re-read list because its declaration is gone.
   * The failure is reported in the panel rather than thrown, so the shared
   * confirmation closes the same way whether or not the request succeeded.
   */
  const remove = async (entry: McpStatusEntry): Promise<void> => {
    const suiteId = entry.suiteId
    const serverKey = entry.serverKey
    if (suiteId === undefined || serverKey === undefined) return
    setError(undefined)
    try {
      await removeMcpServer(suiteId, serverKey)
      setPayload(await fetchMcpStatus())
      // A deleted row must not stay open behind the list.
      setSelected(current => (current?.id === entry.id ? undefined : current))
    } catch (caught) {
      // Close the dialog so the panel's own error line, with its retry, is
      // visible: the failure would otherwise sit behind the dialog that asked.
      setError(clientErrorMessage(t, caught))
      setSelected(current => (current?.id === entry.id ? undefined : current))
    }
  }

  /** Deleting is irreversible, so the detail asks through the shared confirmation. */
  const askDelete = (entry: McpStatusEntry): void => {
    const name = mcpDisplayName(entry)
    setConfirmDelete({
      title: t('mcpDeleteTitle', { name }),
      description: t('mcpDeleteDesc', { name }),
      onConfirm: () => remove(entry)
    })
  }

  // Written through the suite's override record, so the suite's own `mcp.json`
  // stays source-owned. Disabled servers are not mounted at all.
  const toggle = (entry: McpStatusEntry, enabled: boolean): void => {
    const suiteId = entry.suiteId
    const serverKey = entry.serverKey
    if (suiteId === undefined || serverKey === undefined) return
    setError(undefined)
    withBusyOperation(() => setMcpServerEnabled(suiteId, serverKey, enabled))
      .then(() => fetchMcpStatus())
      .then(setPayload)
      .catch(caught => {
        setError(clientErrorMessage(t, caught))
      })
  }

  useEffect(() => {
    refresh()
    return () => {
      refreshSequence.current += 1
      settle.current?.stop()
      settle.current = undefined
    }
  }, [])

  // A reconnecting row moves on its own, and the supervisor says when it will
  // try again. Sleep until just after that attempt instead of polling: a minute
  // of backoff costs one read, not forty. A row that names no time keeps a short
  // interval, and a healthy or stopped row costs no reads at all.
  const nextRead = nextConnectionRead(payload)
  useEffect(() => {
    if (nextRead === undefined) return
    const timer = setTimeout(() => {
      refresh()
    }, nextRead)
    return () => {
      clearTimeout(timer)
    }
  }, [nextRead, payload])

  // The countdown in that sentence has to move, or "45 秒后重试" would sit there
  // reading 45 long after the attempt was due. One tick per second, only while a
  // row is actually waiting.
  const waiting = payload.entries.some(entry => entry.connection?.retryAt !== undefined && entry.connection.retryAt > Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [waiting, payload])

  // The renderer owns the toolbar, the filters, the search and the collection;
  // this panel maps its rows onto the shared entry contract and keeps only the
  // domain work (open, toggle, edit) and the dialogs.
  const byId = new Map(payload.entries.map(entry => [entry.id, entry]))
  const entries = payload.entries.map(entry => {
    const displayName = mcpDisplayName(entry)
    // One sentence for the card and the detail band: the live supervisor's
    // phase when the connection dropped, absent otherwise.
    const connectionNote = mcpConnectionNote(t, entry, now)
    const switchable = entry.suiteId !== undefined && entry.serverKey !== undefined && entry.state !== 'foreign'
    const disabled = entry.state === 'disabled'
    return {
      id: entry.id,
      name: displayName,
      hint: entry.name === displayName ? undefined : entry.name,
      mono: true,
      tag: entry.kind === 'plugin' ? t('mcpPlugin') : t('mcpDirect'),
      chip: true,
      surface: 'mcp' as const,
      description: connectionNote ?? entry.endpoint ?? t('mcpObservedEndpoint'),
      monoBody: connectionNote === undefined,
      source: entry.kind === 'plugin' ? (entry.suiteId ?? entry.source ?? '—') : t('mcpDirect'),
      meta: entry.transport,
      counts: [{ label: entry.tools.length === 1 ? t('mcpTool') : t('mcpTools'), count: entry.tools.length }],
      // Text the card does not render, so search still finds it.
      keywords: [entry.name, entry.endpoint ?? '', entry.transport, entry.reason ?? '', ...(entry.credentialRefs ?? [])].join(' '),
      state: mcpCardState(entry.state),
      canEdit: switchable,
      toggleLabel: disabled ? t('enable') : t('disable')
    }
  })

  return h(
    'div',
    { className: css.surface },
    // The tab row already names this panel; the description is the part that
    // says something the tab does not.
    h(PanelHeader, {
      subtitle: t('mcpStatusSubtitle'),
      actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: () => setAdding(true), refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
    }),
    // The last read's failure stays visible above the list: a stale row is
    // still worth seeing, and the retry sits where the failure is.
    error === undefined ? null : h('div', { className: css.error, role: 'alert' }, error, h(Button, { variant: 'ghost', size: 'sm', onClick: refresh }, t('mcpRetry'))),
    h(ResourceSurface, {
      t,
      entries,
      capabilities: { toggle: true, counts: true },
      searchLabel: t('mcpSearch'),
      searchPlaceholder: t('mcpSearch'),
      filters: MCP_FILTERS.map(kind => ({
        id: kind,
        label: filterLabel(t, kind),
        hint: mcpFilterHint(t, kind),
        match: (entry: { id: string }) => {
          const row = byId.get(entry.id)
          return row !== undefined && matchesMcpFilter(row, kind)
        }
      })),
      beforeView: h(BilingualToggle, { t, showOriginal, onToggle: flipOriginal }),
      toListLabel: t('switchToList'),
      toGridLabel: t('switchToGrid'),
      emptyText: loading && payload.entries.length === 0 ? t('loading') : t('mcpEmpty'),
      onOpen: id => {
        const row = byId.get(id)
        if (row !== undefined) setSelected(row)
      },
      onToggle: (id, enabled) => {
        const row = byId.get(id)
        if (row !== undefined) toggle(row, enabled)
      },
      onEdit: id => {
        const row = byId.get(id)
        if (row !== undefined) setEditing(row)
      },
      isOn: id => byId.get(id)?.state !== 'disabled',
      isToggleDisabled: id => {
        const row = byId.get(id)
        return row === undefined || row.suiteId === undefined || row.serverKey === undefined || row.state === 'foreign'
      }
    }),
    adding
      ? h(McpAddModal, {
          t,
          credentials,
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
          now,
          t,
          backend: payload.backend ?? 'builtin',
          showOriginal: showOriginal || payloadLanguage !== language,
          onClose: () => {
            setSelected(undefined)
            refresh()
          },
          onRetry: retry,
          onReauthorize: reauthorize,
          onRefresh: observe,
          // Deleting belongs to the dialog the card opens: the card's click means
          // "open", and the one irreversible action waits one step inside it.
          ...(deletable(selected) ? { onDelete: () => askDelete(selected) } : {})
        }),
    // The editor is the dialog the add flow uses, opened from the card's own
    // edit action rather than from inside the detail report.
    editing === undefined
      ? null
      : h(McpConfigModal, {
          entry: editing,
          t,
          credentials,
          onClose: () => setEditing(undefined),
          onSaved: refresh
        }),
    // The shared danger confirmation: the card's delete and nothing else opens it.
    h(ConfirmModal, {
      state: confirmDelete,
      confirmLabel: t('mcpDeleteConfirm'),
      cancelLabel: t('cancel'),
      onClose: () => setConfirmDelete(undefined)
    })
  )
}

/**
 * Whether this row is the user's own declaration. A suite declares its servers
 * in its own `mcp.json`, and an observed mount has no declaration here at all,
 * so only a user-owned direct server is this panel's to delete.
 */
function deletable(entry: McpStatusEntry): boolean {
  return entry.kind === 'direct' && entry.suiteId !== undefined && entry.serverKey !== undefined
}

/**
 * The detail dialog owns every action and every long text: state, reason,
 * credentials, config, tools, and the retry control with its in-place result
 * echo. The state pill is dropped entirely — the dot and the reason box carry
 * that information without a second red stamp.
 */
function filterLabel(t: Translate, kind: Filter): string {
  if (kind === 'attention') return t('mcpFilterAttention')
  if (kind === 'disabled') return t('panelFilterDisabled')
  return t('filterAll')
}

/** Hover/aria explanation for each MCP filter tab. */
function mcpFilterHint(t: Translate, kind: Filter): string {
  if (kind === 'attention') return t('mcpFilterAttentionHint')
  if (kind === 'disabled') return t('mcpFilterDisabledHint')
  return t('filterAll')
}
