import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DescriptionLocalizer, needsTranslation, type DescriptionTranslator } from '../src/application/description-localizer.js'
import { descriptionTranslationKey, loadDescriptionTranslations } from '../src/application/state/description-translations.js'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-description-translations-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A translator that records every request and answers from a fixed map. */
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

describe('needsTranslation', () => {
  it('accepts English prose and rejects text that already carries Han', () => {
    expect(needsTranslation('Manage suite sources')).toBe(true)
    expect(needsTranslation('管理套件来源')).toBe(false)
    // A bilingual pair is already Chinese on one side; the client picks it.
    expect(needsTranslation('管理套件来源 · Manage suite sources')).toBe(false)
  })

  it('rejects empty and missing descriptions', () => {
    expect(needsTranslation(undefined)).toBe(false)
    expect(needsTranslation('')).toBe(false)
    expect(needsTranslation('   ')).toBe(false)
  })
})

describe('descriptionTranslationKey', () => {
  it('is stable for identical identity and differs on every part', () => {
    const base = descriptionTranslationKey('src', 'suite', 'text', 'zh')
    expect(descriptionTranslationKey('src', 'suite', 'text', 'zh')).toBe(base)
    expect(descriptionTranslationKey('other', 'suite', 'text', 'zh')).not.toBe(base)
    expect(descriptionTranslationKey('src', 'other', 'text', 'zh')).not.toBe(base)
    expect(descriptionTranslationKey('src', 'suite', 'other', 'zh')).not.toBe(base)
    expect(descriptionTranslationKey('src', 'suite', 'text', 'en')).not.toBe(base)
  })

  it('does not alias ids that contain the join separator', () => {
    // Concatenating without a separator would make these two collide.
    expect(descriptionTranslationKey('a', 'b/c', 't', 'zh')).not.toBe(descriptionTranslationKey('a/b', 'c', 't', 'zh'))
  })
})

