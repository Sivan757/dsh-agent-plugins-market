// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MARKET_SETTINGS_DEFAULTS, MARKET_SETTINGS_NAMESPACE, type MarketSettings } from '../src/contracts/settings.js'
import { bindMarketCardForm, type MarketCardFace, type MarketCardState } from '../src/client/features/settings-card/market-card-form.js'
import { McpPluginCard } from '../src/client/features/settings-card/McpPluginCard.js'
import { apply, name as packageName } from '../src/client/index.js'
import * as api from '../src/client/api.js'
import { translationEnabled } from '../src/client/ui/translation-enabled.js'

/** The renderer-side props of the entry, written out so the test binds only what the host binds. */
interface EntryProps {
  view: 'page'
  t: (key: string) => string
  useMarketCard: <S>(select: (state: MarketCardState) => S) => S
  edit: MarketCardFace['edit']
  resetField: MarketCardFace['resetField']
  save: MarketCardFace['save']
  discard: MarketCardFace['discard']
  refreshProbe: MarketCardFace['refreshProbe']
}

/** A settings scope double speaking the model's SettingsFormScope shape. */
function scopeDouble(initial: Partial<MarketSettings> = {}) {
  const value: MarketSettings = { ...MARKET_SETTINGS_DEFAULTS, ...initial }
  const user: Record<string, unknown> = { ...initial }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({
      status: 'ready' as const,
      value,
      base: undefined,
      user,
      revision: 1,
      writable: true,
      mode: 'host' as const
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    mutate: async (): Promise<boolean> => true,
    listeners
  }
}

function faceFor(view: 'page', initial: Partial<MarketSettings> = {}): EntryProps {
  const bound = bindMarketCardForm(scopeDouble(initial), async () => ({
    backend: 'builtin' as const,
    hostClient: { available: true },
    downloadRegion: { setting: 'auto', effective: 'global' }
  }))
  return {
    view,
    t: key => key,
    useMarketCard: select => select(bound.face.hooks.marketCard.getSnapshot()),
    edit: bound.face.edit,
    resetField: bound.face.resetField,
    save: bound.face.save,
    discard: bound.face.discard,
    refreshProbe: bound.face.refreshProbe
  }
}

describe('installed bundle configuration', () => {
  it.each([true, false])('shares one preference across service lifetimes (menu first: %s)', async menuFirst => {
    const load = vi.spyOn(api, 'fetchMenuRowFaces').mockResolvedValue([])
    const source = scopeDouble({ translationEnabled: false })
    /** The locale row's form: the interface language the translation default follows. */
    const localeSource = { getSnapshot: () => ({ value: { preference: 'en' } }), subscribe: () => () => {} }
    const get = vi.fn((id: string) => (id === 'locale' ? localeSource : source))
    const children = new Map<string, (scope: Record<string, unknown>) => unknown>()
    const childReleases: Array<() => void> = []
    const rootReleases: Array<() => void> = []
    let stopNamespace: (() => void) | undefined
    const unwatch = vi.fn(() => {
      stopNamespace?.()
      stopNamespace = undefined
    })
    const forms = {
      get,
      whileServed: (_namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
        stopNamespace = register(new Set([MARKET_SETTINGS_NAMESPACE]))
        return unwatch
      }
    }
    const candidates = async () => []
    const menu = Object.create({ candidates }) as { candidates: typeof candidates }
    apply({
      effect: (effect, label) => {
        if (label === 'dsh-agent-plugins-market: settings binding' || label === 'dsh-agent-plugins-market: menu row faces') {
          rootReleases.push(effect() as () => void)
        }
      },
      slots: { inject: () => {}, register: () => undefined },
      locale: { register: () => {}, bind: () => key => key },
      remote: { credentials: { describe: async () => ({ ok: true }), set: async () => {}, unset: async () => {} } },
      inject: (services, callback) => {
        children.set(services.includes('commandUi') ? 'menu' : 'settings', callback)
      }
    })
    const mount = (name: string): (() => void) => {
      const release = children.get(name)!({ configForms: forms, commandUi: menu })
      const stop = typeof release === 'function' ? (release as () => void) : () => {}
      childReleases.push(stop)
      return stop
    }
    try {
      if (menuFirst) mount('menu')
      const stopSettings = mount('settings')
      if (!menuFirst) mount('menu')
      // One market form is fetched and shared by the read-only preference and the card.
      expect(get.mock.calls.filter(([id]) => id === MARKET_SETTINGS_NAMESPACE)).toHaveLength(1)
      expect(source.listeners.size).toBe(1)
      expect(menu.candidates).toBe(candidates)
      expect(load).not.toHaveBeenCalled()
      const update = (enabled: boolean) => {
        source.getSnapshot().value.translationEnabled = enabled
        for (const listener of source.listeners) listener()
      }
      update(true)
      expect(translationEnabled.getSnapshot()).toBe(true)
      expect(menu.candidates).not.toBe(candidates)
      expect(load).toHaveBeenCalledOnce()
      update(true)
      expect(load).toHaveBeenCalledOnce()
      stopNamespace!()
      expect(menu.candidates).toBe(candidates)
      expect(translationEnabled.getSnapshot()).toBe(false)
      expect(source.listeners.size).toBe(0)
      stopSettings()
      expect(unwatch).toHaveBeenCalledOnce()
      mount('settings')
      expect(menu.candidates).not.toBe(candidates)
      expect(source.listeners.size).toBe(1)
      for (const stop of childReleases.splice(0).reverse()) stop()
      expect(source.listeners.size).toBe(0)
      expect(menu.candidates).toBe(candidates)
      mount('menu')
      mount('settings')
      expect(source.listeners.size).toBe(1)
      expect(load).toHaveBeenCalledTimes(3)
      await Promise.resolve()
    } finally {
      for (const stop of childReleases.reverse()) stop()
      for (const stop of rootReleases.reverse()) stop()
      unwatch()
      load.mockRestore()
    }
  })

  it('registers by package name only while its settings namespace is served', () => {
    const entries: Array<{ meta: Record<string, unknown>; component: (props: never) => unknown }> = []
    const active = new Set<Record<string, unknown>>()
    const scope = scopeDouble()
    let serve!: () => () => void
    let language = 'zh'
    const slots = {
      inject: (_slot: string, register: () => unknown) => {
        register()
      },
      register: (meta: Record<string, unknown>, component: (props: never) => unknown) => {
        entries.push({ meta, component })
        active.add(meta)
        return () => {
          active.delete(meta)
        }
      }
    }
    const get = vi.fn(() => scope)
    apply({
      effect: () => {},
      slots,
      locale: { register: () => {}, bind: () => key => `${language}:${key}` },
      remote: { credentials: { describe: async () => ({ ok: true }), set: async () => {}, unset: async () => {} } },
      inject: (_services, register) =>
        register({
          slots,
          configForms: {
            get,
            whileServed: (namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
              expect(namespaces).toEqual([MARKET_SETTINGS_NAMESPACE])
              serve = () => register(new Set(namespaces))
              return () => {}
            }
          }
        })
    })
    expect(entries.some(entry => entry.meta.name === 'plugins.bundle.config')).toBe(false)
    let stop = serve()
    const entry = entries.find(entry => entry.component === McpPluginCard)!
    expect(entry.meta).toMatchObject({ name: 'plugins.bundle.config', key: packageName, locale: MARKET_SETTINGS_NAMESPACE })
    expect(entry.meta).not.toHaveProperty('id')
    expect(entries.some(entry => entry.meta.name === 'plugins.item')).toBe(false)
    expect(entries.some(entry => entry.meta.name === 'settings.section')).toBe(true)
    expect(get).toHaveBeenCalledWith(MARKET_SETTINGS_NAMESPACE)
    const first = (entry.meta.inject as () => MarketCardFace)()
    first.edit('autoUpdateSources', 'true')
    stop()
    expect(active.has(entry.meta)).toBe(false)
    expect(scope.listeners.size).toBe(0)
    stop = serve()
    const second = (entries.at(-1)!.meta.inject as () => MarketCardFace)()
    expect(second).not.toBe(first)
    expect(second.hooks.marketCard.getSnapshot().dirty).toBe(false)
    stop()
    expect(scope.listeners.size).toBe(0)
    const originalSection = entries.find(item => item.meta.name === 'settings.section')!
    const firstLabel = typeof originalSection.meta.label === 'function' ? (originalSection.meta.label as () => string)() : originalSection.meta.label
    expect(firstLabel).toBe('zh:nav')
    language = 'en'
    const nextLabel = originalSection.meta.label
    expect(typeof nextLabel === 'function' ? (nextLabel as () => string)() : nextLabel).toBe('en:nav')
  })

  it('renders the staged form controls on the entry page', () => {
    const html = renderToStaticMarkup(h(McpPluginCard, faceFor('page')))
    for (const key of ['mcpCardTitle', 'projectLayoutsLabel', 'autoUpdateLabel', 'feedbackToggleLabel', 'regionLabel', 'settingSave']) {
      expect(html).toContain(key)
    }
  })

  it('renders nothing while the namespace is not served', () => {
    const bound = bindMarketCardForm(
      {
        getSnapshot: () => ({
          status: 'loading' as const,
          value: undefined,
          base: undefined,
          user: undefined,
          revision: undefined,
          writable: false,
          mode: 'host' as const
        }),
        subscribe: () => () => {},
        mutate: async () => true
      },
      async () => ({ backend: 'builtin' as const, hostClient: { available: true }, downloadRegion: { setting: 'auto', effective: 'global' } })
    )
    const face: EntryProps = {
      view: 'page',
      t: key => key,
      useMarketCard: select => select(bound.face.hooks.marketCard.getSnapshot()),
      edit: bound.face.edit,
      resetField: bound.face.resetField,
      save: bound.face.save,
      discard: bound.face.discard,
      refreshProbe: bound.face.refreshProbe
    }
    expect(renderToStaticMarkup(h(McpPluginCard, face))).toContain('settingUnavailable')
  })

  it('shows the auto segment for the region draft a staged clear leaves', () => {
    const bound = bindMarketCardForm(scopeDouble({ downloadRegion: 'china' }), async () => ({
      backend: 'builtin' as const,
      hostClient: { available: true },
      downloadRegion: { setting: 'auto' as const, effective: 'global' as const }
    }))
    bound.face.resetField('downloadRegion')
    const html = renderToStaticMarkup(
      h(McpPluginCard, {
        view: 'page',
        t: key => key,
        useMarketCard: select => select(bound.face.hooks.marketCard.getSnapshot()),
        edit: bound.face.edit,
        resetField: bound.face.resetField,
        save: bound.face.save,
        discard: bound.face.discard,
        refreshProbe: bound.face.refreshProbe
      })
    )
    // The clear hands the field back to the language, so the auto segment is the
    // one the control reports as selected.
    expect(html).toMatch(/aria-selected="true"[^>]*aria-controls="plugin-config-market-region-auto-panel"/)
  })

  it('shows an override badge for a field the user layer carries', () => {
    const html = renderToStaticMarkup(h(McpPluginCard, faceFor('page', { scanProjectLayouts: true })))
    expect(html).toContain('settingOverridden')
    expect(html).toContain('settingReset')
  })

  it('clears the cache from a named text button on the translation row', async () => {
    const clear = vi.spyOn(api, 'clearTranslations').mockResolvedValue()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(h(McpPluginCard, faceFor('page')))
      })
      const button = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === 'translationReset')
      expect(button).toBeDefined()
      // The row's own label is the control: no icon is left standing in for it.
      expect(button!.querySelector('svg')).toBeNull()
      await act(async () => {
        button!.click()
      })
      expect(clear).toHaveBeenCalledOnce()
      // The clear reports through the same label once it settles.
      expect(button!.textContent).toBe('translationResetDone')
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
      clear.mockRestore()
    }
  })
})
