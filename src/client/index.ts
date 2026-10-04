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
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { MARKET_SETTINGS_NAMESPACE, type MarketSettings } from '../contracts/settings.js'
import { fetchMcpBackend } from './api.js'
import { en, zh, type LocaleKey } from './locales.js'
import { resourcesEn, resourcesZh, type ResourceLocaleKey } from './locales-resources.js'
import { PluginWorkspace } from './workspace/PluginWorkspace.js'
import { McpPluginCard } from './features/settings-card/McpPluginCard.js'
import { bindMarketCardForm, type MarketCardFace } from './features/settings-card/market-card-form.js'
import { ComposerResourceEntry } from './features/resource-window/ComposerResourceEntry.js'
import { credentialApi, type CredentialRemote } from './credentials.js'
import { LEGACY_PAGE_MODE_SURFACE_EVENT, mountLegacyPageMode } from './workspace/page-mode.js'

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

/** The host settings service: forms and the served-namespace watch, browser mirror of Host-owned namespaces. */
interface ConfigFormsService {
  get<T>(entryId: string): ConfigForm<T>
  /** Run register while any of the namespaces is served; its disposer runs when none is or the disposer runs. */
  whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

/** The client cordis context this plugin relies on (structural subset). */
interface SuiteClientContext {
  effect(callback: () => unknown, label?: string): void
  /** Late service resolution; absent on hosts predating cross-plugin inject. */
  inject?(services: string[], callback: (resolved: Record<string, unknown>) => void): void
  configForms?: ConfigFormsService
  locale: LocaleService
  slots: SlotsService
  remote: { credentials: CredentialRemote }
}

export const name = 'dsh-agent-plugins-market'
export const inject = ['slots', 'locale', 'remote', 'remote.credentials']
export const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'Tooltip'] as const

/** The composer toggle row needs nothing beyond React and the slots seat. */
export const COMPOSER_TOGGLE_SLOT = 'conversation.input.left'

/** Detect host primitives that predate the exports this UI relies on. */
export function missingPrimitives(module: Record<string, unknown>, required: readonly string[] = REQUIRED_PRIMITIVES): string[] {
  return required.filter(name => module[name] === undefined)
}

export function apply(ctx: SuiteClientContext): void {
  // The per-workspace surface switches ride the composer's left tool row;
  // inject re-runs the registration whenever the host remounts the bar.
  ctx.slots.inject(COMPOSER_TOGGLE_SLOT, () => {
    const dispose = ctx.slots.register(
      { name: COMPOSER_TOGGLE_SLOT, id: 'dsh-agent-plugins-market-resources', order: 60, label: () => ctx.locale.bind(NS)('toggleSurfaceTitle') },
      // The merged dictionary carries the resource keys too; the window's
      // wider key union is a property of the merged dict, asserted once here
      // instead of widening Translate for every existing call site.
      () => h(ComposerResourceEntry, { t: ctx.locale.bind(NS) as unknown as (key: ResourceLocaleKey, params?: Record<string, unknown>) => string })
    )
    return () => dispose?.()
  })
  ctx.effect(
    () =>
      ctx.locale.register(NS, {
        zh: { ...zh, ...resourcesZh },
        en: { ...en, ...resourcesEn }
      }),
    'dsh-agent-plugins: dictionaries'
  )
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

  // Bundle configuration belongs to the installed package's detail page. The
  // host settings namespace controls the form binding's served lifetime.
  ctx.inject?.(['configForms'], (scoped: { configForms?: ConfigFormsService; slots?: SlotsService }) => {
    const service = scoped.configForms
    const slots = scoped.slots
    if (service === undefined || slots === undefined) return
    // One form binding per served lifetime: when the namespace stops being
    // served the registration unwinds, and a re-served namespace gets a live
    // binding rather than the disposed one from before.
    let card: MarketCardFace | undefined
    service.whileServed([NS], () => {
      const bound = bindMarketCardForm(service.get<MarketSettings>(NS), fetchMcpBackend)
      card = bound.face
      const dispose = slots.register({
        name: 'plugins.bundle.config',
        key: name,
        locale: NS,
        inject: () => card!,
      }, McpPluginCard)
      return () => {
        bound.dispose()
        card = undefined
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
      // Directly below Agent presets (order 20), above the notification section.
      order: 21,
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
