/**
 * Suite detail dialog: click one suite card to browse its internals.
 *
 * One status band, an overview grid that does not repeat what the header
 * already says, and one block per surface — skills, MCP servers, commands,
 * agent roles, hooks, LSP servers, then validation diagnostics. Every block is
 * a list of disclosure rows that render the real content in place: a skill's
 * SKILL.md through the safe Markdown renderer, and validated configuration
 * through the host JSON tree.
 *
 * The MCP region is intentionally read-only: credentials and per-server
 * overrides are configured on the MCP services panel (their own detail
 * dialog), not inside the suite detail preview.
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, JsonTree, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './ui/DetailModal.js'
import { MarkdownDocument } from './ui/MarkdownDocument.js'
import { DetailRow, DetailRows } from './ui/DetailRows.js'
import { lastChangeLabel } from './ui/last-change.js'
import { jsonTreeLabels } from './ui/json-tree-labels.js'
import { fetchSkillContent, fetchSuiteDetail, postAction, type McpServerDetail, type SuiteDetail } from './api.js'
import type { Translate } from './index.js'
import { suiteLayoutLabel } from './layout-label.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { createLatestRequestGuard } from './features/suite-detail/suite-detail-resource.js'
import css from './market.module.css'
import panelCss from './ui/panel.module.css'
import { clientErrorMessage } from './ui/error-message.js'

/** Toggleable surface keys paired with their translation keys. */
const SURFACE_TOGGLE_ROWS = [
  ['skills', 'surfaceSkills'],
  ['mcp', 'surfaceMcp'],
  ['hooks', 'surfaceHooks'],
  ['commands', 'surfaceCommands'],
  ['agents', 'surfaceAgents'],
  ['lsp', 'surfaceLsp']
] as const

export interface SuiteDetailModalProps {
  t: Translate
  sourceId: string
  suiteId: string
  onClose: () => void
  /** Installs this suite; present only while it is not installed. */
  onInstall?: (() => void) | undefined
  /** Uninstalls this suite; present only while it is installed. */
  onUninstall?: (() => void) | undefined
}

