/**
 * End-to-end localization through the Catalog facade: the overview and the
 * suite detail must serve translated names and descriptions, report what is
 * still pending, and never let a provider failure break the read.
 */
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { resetCircuitBreaker, type TranslationProvider } from '../src/application/translation/chain.js'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')
const roots: string[] = []

afterEach(async () => {
  // The chain's breaker is process-global: a test that fails a provider must
  // not take that provider out of the chain for the tests after it.
  resetCircuitBreaker()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A provider that maps every text in a batch, throwing when the answer is an Error. */
function stubProvider(answer: (text: string) => string | Error): TranslationProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    id: 'microsoft',
    calls,
    available: () => true,
    translate: async ({ texts }) => {
      calls.push(...texts)
      return texts.map(text => {
        const result = answer(text)
        if (result instanceof Error) throw result
        return result
      })
    }
  }
}

/** The fixture suite's own name and description, as authored upstream. */
const SUITE_NAME = 'v1-suite'
const SUITE_DESCRIPTION = 'A portable v1 suite'

/** Build one catalog over a seeded user root, with the locale and provider chain wired. */
async function catalogWith(options: { locale: string; provider?: TranslationProvider }): Promise<{ catalog: Catalog; userRoot: string }> {
  const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-i18n-'))
  roots.push(userRoot)
  await mkdir(join(userRoot, '.sources', 'demo'), { recursive: true })
  await cp(fixture, join(userRoot, '.sources', 'demo'), { recursive: true })
  const catalog = new Catalog({
    userRoot,
    dataRoot: join(userRoot, 'data'),
    agentsRoot: join(userRoot, 'agents'),
    onChanged: () => {},
    ports: {
      localePreference: () => options.locale,
      ...(options.provider === undefined ? {} : { translationProviders: [options.provider], translationProviderIdentity: () => 'test-chain' })
    }
  })
  await catalog.load()
  await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
  return { catalog, userRoot }
}

/** The one suite card every read of the fixture catalog carries. */
async function onlyCard(catalog: Catalog) {
  const [card] = (await catalog.overview()).suites
  if (card === undefined) throw new Error('expected one suite')
  return card
}

