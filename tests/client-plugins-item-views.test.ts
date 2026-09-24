// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { MARKET_SETTINGS_DEFAULTS, type MarketSettings } from '../src/contracts/settings.js'
import { MarketPluginCardController, type MarketPluginCardState } from '../src/client/features/settings-card/plugin-card-controller.js'
import { McpPluginCard } from '../src/client/features/settings-card/McpPluginCard.js'

/** The renderer-side props of the entry, written out so the test binds only what the host binds. */
interface EntryProps {
  view: 'summary' | 'page'
  t: (key: string) => string
  useMarketCard: <S>(select: (state: MarketPluginCardState) => S) => S
  toggle: (field: 'mcpEnhanced' | 'scanProjectLayouts' | 'autoUpdateSources' | 'feedbackEnabled') => void
  setRegion: (next: 'global' | 'china') => void
  resetField: (field: keyof MarketSettings) => void
  save: () => void
  discard: () => void
  refreshProbe: () => void
}

/** A settings form double: the host's mirror, ready and writable with the defaults applied. */
function scopeDouble() {
  const value: MarketSettings = { ...MARKET_SETTINGS_DEFAULTS }
  const user: Record<string, unknown> = {}
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
    set: async (): Promise<boolean> => true,
    unset: async (): Promise<boolean> => true,
    mutate: async (): Promise<boolean> => true
  }
}

function controllerFor(): MarketPluginCardController {
  return new MarketPluginCardController(scopeDouble(), async () => ({
    backend: 'builtin' as const,
    hostClient: { available: true },
    downloadRegion: { setting: 'auto', effective: 'global' }
  }))
}

function faceFor(view: 'summary' | 'page', store: SnapshotStore<MarketPluginCardState>, controller: MarketPluginCardController): EntryProps {
  const face = controller.inject()
  return {
    view,
    t: key => key,
    useMarketCard: select => select(store.getSnapshot()),
    toggle: face.toggle,
    setRegion: face.setRegion,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
    refreshProbe: face.refreshProbe
  }
}

describe('market plugins.item entry views', () => {
  it('renders the summary one-liner on the official card', () => {
    const store = createSnapshotStore({ ...controllerFor().inject().hooks.marketCard.getSnapshot(), available: true })
    const html = renderToStaticMarkup(h(McpPluginCard, faceFor('summary', store, controllerFor())))
    expect(html).toBe('marketCardDesc')
  })

  it('renders the staged form controls on the entry page', () => {
    const store = createSnapshotStore({ ...controllerFor().inject().hooks.marketCard.getSnapshot(), available: true })
    const html = renderToStaticMarkup(h(McpPluginCard, faceFor('page', store, controllerFor())))
    for (const key of ['mcpCardTitle', 'projectLayoutsLabel', 'autoUpdateLabel', 'feedbackToggleLabel', 'regionLabel', 'settingSave']) {
      expect(html).toContain(key)
    }
  })

  it('renders nothing while the namespace is not served', () => {
    const store = createSnapshotStore({ ...controllerFor().inject().hooks.marketCard.getSnapshot(), available: false })
    const html = renderToStaticMarkup(h(McpPluginCard, faceFor('page', store, controllerFor())))
    expect(html).toBe('')
  })
})
