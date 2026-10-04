/**
 * The translation scheduler: synchronous reads, batching, de-duplication,
 * backoff, and silent degradation.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BATCH_SIZE, TranslationLocalizer, needsTranslation } from '../src/application/translation/localizer.js'
import { resetCircuitBreaker, type TranslationProvider } from '../src/application/translation/chain.js'
import type { TranslationUnit } from '../src/application/translation/unit.js'
import { translationKey } from '../src/application/state/translation-cache.js'

let dataRoot: string
let clock: number

beforeEach(async () => {
  resetCircuitBreaker()
  dataRoot = await mkdtemp(join(tmpdir(), 'translation-localizer-'))
  clock = 1_000_000
})

afterEach(async () => {
  // A flush timer can outlive the test; retry rather than fail on its temp file.
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

/** A provider that records every batch it is handed. */
function recorder(): { provider: TranslationProvider; batches: string[][] } {
  const batches: string[][] = []
  return {
    batches,
    provider: {
      id: 'microsoft',
      available: () => true,
      translate: async ({ texts }) => {
        batches.push([...texts])
        return texts.map(text => 'ZH:' + text)
      }
    }
  }
}

function unit(id: string, text: string, role: 'name' | 'description' = 'description'): TranslationUnit {
  return { surface: 'market', id, role, text }
}

function build(providers: readonly TranslationProvider[]): TranslationLocalizer {
  return new TranslationLocalizer({
    dataRoot,
    providers,
    providerIdentity: () => 'test-chain',
    now: () => clock
  })
}

describe('needsTranslation', () => {
  it('skips text that is already Chinese or bilingual', () => {
    expect(needsTranslation('读取文件')).toBe(false)
    expect(needsTranslation('读取文件 · Read files')).toBe(false)
    expect(needsTranslation('Read files')).toBe(true)
    expect(needsTranslation('   ')).toBe(false)
    expect(needsTranslation(undefined)).toBe(false)
  })
})

describe('TranslationLocalizer', () => {
  it('answers from the original text synchronously and reports pending', async () => {
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    const first = localizer.localize(unit('a/b', 'Read files'), 'zh')
    expect(first.text).toBe('Read files')
    expect(first.pending).toBe(true)
    await localizer.settle(1_000)
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    localizer.dispose()
  })

  it('serves a cached translation without calling the provider again', async () => {
    const { provider, batches } = recorder()
    const first = build([provider])
    await first.load()
    first.localize(unit('a/b', 'Read files'), 'zh')
    await first.settle(1_000)
    first.dispose()

    const second = build([provider])
    await second.load()
    expect(second.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    expect(batches).toHaveLength(1)
    second.dispose()
  })

  it('de-duplicates concurrent requests for the same text', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    for (let index = 0; index < 5; index += 1) localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual(['Read files'])
    localizer.dispose()
  })

  it('keeps name and description apart in the cache', async () => {
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'market', 'name'), 'zh')
    localizer.localize(unit('a/b', 'Read the market', 'description'), 'zh')
    await localizer.settle(1_000)
    expect(localizer.localize(unit('a/b', 'market', 'name'), 'zh').text).toBe('ZH:market')
    expect(localizer.localize(unit('a/b', 'Read the market', 'description'), 'zh').text).toBe('ZH:Read the market')
    localizer.dispose()
  })

  it('misses the cache when the provider identity changes', async () => {
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    const other = new TranslationLocalizer({
      dataRoot,
      providers: [provider],
      providerIdentity: () => 'other-chain',
      now: () => clock
    })
    await other.load()
    expect(other.localize(unit('a/b', 'Read files'), 'zh').pending).toBe(true)
    localizer.dispose()
    other.dispose()
  })

  it('caps one provider call at MAX_BATCH_SIZE texts', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    for (let index = 0; index < MAX_BATCH_SIZE + 5; index += 1) {
      localizer.localize(unit('suite/' + String(index), 'Text number ' + String(index)), 'zh')
    }
    await localizer.settle(2_000)
    expect(batches.every(batch => batch.length <= MAX_BATCH_SIZE)).toBe(true)
    expect(batches.reduce((total, batch) => total + batch.length, 0)).toBe(MAX_BATCH_SIZE + 5)
    localizer.dispose()
  })

  it('degrades silently when every provider fails', async () => {
    const failing: TranslationProvider = {
      id: 'microsoft',
      available: () => true,
      translate: async () => {
        throw new Error('offline')
      }
    }
    const localizer = build([failing])
    await localizer.load()
    const answer = localizer.localize(unit('a/b', 'Read files'), 'zh')
    expect(answer.text).toBe('Read files')
    await localizer.settle(1_000)
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh').text).toBe('Read files')
    localizer.dispose()
  })

  it('stops reporting pending once a key exhausts its retries', async () => {
    const failing: TranslationProvider = {
      id: 'microsoft',
      available: () => true,
      translate: async () => {
        throw new Error('offline')
      }
    }
    const localizer = build([failing])
    await localizer.load()
    // Four attempts, each waiting out the previous one's backoff. The clock
    // advances BEFORE the call, because localize() is what consults the window.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      clock += 200_000
      expect(localizer.localize(unit('a/b', 'Read files'), 'zh').pending).toBe(true)
      await localizer.settle(500)
    }
    clock += 200_000
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh').pending).toBe(false)
    localizer.dispose()
  })

  it('reports no pending work when the chain is empty', async () => {
    const localizer = build([])
    await localizer.load()
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'Read files', pending: false })
    localizer.dispose()
  })

  it('writes the cache to disk and reuses it across instances', async () => {
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    await localizer.flush()
    localizer.dispose()

    const reloaded = build([provider])
    await reloaded.load()
    expect(reloaded.localize(unit('a/b', 'Read files'), 'zh').text).toBe('ZH:Read files')
    reloaded.dispose()
  })

  it('drops expired entries at load time', async () => {
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    await localizer.flush()
    localizer.dispose()

    clock += 8 * 24 * 60 * 60 * 1000
    const later = build([provider])
    await later.load()
    expect(later.localize(unit('a/b', 'Read files'), 'zh').pending).toBe(true)
    later.dispose()
  })

  it('does not queue text that is already Chinese', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    expect(localizer.localize(unit('a/b', '读取文件'), 'zh')).toEqual({ text: '读取文件', pending: false })
    await localizer.settle(200)
    expect(batches).toHaveLength(0)
    localizer.dispose()
  })

  it('keeps the key stable for identical input', () => {
    const a = translationKey(unit('a/b', 'Read files'), 'zh', 'chain')
    const b = translationKey(unit('a/b', 'Read files'), 'zh', 'chain')
    const other = translationKey(unit('a/b', 'Read files'), 'en', 'chain')
    expect(a).toBe(b)
    expect(a).not.toBe(other)
  })

  it('never throws into the caller when the provider rejects asynchronously', async () => {
    const localizer = build([
      {
        id: 'microsoft',
        available: () => true,
        translate: () => Promise.reject(new Error('late failure'))
      }
    ])
    await localizer.load()
    expect(() => localizer.localize(unit('a/b', 'Read files'), 'zh')).not.toThrow()
    await expect(localizer.settle(500)).resolves.toBeTypeOf('boolean')
    localizer.dispose()
  })

  it('cancels a pending flush timer on dispose', async () => {
    vi.useFakeTimers()
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await vi.advanceTimersByTimeAsync(0)
    expect(() => localizer.dispose()).not.toThrow()
    vi.useRealTimers()
  })
})
