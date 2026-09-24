import { useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, IconRefreshOutlineMedium, IconSearchOutlineMedium, Input, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { FailureReport } from '../../ui/FailureReport.js'
import { failureGuidanceKey } from '../../ui/failure-guidance.js'
import type { Translate } from '../../index.js'
import type { McpStatusEntry } from '../../api.js'
import type { CredentialApi } from '../../credentials.js'
import { McpCredentialEditor } from './McpCredentialEditor.js'
import { mcpDetailActions } from './detail-actions.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { credentialUsage, TOOL_PAGE_SIZE, toolParameterRows } from './detail-helpers.js'
import { kvCell, mcpDotState, mcpReportTone, mcpStateLabel, mcpTagTone } from './state-helpers.js'
import { mcpToolRows } from './mcp-status-view-model.js'
import { setMcpServerEnabled, setMcpServerTool } from '../../api.js'
import css from './mcp-status.module.css'
import panelCss from '../../ui/panel.module.css'

export function McpDetailModal({
  entry,
  t,
  credentials,
  backend,
  onClose,
  onRetry,
  onReauthorize,
  onRefresh
}: {
  entry: McpStatusEntry
  t: Translate
  credentials?: CredentialApi
  /** The mount backend; `host` cannot enforce tool filters. */
  backend: 'builtin' | 'host'
  onClose: () => void
  onRetry: (entryId: string) => Promise<McpStatusEntry>
  onReauthorize: (id: string, serverName: string) => Promise<McpStatusEntry>
  onRefresh: (id: string) => Promise<McpStatusEntry>
}): ReactNode {
  const [pending, setPending] = useState(false)
  const [confirmAuth, setConfirmAuth] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  const [toolBusy, setToolBusy] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [toolSearch, setToolSearch] = useState('')
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [enabledBusy, setEnabledBusy] = useState(false)
  const actions = mcpDetailActions(entry)
  const guidance = failureGuidanceKey({ code: entry.code, reason: entry.reason, causes: entry.causes })
  const tools = mcpToolRows(entry)
  const needle = toolSearch.trim().toLowerCase()
  const matchingTools = needle === '' ? tools : tools.filter(tool => tool.name.toLowerCase().includes(needle))
  const shownTools = toolsExpanded ? matchingTools : matchingTools.slice(0, TOOL_PAGE_SIZE)
  const hiddenToolCount = matchingTools.length - shownTools.length
  // A foreign mount belongs to another owner, and a host-observed row has no
  // declaration here, so those tool lists stay read-only; a declared server
  // keeps a switch per tool.
  /** A server this plugin owns: it can be edited, probed, and have its tools chosen. */
  const editableServer = entry.suiteId !== undefined && entry.serverKey !== undefined && entry.state !== 'foreign'
  const toolsEditable = editableServer
  const toggleTool = (tool: string, enabled: boolean): void => {
    const suiteId = entry.suiteId
    const serverKey = entry.serverKey
    if (suiteId === undefined || serverKey === undefined) return
    setToolBusy(true)
    setFeedback(undefined)
    void setMcpServerTool(suiteId, serverKey, tool, enabled)
      .then(() => onRefresh(entry.id))
      .catch(reason => setFeedback({ error: true, text: clientErrorMessage(t, reason) }))
      .finally(() => setToolBusy(false))
  }
  /** Switch the whole server on or off through the same override the card's switch writes. */
  const toggleEnabled = (): void => {
    const suiteId = entry.suiteId
    const serverKey = entry.serverKey
    if (suiteId === undefined || serverKey === undefined) return
    setEnabledBusy(true)
    setFeedback(undefined)
    void setMcpServerEnabled(suiteId, serverKey, entry.state === 'disabled')
      .then(() => onRefresh(entry.id))
      .catch(reason => setFeedback({ error: true, text: clientErrorMessage(t, reason) }))
      .finally(() => setEnabledBusy(false))
  }
  const run = async (authorize: boolean): Promise<void> => {
    setConfirmAuth(false)
    setPending(true)
    setFeedback(undefined)
    try {
      const current = authorize ? await onReauthorize(entry.id, entry.name) : await onRetry(entry.id)
      const connected = current.state === 'connected'
      // The reason itself is reported by the block below, from the row the
      // operation just refreshed, so this echo only says what the operation did.
      setFeedback({ error: !connected, text: connected ? t('mcpRetrySuccess') : t('mcpStillUnavailable') })
    } catch (reason) {
      setFeedback({ error: true, text: t('actionFail') + ': ' + clientErrorMessage(t, reason) })
    } finally {
      setPending(false)
    }
  }
  return h(DetailModal, {
    open: true,
    onClose: () => {
      if (!pending) onClose()
    },
    title: entry.name,
    description: t('mcpServiceDetail'),
    closeLabel: t('mcpClose'),
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      actions.reauthorize
        ? h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              disabled: pending,
              title: t('mcpReauthExplain'),
              onClick: () => {
                setConfirmAuth(true)
                setFeedback(undefined)
              }
            },
            t('mcpReauthorize')
          )
        : null,
      h(Button, { variant: 'ghost', disabled: pending, onClick: onClose }, t('mcpClose')),
      // The one switch reads last, at the action cluster's trailing edge.
      entry.suiteId === undefined || entry.serverKey === undefined
        ? null
        : h(Switch, {
            checked: entry.state !== 'disabled',
            disabled: pending || enabledBusy,
            label: t('mcpEnabledLabel'),
            title: t('mcpEnabledLabel'),
            onChange: () => toggleEnabled()
          })
    ),
    children: h(
      'div',
      null,
      feedback ? h('p', { role: feedback.error ? 'alert' : 'status', className: feedback.error ? css.error : css.retryEchoSuccess }, feedback.text) : null,
      confirmAuth
        ? h(
            'section',
            { className: css.confirmPanel, role: 'alert' },
            h('p', null, t('mcpReauthExplain')),
            h(Button, { variant: 'ghost', onClick: () => setConfirmAuth(false) }, t('cancel')),
            h(
              Button,
              {
                variant: 'primary',
                disabled: pending,
                onClick: () => {
                  void run(true)
                }
              },
              t('mcpConfirmReauth')
            )
          )
        : null,
      h(
        'div',
        { className: panelCss.hero },
        h(StateDot, { state: mcpDotState(entry.state) }),
        h(
          'div',
          { className: panelCss.heroText },
          h(
            'div',
            { className: panelCss.heroLine },
            h(Tag, { tone: mcpTagTone(entry.state) }, mcpStateLabel(t, entry.state)),
            h(Tag, null, entry.kind === 'plugin' ? t('mcpPlugin') : t('mcpDirect')),
            h(Tag, { tone: 'quiet' }, entry.transport),
            // A server that declares no `auth` block still runs the OAuth flow
            // when it answers 401, and the redacted configuration cannot show
            // that, so the note rides on the status band.
            entry.oauthDefault === true ? h(Tag, { tone: 'quiet' }, t('mcpOauthDefault')) : null
          ),
          h('p', { className: panelCss.heroMono }, entry.endpoint ?? t('mcpObservedEndpoint'))
        )
      ),
      h(
        'div',
        { className: panelCss.block },
        h('h4', { className: panelCss.blockHead }, t('overviewSection')),
        h(
          'dl',
          { className: panelCss.kvGrid },
          kvCell(t('sourceLabel'), entry.kind === 'plugin' ? entry.suiteId ?? entry.source ?? '—' : t('mcpDirect'), true),
          kvCell(t('detailTypeLabel'), entry.kind === 'plugin' ? t('panelSourcePlugin') : t('panelSourceUser')),
          kvCell(t('detailTransport'), entry.transport, true),
          kvCell(t('mcpServerKeyLabel'), entry.serverKey ?? entry.name, true)
        )
      ),
      // Every state with something to report renders through the one failure
      // report: the sentence the classifier picked leads, the recorded
      // diagnostic stays behind its disclosure, and the state's one recovery
      // action rides inside. A state that is not a failure keeps the
      // informational tone instead of the error fill.
      entry.reason !== undefined || actions.retry || entry.state === 'foreign'
        ? h(
            'div',
            { className: panelCss.block },
            h('h4', { className: panelCss.blockHead }, t('mcpReasonLabel')),
            h(FailureReport, {
              t,
              tone: mcpReportTone(entry.state),
              ...(guidance === undefined ? {} : { guidance }),
              detail: [entry.reason, ...(entry.causes ?? [])].filter((line): line is string => line !== undefined),
              // The state names one way out; the dialog footer keeps the rest.
              ...(actions.retry
                ? {
                    action: h(
                      Button,
                      {
                        variant: 'outline',
                        size: 'sm',
                        disabled: pending,
                        title: t('mcpRetryPreservesCredentials'),
                        onClick: () => {
                          void run(false)
                        }
                      },
                      h(IconRefreshOutlineMedium),
                      t('mcpRetryConnection')
                    )
                  }
                : {})
            })
          )
        : null,
      entry.kind === 'direct' && !entry.managed ? h(FailureReport, { t, tone: 'info', headline: t('mcpDirectBoundary') }) : null,
      h(
        'div',
        { className: panelCss.block },
        h(
          'div',
          { className: css.blockHeadRow },
          h('h4', { className: panelCss.blockHead }, `${t('mcpTools')} (${tools.length})`),
          // A long capability list is worth filtering; a short one needs no
          // control above it.
          tools.length > TOOL_PAGE_SIZE
            ? h(
                'label',
                { className: css.toolSearch },
                h(Input, {
                  icon: h(IconSearchOutlineMedium),
                  value: toolSearch,
                  placeholder: t('mcpToolsSearch'),
                  'aria-label': t('mcpToolsSearch'),
                  onChange: (event: { target: { value: string } }) => setToolSearch(event.target.value)
                })
              )
            : null
        ),
        toolsEditable && backend === 'host' ? h('p', { className: css.blockSub }, t('mcpHostToolsUnsupported')) : null,
        tools.length === 0
          ? h('p', { className: panelCss.detailProse }, entry.advertisedTools === false && entry.state === 'degraded' ? t('mcpZeroTools') : t('mcpNoTools'))
          : matchingTools.length === 0
            ? h('p', { className: panelCss.detailProse }, t('mcpToolsNoMatch'))
            : h(
                'div',
                { className: css.toolList },
                shownTools.map(tool =>
                  h(
                    'div',
                    { key: tool.name, className: css.tool },
                    h(
                      'span',
                      { className: css.toolIdentity },
                      toolsEditable
                        ? h('input', {
                            type: 'checkbox',
                            checked: tool.allowed,
                            disabled: toolBusy || tool.suiteLimited || backend === 'host',
                            'aria-label': `${t('mcpAllowTool')} ${tool.name}`,
                            onChange: (event: { target: HTMLInputElement }) => toggleTool(tool.name, event.target.checked)
                          })
                        : null,
                      // A name with a schema is the control that reveals what the tool takes.
                      tool.parameters === undefined
                        ? h('span', { className: css.toolName }, tool.name)
                        : h(
                            'button',
                            {
                              type: 'button',
                              className: `${css.toolName} ${css.toolNameButton}`,
                              'aria-expanded': expandedTools[tool.name] === true,
                              onClick: () => setExpandedTools(current => ({ ...current, [tool.name]: current[tool.name] !== true }))
                            },
                            tool.name
                          )
                    ),
                    h('span', { className: css.toolDescription }, tool.description ?? ''),
                    h('span', { className: css.toolNote }, tool.suiteLimited ? t('mcpToolSuiteLimited') : ''),
                    expandedTools[tool.name] === true ? h('div', { className: css.toolParams }, toolParameterRows(tool.parameters, t)) : null
                  )
                ),
                hiddenToolCount > 0
                  ? h(
                      'button',
                      { type: 'button', className: css.toolMore, onClick: () => setToolsExpanded(true) },
                      t('mcpToolsMore', { count: hiddenToolCount })
                    )
                  : null
              )
      ),
      entry.credentialRefs?.length === 0 || entry.credentialRefs === undefined
        ? null
        : h(McpCredentialEditor, { t, api: credentials, refs: entry.credentialRefs, usage: credentialUsage(t, entry.config) })
    )
  })
}

/**
 * The editor dialog: one scroll column of form fields, opened from the detail
 * dialog's service-configuration block. Reporting and changing live in separate
 * dialogs, so neither has to share the other's layout.
 */
