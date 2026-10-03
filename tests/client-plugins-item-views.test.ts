// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MARKET_SETTINGS_DEFAULTS, MARKET_SETTINGS_NAMESPACE, type MarketSettings } from '../src/contracts/settings.js'
import { bindMarketCardForm, type MarketCardFace, type MarketCardState } from '../src/client/features/settings-card/market-card-form.js'
import { McpPluginCard } from '../src/client/features/settings-card/McpPluginCard.js'
import { apply, name as packageName } from '../src/client/index.js'

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
    mutate: async (): Promise<boolean> => true
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
  it('registers by package name only while its settings namespace is served', () => {
    const entries: Array<{ meta: Record<string, unknown>; component: (props: never) => unknown }> = []
    const active = new Set<Record<string, unknown>>()
    const disposed = vi.fn()
    const scope = { ...scopeDouble(), subscribe: () => disposed }
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
    expect(disposed).toHaveBeenCalledOnce()
    stop = serve()
    const second = (entries.at(-1)!.meta.inject as () => MarketCardFace)()
    expect(second).not.toBe(first)
    expect(second.hooks.marketCard.getSnapshot().dirty).toBe(false)
    stop()
    expect(disposed).toHaveBeenCalledTimes(2)
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
})
