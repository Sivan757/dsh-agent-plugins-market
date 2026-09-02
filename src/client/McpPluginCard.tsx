/**
 * The Agent Plugins Market card on the host's 插件配置 (plugin configuration)
 * tab: the market feature's configuration entry, named after the market
 * itself. Disclosed inside is the MCP enhancement switch — ON (default)
 * mounts suite MCP servers through the market's built-in bridge (OAuth
 * authorization, SSE, browser-leg hold); OFF falls back to the host's
 * `dsh-mcp-client` compatibility client.
 *
 * The card lives in the host card list via the `settings.plugin.item` slot
 * (the same seat dshmarket uses), while the state stays on the market's own
 * backend API — the host settings document is not touched, so no settings
 * schema or host restart is involved.
 */
import { createElement as h, useCallback, useEffect, useState, type ReactNode } from 'react'
import { fetchMcpBackend, setMcpBackend, type McpBackendInfo } from './api.js'
import css from './market.module.css'

/** Locale subset the card needs (structural — the host binds the real one). */
type CardTranslate = (key: string, params?: Record<string, unknown>) => string

export interface McpPluginCardProps {
  t: CardTranslate
}

export function McpPluginCard({ t }: McpPluginCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<McpBackendInfo | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setInfo(await fetchMcpBackend())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // While the first answer is in flight the switch renders ON-but-disabled:
  // the built-in client is the default, so on is the honest resting state.
  const enhanced = info === undefined ? true : info.backend === 'builtin'
  // Compat mode requires the host client to resolve; the enhanced (built-in)
  // client is always available because it ships inside this plugin.
  const hostUsable = info?.hostClient.available === true

  const onToggle = (): void => {
    if (info === undefined || busy) return
    const next = enhanced ? 'host' : 'builtin'
    if (next === 'host' && !hostUsable) {
      setError(t('mcpBackendHostMissing'))
      return
    }
    setBusy(true)
    setError(undefined)
    void (async () => {
      try {
        setInfo(await setMcpBackend(next))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    })()
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
      },
      h(
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
              disabled: busy || info === undefined,
              className: enhanced ? css.pluginSwitchOn : css.pluginSwitchOff,
              onClick: onToggle,
            }, h('span', { className: css.pluginSwitchThumb }))
          ),
          error !== undefined
            ? h('div', { className: css.pluginCardError }, error)
            : null,
          info?.hostClient.available === true && info.hostClient.version !== undefined
            ? h('div', { className: css.pluginCardMeta }, `dsh-mcp-client ${info.hostClient.version}`)
            : null
        )
      : null
  )
}
