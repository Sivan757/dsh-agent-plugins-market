/**
 * dsh-agent-plugins-market client: registers the Agent Plugins Market section inside the Web
 * GUI's settings page (the same settings.section seat dshmarket uses), with a
 * guarded legacy top-level page fallback for older shells. The bundle's
 * browser externals are React, ReactDOM, and the injected `dsh.client.inject`
 * module table, so it cannot reach packages the host does not serve.
 */
import { createElement as h, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BusyOverlay } from './ui/BusyOverlay.js'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { MARKET_SETTINGS_NAMESPACE, type MarketSettings } from '../../market-contracts/src/contracts/settings.js'
import { fetchMcpBackend, fetchMenuRowFaces } from './api.js'
import { createMenuRowFaces, type MenuRowFaces } from './menu-row-faces.js'
import { en, zh } from './locales.js'
import type { Translate } from './i18n.js'
import { resourcesEn, resourcesZh } from './locales-resources.js'
import { PluginWorkspace } from './workspace/PluginWorkspace.js'
import { McpPluginCard } from './features/settings-card/McpPluginCard.js'
import { bindMarketCardForm, type MarketCardFace } from './features/settings-card/market-card-form.js'
import { bindInterfaceLanguage, bindTranslationEnabled, translationEnabled, LOCALE_SETTINGS_ENTRY } from './ui/translation-enabled.js'
import { bindAgentPresetsEnabled, useAgentPresetsEnabled } from './ui/agent-presets-enabled.js'
import { createElement as slotH } from 'react'
import { ExtensionDetailView } from './workspace/ExtensionResourceDetail.js'
import { ExtensionPresetEntry } from './features/extension-presets/ExtensionPresetEntry.js'
import type { ExtensionTranslate } from './features/extension-presets/types.js'
import { extensionPresetsEn, extensionPresetsZh } from './locales-extension-presets.js'
import { credentialApi, type CredentialRemote } from './credentials.js'
import { LEGACY_PAGE_MODE_SURFACE_EVENT, mountLegacyPageMode } from './workspace/page-mode.js'

/** The settings namespace this plugin registers, and the key the host pairs our card by. */
const NS = MARKET_SETTINGS_NAMESPACE

export type { Translate }

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
  inject?(services: string[], callback: (resolved: Record<string, unknown>) => (() => void) | undefined): void
  configForms?: ConfigFormsService
  locale: LocaleService
  slots: SlotsService
  remote: { credentials: CredentialRemote }
}

export const name = 'dsh-agent-plugins-market'
export const inject = ['slots', 'locale', 'remote', 'remote.credentials']
export const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'Tooltip'] as const

/** Published composer seat after Permissions; blank and ongoing sessions share one icon entry. */
export const COMPOSER_TOGGLE_SLOT = 'conversation.input.left'

/**
 * The slot's payload, behind the experimental switch: nothing renders while
 * the setting is off, and a flip shows the entry without a reload.
 */
function PresetEntrySlot(props: { sessionId?: string; t: ExtensionTranslate }): ReactNode {
  const enabled = useAgentPresetsEnabled()
  if (!enabled || !props.sessionId) return null
  return h(ExtensionPresetEntry, { sessionId: props.sessionId, t: props.t, renderDetail: detail => h(ExtensionDetailView, detail) })
}

/** Detect host primitives that predate the exports this UI relies on. */
export function missingPrimitives(module: Record<string, unknown>, required: readonly string[] = REQUIRED_PRIMITIVES): string[] {
  return required.filter(name => module[name] === undefined)
}

