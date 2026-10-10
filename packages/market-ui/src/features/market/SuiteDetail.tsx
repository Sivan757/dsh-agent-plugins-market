/**
 * Suite detail dialog: click one suite card to browse its internals.
 *
 * One status band, an overview grid that does not repeat what the header
 * already says, and one block per surface — skills, MCP servers, commands,
 * agent roles, hooks, LSP servers, then validation diagnostics. Every block is
 * a list of disclosure rows that render the real content in place: a skill's
 * SKILL.md, a command, or an agent role arrives through one read made when the
 * row is opened, rendered through the safe Markdown renderer, and validated
 * configuration through the host JSON tree.
 *
 * The MCP region is intentionally read-only: credentials and per-server
 * overrides are configured on the MCP services panel (their own detail
 * dialog), not inside the suite detail preview.
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDisplayText } from '../../ui/translated-text.js'
import { localeIsChinese } from '../../ui/bilingual-text.js'
import { useTranslationEnabled } from '../../ui/translation-enabled.js'
import { pollUntilTranslated } from '../../ui/translation-settle.js'
import { Button, JsonTree, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { DocumentTranslationView } from '../../ui/DocumentTranslation.js'
import { DetailRow, DetailRows, kvCell } from '../../ui/DetailRows.js'
import { lastChangeLabel } from '../../ui/last-change.js'
import { jsonTreeLabels } from '../../ui/json-tree-labels.js'
import { fetchSuiteDetail, fetchSuiteDocument, fetchSuiteDocumentTranslation, type McpServerDetail, type SuiteDetail, type UserPanelKind } from '../../api.js'
import type { Translate } from '../../i18n.js'
import { suiteLayoutLabel } from '../../layout-label.js'
import { ErrorBoundary } from '../../ErrorBoundary.js'
import { createLatestRequestGuard } from './suite-detail-resource.js'
import css from './market.module.css'
import panelCss from '../../ui/panel.module.css'
import { clientErrorMessage } from '../../ui/error-message.js'

export interface SuiteDetailModalProps {
  t: Translate
  sessionId?: string
  sourceId: string
  suiteId: string
  onClose: () => void
  /** Installs this suite; present only while it is not installed. */
  onInstall?: (() => void) | undefined
  /** Uninstalls this suite; present only while it is installed. */
  onUninstall?: (() => void) | undefined
  /** The panel's text view, and the switch that drives it. */
  showOriginal: boolean
  /**
   * Presentation overrides for a configuration row whose identity is a wire
   * id, not display text: the presets detail passes the localized title and
   * description here so the dialog shows the same name the list row does.
   */
  displayName?: string | undefined
  displayDescription?: string | undefined
  /** Shown as a note when the detail carries no usable capability, e.g. the user hooks configuration with no valid hook event. */
  emptyNote?: string | undefined
}

