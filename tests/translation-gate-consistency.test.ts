/**
 * One statement, three readers: the host's interface language, the translation
 * switch's default, and the gate that decides whether a read translates. The
 * host is the authority — `bindHostLocale` is what renders the market's own
 * copy — and both of ours must answer the same way for every locale a host can
 * carry. This suite drives the real gate through the Catalog facade, so a change
 * to either side alone turns it red; a switch reading "on" beside text nothing
 * translates is worse than no switch at all.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { interfaceLanguageTranslates, resolveTranslationTarget } from '../src/contracts/settings.js'
import { bindHostLocale } from '../src/runtime/host/host-locale.js'
import { resetCircuitBreaker, type TranslationProvider } from '../src/application/translation/chain.js'

/** Every shape a host locale preference can carry: built-ins, regions, scripts, and a language pack. */
const LOCALES = ['zh', 'zh-CN', 'zh-Hant', 'ja', 'en', 'en-US'] as const

/**
 * The host's own answer to "which dictionary does this preference render?",
 * read off the copy it produces rather than restated from its rule: a
 * preference that yields the Chinese string is a Chinese interface.
 */
function hostRendersChinese(localePreference: string | undefined): boolean {
  return bindHostLocale(localePreference)('feedbackToolCardTitle') === bindHostLocale('zh')('feedbackToolCardTitle')
}

/** Authored English prose: the localizer only queues text that needs translating. */
const TEXT = 'Read files from disk'

const roots: string[] = []

afterEach(async () => {
  // The chain's breaker is process-global, and each case runs its own provider.
  resetCircuitBreaker()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A provider that answers every batch, recording what it was asked to translate. */
function stubProvider(): TranslationProvider & { calls: string[]; targets: string[] } {
  const calls: string[] = []
  const targets: string[] = []
  return {
    id: 'microsoft',
    calls,
    targets,
    available: () => true,
    translate: async ({ texts, locale }) => {
      calls.push(...texts)
      targets.push(locale)
      return texts.map(text => `译文 ${text}`)
    }
  }
}

/** One catalog over a throwaway root, with the locale and the provider chain wired. */
async function catalogWith(locale: string, provider: TranslationProvider): Promise<Catalog> {
  const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-gate-'))
  roots.push(userRoot)
  const catalog = new Catalog({
    userRoot,
    dataRoot: join(userRoot, 'data'),
    agentsRoot: join(userRoot, 'agents'),
    onChanged: () => {},
    ports: { localePreference: () => locale, translationProviders: [provider], translationProviderIdentity: () => 'test-chain' }
  })
  await catalog.load()
  return catalog
}

describe('the translation gate and the translation switch', () => {
  it('reads an absent preference the way the host does', () => {
    expect(interfaceLanguageTranslates(undefined)).toBe(hostRendersChinese(undefined))
  })

  it.each(LOCALES)('agree on %s', async locale => {
    const provider = stubProvider()
    const catalog = await catalogWith(locale, provider)
    // The host is the oracle for every case below: the switch and the gate are
    // both wrong if they answer anything else, whichever side moved.
    const expected = hostRendersChinese(locale)
    expect(interfaceLanguageTranslates(locale)).toBe(expected)
    const read = (): { translated: boolean; pending: number } => {
      const { fields, pending } = catalog.translateFields('market', 'demo/suite', { description: TEXT }, locale)
      return { translated: fields.translatedDescription !== undefined, pending }
    }
    // A read the gate lets through queues the text; a read it refuses reaches no
    // provider at all.
    expect(read().pending > 0).toBe(expected)
    await catalog.settleDescriptions()
    expect(read().translated).toBe(expected)
    expect(provider.calls.length > 0).toBe(expected)
    // And the third reader of the same rule: the language the text is translated
    // *into*. Every locale the host renders in Chinese targets Chinese, so a
    // `ja` reader does not get Japanese text beside Chinese chrome and a
    // `zh-Hant` reader does not get Traditional beside Simplified; the English
    // interface targets nothing at all.
    const target = resolveTranslationTarget(locale)
    expect(target === undefined).toBe(!expected)
    if (target !== undefined) expect(target).toBe('zh')
  })

  it('asks the chain for the language the market renders, not the preference tag', async () => {
    for (const locale of ['zh', 'zh-CN', 'zh-Hant', 'ja']) {
      const provider = stubProvider()
      const catalog = await catalogWith(locale, provider)
      catalog.translateFields('market', 'demo/suite', { description: TEXT }, locale)
      await catalog.settleDescriptions()
      // One target for four spellings: the tag the market's own dictionary
      // renders, which is what every provider in the chain understands.
      expect(provider.targets, locale).toEqual(['zh'])
    }
  })

  it('keeps the document path on the same answer', async () => {
    const body = '# Title\n\nRead files from disk.'
    const translated = stubProvider()
    const chinese = await catalogWith('zh-CN', translated)
    expect(chinese.translateDocument('skills', 'demo/suite/skill', body, 'zh-CN').pending).toBeGreaterThan(0)
    await chinese.settleDescriptions()
    const settled = chinese.translateDocument('skills', 'demo/suite/skill', body, 'zh-CN')
    expect(settled.pending).toBe(0)
    expect(settled.text).toContain('译文')
    expect(translated.calls.join('\n')).toContain('Read files from disk.')

    const skippedProvider = stubProvider()
    const english = await catalogWith('en', skippedProvider)
    expect(english.translateDocument('skills', 'demo/suite/skill', body, 'en')).toEqual({ text: body, pending: 0 })
    expect(skippedProvider.calls).toHaveLength(0)
  })
})