export function apply(ctx: SuiteClientContext): void {
  // No additive top entry exists; this seat supplies the materialized session identity beside Permissions.
  // The capability is experimental: the entry renders only while the setting is on, and a flip shows it without a reload.
  ctx.slots.inject(COMPOSER_TOGGLE_SLOT, () => {
    const dispose = ctx.slots.register(
      { name: COMPOSER_TOGGLE_SLOT, id: 'dsh-agent-plugins-market-resources', order: 60, label: () => (ctx.locale.bind(NS) as ExtensionTranslate)('epTitle') },
      (props: { sessionId?: string }) => slotH(PresetEntrySlot, { sessionId: props.sessionId, t: ctx.locale.bind(NS) as ExtensionTranslate })
    )
    return () => dispose?.()
  })
  ctx.effect(
    () =>
      ctx.locale.register(NS, {
        zh: { ...zh, ...resourcesZh, ...extensionPresetsZh },
        en: { ...en, ...resourcesEn, ...extensionPresetsEn }
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
    return () => {
      root.unmount()
      element.remove()
    }
  }, 'dsh-agent-plugins-market: operation overlay')
  ctx.effect(
    () =>
      mountLegacyPageMode({
        t,
        credentials,
        isSettingsSurfaceAvailable: () => settingsSurfaceAvailable,
        subscribeLocale: ctx.locale.subscribe === undefined ? undefined : listener => ctx.locale.subscribe!(listener)
      }),
    'dsh-agent-plugins-market: legacy page mode'
  )

  // Bundle configuration belongs to the installed package's detail page. The
  // host settings namespace controls the form binding's served lifetime.
  ctx.inject?.(['configForms'], (scoped: { configForms?: ConfigFormsService; slots?: SlotsService }) => {
    const service = scoped.configForms
    const slots = scoped.slots
    if (service === undefined) return
    // One host form supplies both the read-only preference and the editable card.
    let card: MarketCardFace | undefined
    // The translation preference is a global read of the namespace, not a seat
    // on the settings page: every document surface asks whether a translation is
    // shown, the composer entry's dialog included. It therefore follows the
    // configForms service's lifetime, the way the host's own pages take
    // `configForms.get(NS)` at apply time and leave only the slot registration
    // inside whileServed — `get` has no served precondition. Binding it inside
    // the watch would tie the preference to a surface-scoped lifetime that is
    // not its own.
    const form = service.get<MarketSettings>(NS)
    // The translation default follows the interface language, so the read-only
    // preference and the card both resolve it off the locale row's own form —
    // the same `locale.preference` the node half reads.
    const language = bindInterfaceLanguage(service.get<{ preference?: string }>(LOCALE_SETTINGS_ENTRY))
    const unbindTranslation = bindTranslationEnabled(form, language)
    // The preset manager is experimental: the same form drives its visibility.
    const unbindPresets = bindAgentPresetsEnabled(form)
    const stopServed = service.whileServed([NS], () => {
      if (slots === undefined) return () => {}
      const bound = bindMarketCardForm(form, fetchMcpBackend, language)
      card = bound.face
      const dispose = slots.register(
        {
          name: 'plugins.bundle.config',
          key: name,
          locale: NS,
          inject: () => card!
        },
        McpPluginCard
      )
      return () => {
        bound.dispose()
        card = undefined
        if (typeof dispose === 'function') dispose()
      }
    })
    return () => {
      unbindTranslation()
      unbindPresets()
      stopServed()
    }
  })

  // The `/` menu's rows: our commands and skills carry the same translated
  // title and description the panels show. Wrapping is the whole feature, so it
  // follows the translation switch exactly — while the switch is off nothing is
  // wrapped and the menu renders the host's own text, as it does without us.
  ctx.inject?.(['commandUi', 'inputTriggers', 'sessions'], (scoped: { commandUi?: unknown; inputTriggers?: unknown; sessions?: unknown }) => {
    let faces: MenuRowFaces | undefined
    /** Bring the wrapper in line with the switch; installing is idempotent. */
    const sync = (): void => {
      if (!translationEnabled.getSnapshot()) {
        faces?.dispose()
        faces = undefined
        return
      }
      if (faces !== undefined) return
      faces = createMenuRowFaces({
        commandUi: scoped.commandUi,
        inputTriggers: scoped.inputTriggers,
        sessions: scoped.sessions,
        load: fetchMenuRowFaces,
        onError: error => console.warn('[dsh-agent-plugins-market] menu row faces unavailable:', error)
      })
      void faces.refresh()
    }
    const unsubscribe = translationEnabled.subscribe(sync)
    // The label is the host's translation of our text, so a language switch
    // invalidates every face; a fresh read is the whole update.
    const unsubscribeLocale = ctx.locale.subscribe?.(() => {
      void faces?.refresh(true)
    })
    sync()
    return () => {
      unsubscribeLocale?.()
      unsubscribe()
      faces?.dispose()
    }
  })

  ctx.slots.inject('settings.section', () => {
    settingsSurfaceAvailable = true
    notifyPageModeSurfaceChange()
    // One section, six top tabs (market / skills / commands / personas /
    // MCP / LSP) — the PluginWorkspace owns the tab row and per-tab scroll.
    const workspaceDispose = ctx.slots.register(
      {
        name: 'settings.section',
        id: 'agent-plugin-workspace',
        // Directly below Agent presets (order 20) and above the IM section, which
        // claims 21: a shared number loses the tie to registration order and drops
        // this entry down the nav.
        order: 20.5,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t })
      },
      () =>
        h(PluginWorkspace, {
          t,
          credentials,
          mode: 'settings'
        })
    )
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
