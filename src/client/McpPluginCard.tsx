/**
 * The Agent Plugins Market card on the host's 插件配置 (plugin configuration)
 * tab: the market feature's configuration entry, named after the market
 * itself. Disclosed inside is the MCP enhancement switch — ON (default)
 * mounts suite MCP servers through the market's built-in bridge (OAuth
 * authorization, SSE, browser-leg hold); OFF falls back to the host's
 * `dsh-mcp-client` compatibility client.
 *
 * The switch state is the market's host settings namespace (bound by the
 * client entry), so a flip persists through the host settings document and
 * the node half's namespace watcher remounts the servers. The host client
 * version probe rides the market's own API.
 */
import { createElement as h, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { McpBackendInfo } from './api.js'
import css from './market.module.css'

/** Locale subset the card needs (structural — the host binds the real one). */
type CardTranslate = (key: string, params?: Record<string, unknown>) => string

/** The bound settings-namespace face the client entry hands the card. */
export interface McpEnhanceScopeFace {
  /** Whether the enhancement is on; defaults to true before the first answer. */
  enhanced(): boolean
  /** Whether the host settings document accepts writes. */
  writable(): boolean
  subscribe(listener: () => void): () => void
  setEnhanced(next: boolean): Promise<void>
}

export interface McpPluginCardProps {
  t: CardTranslate
  scope: McpEnhanceScopeFace
  /** Live host-client probe (availability + version) from the market API. */
  probe: () => Promise<McpBackendInfo>
}

export function McpPluginCard({ t, scope, probe }: McpPluginCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const [probeInfo, setProbeInfo] = useState<McpBackendInfo | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => scope.subscribe(() => setTick(tick => tick + 1)), [scope])

  const refreshProbe = useCallback(async () => {
    try {
      setProbeInfo(await probe())
    } catch {
      // The version line degrades silently; the switch still works.
    }
  }, [probe])

  useEffect(() => { void refreshProbe() }, [refreshProbe])

  const enhanced = scope.enhanced()
  const writable = scope.writable()
  // Compat mode requires the host client to resolve; the enhanced (built-in)
  // client is always available because it ships inside this plugin.
  const hostUsable = probeInfo?.hostClient.available === true

  const onToggle = (): void => {
    if (busy || !writable) return
    const next = !enhanced
    if (!next && !hostUsable) {
      setError(t('mcpBackendHostMissing'))
      return
    }
    setBusy(true)
    setError(undefined)
    void scope.setEnhanced(next).then(() => {
      setBusy(false)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    })
  }

  return h(
    'div',
    { className: css.pluginCard, 'data-busy': busy ? 'true' : undefined },
    h(
      'button',
      {
        type: 'button',
        className: css.pluginCardHeader,
        'aria-expanded': open,
        onClick: () => { setOpen(current => !current) },
      },      h(
        'div',
        { className: css.pluginCardText },
        h('div', { className: css.pluginCardTitle }, t('nav')),
        h('div', { className: css.pluginCardDesc }, t('marketCardDesc'))
      ),
      h('span', { className: open ? `${css.pluginChevron} ${css.pluginChevronOpen}` : css.pluginChevron }, '▾')
    ),
    open
      ? h(
          'div',
          { className: css.pluginCardBody },
          h(
            'div',
            { className: css.pluginCardRow },
            h(
              'div',
              { className: css.pluginCardText },
              h('div', { className: css.pluginCardRowLabel }, t('mcpCardTitle')),
              h('div', { className: css.pluginCardDesc }, enhanced ? t('mcpCardDescOn') : t('mcpCardDescOff'))
            ),
            h('button', {
              type: 'button',
              role: 'switch',
              'aria-checked': enhanced,
              'aria-label': t('mcpCardTitle'),
              disabled: busy || !writable,
              title: writable ? undefined : t('mcpCardReadonly'),
              className: enhanced ? css.pluginSwitchOn : css.pluginSwitchOff,
              onClick: onToggle,
            }, h('span', { className: css.pluginSwitchThumb }))
          ),
          error !== undefined
            ? h('div', { className: css.pluginCardError }, error)
            : null,
          probeInfo?.hostClient.available === true && probeInfo.hostClient.version !== undefined
            ? h('div', { className: css.pluginCardMeta }, `dsh-mcp-client ${probeInfo.hostClient.version}`)
            : null
        )
      : null
  )
}
