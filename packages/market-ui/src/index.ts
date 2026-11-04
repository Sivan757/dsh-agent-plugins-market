/**
 * dsh-agent-plugins-market client: registers the Agent Plugins Market section inside the Web
 * GUI's settings page (the same settings.section seat dshmarket uses), with a
 * guarded legacy top-level page fallback for older shells. The bundle's
 * browser externals are React, ReactDOM, and the injected `dsh.client.inject`
 * module table, so it cannot reach packages the host does not serve.
 */
import { createElement as h, type ReactNode } from 'react'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { createSkillCatalogRefresh, type SkillCatalogRefresh, type SkillCatalogEntry } from './ui/skill-catalog-refresh.js'
import { watchSelectionCommits, type SelectionCommitBinding } from './ui/selection-skill-notifications.js'
import type { ExtensionWindowObserver } from './features/extension-presets/use-window.js'
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
import { bindTranslationEnabled, translationEnabled } from './ui/translation-enabled.js'
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
  on?(event: 'connection/reset', listener: () => void): () => void
  /** Late service resolution; absent on hosts predating cross-plugin inject. */
  inject?(services: string[], callback: (resolved: Record<string, unknown>) => (() => void) | undefined): void
  configForms?: ConfigFormsService
  locale: LocaleService
  slots: SlotsService
  remote: { credentials: CredentialRemote }
}

export const name = 'dsh-agent-plugins-market'
export const inject = ['slots', 'locale', 'remote', 'remote.credentials']
const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'Tooltip'] as const

/** Published composer seat after Permissions; blank and ongoing sessions share one icon entry. */
export const COMPOSER_TOGGLE_SLOT = 'conversation.input.left'

/** Reported once, because a slot that re-renders would otherwise repeat it. */
let reportedMissingSession = false

/**
 * The slot's payload, behind the preset switch: nothing renders while the
 * setting is off, and a flip shows the entry without a reload.
 *
 * The host renders `conversation.input.left` with `{}` — it wraps that call in a
 * session check without passing the id — so the entry cannot name the session it
 * belongs to and renders nothing. It says so once instead: silently missing UI is
 * indistinguishable from a broken plugin, and this one is a gap in the seat.
 */
function PresetEntrySlot(props: { sessionId?: string; t: ExtensionTranslate; observer: ExtensionWindowObserver }): ReactNode {
  const enabled = useAgentPresetsEnabled()
  if (enabled && !props.sessionId && !reportedMissingSession) {
    reportedMissingSession = true
    console.warn('[dsh-agent-plugins-market] preset entry hidden: ' + COMPOSER_TOGGLE_SLOT + ' is rendered without a session id, so the seat cannot scope a read')
  }
  if (!enabled || !props.sessionId) return null
  return h(ExtensionPresetEntry, { sessionId: props.sessionId, t: props.t, observer: props.observer, renderDetail: detail => h(ExtensionDetailView, detail) })
}

/** Detect host primitives that predate the exports this UI relies on. */
function missingPrimitives(module: Record<string, unknown>, required: readonly string[] = REQUIRED_PRIMITIVES): string[] {
  return required.filter(name => module[name] === undefined)
}

interface SkillRefreshServices {
  inputTriggers: unknown
  sessions: {
    scope(id: string): unknown
    binding(id: string): SelectionCommitBinding | undefined
    subagentAddress?(id: string): unknown
    list: { getSnapshot(): { byId: Record<string, { cwd?: string } | undefined> } }
  }
  remote: {
    skills: {
      list(
        request: { sessionId: string },
        signal: AbortSignal
      ): Promise<{ ok: true; value: { skills: SkillCatalogEntry[] } } | { ok: false; error: { code: string; message: string } }>
    }
    $on?(event: 'agent-preset/selected', listener: (sessionId: string) => void): () => void
  }
  sidebarRight: { openResource(address: ReturnType<typeof fileAddressFor>): void }
}

export function apply(ctx: SuiteClientContext): void {
  let catalog: SkillCatalogRefresh | undefined
  let bindingOf: ((id: string) => SelectionCommitBinding | undefined) | undefined
  const subscriptions = new Set<{ id: string; refresh: () => void; stop?: () => void }>()
  const connect = (entry: { id: string; refresh: () => void; stop?: () => void }) => {
    entry.stop?.()
    const binding = bindingOf?.(entry.id)
    entry.stop = binding ? watchSelectionCommits(binding, entry.refresh) : undefined
  }
  const observer: ExtensionWindowObserver = {
    committed: id => catalog?.refresh(id),
    subscribe: (id, refresh) => {
      const entry = { id, refresh, stop: undefined as (() => void) | undefined }
      subscriptions.add(entry)
      connect(entry)
      return () => {
        entry.stop?.()
        subscriptions.delete(entry)
      }
    }
  }
  ctx.inject?.(['inputTriggers', 'sessions', 'remote.skills', 'sidebarRight'], resolved => {
    const scoped = resolved as unknown as SkillRefreshServices
    if (!scoped.inputTriggers || !scoped.sessions || !scoped.remote?.skills || !scoped.sidebarRight) return
    catalog = createSkillCatalogRefresh({
      inputTriggers: scoped.inputTriggers,
      sessions: scoped.sessions,
      list: async (sessionId, signal) => {
        const result = await scoped.remote.skills.list({ sessionId }, signal)
        if (!result.ok) throw new Error('skills/list failed: ' + result.error.code + ': ' + result.error.message)
        return result.value.skills
      },
      userOnlyLabel: () => (ctx.locale.bind('skill') as (key: string) => string)('menu.userOnly'),
      openResource: (sessionId, path) => scoped.sidebarRight.openResource(fileAddressFor(sessionId, scoped.sessions.list.getSnapshot().byId[sessionId]?.cwd, path))
    })
    const offPreset = scoped.remote.$on?.('agent-preset/selected', id => catalog?.refresh(id))
    const offReset = ctx.on?.('connection/reset', () => catalog?.refreshAll())
    bindingOf = id => scoped.sessions.binding(id)
    for (const entry of subscriptions) connect(entry)
    return () => {
      for (const entry of subscriptions) {
        entry.stop?.()
        entry.stop = undefined
      }
      offPreset?.()
      offReset?.()
      bindingOf = undefined
      catalog?.dispose()
      catalog = undefined
    }
  })
  // No additive top entry exists; this seat supplies the materialized session identity beside Permissions.
  // The preset switch owns the entry: it renders only while the setting is on, and a flip shows it without a reload.
  ctx.slots.inject(COMPOSER_TOGGLE_SLOT, () => {
    const dispose = ctx.slots.register(
      { name: COMPOSER_TOGGLE_SLOT, id: 'dsh-agent-plugins-market-resources', order: 60, label: () => (ctx.locale.bind(NS) as ExtensionTranslate)('epTitle') },
      (props: { sessionId?: string }) => slotH(PresetEntrySlot, { sessionId: props.sessionId, t: ctx.locale.bind(NS) as ExtensionTranslate, observer })
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
    // The read-only preference and the card resolve the same stored value
    // through the contract, so neither needs a second form.
    const unbindTranslation = bindTranslationEnabled(form)
    // The preset switch drives the composer entry's visibility from the same form.
    const unbindPresets = bindAgentPresetsEnabled(form)
    const stopServed = service.whileServed([NS], () => {
      if (slots === undefined) return () => {}
      const bound = bindMarketCardForm(form, fetchMcpBackend)
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
    // One section: PluginWorkspace owns the tab row (one tab per key in
    // WORKSPACE_TAB_KEYS) and each tab's own scroll region.
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
