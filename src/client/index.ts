/**
 * dsh-agent-plugins-market client: registers the Agent Plugins Market section inside the Web
 * GUI's settings page (the same settings.section seat dshmarket uses), with a
 * guarded legacy top-level page fallback for older shells. The bundle's
 * browser externals are React, ReactDOM, and the injected `dsh.client.inject`
 * module table, so it cannot reach packages the host does not serve.
 */
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { BusyOverlay } from './ui/BusyOverlay.js'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { MARKET_SETTINGS_NAMESPACE, type MarketSettings } from '../contracts/settings.js'
import { fetchMcpBackend } from './api.js'
import { en, zh, type LocaleKey } from './locales.js'
import { PluginWorkspace } from './PluginWorkspace.js'
import { McpPluginCard } from './McpPluginCard.js'
import { MarketPluginCardController } from './plugin-card-controller.js'
import { credentialApi, type CredentialRemote } from './credentials.js'
import { LEGACY_PAGE_MODE_SURFACE_EVENT, mountLegacyPageMode } from './page-mode.js'

/** The settings namespace this plugin registers, and the key the host pairs our card by. */
const NS = MARKET_SETTINGS_NAMESPACE

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
  /** Returns the registration's disposer; a host that keeps the seat until teardown returns nothing. */
  register(meta: Record<string, unknown>, component: (props: never) => unknown): (() => void) | undefined
}

/** The host settings-scope service: the browser mirror of a Host-owned namespace. */
interface SettingsScopeService {
  bind<T>(options: { namespace: string }): SettingsScope<T>
}

/** The client cordis context this plugin relies on (structural subset). */
interface SuiteClientContext {
  effect(callback: () => unknown, label?: string): void
  /** Late service resolution; absent on hosts predating cross-plugin inject. */
  inject?(services: string[], callback: (resolved: Record<string, unknown>) => void): void
  locale: LocaleService
  slots: SlotsService
  remote: { credentials: CredentialRemote }
}

export const name = 'dsh-agent-plugins-market'
export const inject = ['slots', 'locale', 'remote', 'remote.credentials']
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
  const credentials = credentialApi(ctx.remote.credentials)

  const gaps = missingPrimitives(primitives)
  if (gaps.length > 0) {
    console.warn(`[dsh-agent-plugins-market] host ui-primitives missing ${gaps.join(', ')} — Agent Plugins Market section disabled (dsh web >= 0.1.0-rc.6 required)`)
    return
  }

  let settingsSurfaceAvailable = false
  ctx.effect(() => {
    if (typeof document === 'undefined') return
    const element = document.createElement('div')
    element.dataset.agentPluginsBusyHost = ''
    document.body.append(element)
    const root = createRoot(element)
    root.render(h(BusyOverlay, { t }))
    return () => { root.unmount(); element.remove() }
  }, 'dsh-agent-plugins-market: operation overlay')
  ctx.effect(() => mountLegacyPageMode({
    t,
    credentials,
    isSettingsSurfaceAvailable: () => settingsSurfaceAvailable,
    subscribeLocale: ctx.locale.subscribe === undefined ? undefined : (listener) => ctx.locale.subscribe!(listener),
  }), 'dsh-agent-plugins-market: legacy page mode')

  // The host 插件配置 tab card. Registration rides the injected scope's slots
  // (the dshmarket / dsh-rewind pattern): the card's form binds the market's
  // settings namespace — the namespace the node half registers, which is also
  // what makes the tab serve our card at all.
  ctx.inject?.(['settingsScope'], (scoped: { settingsScope?: SettingsScopeService; slots?: SlotsService }) => {
    const service = scoped.settingsScope
    const slots = scoped.slots
    if (service === undefined || slots === undefined) return
    slots.inject('settings.plugin.item', () => {
      // One form per declaration lifetime: a collapsed and re-declared slot
      // gets a live controller rather than the disposed one from before.
      const card = new MarketPluginCardController(service.bind<MarketSettings>({ namespace: NS }), fetchMcpBackend)
      const dispose = slots.register({
        name: 'settings.plugin.item',
        key: NS,
        locale: NS,
        inject: () => card.inject(),
      }, McpPluginCard)
      return () => {
        card.dispose()
        if (typeof dispose === 'function') dispose()
      }
    })
  })

  ctx.slots.inject('settings.section', () => {
    settingsSurfaceAvailable = true
    notifyPageModeSurfaceChange()
    // One section, six top tabs (market / skills / commands / personas /
    // MCP / LSP) — the PluginWorkspace owns the tab row and per-tab scroll.
    const workspaceDispose = ctx.slots.register({
      name: 'settings.section',
      id: 'agent-plugin-workspace',
      order: 45,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(PluginWorkspace, {
      t,
      credentials,
      mode: 'settings',
    }))
    return () => {
      settingsSurfaceAvailable = false
      notifyPageModeSurfaceChange()
      if (typeof workspaceDispose === 'function') workspaceDispose()
    }
  })
}

function notifyPageModeSurfaceChange(): void {
  if (typeof document !== 'undefined') document.dispatchEvent(new Event(LEGACY_PAGE_MODE_SURFACE_EVENT))
}
