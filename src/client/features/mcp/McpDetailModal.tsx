import { Fragment, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, IconRefreshOutlineMedium, IconSearchOutlineMedium, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { StatusBand, bandTone } from '../../ui/StatusBand.js'
import { failureGuidanceKey } from '../../ui/failure-guidance.js'
import type { Translate } from '../../index.js'
import type { McpStatusEntry } from '../../api.js'
import type { CredentialApi } from '../../credentials.js'
import { McpCredentialFields } from './McpCredentialFields.js'
import { mcpDetailActions } from './detail-actions.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { credentialUsage, TOOL_PAGE_SIZE, toolParameterRows } from './detail-helpers.js'
import { kvCell } from '../../ui/DetailRows.js'
import { mcpCardState, mcpDisplayName, mcpDotState, mcpStateLabel, mcpTagTone } from './state-helpers.js'
import { mcpToolRows } from './mcp-status-view-model.js'
import { setMcpServerTool } from '../../api.js'
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
  const actions = mcpDetailActions(entry)
  const guidance = failureGuidanceKey({ code: entry.code, reason: entry.reason, causes: entry.causes })
  const tools = mcpToolRows(entry)
  const needle = toolSearch.trim().toLowerCase()
  const matchingTools = needle === '' ? tools : tools.filter(tool => tool.name.toLowerCase().includes(needle))
  const shownTools = toolsExpanded ? matchingTools : matchingTools.slice(0, TOOL_PAGE_SIZE)
  const hiddenToolCount = matchingTools.length - shownTools.length
  // A foreign mount belongs to another owner and a host-observed row has no
  // declaration here, so both stay read-only; a declared server is this
  // plugin's to edit, probe, and pick tools for.
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
  const run = async (authorize: boolean): Promise<void> => {
    setConfirmAuth(false)
    setPending(true)
    setFeedback(undefined)
    try {
      const current = authorize ? await onReauthorize(entry.id, entry.name) : await onRetry(entry.id)
      const connected = current.state === 'connected'
      // The reason itself is reported by the band, from the row the operation
      // just refreshed, so this echo only says what the operation did.
      setFeedback({ error: !connected, text: connected ? t('mcpRetrySuccess') : t('mcpStillUnavailable') })
    } catch (reason) {
      setFeedback({ error: true, text: t('actionFail') + ': ' + clientErrorMessage(t, reason) })
    } finally {
      setPending(false)
    }
  }
  const recovery: ReactNode[] = []
  if (actions.retry) {
    recovery.push(
      h(
        Button,
        {
          key: 'retry',
          variant: 'outline',
          size: 'sm',
          disabled: pending,
          title: t('mcpRetryPreservesCredentials'),
          'aria-label': t('mcpRetryConnection'),
          onClick: () => {
            void run(false)
          }
        },
        h(IconRefreshOutlineMedium),
        t('mcpRetryConnection')
      )
    )
  }
  if (actions.reauthorize) {
    recovery.push(
      h(
        Button,
        {
          key: 'reauthorize',
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
    )
  }
  return h(DetailModal, {
    open: true,
    onClose: () => {
      if (!pending) onClose()
    },
    title: mcpDisplayName(entry),
    description: t('mcpServiceDetail'),
    closeLabel: t('mcpClose'),
    contentClassName: css.detailBody,
    children: h(
      'div',
      null,
      h(StatusBand, {
        t,
        dot: mcpDotState(entry.state),
        tone: bandTone(mcpCardState(entry.state)),
        labels: h(
          Fragment,
          null,
          h(Tag, { tone: mcpTagTone(entry.state) }, mcpStateLabel(t, entry.state)),
          h(Tag, null, entry.kind === 'plugin' ? t('mcpPlugin') : t('mcpDirect')),
          h(Tag, { tone: 'quiet' }, entry.transport),
          // A server that declares no `auth` block still runs the OAuth flow
          // when it answers 401, and the redacted configuration cannot show
          // that, so the note rides on the status band.
          entry.oauthDefault === true ? h(Tag, { tone: 'quiet' }, t('mcpOauthDefault')) : null
        ),
        ...(recovery.length === 0 ? {} : { action: recovery }),
        ...(feedback === undefined ? {} : { echo: feedback }),
        ...(guidance === undefined ? {} : { guidance }),
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(entry.causes === undefined ? {} : { causes: entry.causes }),
        mono: entry.endpoint ?? t('mcpObservedEndpoint')
      }),
      // The one destructive confirmation sits directly under the band it
      // belongs to, and keeps its in-line shape rather than becoming a panel
      // or the host's risk dialog.
      confirmAuth
        ? h(
            'div',
            { className: css.reauthConfirm, role: 'alert' },
            h('p', { className: css.reauthExplain }, t('mcpReauthExplain')),
            h(
              'div',
              { className: css.reauthActions },
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
          )
        : null,
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
          kvCell(t('mcpServerKeyLabel'), entry.serverKey ?? entry.name, true),
          // The mount identity the runtime registers, which is not always the
          // name the declaration uses.
          kvCell(t('mcpMountNameLabel'), entry.name, true)
        )
      ),
      entry.kind === 'direct' && !entry.managed ? h('p', { className: panelCss.detailProse }, t('mcpDirectBoundary')) : null,
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
          ? h(
              'p',
              { className: panelCss.detailProse },
              // A failed mount has no registry to read, so the empty list is a
              // symptom of the state rather than a statement about the server.
              entry.state === 'failed' || entry.state === 'orphaned'
                ? t('mcpToolsUnreachable')
                : entry.advertisedTools === false && entry.state === 'degraded'
                  ? t('mcpZeroTools')
                  : t('mcpNoTools')
            )
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
        : h(McpCredentialFields, { t, api: credentials, refs: entry.credentialRefs, usage: credentialUsage(t, entry.config) })
    )
  })
}

