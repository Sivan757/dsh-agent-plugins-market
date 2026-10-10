/**
 * End-to-end localization through the Catalog facade: the overview and the
 * suite detail must serve translated descriptions, report what is
 * still pending, and never let a provider failure break the read.
 */
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { MAX_DOCUMENT_CHUNK_CHARS } from '../packages/market-translation/src/application/translation/document.js'
import { resetCircuitBreaker, type TranslationProvider } from '../packages/market-translation/src/application/translation/chain.js'

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
    expect(firstRead.translationPending).toBe(1)
    await catalog.settleDescriptions(5_000)
    const second = await catalog.overview()
    const card = second.suites[0]
    // The upstream text stays in place beside the translation: the client picks
    // which to render, and the panel's search keeps reading the original.
    expect(card?.description).toBe(SUITE_DESCRIPTION)
    expect(card?.translatedDescription).toBe('中文描述')
    // The name is never translated, so it carries no translated counterpart.
    expect(card?.name).toBe(SUITE_NAME)
    expect(second.translationPending).toBeUndefined()
    expect(provider.calls).toHaveLength(1)
  })

  it('leaves the authored description when the provider answers with nothing', async () => {
    // An empty answer fails only its own key, so the authored text stays.
    const provider = stubProvider(() => '')
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    const card = await onlyCard(catalog)
    expect(card.description).toBe(SUITE_DESCRIPTION)
    expect(card.translatedDescription).toBeUndefined()
  })

  it('leaves the overview untouched for the en locale', async () => {
    const provider = stubProvider(() => '中文描述')
    const { catalog } = await catalogWith({ locale: 'en', provider })
    const overview = await catalog.overview()
    expect(overview.suites[0]?.description).not.toBe('中文描述')
    expect(overview.suites[0]?.translatedDescription).toBeUndefined()
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
    expect(provider.calls).toHaveLength(1)
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
    expect(overview.translationPending).toBeUndefined()
    expect(second.calls).toEqual([])
    reopened.dispose()
  })

  it('chunks a description longer than one call may carry, and reassembles it whole', async () => {
    // Real catalogs ship descriptions past the size one text used to be
    // budgeted for (the longest measured is 1,428 characters), and a text that
    // overruns the model hop's output budget is cut off mid-generation — which
    // fails the batch and retires the provider for the session. So a long
    // description travels the way a document does.
    const long = Array.from({ length: 6 }, (_, index) => `Paragraph ${String(index)} ` + 'of a description long enough to travel in chunks.'.repeat(4)).join('\n\n')
    expect(long.length).toBeGreaterThan(MAX_DOCUMENT_CHUNK_CHARS)
    const provider = stubProvider(text => `ZH<${text}>`)
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    const first = catalog.translateFields('market', 'demo/suite', { description: long }, 'zh')
    // The read never waits: it answers the authored text and counts the chunks
    // it just queued.
    expect(first.fields.translatedDescription).toBeUndefined()
    expect(first.pending).toBeGreaterThan(1)

    await catalog.settleDescriptions(5_000)
    const settled = catalog.translateFields('market', 'demo/suite', { description: long }, 'zh')
    expect(settled.pending).toBe(0)
    // Every chunk went on its own, nothing was dropped or reordered, and the
    // authored blank lines between them survive the round trip.
    for (const call of provider.calls) expect(call.length).toBeLessThanOrEqual(MAX_DOCUMENT_CHUNK_CHARS)
    expect(settled.fields.translatedDescription?.replace(/ZH<|>/g, '')).toBe(long)
  })

  it('translates nothing until a read asks for it', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    // Lazy by design: constructing and loading a catalog must not spend a single
    // provider call, so a deployment that never opens the market pays nothing.
    expect(provider.calls).toEqual([])
    await catalog.settleDescriptions(200)
    expect(provider.calls).toEqual([])
  })

  it('the first read queues the work and the second serves it', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    const first = await catalog.overview()
    expect(first.suites[0]?.translatedDescription).toBeUndefined()
    expect(first.translationPending).toBe(1)
    await catalog.settleDescriptions(5_000)
    const second = await catalog.overview()
    expect(second.suites[0]?.translatedDescription).toBe('中文描述')
    expect(second.translationPending).toBeUndefined()
    expect(provider.calls).toHaveLength(1)
  })

  it('pays only for fields not yet cached on a repeated read', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    expect(provider.calls).toHaveLength(1)
    // Every later read is a cache lookup per field: nothing new to translate.
    await catalog.overview()
    await catalog.settleDescriptions(1_000)
    expect(provider.calls).toHaveLength(1)
  })

  it('queues nothing for the en locale', async () => {
    const provider = stubProvider(() => '中文描述')
    const { catalog } = await catalogWith({ locale: 'en', provider })
    const overview = await catalog.overview()
    await catalog.settleDescriptions(1_000)
    expect(overview.translationPending).toBeUndefined()
    expect(provider.calls).toEqual([])
  })

  it('keeps the panel usable when the provider fails', async () => {
    const provider = stubProvider(() => new Error('provider unavailable'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.overview()
    await catalog.settleDescriptions(1_000)
    // A failed batch is silent: the read still answers with upstream text.
    const overview = await catalog.overview()
    expect(overview.suites).toHaveLength(1)
    expect(overview.suites[0]?.description).toBeTruthy()
  })

  it('clearTranslations drops the cache so the next read translates again', async () => {
    const provider = stubProvider(text => (text === SUITE_DESCRIPTION ? '中文描述' : '中文名称'))
    const { catalog } = await catalogWith({ locale: 'zh', provider })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    expect(provider.calls).toHaveLength(1)

    await catalog.clearTranslations()
    // The in-memory copy must go too, or the same process keeps serving text
    // the file no longer holds.
    const afterClear = await catalog.overview()
    expect(afterClear.suites[0]?.translatedDescription).toBeUndefined()
    expect(afterClear.translationPending).toBe(1)
    await catalog.settleDescriptions(5_000)
    expect(provider.calls).toHaveLength(2)
  })

  it('renders upstream text when no provider chain is wired at all', async () => {
    const { catalog } = await catalogWith({ locale: 'zh' })
    const overview = await catalog.overview()
    expect(overview.suites).toHaveLength(1)
    expect(overview.suites[0]?.translatedDescription).toBeUndefined()
    expect(overview.translationPending).toBeUndefined()
  })
})
