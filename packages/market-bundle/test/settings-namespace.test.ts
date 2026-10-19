import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { MarketSettingsNamespace, type MarketSettingRefs } from '../../../packages/market-bundle/src/platform/settings-namespace.js'
import { MarketSettingsSchema } from '../../../packages/market-bundle/src/platform/settings-schema.js'
import { resolveMarketSettings } from '../../../packages/market-contracts/src/contracts/settings.js'

/**
 * One namespace over hand-built references.
 *
 * An absent translation reference is the untouched-document case: the reader,
 * not the reference, answers the plugin default.
 */
function settings(read: () => boolean | undefined, options: { missing?: boolean } = {}): MarketSettingsNamespace {
  const refs: MarketSettingRefs = {
    mcpEnhanced: { get: () => undefined },
    scanProjectLayouts: { get: () => undefined },
    downloadRegion: { get: () => undefined },
    feedbackEnabled: { get: () => undefined },
    autoUpdateSources: { get: () => undefined },
    translationEnabled: { get: read },
    // The preset switch joins this namespace's ref set; its default is on, and
    // the reader below answers it.
    agentPresetsEnabled: { get: () => undefined }
  }
  if (options.missing) Reflect.deleteProperty(refs, 'translationEnabled')
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
    }
  )
}

describe('MarketSettingsNamespace.translationEnabled', () => {
  it('resolves an absent reference to the plugin default, on', () => {
    expect(settings(() => undefined, { missing: true }).translationEnabled()).toBe(true)
  })

  it.each([
    [undefined, true],
    [false, false],
    [true, true]
  ])('resolves a reference holding %s to %s', (value, expected) => {
    expect(settings(() => value).translationEnabled()).toBe(expected)
  })

  it('reads changes from the same reference without rebuilding the namespace', () => {
    let value: boolean | undefined
    const namespace = settings(() => value)
    expect(namespace.translationEnabled()).toBe(true)
    value = false
    expect(namespace.translationEnabled()).toBe(false)
    value = true
    expect(namespace.translationEnabled()).toBe(true)
    value = undefined
    expect(namespace.translationEnabled()).toBe(true)
  })

  it('notifies translation on both preference edges and releases its watcher', () => {
    let value: boolean | undefined = true
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
      }
    )
    namespace.mount()
    const write = (): void => {
      ctx.emit('loader/volatile-update' as Parameters<Context['on']>[0])
    }
    // A settings write that leaves the switch where it was must not reset
    // anything, or an unreachable endpoint would cost a timeout per write.
    write()
    expect(resets).toHaveLength(0)

    value = false
    write()
    expect(resets).toHaveLength(1)

    // Already off: nothing was switched, so nothing is retried.
    write()
    expect(resets).toHaveLength(1)

    value = true
    write()
    expect(resets).toHaveLength(2)

    namespace.dispose()
    value = false
    write()
    expect(resets).toHaveLength(2)
  })

  it('holds both defaults when the schema resolves an absent section', () => {
    // What production runs: the loader applies the schema, then this reader
    // answers. Both switches are on for a section that says nothing.
    const absent = resolveMarketSettings(MarketSettingsSchema(undefined))
    expect(absent.translationEnabled).toBe(true)
    expect(absent.agentPresetsEnabled).toBe(true)
    // A stored answer still wins over the default.
    const stored = resolveMarketSettings(MarketSettingsSchema({ translationEnabled: false, agentPresetsEnabled: false }))
    expect(stored.translationEnabled).toBe(false)
    expect(stored.agentPresetsEnabled).toBe(false)
  })
})
