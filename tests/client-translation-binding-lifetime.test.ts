// @vitest-environment jsdom
/**
 * The translation switch is bound to the settings service, not to the page.
 *
 * The preference answers whether a translation is shown, and a surface outside
 * the settings page asks it: the composer entry opens the same detail dialog.
 * `whileServed` watches the host's served-namespace projection — the namespaces
 * active plugin entries contribute — rather than the settings page, so it is not
 * the lifetime a global preference belongs to. The switch follows the
 * configForms service instead, the way the host's own pages take
 * `configForms.get(NS)` at apply time. The double below lets the watch register
 * nothing at all, so the switch's value can only come from the form the binding
 * acquired: that form's stored value must still be read, and the document
 * section must render from it. Binding the preference inside the watch leaves
 * the stored value unread and this file red.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Translate } from '../src/client/index.js'
import { DocumentTranslationView } from '../src/client/ui/DocumentTranslation.js'
import { translationEnabled } from '../src/client/ui/translation-enabled.js'
import { MARKET_SETTINGS_DEFAULTS, type MarketSettings } from '../src/contracts/settings.js'
import type { DocumentTranslation } from '../src/contracts/translation.js'

/**
 * Live listeners the market installs on the host form: one per module that binds
 * it for the configForms service's lifetime — this file's translation
 * preference (ui/translation-enabled) and the agent-preset visibility switch
 * (ui/agent-presets-enabled). The number is bindings, not consumers or mounts.
 */
const FORM_BINDINGS = 2

/** Locale probes: the section's target dimension reads the active language from this key. */
const chinese: Translate = key => (key === 'localeProbeLang' ? '中文' : key)
const english: Translate = key => (key === 'localeProbeLang' ? 'English' : key)

/**
 * The market form double: a stored section, plus the listeners a bound
 * preference installs. The listener set is how the test observes whether the
 * switch was bound at all.
 */
function marketForm(stored: Partial<MarketSettings>) {
  const value: MarketSettings = { ...MARKET_SETTINGS_DEFAULTS, ...stored }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({
      status: 'ready' as const,
      value,
      base: undefined,
      user: { ...stored },
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
    mutate: async () => true,
    listeners
  }
}

let root: Root | undefined
let release: (() => void) | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  release?.()
  release = undefined
})

/**
 * Mount the plugin against a settings double whose watch registers nothing:
 * `whileServed` returns a disposer without registering the card, so the
 * switch's value cannot come from the card. That absence isolates the binding
 * from the watch — a dialog asks the switch wherever the watch contributes
 * nothing, and the binding must still answer.
 */
function mountUnservedMarket(localePreference: string, stored: Partial<MarketSettings>) {
  const form = marketForm(stored)
  const localeForm = { getSnapshot: () => ({ value: { preference: localePreference } }), subscribe: () => () => {} }
  const register = vi.fn(() => () => {})
  let settingsInject: ((scope: Record<string, unknown>) => unknown) | undefined
  apply({
    effect: () => {},
    slots: { inject: () => {}, register },
    locale: { register: () => {}, bind: () => key => key },
    remote: { credentials: { describe: async () => ({ ok: true }), set: async () => {}, unset: async () => {} } },
    inject: (services: string[], callback: (scope: Record<string, unknown>) => unknown) => {
      if (services.includes('configForms')) settingsInject = callback
    }
  })
  const stop = settingsInject!({
    configForms: { get: (id: string) => (id === 'locale' ? localeForm : form), whileServed: () => () => {} },
    slots: undefined
  })
  release = typeof stop === 'function' ? (stop as () => void) : () => {}
  return { form, register }
}

/** Render the section the way a dialog does. */
async function mount(t: Translate, load: () => Promise<DocumentTranslation>): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  const created = createRoot(element)
  root = created
  await act(async () => created.render(h(DocumentTranslationView, { t, original: '# Authored', load })))
}

describe('the effective translation switch without a served settings page', () => {
  it('renders the section from the stored preference when the settings card never mounted', async () => {
    const { form, register } = mountUnservedMarket('zh', { translationEnabled: true })
    // The served-namespace watch never fired, so no card was registered...
    expect(register).not.toHaveBeenCalled()
    // ...and the preference is nonetheless bound and readable, because it
    // follows the service's lifetime rather than the card's.
    expect(form.listeners.size).toBe(FORM_BINDINGS)
    expect(translationEnabled.getSnapshot()).toBe(true)

    const load = vi.fn(async () => ({ text: '译文', pending: 0 }))
    await mount(chinese, load)
    expect(document.body.querySelector('[role="tablist"]')).not.toBeNull()
    // This component mounts only once a document is expanded.
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps the stored off value authoritative, whatever the interface language', async () => {
    const { form } = mountUnservedMarket('zh', { translationEnabled: false })
    expect(form.listeners.size).toBe(FORM_BINDINGS)
    expect(translationEnabled.getSnapshot()).toBe(false)

    const load = vi.fn(async () => ({ text: '译文', pending: 0 }))
    await mount(chinese, load)
    expect(document.body.querySelector('[role="tablist"]')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('shows the three modes for an explicitly enabled English interface', async () => {
    mountUnservedMarket('en', { translationEnabled: true })
    // English is a valid translation target; only the default is off.
    expect(translationEnabled.getSnapshot()).toBe(true)

    const load = vi.fn(async () => ({ text: 'translated', pending: 0 }))
    await mount(english, load)
    expect(document.body.querySelector('[role="tablist"]')).not.toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
