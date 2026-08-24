/**
 * Suite detail modal: click one suite card to browse its internals.
 *
 * Sections: manifest overview, the skill list (each skill expands to its
 * SKILL.md body through the safe MarkdownText renderer), the validated
 * mcp.json servers (each expands to its full config), command/subagent file
 * lists, hook/LSP counts, and validation diagnostics.
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Modal, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchSkillContent, fetchSuiteDetail, postAction, type McpServerDetail, type SuiteDetail } from './api.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import type { Translate } from './index.js'
import { createLatestRequestGuard } from './features/suite-detail/suite-detail-resource.js'
import css from './market.module.css'

/** Toggleable surface keys paired with their translation keys. */
const SURFACE_TOGGLE_ROWS = [
  ['skills', 'surfaceSkills'],
  ['mcp', 'surfaceMcp'],
  ['hooks', 'surfaceHooks'],
  ['commands', 'surfaceCommands'],
  ['agents', 'surfaceAgents']
] as const

export interface SuiteDetailModalProps {
  t: Translate
  sourceId: string
  suiteId: string
  onClose: () => void
}

export function SuiteDetailModal({ t, sourceId, suiteId, onClose }: SuiteDetailModalProps): ReactNode {
  const [detail, setDetail] = useState<SuiteDetail | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openSkill, setOpenSkill] = useState<string | undefined>(undefined)
  const [skillText, setSkillText] = useState<string | undefined>(undefined)
  const [skillLoading, setSkillLoading] = useState(false)
  const skillRequestGuard = useRef(createLatestRequestGuard())
  const [openMcp, setOpenMcp] = useState<string | undefined>(undefined)
  const [openPreview, setOpenPreview] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    skillRequestGuard.current.invalidate()
    setDetail(undefined)
    setError(undefined)
    setOpenSkill(undefined)
    setSkillText(undefined)
    fetchSuiteDetail(sourceId, suiteId)
      .then(value => {
        if (!cancelled) setDetail(value)
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
      skillRequestGuard.current.invalidate()
    }
  }, [sourceId, suiteId])

  const toggleSkill = async (name: string): Promise<void> => {
    const requestId = skillRequestGuard.current.next()
    if (openSkill === name) {
      setOpenSkill(undefined)
      return
    }
    setOpenSkill(name)
    setSkillLoading(true)
    setSkillText(undefined)
    try {
      const content = await fetchSkillContent(sourceId, suiteId, name)
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillText(content.content)
    } catch (reason) {
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillText(`⚠ ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillLoading(false)
    }
  }

  const toggleMcp = (key: string): void => {
    setOpenMcp(openMcp === key ? undefined : key)
  }

  const [surfaceBusy, setSurfaceBusy] = useState(false)
  const toggleSurface = async (surface: string, enabled: boolean): Promise<void> => {
    setSurfaceBusy(true)
    try {
      await postAction('set-surface', { sourceId, suiteId, surface, enabled })
      const next = await fetchSuiteDetail(sourceId, suiteId)
      setDetail(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSurfaceBusy(false)
    }
  }

  /** Save or clear one server's MCP override, then refresh the detail. */
  const saveMcpOverride = async (serverKey: string, patch: Record<string, unknown> | null): Promise<void> => {
    setSurfaceBusy(true)
    try {
      await postAction('set-mcp-override', { sourceId, suiteId, serverKey, override: patch })
      const next = await fetchSuiteDetail(sourceId, suiteId)
      setDetail(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSurfaceBusy(false)
    }
  }

  const layoutLabel =
    detail === undefined
      ? ''
      : detail.layout === 'agent-plugin-v1'
        ? t('layoutV1')
        : detail.layout === 'claude-code'
          ? t('layoutCC')
          : detail.layout === 'codex'
            ? t('layoutCodex')
            : detail.layout === 'universal'
              ? t('layoutUniversal')
              : detail.layout === 'cursor'
                ? t('layoutCursor')
                : detail.layout === 'kimi'
                  ? t('layoutKimi')
                  : detail.layout === 'remote'
                    ? t('layoutRemote')
                    : detail.layout === 'project-native'
                      ? t('layoutProjectNative')
                      : t('layoutSkills')

  return h(Modal, {
    open: true,
    onClose,
    title: detail === undefined ? t('detailTitle') : `${detail.name}${detail.version === null ? '' : ` v${detail.version}`}`,
    description: detail === undefined ? undefined : t('detailHint'),
    closeLabel: t('cancel'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h('div', { className: css.modalFooter }, h(Button, { variant: 'ghost', onClick: onClose }, t('cancel'))),
    children: h(ErrorBoundary, {
      fallback: boundaryError => h('div', { className: css.warnLine }, `${t('actionFail')}: ${boundaryError.message}`),
      children:
        error !== undefined
          ? h('div', { className: css.warnLine }, error)
          : detail === undefined
            ? h('div', { className: css.empty }, t('loading'))
            : h(
                'div',
                { className: css.detailSections },
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, t('overviewSection')),
                  h(
                    'div',
                    { className: css.detailGrid },
                    h('div', { className: css.detailCell }, h('span', { className: css.detailKey }, t('sourceLabel')), h('span', { className: css.detailValue }, detail.sourceId)),
                    h(
                      'div',
                      { className: css.detailCell },
                      h('span', { className: css.detailKey }, t('dimensionLabel')),
                      h('span', { className: css.detailValue }, detail.dimension === 'user' ? t('dimensionUser') : t('dimensionProject'))
                    ),
                    h('div', { className: css.detailCell }, h('span', { className: css.detailKey }, t('layoutLabel')), h('span', { className: css.detailValue }, layoutLabel)),
                    h(
                      'div',
                      { className: css.detailCell },
                      h('span', { className: css.detailKey }, t('statusLabel')),
                      h(
                        'span',
                        { className: detail.enabled ? css.okState : css.detailValue },
                        detail.installed ? (detail.enabled ? t('installedBadge') : t('disabledLabel')) : t('notInstalledLabel')
                      )
                    ),
                    detail.author === null
                      ? null
                      : h(
                          'div',
                          { className: css.detailCell },
                          h('span', { className: css.detailKey }, t('authorLabel')),
                          h('span', { className: css.detailValue }, detail.author)
                        ),
                    detail.keywords.length === 0
                      ? null
                      : h(
                          'div',
                          { className: css.detailCell },
                          h('span', { className: css.detailKey }, t('keywordsLabel')),
                          h('span', { className: css.detailValue }, detail.keywords.join(', '))
                        )
                  ),
                  detail.description === null ? null : h('p', { className: css.detailDesc }, detail.description),
                  h('div', { className: css.detailCell }, h('span', { className: css.detailKey }, t('rootLabel')), h('span', { className: css.mono }, detail.root)),
                  detail.installed === false || detail.surfaceToggles === null
                    ? null
                    : h(
                        'div',
                        { className: css.detailCell },
                        h('span', { className: css.detailKey }, t('surfaceTogglesSection')),
                        h(
                          'div',
                          { className: css.surfaceToggles, title: t('surfaceTogglesHint') },
                          ...SURFACE_TOGGLE_ROWS.map(([key, labelKey]) =>
                            h('label', { key, className: css.surfaceToggle }, h('input', {
                              type: 'checkbox',
                              checked: detail.surfaceToggles![key],
                              disabled: surfaceBusy,
                              onChange: event => {
                                void toggleSurface(key, (event.target as HTMLInputElement).checked)
                              }
                            }), t(labelKey))
                          )
                        )
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('skillsSection')} (${detail.skills.length})`),
                  detail.skills.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.skills.map(skill =>
                        h(
                          'div',
                          { key: skill.name, className: css.detailItem },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: openSkill === skill.name ? css.detailItemOpen : css.detailItemRow,
                              onClick: () => {
                                void toggleSkill(skill.name)
                              }
                            },
                            h('span', { className: css.detailItemName }, skill.name),
                            h('span', { className: css.detailItemDesc }, skill.description),
                            h('span', { className: css.detailChevron }, openSkill === skill.name ? '▾' : '▸')
                          ),
                          openSkill !== skill.name ? null : h('div', { className: css.skillContent }, skillLoading ? t('loading') : h(MarkdownText, { text: skillText ?? '' }))
                        )
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('mcpSection')} (${detail.mcpServers.length})`),
                  detail.mcpErrors.length === 0
                    ? null
                    : h('div', { className: css.warnLine, style: { margin: '0 0 6px' } }, `⚠ ${detail.mcpErrors.join(t('sourceErrorSeparator'))}`),
                  detail.mcpServers.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.mcpServers.map(server => {
                        const override = detail.mcpOverrides?.[server.key]
                        const overridden = override !== undefined && Object.keys(override).length > 0
                        const disabled = override?.enabled === false
                        return h(
                          'div',
                          { key: server.key, className: css.detailItem },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: openMcp === server.key ? css.detailItemOpen : css.detailItemRow,
                              onClick: () => toggleMcp(server.key)
                            },
                            h('span', { className: css.detailItemName }, server.key),
                            h(
                              'span',
                              { className: css.detailItemDesc },
                              `${mcpSummary(server)}${disabled ? ` · ${t('mcpOverrideDisabledBadge')}` : overridden ? ` · ${t('mcpOverriddenBadge')}` : ''}`
                            ),
                            h('span', { className: css.detailChevron }, openMcp === server.key ? '▾' : '▸')
                          ),
                          openMcp === server.key
                            ? h(
                                'div',
                                { className: css.skillContent },
                                detail.installed && detail.surfaceToggles?.mcp !== false
                                  ? h(McpOverrideEditor, {
                                      t,
                                      serverKey: server.key,
                                      transport: server.type,
                                      override: override ?? {},
                                      busy: surfaceBusy,
                                      onSave: patch => saveMcpOverride(server.key, patch),
                                      onReset: () => saveMcpOverride(server.key, null)
                                    })
                                  : null,
                                h('pre', { className: css.mono }, JSON.stringify(server, null, 2))
                              )
                            : null
                        )
                      })
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('commandsSection')} (${detail.commands.length})`),
                  detail.commands.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.commands.map(command =>
                        h(PreviewRow, {
                          key: `c:${command.name}`,
                          t,
                          name: `/${command.name}`,
                          description: command.description,
                          open: openPreview === `c:${command.name}`,
                          onToggle: () => setOpenPreview(openPreview === `c:${command.name}` ? undefined : `c:${command.name}`),
                          children: h(MarkdownText, { text: command.content })
                        })
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('agentsSection')} (${detail.agents.length})`),
                  detail.agents.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.agents.map(agent =>
                        h(PreviewRow, {
                          key: `a:${agent.name}`,
                          t,
                          name: agent.name,
                          description: agent.description,
                          open: openPreview === `a:${agent.name}`,
                          onToggle: () => setOpenPreview(openPreview === `a:${agent.name}` ? undefined : `a:${agent.name}`),
                          children: h(MarkdownText, { text: agent.content })
                        })
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('hooksLabel')} (${detail.hooks.count})`),
                  detail.hooks.count === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.hooks.entries.map((hook, index) =>
                        h(PreviewRow, {
                          key: `h:${index}`,
                          t,
                          name: hook.event,
                          description: hook.command,
                          open: openPreview === `h:${index}`,
                          onToggle: () => setOpenPreview(openPreview === `h:${index}` ? undefined : `h:${index}`),
                          children: h('pre', { className: css.mono }, JSON.stringify(hook, null, 2))
                        })
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('lspSection')} (${detail.lsp.length})`),
                  detail.lsp.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.lsp.map(entry =>
                        h(PreviewRow, {
                          key: `l:${entry.name}`,
                          t,
                          name: entry.name,
                          open: openPreview === `l:${entry.name}`,
                          onToggle: () => setOpenPreview(openPreview === `l:${entry.name}` ? undefined : `l:${entry.name}`),
                          children: h('pre', { className: css.mono }, entry.content)
                        })
                      )
                ),
                detail.errors.length === 0
                  ? null
                  : h(
                      'section',
                      { className: css.detailSection },
                      h('h4', { className: css.detailHead }, `${t('errors')} (${detail.errors.length})`),
                      detail.errors.map((entry, index) => h('div', { key: index, className: css.warnLine }, entry))
                    )
              )
    })
  })
}

function mcpSummary(server: McpServerDetail): string {
  if (server.type === 'stdio') return server.command ?? server.type
  return server.url ?? server.type
}

/** Parse `KEY=VALUE` lines into a record; blank and comment lines are skipped. */
function parseKvLines(text: string): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Format a record back into sorted `KEY=VALUE` lines for editing. */
function formatKvLines(map: Record<string, string> | undefined): string {
  if (map === undefined) return ''
  return Object.keys(map)
    .sort()
    .map(key => `${key}=${map[key]}`)
    .join('\n')
}

type OverridePatch = Record<string, unknown>

/**
 * Per-server MCP override editor: enable/disable plus connection-input
 * replacement (url/headers for http servers, args/env for stdio). The
 * suite's own mcp.json stays source-owned; everything here persists as a
 * user override layered on top at mount time.
 */
function McpOverrideEditor(props: {
  t: Translate
  serverKey: string
  transport: string
  override: Record<string, unknown>
  busy: boolean
  onSave: (patch: OverridePatch) => Promise<void>
  onReset: () => Promise<void>
}): ReactNode {
  const { t, transport, override, busy } = props
  const [draft, setDraft] = useState<OverridePatch>(override)
  const kvHint = t('mcpOverrideKvHint')
  const isHttp = transport !== 'stdio'
  /** Gather the draft fields into one sanitized override patch and save it. */
  const submit = (): void => {
    const patch: OverridePatch = {}
    patch['enabled'] = draft['enabled'] !== false
    if (isHttp && typeof draft['url'] === 'string' && draft['url'] !== '') patch['url'] = draft['url']
    const headerText = isHttp ? String(draft['__headers'] ?? '') : ''
    const headers = parseKvLines(headerText)
    if (headers !== undefined) patch['headers'] = headers
    const envText = !isHttp ? String(draft['__env'] ?? '') : ''
    const env = parseKvLines(envText)
    if (env !== undefined) patch['env'] = env
    const argsText = !isHttp ? String(draft['__args'] ?? '') : ''
    const args = argsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
    if (args.length > 0) patch['args'] = args
    void props.onSave(patch)
  }
  return h(
    'div',
    { className: css.mcpOverrideForm },
    h(
      'label',
      { className: css.mcpOverrideCheck },
      h('input', {
        type: 'checkbox',
        checked: draft['enabled'] !== false,
        disabled: busy,
        onChange: event => setDraft({ ...draft, enabled: (event.target as HTMLInputElement).checked })
      }),
      t('mcpOverrideEnabled')
    ),
    isHttp
      ? h('input', {
          className: css.mcpOverrideInput,
          value: typeof draft['url'] === 'string' ? draft['url'] : '',
          placeholder: t('mcpOverrideUrlLabel'),
          disabled: busy,
          onChange: event => setDraft({ ...draft, url: (event.target as HTMLInputElement).value })
        })
      : null,
    isHttp
      ? h('textarea', {
          className: css.mcpOverrideArea,
          rows: 3,
          placeholder: t('mcpOverrideHeadersLabel'),
          title: kvHint,
          value: typeof draft['__headers'] === 'string' ? draft['__headers'] : formatKvLines(override['headers'] as Record<string, string> | undefined),
          disabled: busy,
          onChange: (event: { target: EventTarget | null }) => setDraft({ ...draft, __headers: (event.target as HTMLTextAreaElement).value })
        })
      : null,
    !isHttp
      ? h('textarea', {
          className: css.mcpOverrideArea,
          rows: 3,
          placeholder: t('mcpOverrideEnvLabel'),
          title: kvHint,
          value: typeof draft['__env'] === 'string' ? draft['__env'] : formatKvLines(override['env'] as Record<string, string> | undefined),
          disabled: busy,
          onChange: (event: { target: EventTarget | null }) => setDraft({ ...draft, __env: (event.target as HTMLTextAreaElement).value })
        })
      : null,
    !isHttp
      ? h('textarea', {
          className: css.mcpOverrideArea,
          rows: 3,
          placeholder: t('mcpOverrideArgsLabel'),
          value: typeof draft['__args'] === 'string' ? draft['__args'] : Array.isArray(override['args']) ? (override['args'] as string[]).join('\n') : '',
          disabled: busy,
          onChange: (event: { target: EventTarget | null }) => setDraft({ ...draft, __args: (event.target as HTMLTextAreaElement).value })
        })
      : null,
    h('div', { className: css.mcpOverrideActions },
      h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: submit }, t('mcpOverrideSave')),
      h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => void props.onReset() }, t('mcpOverrideReset'))
    ),
    h('div', { className: css.detailItemDesc }, kvHint)
  )
}

function PreviewRow(props: { t: Translate; name: string; description?: string; open: boolean; onToggle: () => void; children: ReactNode }): ReactNode {
  const { name, description, open, onToggle, children } = props
  return h(
    'div',
    { className: css.detailItem },
    h(
      'button',
      {
        type: 'button',
        className: open ? css.detailItemOpen : css.detailItemRow,
        onClick: onToggle
      },
      h('span', { className: css.detailItemName }, name),
      description === undefined ? null : h('span', { className: css.detailItemDesc }, description),
      h('span', { className: css.detailChevron }, open ? '▾' : '▸')
    ),
    open ? h('div', { className: css.skillContent }, children) : null
  )
}
