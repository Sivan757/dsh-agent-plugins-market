/**
 * The MCP backend block on the plugin configuration page: which client mounts
 * suite servers — the market's built-in bridge (default; OAuth + SSE) or the
 * host's `dsh-mcp-client` (compatibility mode) — with a live availability
 * probe of the host package and a switch to change it.
 */
import { createElement as h, useCallback, useEffect, useState, type ReactNode } from 'react'
import { fetchMcpBackend, setMcpBackend, type McpBackendInfo } from './api.js'
import { ToggleSwitch } from './ui/ToggleSwitch.js'
import css from './market.module.css'
import type { Translate } from './index.js'

export interface McpBackendPanelProps {
  t: Translate
  /** Surface a switch result (or failure) through the section's toast. */
  onToast: (message: string) => void
}

export function McpBackendPanel({ t, onToast }: McpBackendPanelProps): ReactNode {
  const [info, setInfo] = useState<McpBackendInfo | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setInfo(await fetchMcpBackend())
    } catch {
      // The block degrades silently; the MCP status tab still shows mounts.
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const switchingToHost = info !== undefined && info.backend === 'builtin'
  const hostUsable = info?.hostClient.available === true

  const onToggle = (): void => {
    if (info === undefined || busy) return
    const next = info.backend === 'builtin' ? 'host' : 'builtin'
    // Enabling compat mode requires the host package to resolve; disabling it
    // (back to the built-in client) is always possible.
    if (next === 'host' && !hostUsable) {
      onToast(t('mcpBackendHostMissing'))
      return
    }
    setBusy(true)
    void (async () => {
      try {
        setInfo(await setMcpBackend(next))
        onToast(t('mcpBackendSwitched'))
      } catch (error) {
        onToast(`${t('actionFail')}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  const currentLabel = info === undefined
    ? t('loading')
    : info.backend === 'host' ? t('mcpBackendHost') : t('mcpBackendBuiltin')

  return h(
    'div',
    { className: css.backendBlock, 'data-busy': busy ? 'true' : undefined },
    h(
      'div',
      { className: css.backendRow },
      h('h3', { className: css.backendTitle }, t('mcpBackendTitle')),
      h(ToggleSwitch, {
        on: info?.backend === 'host',
        disabled: busy || info === undefined || (switchingToHost && !hostUsable),
        title: switchingToHost && !hostUsable ? t('mcpBackendHostMissing') : undefined,
        onChange: onToggle
      })
    ),
    h('p', { className: css.backendCurrent }, currentLabel),
    h('p', { className: css.backendHint },
      info !== undefined && info.backend === 'builtin' && !hostUsable ? t('mcpBackendHostMissing') : t('mcpBackendHint')),
    info?.hostClient.available === true && info.hostClient.version !== undefined
      ? h('p', { className: css.backendVersion }, `dsh-mcp-client ${info.hostClient.version}`)
      : null
  )
}
