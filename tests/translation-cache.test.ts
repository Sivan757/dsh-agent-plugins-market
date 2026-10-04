import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TRANSLATION_TTL_MS,
  loadTranslationCache,
  pruneExpired,
  saveTranslationCache,
  translationCachePath,
  translationKey,
  type TranslationRecord
} from '../src/application/state/translation-cache.js'
import type { TranslationUnit } from '../src/application/translation/unit.js'

const roots: string[] = []

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
  return { text: '管理套件来源', provider: 'google', at: 1_000, expiresAt: 1_000 + TRANSLATION_TTL_MS, ...overrides }
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
    const separated = translationKey(unit({ id: 'a\u0000b' }), 'zh', 'chain')
    const plain = translationKey(unit({ id: 'a' }), 'zh', 'chain')
    const other = translationKey(unit({ id: 'b' }), 'zh', 'chain')
    expect(new Set([separated, plain, other]).size).toBe(3)
  })

  it('is a bounded digest, not the raw text', () => {
    expect(translationKey(unit({ text: 'x'.repeat(10_000) }), 'zh', 'chain')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('pruneExpired', () => {
  it('drops entries whose expiry has passed and keeps the live ones', () => {
    const live = record({ expiresAt: 2_000 })
    const gone = record({ expiresAt: 999 })
    expect(pruneExpired({ live, gone }, 1_000)).toEqual({ live })
  })

  it('drops an entry expiring exactly at the reference time', () => {
    expect(pruneExpired({ edge: record({ expiresAt: 1_000 }) }, 1_000)).toEqual({})
  })

  it('returns a new record rather than mutating its input', () => {
    const entries = { gone: record({ expiresAt: 999 }) }
    expect(pruneExpired(entries, 1_000)).toEqual({})
    expect(Object.keys(entries)).toEqual(['gone'])
  })
})

describe('loadTranslationCache', () => {
  it('round-trips a saved entry with its provider and expiry', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    const entry = record()
    await saveTranslationCache(root, { [key]: entry })
    expect(await loadTranslationCache(root, 1_000)).toEqual({ [key]: entry })
  })

  it('drops expired entries when reading', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    await saveTranslationCache(root, { [key]: record({ expiresAt: 5_000 }) })
    expect(await loadTranslationCache(root, 5_000)).toEqual({})
    expect(await loadTranslationCache(root, 4_999)).toEqual({ [key]: record({ expiresAt: 5_000 }) })
  })

  it('defaults the prune clock to now, so a week-old entry is gone', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    const at = Date.now() - TRANSLATION_TTL_MS - 1
    await saveTranslationCache(root, { [key]: record({ at, expiresAt: at + TRANSLATION_TTL_MS }) })
    expect(await loadTranslationCache(root)).toEqual({})
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
          noExpiry: { text: '管理套件来源', provider: 'llm', at: 1 },
          junk: 'nope'
        }
      }),
      'utf8'
    )
    // A record without a usable expiry is dropped: an entry whose age cannot be
    // established is exactly what a TTL exists to bound.
    expect(Object.keys(await loadTranslationCache(root, 1_000))).toEqual([key])
  })

  it('fills a missing timestamp rather than dropping the translation', async () => {
    const root = await tempRoot()
    const key = translationKey(unit(), 'zh', 'chain')
    await writeFile(translationCachePath(root), JSON.stringify({ version: 1, entries: { [key]: { text: '管理套件来源', provider: 'llm', expiresAt: 9_000 } } }), 'utf8')
    expect(await loadTranslationCache(root, 1_000)).toEqual({ [key]: { text: '管理套件来源', provider: 'llm', at: 0, expiresAt: 9_000 } })
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
    expect(Object.keys(await loadTranslationCache(root, 1_000))).toEqual([fresh])
  })
})

describe('TRANSLATION_TTL_MS', () => {
  it('is seven days', () => {
    expect(TRANSLATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