describe('Catalog translation', () => {
  it('serves the original text and reports pending on the first zh read, then both translations', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    // The first read never waits on a provider: it answers with upstream text
    // and counts every field it just queued.
    const firstRead = await catalog.overview()
    const first = firstRead.suites[0]
    if (first === undefined) throw new Error('expected one suite')
    expect(first.description).toBe(SUITE_DESCRIPTION)
    expect(first.translatedDescription).toBeUndefined()
    expect(first.translatedName).toBeUndefined()
    expect(firstRead.translationPending).toBe(2)
    await catalog.settleDescriptions(5_000)
    const second = await catalog.overview()
    const card = second.suites[0]
    // The upstream text stays in place beside the translation: the client picks
    // which to render, and the panel's search keeps reading the original.
    expect(card?.description).toBe(SUITE_DESCRIPTION)
    expect(card?.translatedDescription).toBe('中文描述')
    expect(card?.name).toBe(SUITE_NAME)
    expect(card?.translatedName).toBe('中文名称')
    expect(second.translationPending).toBeUndefined()
    expect(provider.calls).toHaveLength(2)
  })

  it('translates name and description independently, so one may land without the other', async () => {
    // An empty result fails only its own key: the description still lands, and
    // the name backs off instead of blocking it.
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : ''))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    const card = await onlyCard(catalog)
    expect(card.translatedDescription).toBe('中文描述')
    expect(card.translatedName).toBeUndefined()
  })

  it('leaves the overview untouched for the en locale', async () => {
    const provider = stubProvider(() => '中文描述')
    const { catalog } = await catalogWith({ locale: 'en', provider })
    const overview = await catalog.overview()
    expect(overview.suites[0]?.description).not.toBe('中文描述')
    expect(overview.suites[0]?.translatedDescription).toBeUndefined()
    expect(overview.suites[0]?.translatedName).toBeUndefined()
    expect(overview.translationPending).toBeUndefined()
    expect(provider.calls).toEqual([])
  })

  it('stays usable when the provider fails, and never surfaces the error', async () => {
    const provider = stubProvider(() => new Error('provider unavailable'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    const before = await catalog.overview()
    await catalog.settleDescriptions(1_000)
    const after = await catalog.overview()
    expect(after.suites[0]?.description).toBe(before.suites[0]?.description)
    expect(after.suites[0]?.translatedDescription).toBeUndefined()
    expect(after.totals.all).toBe(1)
  })

  it('translates the detail modal through the same cache', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    const detail = await catalog.suiteDetail('demo', 'v1-suite')
    expect(detail.description).toBe(SUITE_DESCRIPTION)
    expect(detail.translatedDescription).toBe('中文描述')
    expect(detail.name).toBe(SUITE_NAME)
    expect(detail.translatedName).toBe('中文名称')
    expect(provider.calls).toHaveLength(2)
  })

  it('reuses the persisted cache across catalog instances', async () => {
    const first = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog, userRoot } = await catalogWith({ locale: 'zh', provider: first })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    catalog.dispose()

    // A second activation over the same data root must not pay for the same
    // fields again, and the identity it folds into the key must match the first.
    const second = stubProvider(() => new Error('must not be called'))
    const reopened = new Catalog({
      userRoot,
      dataRoot: join(userRoot, 'data'),
      agentsRoot: join(userRoot, 'agents'),
      onChanged: () => {},
      ports: { localePreference: () => 'zh', translationProviders: [second], translationProviderIdentity: () => 'test-chain' }
    })
    await reopened.load()
    await reopened.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    const overview = await reopened.overview()
    expect(overview.suites[0]?.translatedDescription).toBe('中文描述')
    expect(overview.suites[0]?.translatedName).toBe('中文名称')
    expect(overview.translationPending).toBeUndefined()
    expect(second.calls).toEqual([])
    reopened.dispose()
  })

  it('warms the whole catalog without a panel read', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    // No overview() call: the warm-up alone must queue and complete the work,
    // so a returning user's panel opens on translations already paid for.
    await catalog.warmDescriptions()
    await catalog.settleDescriptions(5_000)
    const card = await onlyCard(catalog)
    expect(card.translatedDescription).toBe('中文描述')
    expect(card.translatedName).toBe('中文名称')
    expect(provider.calls).toHaveLength(2)
  })

  it('re-warms incrementally, paying only for fields not yet cached', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.warmDescriptions()
    await catalog.settleDescriptions(5_000)
    expect(provider.calls).toHaveLength(2)
    // A second pass is a cache lookup per field: nothing new to translate.
    await catalog.warmDescriptions()
    await catalog.settleDescriptions(1_000)
    expect(provider.calls).toHaveLength(2)
  })

  it('warms nothing for the en locale', async () => {
    const provider = stubProvider(() => '中文描述')
    const { catalog } = await catalogWith({ locale: 'en', provider })
    await catalog.warmDescriptions()
    await catalog.settleDescriptions(1_000)
    expect(provider.calls).toEqual([])
  })

  it('keeps the panel usable when the warm-up itself fails', async () => {
    const provider = stubProvider(() => new Error('provider unavailable'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.warmDescriptions()
    await catalog.settleDescriptions(1_000)
    // A failed warm-up is silent: the read still answers with upstream text.
    const overview = await catalog.overview()
    expect(overview.suites).toHaveLength(1)
    expect(overview.suites[0]?.description).toBeTruthy()
  })

  it('renders upstream text when no provider chain is wired at all', async () => {
    const { catalog } = await catalogWith({ locale: 'zh' })
    const overview = await catalog.overview()
    expect(overview.suites).toHaveLength(1)
    expect(overview.suites[0]?.translatedDescription).toBeUndefined()
    expect(overview.suites[0]?.translatedName).toBeUndefined()
    expect(overview.translationPending).toBeUndefined()
  })
})
