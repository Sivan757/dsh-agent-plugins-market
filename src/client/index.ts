/**
 * dsh-agent-plugins-market client: registers the Agent Plugins Market section inside the Web
 * GUI's settings page (the same settings.section seat dshmarket uses), with a
 * guarded legacy top-level page fallback for older shells. The bundle's
 * browser externals are React, ReactDOM, and the injected `dsh.client.inject`
 * module table, so it cannot reach packages the host does not serve.
 */
import { createElement as h } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchMcpBackend } from './api.js'
import { en, zh, type LocaleKey } from './locales.js'
import { MarketSection } from './MarketSection.js'
import { McpStatusPanel } from './McpStatusPanel.js'
import { LspStatusPanel } from './LspStatusPanel.js'
import { McpPluginCard } from './McpPluginCard.js'
import type { CredentialApi } from './credentials.js'
import { LEGACY_PAGE_MODE_SURFACE_EVENT, mountLegacyPageMode } from './page-mode.js'

const NS = 'dsh-agent-plugins-market'

export type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** The subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): Translate
  subscribe?: (listener: () => void) => () => void
}

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** The subset of the host settings-scope service this plugin touches. */
interface SettingsScopeService {
  bind(options: { namespace: string }): {
    getSnapshot(): { value?: { mcpEnhanced?: boolean; downloadRegion?: string }; writable: boolean }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
  }
}

/** The client cordis context this plugin relies on (structural subset). */
interface SuiteClientContext {
  effect(callback: () => unknown, label?: string): void
  /** Late service resolution; absent on hosts predating cross-plugin inject. */
  inject?(services: string[], callback: (resolved: Record<string, unknown>) => void): void
  locale: LocaleService
  slots: SlotsService
  connection: { api: { credentials: CredentialApi } }
}

export const name = 'dsh-agent-plugins-market'
export const inject = ['slots', 'locale', 'connection']
export const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'Tooltip'] as const

/**
 * Register the MCP enhancement card into the host's shared 插件配置 tab
 * (`settings.plugin.item`), the same seat dshmarket uses. Called through
 * `ctx.inject(['settingsScope'])` at apply time; a host without the
 * settingsScope service simply skips the card.
 */

/** Detect host primitives that predate the exports this UI relies on. */
export function missingPrimitives(module: Record<string, unknown>, required: readonly string[] = REQUIRED_PRIMITIVES): string[] {
  return required.filter(name => module[name] === undefined)
}

export function apply(ctx: SuiteClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-agent-plugins: dictionaries')
  const t = ctx.locale.bind(NS)
  const credentials = ctx.connection.api.credentials

  const gaps = missingPrimitives(primitives as unknown as Record<string, unknown>)
  if (gaps.length > 0) {
    console.warn(`[dsh-agent-plugins-market] host ui-primitives missing ${gaps.join(', ')} — Agent Plugins Market section disabled (dsh web >= 0.1.0-rc.6 required)`)
    return
  }

  let settingsSurfaceAvailable = false
  ctx.effect(() => mountLegacyPageMode({
    t,
    credentials,
    isSettingsSurfaceAvailable: () => settingsSurfaceAvailable,
    subscribeLocale: ctx.locale.subscribe === undefined ? undefined : (listener) => ctx.locale.subscribe!(listener),
  }), 'dsh-agent-plugins-market: legacy page mode')

  // The host 插件配置 tab card. Registration rides the injected scope's slots
  // (the dshmarket / dsh-rewind pattern), and the card state binds the
  // market's settings namespace — the namespace the node half registers,
  // which is also what makes the tab serve our card at all.
  ctx.inject?.(['settingsScope'], (scoped: { settingsScope?: SettingsScopeService; slots?: SlotsService }) => {
    const service = scoped.settingsScope
    const slots = scoped.slots
    if (service === undefined || slots === undefined) return
    const tCard = ctx.locale.bind(NS)
    const scope = service.bind({ namespace: NS })
    slots.inject('settings.plugin.item', () =>
      slots.register({
        name: 'settings.plugin.item',
        key: NS,
        locale: NS,
        inject: () => ({ t: tCard }),
      }, () => h(McpPluginCard, {
        t: key => tCard(key as LocaleKey),
        scope: {
          enhanced: () => scope.getSnapshot().value?.mcpEnhanced !== false,
          writable: () => scope.getSnapshot().writable,
          subscribe: listener => scope.subscribe(listener),
          setEnhanced: next => scope.set('mcpEnhanced', next),
          region: () => {
            const value = scope.getSnapshot().value?.downloadRegion
            return value === 'global' || value === 'china' ? value : 'auto'
          },
          setRegion: next => scope.set('downloadRegion', next)
        },
        probe: () => fetchMcpBackend(),
      })),
    )
  })

  ctx.slots.inject('settings.section', () => {
    settingsSurfaceAvailable = true
    notifyPageModeSurfaceChange()
    const marketDispose = ctx.slots.register({
      name: 'settings.section',
      id: 'agent-plugin',
      order: 45,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(MarketSection, {
      t,
      credentials,
      mode: 'settings',
    }))
    const mcpDispose = ctx.slots.register({
      name: 'settings.section',
      id: 'mcp-status',
      order: 46,
      label: () => t('mcpStatusNav'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(McpStatusPanel, { t, credentials }))
    const lspDispose = ctx.slots.register({
      name: 'settings.section',
      id: 'lsp-status',
      order: 47,
      label: () => t('lspStatusNav'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(LspStatusPanel, { t }))
    return () => {
      settingsSurfaceAvailable = false
      notifyPageModeSurfaceChange()
      if (typeof mcpDispose === 'function') mcpDispose()
      if (typeof lspDispose === 'function') lspDispose()
      if (typeof marketDispose === 'function') marketDispose()
    }
  })
}

function notifyPageModeSurfaceChange(): void {
  if (typeof document !== 'undefined') document.dispatchEvent(new Event(LEGACY_PAGE_MODE_SURFACE_EVENT))
}
