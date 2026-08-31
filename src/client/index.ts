/**
 * dsh-agent-plugins-market client: registers the Agent Plugins Market section inside the Web
 * GUI's settings page (the same settings.section seat dshmarket uses), with a
 * guarded legacy top-level page fallback for older shells. The bundle's
 * browser externals are React, ReactDOM, and the injected `dsh.client.inject`
 * module table, so it cannot reach packages the host does not serve.
 */
import { createElement as h } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh, type LocaleKey } from './locales.js'
import { MarketSection } from './MarketSection.js'
import { McpStatusPanel } from './McpStatusPanel.js'
import { LspStatusPanel } from './LspStatusPanel.js'
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

/** The client cordis context this plugin relies on (structural subset). */
interface SuiteClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
  connection: { api: { credentials: CredentialApi } }
}

export const name = 'dsh-agent-plugins-market'
export const inject = ['slots', 'locale', 'connection']

/** Primitives this section renders with; absent exports degrade the whole section. */
export const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'Tooltip'] as const

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
