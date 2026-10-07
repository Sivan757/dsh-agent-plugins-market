import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { MarketSettingsNamespace, type MarketSettingRefs } from '../src/runtime/host/settings-namespace.js'

/**
 * One namespace over hand-built references.
 *
 * The language defaults to English so a case that names none reads the
 * translation field as off; the language-following cases name their own.
 */
function settings(read: () => boolean | undefined, options: { missing?: boolean; locale?: string | (() => string) } = {}): MarketSettingsNamespace {
  const refs: MarketSettingRefs = {
    mcpEnhanced: { get: () => undefined },
    scanProjectLayouts: { get: () => undefined },
    downloadRegion: { get: () => undefined },
    feedbackEnabled: { get: () => undefined },
    autoUpdateSources: { get: () => undefined },
    translationEnabled: { get: read },
    // The preset switch joins this namespace's ref set; absent reads as its
    // declared default off (settings-namespace.ts).
    agentPresetsEnabled: { get: () => undefined }
  }
  if (options.missing) Reflect.deleteProperty(refs, 'translationEnabled')
  const locale = options.locale ?? 'en'
  return new MarketSettingsNamespace(
    new Context(),
    refs,
    '/unused',
    { t: key => key },
    {
      setScanProjectLayouts: async () => {},
      refreshMcpMounts: () => {},
      setAutoUpdateSources: () => {},
      syncTranslationEnabled: () => {}
    },
    typeof locale === 'function' ? locale : () => locale
  )
}

describe('MarketSettingsNamespace.translationEnabled', () => {
  // The host renders every preference that is not English with its Chinese
  // dictionary, so the switch is on for everything but English.
  it.each(['zh', 'zh-CN', 'zh-Hant', 'ja'])('translates under the %s interface an untouched document leaves open', locale => {
    expect(settings(() => undefined, { locale }).translationEnabled()).toBe(true)
  })

  it.each(['en', 'en-US'])('leaves translation off for the %s interface an untouched document leaves open', locale => {
    expect(settings(() => undefined, { locale }).translationEnabled()).toBe(false)
  })

  it('resolves an absent reference to the language default rather than to a constant', () => {
    expect(settings(() => undefined, { missing: true, locale: 'en' }).translationEnabled()).toBe(false)
    expect(settings(() => undefined, { missing: true, locale: 'zh' }).translationEnabled()).toBe(true)
  })

  it.each([
    [undefined, false],
    [false, false],
    [true, true]
  ])('resolves a reference holding %s to %s', (value, expected) => {
    expect(settings(() => value).translationEnabled()).toBe(expected)
  })

  it('keeps a stored value whatever the interface language says', () => {
    // The user's own answer outranks the derivation in both directions: a
    // language switch must never move a field they set themselves.
    expect(settings(() => false, { locale: 'zh' }).translationEnabled()).toBe(false)
    expect(settings(() => true, { locale: 'en' }).translationEnabled()).toBe(true)
  })

  it('reads changes from the same reference without rebuilding the namespace', () => {
    let value: boolean | undefined
    const namespace = settings(() => value)
    expect(namespace.translationEnabled()).toBe(false)
    value = true
    expect(namespace.translationEnabled()).toBe(true)
    value = false
    expect(namespace.translationEnabled()).toBe(false)
    value = undefined
    expect(namespace.translationEnabled()).toBe(false)
  })

  it('notifies translation on both preference edges and releases both watchers', () => {
    let value: boolean | undefined = false
    const resets: number[] = []
    const ctx = new Context()
    const refs: MarketSettingRefs = {
      mcpEnhanced: { get: () => undefined },
      scanProjectLayouts: { get: () => undefined },
      downloadRegion: { get: () => undefined },
      feedbackEnabled: { get: () => undefined },
      autoUpdateSources: { get: () => undefined },
      translationEnabled: { get: () => value },
      agentPresetsEnabled: { get: () => undefined }
    }
    const namespace = new MarketSettingsNamespace(
      ctx,
      refs,
      '/unused',
      { t: key => key },
      {
        setScanProjectLayouts: async () => {},
        refreshMcpMounts: () => {},
        setAutoUpdateSources: () => {},
        syncTranslationEnabled: () => {
          resets.push(1)
        }
      },
      () => 'zh'
    )
    namespace.mount()
    const write = (): void => {
      ctx.emit('loader/volatile-update' as Parameters<Context['on']>[0])
    }
    // A settings write that leaves the switch where it was must not reset
    // anything, or an unreachable endpoint would cost a timeout per write.
    write()
    expect(resets).toHaveLength(0)

    value = true
    write()
    expect(resets).toHaveLength(1)

    // Already on: nothing was switched, so nothing is retried.
    write()
    expect(resets).toHaveLength(1)

    value = false
    write()
    expect(resets).toHaveLength(2)

    value = true
    write()
    expect(resets).toHaveLength(3)
    namespace.dispose()
    value = false
    write()
    ctx.emit('settings/document-updated' as Parameters<Context['on']>[0])
    expect(resets).toHaveLength(3)
  })

  it('notifies language-derived preference changes through settings document updates', () => {
    let locale = 'en'
    let calls = 0
    const ctx = new Context()
    const refs: MarketSettingRefs = {
      mcpEnhanced: { get: () => undefined },
      scanProjectLayouts: { get: () => undefined },
      downloadRegion: { get: () => undefined },
      feedbackEnabled: { get: () => false },
      autoUpdateSources: { get: () => undefined },
      translationEnabled: { get: () => undefined },
      agentPresetsEnabled: { get: () => undefined }
    }
    const namespace = new MarketSettingsNamespace(
      ctx,
      refs,
      '/unused',
      { t: key => key },
      {
        setScanProjectLayouts: async () => {},
        refreshMcpMounts: () => {},
        setAutoUpdateSources: () => {},
        syncTranslationEnabled: () => {
          calls++
        }
      },
      () => locale
    )
    namespace.mount()
    const updated = (): void => {
      ctx.emit('settings/document-updated' as Parameters<Context['on']>[0])
    }
    try {
      locale = 'zh'
      updated()
      expect(calls).toBe(1)
      updated()
      expect(calls).toBe(1)
      locale = 'en'
      updated()
      expect(calls).toBe(2)
    } finally {
      namespace.dispose()
    }
  })

  it('moves an unset field with the language and leaves a set one alone', () => {
    let locale = 'en'
    let value: boolean | undefined
    const namespace = settings(() => value, { locale: () => locale })
    expect(namespace.translationEnabled()).toBe(false)
    locale = 'zh'
    expect(namespace.translationEnabled()).toBe(true)
    // The user turns it off; switching the language back must not re-enable it.
    value = false
    locale = 'en'
    expect(namespace.translationEnabled()).toBe(false)
    locale = 'zh'
    expect(namespace.translationEnabled()).toBe(false)
    // Handing the field back to the composition layer puts the language in charge again.
    value = undefined
    expect(namespace.translationEnabled()).toBe(true)
  })
})