export function SuiteDetailModal({ t, sourceId, suiteId, onClose, onInstall, onUninstall }: SuiteDetailModalProps): ReactNode {
  const [detail, setDetail] = useState<SuiteDetail | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openRow, setOpenRow] = useState<string | undefined>(undefined)
  const [skillText, setSkillText] = useState<string | undefined>(undefined)
  const [skillLoading, setSkillLoading] = useState(false)
  const skillRequestGuard = useRef(createLatestRequestGuard())
  const [surfaceBusy, setSurfaceBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    skillRequestGuard.current.invalidate()
    setDetail(undefined)
    setError(undefined)
    setOpenRow(undefined)
    setSkillText(undefined)
    fetchSuiteDetail(sourceId, suiteId)
      .then(value => {
        if (!cancelled) setDetail(value)
      })
      .catch(reason => {
        if (!cancelled) setError(clientErrorMessage(t, reason))
      })
    return () => {
      cancelled = true
      skillRequestGuard.current.invalidate()
    }
  }, [sourceId, suiteId])

  const toggleRow = async (id: string, load?: () => Promise<string>): Promise<void> => {
    if (openRow === id) {
      setOpenRow(undefined)
      return
    }
    setOpenRow(id)
    if (load === undefined) return
    const requestId = skillRequestGuard.current.next()
    setSkillLoading(true)
    setSkillText(undefined)
    try {
      const content = await load()
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillText(content)
    } catch (reason) {
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillText(`⚠ ${clientErrorMessage(t, reason)}`)
    } finally {
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillLoading(false)
    }
  }

  const toggleSurface = async (surface: string, enabled: boolean): Promise<void> => {
    setSurfaceBusy(true)
    try {
      await postAction('set-surface', { sourceId, suiteId, surface, enabled })
      setDetail(await fetchSuiteDetail(sourceId, suiteId))
    } catch (reason) {
      setError(clientErrorMessage(t, reason))
    } finally {
      setSurfaceBusy(false)
    }
  }

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
    // `插件套件 · <source>`: what this dialog is about. The version lives in the
    // status band with the state and the provenance, not in the title.
    description: detail === undefined ? undefined : `${t('detailKicker')} · ${detail.sourceId}`,
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
                    kv(t('sourceLabel'), detail.sourceId, true),
                    kv(t('layoutLabel'), layoutLabel),
                    detail.author === null ? null : kv(t('authorLabel'), detail.author),
                    updated === null ? null : kv(t('updatedLabel'), updated)
                  )
                ),
                detail.description === null
                  ? null
                  : h('div', { className: panelCss.block }, h('h4', { className: panelCss.blockHead }, t('detailDescriptionLabel')), h('p', { className: panelCss.detailProse }, detail.description)),
                h('div', { className: panelCss.block }, h('h4', { className: panelCss.blockHead }, t('rootLabel')), h('pre', { className: panelCss.monoBlock }, detail.root)),
                detail.installed === false || detail.surfaceToggles === null
                  ? null
                  : h(
                      'div',
                      { className: panelCss.block },
                      h('h4', { className: panelCss.blockHead }, t('surfaceTogglesSection')),
                      h(
                        'div',
                        { className: css.surfaceToggles, title: t('surfaceTogglesHint') },
                        ...SURFACE_TOGGLE_ROWS.map(([key, labelKey]) =>
                          h(
                            'label',
                            { key, className: css.surfaceToggle },
                            h('input', {
                              type: 'checkbox',
                              checked: detail.surfaceToggles?.[key] === true,
                              disabled: surfaceBusy,
                              onChange: event => {
                                void toggleSurface(key, (event.target).checked)
                              }
                            }),
                            t(labelKey)
                          )
                        )
                      )
                    ),
                block(
                  t('skillsSection'),
                  detail.skills.length,
                  detail.skills.map(skill =>
                    row(
                      openRow,
                      `s:${skill.name}`,
                      skill.name,
                      skill.description,
                      () => void toggleRow(`s:${skill.name}`, async () => (await fetchSkillContent(sourceId, suiteId, skill.name)).content),
                      skillLoading && openRow === `s:${skill.name}` ? h('div', { className: css.empty }, t('loading')) : h(MarkdownDocument, { text: skillText ?? '', t })
                    )
                  )
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
                  detail.commands.map(command =>
                    row(openRow, `c:${command.name}`, `/${command.name}`, command.description, () => void toggleRow(`c:${command.name}`), h(MarkdownDocument, { text: command.content, t }))
                  )
                ),
                block(
                  t('agentsSection'),
                  detail.agents.length,
                  detail.agents.map(agent => row(openRow, `a:${agent.name}`, agent.name, agent.description, () => void toggleRow(`a:${agent.name}`), h(MarkdownDocument, { text: agent.content, t })))
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

function kv(label: string, value: string, mono = false): ReactNode {
  return h('div', null, h('dt', { className: panelCss.kvKey }, label), h('dd', { className: mono ? `${panelCss.kvValue} ${panelCss.kvValueMono}` : panelCss.kvValue, title: value }, value))
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
  if (detail !== undefined && !detail.installed && actions.onInstall !== undefined) {
    return [
      h(Button, { key: 'close', variant: 'ghost', onClick: actions.onClose }, t('mcpClose')),
      h(Button, { key: 'install', variant: 'primary', onClick: actions.onInstall }, t('install'))
    ]
  }
  if (detail !== undefined && detail.installed && actions.onUninstall !== undefined) {
    return [
      h(Button, { key: 'uninstall', variant: 'ghost', onClick: actions.onUninstall }, t('uninstall')),
      h(Button, { key: 'done', variant: 'primary', onClick: actions.onClose }, t('detailDone'))
    ]
  }
  return h(Button, { variant: 'ghost', onClick: actions.onClose }, t('mcpClose'))
}

function mcpSummary(server: McpServerDetail): string {
  if (server.type === 'stdio') return server.command ?? server.type
  return server.url ?? server.type
}

/** One-line summary of a declared LSP server: command plus mapped extension list. */
function lspSummary(server: { command: string; extensions: Record<string, string> }): string {
  return [server.command, Object.keys(server.extensions).join(' ')].join(' · ')
}