export function SuiteDetailModal({
  t,
  sourceId,
  suiteId,
  sessionId,
  onClose,
  onInstall,
  onUninstall,
  showOriginal,
  displayName,
  displayDescription,
  emptyNote
}: SuiteDetailModalProps): ReactNode {
  const [detail, setDetail] = useState<SuiteDetail | undefined>(undefined)
  const target = localeIsChinese(t) ? 'zh' : 'en'
  const enabled = useTranslationEnabled()
  const [detailTarget, setDetailTarget] = useState(target)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openRow, setOpenRow] = useState<string | undefined>(undefined)
  // One slot for whichever document row is open: a row's body renders only while
  // it is the open one, so the three document surfaces share one read state.
  const [documentText, setDocumentText] = useState<string | undefined>(undefined)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [documentError, setDocumentError] = useState<string>()
  const documentRequestGuard = useRef(createLatestRequestGuard())
  // The dialog renders the panel's view and flips that same state, so the two
  // switches are one control seen from two places rather than two states.
  const description = useDisplayText(detailTarget === target ? detail?.translatedDescription : undefined, detail?.description ?? undefined, t, { original: showOriginal })

  useEffect(() => {
    documentRequestGuard.current.invalidate()
    setDetail(undefined)
    setError(undefined)
    setOpenRow(undefined)
    setDocumentText(undefined)
    setDocumentError(undefined)
    return () => {
      documentRequestGuard.current.invalidate()
    }
  }, [sourceId, suiteId, sessionId])

  useEffect(() => {
    let cancelled = false
    let poll: { stop: () => void } | undefined
    const report = (value: SuiteDetail): void => {
      if (!cancelled) {
        setDetail(value)
        setDetailTarget(target)
      }
    }
    const read = async (): Promise<{ value: SuiteDetail; pending: number }> => {
      const value = await fetchSuiteDetail(sourceId, suiteId, sessionId)
      return { value, pending: enabled ? (value.translationPending ?? 0) : 0 }
    }
    read()
      .then(first => {
        if (cancelled) return
        report(first.value)
        if (first.pending > 0) poll = pollUntilTranslated({ read, report, isStopped: () => cancelled })
      })
      .catch(reason => {
        if (!cancelled) setError(clientErrorMessage(t, reason))
      })
    return () => {
      cancelled = true
      poll?.stop()
    }
  }, [sourceId, suiteId, sessionId, target, enabled])

  const toggleRow = async (id: string, load?: () => Promise<string>): Promise<void> => {
    if (openRow === id) {
      setOpenRow(undefined)
      return
    }
    setOpenRow(id)
    if (load !== undefined) await readDocument(load)
  }

  const readDocument = async (load: () => Promise<string>): Promise<void> => {
    const requestId = documentRequestGuard.current.next()
    setDocumentLoading(true)
    setDocumentError(undefined)
    setDocumentText(undefined)
    try {
      const content = await load()
      if (documentRequestGuard.current.isCurrent(requestId)) setDocumentText(content)
    } catch (reason) {
      if (documentRequestGuard.current.isCurrent(requestId)) setDocumentError(clientErrorMessage(t, reason))
    } finally {
      if (documentRequestGuard.current.isCurrent(requestId)) setDocumentLoading(false)
    }
  }

  /** A document row keeps its reading controls in the file header. */
  const documentRow = (kind: UserPanelKind, id: string, name: string, description: string | undefined): ReactNode =>
    h(DocumentTranslationView, {
      key: id,
      t,
      open: openRow === id,
      original: openRow === id ? documentText : undefined,
      originalLoading: openRow === id && documentLoading,
      originalError: openRow === id ? documentError : undefined,
      retryOriginal: () => void readDocument(async () => (await fetchSuiteDocument(sourceId, suiteId, kind, name, sessionId)).content),
      load: retry => fetchSuiteDocumentTranslation(sourceId, suiteId, kind, name, sessionId, retry),
      render: ({ controls, body }) =>
        h(DetailRow, {
          name,
          summary: description?.replace(/\s+/g, ' ').trim(),
          open: openRow === id,
          onToggle: () => void toggleRow(id, async () => (await fetchSuiteDocument(sourceId, suiteId, kind, name, sessionId)).content),
          headerActions: controls,
          children: body
        })
    })

  const layoutLabel = detail === undefined ? '' : suiteLayoutLabel(detail.layout, t)
  const updated = detail === undefined || detail.updatedAt === null ? null : lastChangeLabel(t, detail.updatedAt)
  const statusLabel = detail === undefined ? '' : detail.installed ? (detail.enabled ? t('installedBadge') : t('disabledLabel')) : t('notInstalledLabel')

  const shownName = displayName ?? detail?.name
  return h(DetailModal, {
    open: true,
    onClose,
    title: shownName === undefined ? t('detailTitle') : shownName,
    // No subtitle: the kind and the source are already tags on the identity row,
    // and the source repeats the overview grid's own `来源套件` cell.
    closeLabel: t('cancel'),
    footer: footer(t, detail, { onClose, onInstall, onUninstall }),
    children: h(ErrorBoundary, {
      fallback: boundaryError => h('div', { className: css.warnLine }, `${t('actionFail')}: ${boundaryError.message}`),
      children:
        error !== undefined
          ? h('div', { className: css.warnLine }, error)
          : detail === undefined
            ? h('div', { className: css.empty }, t('loading'))
            : h(
                'div',
                null,
                h(
                  'div',
                  { className: panelCss.hero },
                  h(StateDot, { state: detail.installed ? (detail.enabled ? 'done' : 'idle') : 'idle' }),
                  h(
                    'div',
                    { className: panelCss.heroText },
                    h(
                      'div',
                      { className: panelCss.heroLine },
                      h(Tag, { tone: detail.installed ? (detail.enabled ? 'success' : 'neutral') : 'neutral' }, statusLabel),
                      h(Tag, { tone: 'neutral' }, detail.dimension === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')),
                      detail.version === null ? null : h(Tag, { tone: 'quiet' }, `v${detail.version}`)
                    ),
                    h('p', { className: panelCss.heroMono }, detail.root)
                  )
                ),
                h(
                  'div',
                  { className: panelCss.block },
                  h('h4', { className: panelCss.blockHead }, t('overviewSection')),
                  h(
                    'dl',
                    { className: panelCss.kvGrid },
                    kvCell(t('sourceLabel'), detail.sourceId, true),
                    kvCell(t('layoutLabel'), layoutLabel),
                    detail.author === null ? null : kvCell(t('authorLabel'), detail.author),
                    updated === null ? null : kvCell(t('updatedLabel'), updated)
                  )
                ),
                (displayDescription ?? (detail.description === null ? undefined : description)) === undefined
                  ? null
                  : h(
                      'div',
                      { className: panelCss.block },
                      h('h4', { className: panelCss.blockHead }, t('detailDescriptionLabel')),
                      h('p', { className: panelCss.detailProse }, displayDescription ?? description)
                    ),
                block(
                  t('skillsSection'),
                  detail.skills.length,
                  detail.skills.map(skill => documentRow('skills', `s:${skill.name}`, skill.name, skill.description)),
                  undefined,
                  true
                ),
                block(
                  t('mcpSection'),
                  detail.mcpServers.length,
                  detail.mcpServers.map(server => {
                    const disabled = detail.mcpOverrides?.[server.key]?.enabled === false
                    return row(
                      openRow,
                      `m:${server.key}`,
                      server.key,
                      `${mcpSummary(server)}${disabled ? ` · ${t('mcpOverrideDisabledBadge')}` : ''}`,
                      () => void toggleRow(`m:${server.key}`),
                      h(JsonTree, { data: server, label: server.key, copyable: true, expandTopLevel: true, labels: jsonTreeLabels(t) })
                    )
                  }),
                  detail.mcpErrors.length === 0 ? null : h('div', { className: css.warnLine }, `⚠ ${detail.mcpErrors.join(t('sourceErrorSeparator'))}`)
                ),
                block(
                  t('commandsSection'),
                  detail.commands.length,
                  detail.commands.map(command => documentRow('commands', `c:${command.name}`, command.name, command.description)),
                  undefined,
                  true
                ),
                block(
                  t('agentsSection'),
                  detail.agents.length,
                  detail.agents.map(agent => documentRow('agents', `a:${agent.name}`, agent.name, agent.description)),
                  undefined,
                  true
                ),
                block(
                  t('hooksLabel'),
                  detail.hooks.count,
                  detail.hooks.entries.map((hook, index) =>
                    row(
                      openRow,
                      `h:${index}`,
                      hook.event,
                      hook.command,
                      () => void toggleRow(`h:${index}`),
                      h(JsonTree, { data: hook, label: hook.event, copyable: true, labels: jsonTreeLabels(t) })
                    )
                  )
                ),
                emptyNote === undefined || detail.hooks.count > 0 ? null : h('p', { className: panelCss.detailProse }, emptyNote),
                block(t('lspSection'), detail.lsp.servers.length + detail.lsp.raw.length, [
                  ...detail.lsp.servers.map(server =>
                    row(
                      openRow,
                      `l:${server.key}`,
                      server.key,
                      lspSummary(server),
                      () => void toggleRow(`l:${server.key}`),
                      h(JsonTree, { data: server, label: server.key, copyable: true, expandTopLevel: true, labels: jsonTreeLabels(t) })
                    )
                  ),
                  ...detail.lsp.raw.map(entry =>
                    row(openRow, `lr:${entry.name}`, entry.name, undefined, () => void toggleRow(`lr:${entry.name}`), h('pre', { className: panelCss.monoBlock }, entry.content))
                  )
                ]),
                h(
                  'div',
                  { className: panelCss.block },
                  h('h4', { className: panelCss.blockHead }, `${t('errors')} (${detail.errors.length})`),
                  detail.errors.length === 0
                    ? h('p', { className: panelCss.detailProse }, t('diagnosticsPassed'))
                    : detail.errors.map((entry, index) => h('div', { key: index, className: css.warnLine }, entry))
                )
              )
    })
  })
}

