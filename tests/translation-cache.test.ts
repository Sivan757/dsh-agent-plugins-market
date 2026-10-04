import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearTranslationCache,
  loadTranslationCache,
  saveTranslationCache,
  translationCachePath,
  translationKey,
  type TranslationRecord
} from '../src/application/state/translation-cache.js'
import type { TranslationUnit } from '../src/application/translation/unit.js'

const roots: string[] = []

/** The separator the cache key joins its parts with. */
const SEP = String.fromCharCode(0)

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-translation-cache-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A unit with every identity part spelled out, so a case can vary one of them. */
function unit(overrides: Partial<TranslationUnit> = {}): TranslationUnit {
  return { surface: 'market', id: 'source/suite', role: 'description', text: 'Manage suite sources', ...overrides }
}

/** A record as a successful translation would have written it. */
function record(overrides: Partial<TranslationRecord> = {}): TranslationRecord {
  return { text: '管理套件来源', provider: 'google', at: 1_000, ...overrides }
}

describe('translationCachePath', () => {
  it('lives beside the other plugin state files under the data root', () => {
    expect(translationCachePath('/data/plugin')).toBe(join('/data/plugin', 'translation-cache.json'))
  })
})

describe('translationKey', () => {
  it('is stable for an identical unit, locale, and provider identity', () => {
    const base = translationKey(unit(), 'zh', 'google|microsoft|llm')
    expect(translationKey(unit(), 'zh', 'google|microsoft|llm')).toBe(base)
  })

  it('changes when the target locale changes', () => {
    expect(translationKey(unit(), 'en', 'google|microsoft|llm')).not.toBe(translationKey(unit(), 'zh', 'google|microsoft|llm'))
  })

  it('changes when the provider identity changes', () => {
    // The whole point of folding the provider into the key: a deployment that
    // switches engines must miss instead of serving the old engine's text.
    expect(translationKey(unit(), 'zh', 'microsoft|llm')).not.toBe(translationKey(unit(), 'zh', 'google|microsoft|llm'))
  })

  it('changes on every part of the unit identity and text', () => {
    const base = translationKey(unit(), 'zh', 'chain')
    expect(translationKey(unit({ surface: 'skills' }), 'zh', 'chain')).not.toBe(base)
    expect(translationKey(unit({ id: 'other/suite' }), 'zh', 'chain')).not.toBe(base)
    expect(translationKey(unit({ role: 'name' }), 'zh', 'chain')).not.toBe(base)
    expect(translationKey(unit({ text: 'Other text' }), 'zh', 'chain')).not.toBe(base)
  })

  it('keeps identities that contain the join separator distinct', () => {
    const separated = translationKey(unit({ id: 'a' + SEP + 'b' }), 'zh', 'chain')
    const plain = translationKey(unit({ id: 'a' }), 'zh', 'chain')
    const other = translationKey(unit({ id: 'b' }), 'zh', 'chain')
    expect(new Set([separated, plain, other]).size).toBe(3)
  })

  it('is a bounded digest, not the raw text', () => {
    expect(translationKey(unit({ text: 'x'.repeat(10_000) }), 'zh', 'chain')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('loadTranslationCache', () => {
  it('round-trips a saved entry with its provider and timestamp', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    const entry = record()
    await saveTranslationCache(root, { [key]: entry })
    expect(await loadTranslationCache(root)).toEqual({ [key]: entry })
  })

  it('keeps an entry indefinitely: nothing expires it', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    const ancient = record({ at: 0 })
    await saveTranslationCache(root, { [key]: ancient })
    expect(await loadTranslationCache(root)).toEqual({ [key]: ancient })
  })

  it('degrades to an empty cache when the file is missing', async () => {
    const root = await tempRoot()
    expect(await loadTranslationCache(root)).toEqual({})
  })

  it('degrades to an empty cache when the file is not JSON', async () => {
    const root = await tempRoot()
    await writeFile(translationCachePath(root), '{ not json', 'utf8')
    expect(await loadTranslationCache(root)).toEqual({})
  })

  it('degrades to an empty cache when the document shape is wrong', async () => {
    const root = await tempRoot()
    await writeFile(translationCachePath(root), JSON.stringify({ version: 1, entries: 'nope' }), 'utf8')
    expect(await loadTranslationCache(root)).toEqual({})
  })

  it('drops malformed entries from a hand-edited cache', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    await writeFile(
      translationCachePath(root),
      JSON.stringify({
        version: 1,
        entries: {
          [key]: record(),
          emptyText: record({ text: '' }),
          unknownProvider: { ...record(), provider: 'deepl' },
          junk: 'nope'
        }
      }),
      'utf8'
    )
    expect(Object.keys(await loadTranslationCache(root))).toEqual([key])
  })

  it('fills a missing timestamp rather than dropping the translation', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    await writeFile(translationCachePath(root), JSON.stringify({ version: 1, entries: { [key]: { text: '管理套件来源', provider: 'llm' } } }), 'utf8')
    expect(await loadTranslationCache(root)).toEqual({ [key]: { text: '管理套件来源', provider: 'llm', at: 0 } })
  })
})

describe('saveTranslationCache', () => {
  it('writes the whole document through the shared atomic writer', async () => {
    const root = await tempRoot()
    await saveTranslationCache(root, {})
    const written = await readFile(translationCachePath(root), 'utf8')
    expect(written.endsWith('\n')).toBe(true)
    expect(JSON.parse(written)).toEqual({ version: 1, entries: {} })
  })

  it('replaces the previous document instead of merging into it', async () => {
    const root = await tempRoot()
    const stale = translationKey(unit({ id: 'stale' }), 'zh', 'chain')
    const fresh = translationKey(unit({ id: 'fresh' }), 'zh', 'chain')
    await saveTranslationCache(root, { [stale]: record() })
    await saveTranslationCache(root, { [fresh]: record() })
    expect(Object.keys(await loadTranslationCache(root))).toEqual([fresh])
  })
})

describe('clearTranslationCache', () => {
  it('removes every entry', async () => {
    const root = await tempRoot()
    await saveTranslationCache(root, { [translationKey(unit(), 'zh', 'chain')]: record() })
    await clearTranslationCache(root)
    expect(await loadTranslationCache(root)).toEqual({})
  })

  it('is idempotent: clearing a missing file is not an error', async () => {
    const root = await tempRoot()
    await expect(clearTranslationCache(root)).resolves.toBeUndefined()
    await expect(clearTranslationCache(root)).resolves.toBeUndefined()
  })
})
