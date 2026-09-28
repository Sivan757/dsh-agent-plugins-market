// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MARKET_SETTINGS_DEFAULTS, type MarketSettings } from '../src/contracts/settings.js'
import { bindMarketCardForm, type MarketCardFace, type MarketCardState } from '../src/client/features/settings-card/market-card-form.js'
import { McpPluginCard } from '../src/client/features/settings-card/McpPluginCard.js'

/** The renderer-side props of the entry, written out so the test binds only what the host binds. */
interface EntryProps {
  view: 'summary' | 'page'
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

function faceFor(view: 'summary' | 'page', initial: Partial<MarketSettings> = {}): EntryProps {
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

describe('market plugins.item entry views', () => {
  it('renders the summary one-liner on the official card', () => {
    const html = renderToStaticMarkup(h(McpPluginCard, faceFor('summary')))
    expect(html).toBe('marketCardDesc')
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