/** One surface group. A surface the suite does not carry is left out entirely. */
function block(head: string, count: number, rows: ReactNode[], note?: ReactNode, documentHeaders = false): ReactNode {
  if (count === 0 && rows.length === 0) return null
  return h(
    'div',
    { className: panelCss.block },
    h('h4', { className: panelCss.blockHead }, `${head} (${count})`),
    note ?? null,
    rows.length === 0 ? null : h(DetailRows, { documentHeaders }, ...rows)
  )
}

/** One row; its body renders only while that row is the open one. */
function row(current: string | undefined, id: string, name: string, description: string | undefined, onToggle: () => void, body: ReactNode): ReactNode {
  const summary = description === undefined ? undefined : description.replace(/\s+/g, ' ').trim()
  return h(DetailRow, {
    key: id,
    name,
    summary: summary === '' ? undefined : summary,
    open: current === id,
    onToggle,
    children: body
  })
}

function footer(
  t: Translate,
  detail: SuiteDetail | undefined,
  actions: { onClose: () => void; onInstall?: (() => void) | undefined; onUninstall?: (() => void) | undefined }
): ReactNode {
  // One action per state; closing rides the modal chrome (closeLabel / ESC).
  if (detail !== undefined && !detail.installed && actions.onInstall !== undefined) {
    return h(Button, { key: 'install', variant: 'primary', onClick: actions.onInstall }, t('install'))
  }
  if (detail !== undefined && detail.installed && actions.onUninstall !== undefined) {
    return h(Button, { key: 'uninstall', variant: 'ghost', onClick: actions.onUninstall }, t('uninstall'))
  }
  return null
}

function mcpSummary(server: McpServerDetail): string {
  if (server.type === 'stdio') return server.command ?? server.type
  return server.url ?? server.type
}

/** One-line summary of a declared LSP server: command plus mapped extension list. */
function lspSummary(server: { command: string; extensions: Record<string, string> }): string {
  return [server.command, Object.keys(server.extensions).join(' ')].join(' · ')
}
