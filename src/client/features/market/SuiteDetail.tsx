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
import { createElement as h, Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { displayText } from '../../ui/translated-text.js'
import { Button, JsonTree, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { MarkdownDocument } from '../../ui/MarkdownDocument.js'
import { DocumentTranslationView } from '../../ui/DocumentTranslation.js'
import { DetailRow, DetailRows, kvCell } from '../../ui/DetailRows.js'
import { lastChangeLabel } from '../../ui/last-change.js'
import { jsonTreeLabels } from '../../ui/json-tree-labels.js'
import { fetchSuiteDetail, fetchSuiteDocument, fetchSuiteDocumentTranslation, type McpServerDetail, type SuiteDetail, type UserPanelKind } from '../../api.js'
import type { DocumentTranslation } from '../../../contracts/translation.js'
import type { Translate } from '../../index.js'
import { suiteLayoutLabel } from '../../layout-label.js'
import { ErrorBoundary } from '../../ErrorBoundary.js'
import { createLatestRequestGuard } from './suite-detail-resource.js'
import css from './market.module.css'
import panelCss from '../../ui/panel.module.css'
import { clientErrorMessage } from '../../ui/error-message.js'

export interface SuiteDetailModalProps {
  t: Translate
  sourceId: string
  suiteId: string
  onClose: () => void
  /** Installs this suite; present only while it is not installed. */
  onInstall?: (() => void) | undefined
  /** Uninstalls this suite; present only while it is installed. */
  onUninstall?: (() => void) | undefined
  /** The panel's text view, and the switch that drives it. */
  showOriginal: boolean
}

export function SuiteDetailModal({ t, sourceId, suiteId, onClose, onInstall, onUninstall, showOriginal }: SuiteDetailModalProps): ReactNode {
  const [detail, setDetail] = useState<SuiteDetail | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openRow, setOpenRow] = useState<string | undefined>(undefined)
  // One slot for whichever document row is open: a row's body renders only while
  // it is the open one, so the three document surfaces share one read state.
  const [documentText, setDocumentText] = useState<string | undefined>(undefined)
  const [documentLoading, setDocumentLoading] = useState(false)
  const documentRequestGuard = useRef(createLatestRequestGuard())
  // The dialog renders the panel's view and flips that same state, so the two
  // switches are one control seen from two places rather than two states.
  const view = { original: showOriginal }

  useEffect(() => {
    let cancelled = false
    documentRequestGuard.current.invalidate()
    setDetail(undefined)
    setError(undefined)
    setOpenRow(undefined)
    setDocumentText(undefined)
    fetchSuiteDetail(sourceId, suiteId)
      .then(value => {
        if (!cancelled) setDetail(value)
      })
      .catch(reason => {
        if (!cancelled) setError(clientErrorMessage(t, reason))
      })
    return () => {
      cancelled = true
      documentRequestGuard.current.invalidate()
    }
  }, [sourceId, suiteId])

  const toggleRow = async (id: string, load?: () => Promise<string>): Promise<void> => {
    if (openRow === id) {
      setOpenRow(undefined)
      return
    }
    setOpenRow(id)
    if (load === undefined) return
    const requestId = documentRequestGuard.current.next()
    setDocumentLoading(true)
    setDocumentText(undefined)
    try {
      const content = await load()
      if (documentRequestGuard.current.isCurrent(requestId)) setDocumentText(content)
    } catch (reason) {
      if (documentRequestGuard.current.isCurrent(requestId)) setDocumentText(`⚠ ${clientErrorMessage(t, reason)}`)
    } finally {
      if (documentRequestGuard.current.isCurrent(requestId)) setDocumentLoading(false)
    }
  }

  /**
   * One document row — a skill, a command, or an agent. The three surfaces take
   * one path: opening the row starts the read, the row shows its own loading
   * line until that read lands, and a failed read writes the same failure text
   * into the body. The detail payload never carries a document's bytes, so no
   * row can render a body that was cut to fit it.
   */
  const documentRow = (kind: UserPanelKind, id: string, name: string, description: string | undefined): ReactNode =>
    row(
      openRow,
      id,
      name,
      description,
      () => void toggleRow(id, async () => (await fetchSuiteDocument(sourceId, suiteId, kind, name)).content),
      openRow === id && documentLoading
        ? h('div', { className: css.empty }, t('loading'))
        : documentBody(t, h(MarkdownDocument, { text: documentText ?? '', t }), () => fetchSuiteDocumentTranslation(sourceId, suiteId, kind, name))
    )

  const layoutLabel = detail === undefined ? '' : suiteLayoutLabel(detail.layout, t)
  const updated = detail === undefined || detail.updatedAt === null ? null : lastChangeLabel(t, detail.updatedAt)
  const statusLabel = detail === undefined
    ? ''
    : detail.installed
      ? detail.enabled
        ? t('installedBadge')
        : t('disabledLabel')
      : t('notInstalledLabel')

  return h(DetailModal, {
    open: true,
    onClose,
    title: detail === undefined ? t('detailTitle') : detail.name,
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
                detail.description === null
                  ? null
                  : h(
                      'div',
                      { className: panelCss.block },
                      h('h4', { className: panelCss.blockHead }, t('detailDescriptionLabel')),
                      h('p', { className: panelCss.detailProse }, displayText(detail.translatedDescription, detail.description, t, view))
                    ),
                block(
                  t('skillsSection'),
                  detail.skills.length,
                  detail.skills.map(skill => documentRow('skills', `s:${skill.name}`, skill.name, skill.description))
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
                  detail.commands.map(command => documentRow('commands', `c:${command.name}`, command.name, command.description))
                ),
                block(
                  t('agentsSection'),
                  detail.agents.length,
                  detail.agents.map(agent => documentRow('agents', `a:${agent.name}`, agent.name, agent.description))
                ),
                block(
                  t('hooksLabel'),
                  detail.hooks.count,
                  detail.hooks.entries.map((hook, index) =>
                    row(openRow, `h:${index}`, hook.event, hook.command, () => void toggleRow(`h:${index}`), h(JsonTree, { data: hook, label: hook.event, copyable: true, labels: jsonTreeLabels(t) }))
                  )
                ),
                block(
                  t('lspSection'),
                  detail.lsp.servers.length + detail.lsp.raw.length,
                  [
                    ...detail.lsp.servers.map(server =>
                      row(openRow, `l:${server.key}`, server.key, lspSummary(server), () => void toggleRow(`l:${server.key}`), h(JsonTree, { data: server, label: server.key, copyable: true, expandTopLevel: true, labels: jsonTreeLabels(t) }))
                    ),
                    ...detail.lsp.raw.map(entry =>
                      row(openRow, `lr:${entry.name}`, entry.name, undefined, () => void toggleRow(`lr:${entry.name}`), h('pre', { className: panelCss.monoBlock }, entry.content))
                    )
                  ]
                ),
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

/**
 * One document row's body: the file as authored, and under it the collapsible
 * translation section every other document surface carries.
 *
 * The section starts closed and reads nothing until a reader opens it, so a
 * document nobody translates costs nothing. It is the component the user-panel
 * detail page renders, against the same contract: the read names this suite and
 * this document, and the server re-reads the file rather than trusting the
 * detail payload that put the authored text on screen.
 */
function documentBody(t: Translate, document: ReactNode, load: () => Promise<DocumentTranslation>): ReactNode {
  return h(Fragment, null, document, h(DocumentTranslationView, { t, load }))
}

/** One surface group. A surface the suite does not carry is left out entirely. */
function block(head: string, count: number, rows: ReactNode[], note?: ReactNode): ReactNode {
  if (count === 0 && rows.length === 0) return null
  return h(
    'div',
    { className: panelCss.block },
    h('h4', { className: panelCss.blockHead }, `${head} (${count})`),
    note ?? null,
    rows.length === 0 ? null : h(DetailRows, null, ...rows)
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

function footer(t: Translate, detail: SuiteDetail | undefined, actions: { onClose: () => void; onInstall?: (() => void) | undefined; onUninstall?: (() => void) | undefined }): ReactNode {
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