describe('DescriptionLocalizer', () => {
  it('returns the original text and reports pending while a translation runs', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => '管理套件来源')
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    const first = localizer.localize('src', 'suite', 'Manage suite sources', 'zh')
    expect(first).toEqual({ text: 'Manage suite sources', pending: true })
    await localizer.settle(2_000)
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh')).toEqual({ text: '管理套件来源', pending: false })
  })

  it('serves a cached translation across instances', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => '管理套件来源')
    const first = new DescriptionLocalizer({ dataRoot: root, translator })
    await first.load()
    first.localize('src', 'suite', 'Manage suite sources', 'zh')
    await first.settle(2_000)

    const second = new DescriptionLocalizer({ dataRoot: root, translator: stubTranslator(() => new Error('must not be called')) })
    await second.load()
    expect(second.localize('src', 'suite', 'Manage suite sources', 'zh')).toEqual({ text: '管理套件来源', pending: false })
  })

  it('never translates a description that already carries Chinese', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => 'unused')
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    expect(localizer.localize('src', 'suite', '管理套件来源 · Manage suite sources', 'zh')).toEqual({
      text: '管理套件来源 · Manage suite sources',
      pending: false
    })
    expect(translator.calls).toEqual([])
  })

  it('queues one call per key even when the panel reads the same suite repeatedly', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => '管理套件来源')
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    for (let i = 0; i < 5; i += 1) localizer.localize('src', 'suite', 'Manage suite sources', 'zh')
    await localizer.settle(2_000)
    expect(translator.calls).toEqual(['Manage suite sources'])
  })

  it('caps concurrent model calls', async () => {
    const root = await tempRoot()
    let active = 0
    let peak = 0
    const translator: DescriptionTranslator = {
      available: () => true,
      translate: async ({ text }) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active -= 1
        return `译:${text}`
      }
    }
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    for (let i = 0; i < 12; i += 1) localizer.localize('src', `suite-${i}`, `Description ${i}`, 'zh')
    await localizer.settle(5_000)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('degrades to the original text when the model fails, and keeps the panel usable', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => new Error('model unavailable'))
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh').text).toBe('Manage suite sources')
    await localizer.settle(1_000)
    // The failure is silent: the read still answers with the original text.
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh').text).toBe('Manage suite sources')
  })

  it('reports nothing pending while a key waits out its backoff', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => new Error('model unavailable'))
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator, now: () => 0 })
    await localizer.load()
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh').pending).toBe(true)
    await localizer.settle(1_000)
    // The attempt failed and the key is now backing off: no work is queued, so
    // the panel must stop re-reading instead of polling forever.
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh').pending).toBe(false)
  })

  it('backs off a key that keeps failing instead of retrying in a loop', async () => {
    const root = await tempRoot()
    let calls = 0
    const translator: DescriptionTranslator = {
      available: () => true,
      translate: async () => {
        calls += 1
        throw new Error('model unavailable')
      }
    }
    // A controllable clock keeps the backoff window deterministic.
    let now = 0
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator, now: () => now })
    await localizer.load()
    localizer.localize('src', 'suite', 'Manage suite sources', 'zh')
    await localizer.settle(1_000)
    expect(calls).toBe(1)
    // Still inside the first backoff window: no second attempt.
    now += 1_000
    localizer.localize('src', 'suite', 'Manage suite sources', 'zh')
    await localizer.settle(1_000)
    expect(calls).toBe(1)
    // Past it: the key is retried once.
    now += 5_000
    localizer.localize('src', 'suite', 'Manage suite sources', 'zh')
    await localizer.settle(1_000)
    expect(calls).toBe(2)
  })

  it('reports pending without queueing when no translator is wired', async () => {
    const root = await tempRoot()
    const localizer = new DescriptionLocalizer({ dataRoot: root })
    await localizer.load()
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh')).toEqual({ text: 'Manage suite sources', pending: false })
    expect(localizer.pendingCount).toBe(0)
  })

  it('reports pending without queueing when the model route is unavailable', async () => {
    const root = await tempRoot()
    const translator: DescriptionTranslator = { available: () => false, translate: async () => 'unused' }
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh')).toEqual({ text: 'Manage suite sources', pending: false })
  })

  it('survives a corrupt cache file', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'description-translations.json'), '{ not json', 'utf8')
    const translator = stubTranslator(() => '管理套件来源')
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh').text).toBe('Manage suite sources')
    await localizer.settle(2_000)
    expect(localizer.localize('src', 'suite', 'Manage suite sources', 'zh').text).toBe('管理套件来源')
  })

  it('drops malformed entries from a hand-edited cache', async () => {
    const root = await tempRoot()
    const key = descriptionTranslationKey('src', 'suite', 'Manage suite sources', 'zh')
    await writeFile(
      join(root, 'description-translations.json'),
      JSON.stringify({ version: 1, entries: { [key]: { text: '管理套件来源', at: 1 }, bogus: { text: '' }, junk: 'nope' } }),
      'utf8'
    )
    const entries = await loadDescriptionTranslations(root)
    expect(Object.keys(entries)).toEqual([key])
  })

  it('persists through the shared atomic writer with a trailing newline', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => '管理套件来源')
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    localizer.localize('src', 'suite', 'Manage suite sources', 'zh')
    await localizer.settle(2_000)
    const written = await readFile(join(root, 'description-translations.json'), 'utf8')
    expect(written.endsWith('\n')).toBe(true)
    expect(JSON.parse(written)).toMatchObject({ version: 1 })
  })

  it('ignores work enqueued after dispose', async () => {
    const root = await tempRoot()
    const translator = stubTranslator(() => '管理套件来源')
    const localizer = new DescriptionLocalizer({ dataRoot: root, translator })
    await localizer.load()
    localizer.dispose()
    localizer.localize('src', 'suite', 'Manage suite sources', 'zh')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(translator.calls).toEqual([])
  })
})
