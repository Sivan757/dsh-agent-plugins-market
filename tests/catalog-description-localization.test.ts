/**
 * End-to-end localization through the Catalog facade: the overview and the
 * suite detail must serve translated descriptions, report what is still
 * pending, and never let a model failure break the read.
 */
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import type { DescriptionTranslator } from '../src/application/description-localizer.js'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')
const roots: string[] = []

/** A temp user root with the v1-suite fixture checked out as local source demo. */
async function seededUserRoot(prefix: string): Promise<string> {
  const userRoot = await mkdtemp(join(tmpdir(), prefix))
  roots.push(userRoot)
  await mkdir(join(userRoot, '.sources', 'demo'), { recursive: true })
  await cp(fixture, join(userRoot, '.sources', 'demo'), { recursive: true })
  return userRoot
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A translator that maps every description to a fixed Chinese answer. */
function stubTranslator(answer: (text: string) => string | Error): DescriptionTranslator & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    available: () => true,
    translate: async ({ text }) => {
      calls.push(text)
      const result = answer(text)
      if (result instanceof Error) throw result
      return result
    }
  }
}

/** Build one catalog over a seeded user root, with the locale and translator wired. */
async function catalogWith(options: { locale: string; translator?: DescriptionTranslator }): Promise<{ catalog: Catalog; userRoot: string }> {
  const userRoot = await seededUserRoot('dsh-agent-plugins-i18n-')
  const catalog = new Catalog({
    userRoot,
    dataRoot: join(userRoot, 'data'),
    agentsRoot: join(userRoot, 'agents'),
    onChanged: () => {},
    ports: {
      localePreference: () => options.locale,
      ...(options.translator === undefined ? {} : { descriptionTranslator: options.translator })
    }
  })
  await catalog.load()
  await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
  return { catalog, userRoot }
}

describe('Catalog description localization', () => {
  it('serves the original text and reports pending on the first zh read, then the translation', async () => {
    const translator = stubTranslator(() => '中文描述')
    const { catalog } = await catalogWith({ locale: 'zh', translator })
    const first = await catalog.overview()
    const [firstCard] = first.suites
    if (firstCard === undefined) throw new Error('expected one suite')
    // The read never waits on the model: it answers with upstream text.
    expect(firstCard.description).not.toBe('中文描述')
    expect(first.descriptionPending).toBe(1)
    await catalog.settleDescriptions(5_000)
    const second = await catalog.overview()
    expect(second.suites[0]?.description).toBe('中文描述')
    expect(second.descriptionPending).toBeUndefined()
    expect(translator.calls).toHaveLength(1)
  })

  it('leaves the overview untouched for the en locale', async () => {
    const translator = stubTranslator(() => '中文描述')
    const { catalog } = await catalogWith({ locale: 'en', translator })
    const overview = await catalog.overview()
    expect(overview.suites[0]?.description).not.toBe('中文描述')
    expect(overview.descriptionPending).toBeUndefined()
    expect(translator.calls).toEqual([])
  })

  it('stays usable when the model fails, and never surfaces the error', async () => {
    const translator = stubTranslator(() => new Error('model unavailable'))
    const { catalog } = await catalogWith({ locale: 'zh', translator })
    const before = await catalog.overview()
    await catalog.settleDescriptions(1_000)
    const after = await catalog.overview()
    expect(after.suites[0]?.description).toBe(before.suites[0]?.description)
    expect(after.totals.all).toBe(1)
  })

  it('translates the detail modal description through the same cache', async () => {
    const translator = stubTranslator(() => '中文描述')
    const { catalog } = await catalogWith({ locale: 'zh', translator })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    const detail = await catalog.suiteDetail('demo', 'v1-suite')
    expect(detail.description).toBe('中文描述')
    expect(translator.calls).toHaveLength(1)
  })

  it('reuses the persisted cache across catalog instances', async () => {
    const first = stubTranslator(() => '中文描述')
    const { catalog, userRoot } = await catalogWith({ locale: 'zh', translator: first })
    await catalog.overview()
    await catalog.settleDescriptions(5_000)
    catalog.dispose()

    // A second activation over the same data root must not pay for the same
    // description again.
    const second = stubTranslator(() => new Error('must not be called'))
    const reopened = new Catalog({
      userRoot,
      dataRoot: join(userRoot, 'data'),
      agentsRoot: join(userRoot, 'agents'),
      onChanged: () => {},
      ports: { localePreference: () => 'zh', descriptionTranslator: second }
    })
    await reopened.load()
    await reopened.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    const overview = await reopened.overview()
    expect(overview.suites[0]?.description).toBe('中文描述')
    expect(overview.descriptionPending).toBeUndefined()
    expect(second.calls).toEqual([])
    reopened.dispose()
  })

  it('renders upstream text when no translator is wired at all', async () => {
    const { catalog } = await catalogWith({ locale: 'zh' })
    const overview = await catalog.overview()
    expect(overview.suites).toHaveLength(1)
    expect(overview.descriptionPending).toBeUndefined()
  })
})
