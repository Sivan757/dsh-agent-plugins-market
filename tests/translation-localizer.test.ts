/**
 * The translation scheduler: synchronous reads, batching, de-duplication,
 * backoff, and silent degradation.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_COALESCE_MS, MAX_BATCH_CHARS, MAX_BATCH_SIZE, TranslationLocalizer, needsTranslation } from '../src/application/translation/localizer.js'
import { isTripped, resetCircuitBreaker, type TranslationProvider } from '../src/application/translation/chain.js'
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

/** A provider that records the target language each batch was asked for. */
function targetRecorder(): { provider: TranslationProvider; targets: string[] } {
  const targets: string[] = []
  return {
    targets,
    provider: {
      id: 'microsoft',
      available: () => true,
      translate: async ({ texts, locale }) => {
        targets.push(locale)
        return texts.map(text => 'ZH:' + text)
      }
    }
  }
}

function unit(id: string, text: string): TranslationUnit {
  return { surface: 'market', id, text }
}

function build(providers: readonly TranslationProvider[], enabled?: () => boolean): TranslationLocalizer {
  return new TranslationLocalizer({
    dataRoot,
    providers,
    providerIdentity: () => 'test-chain',
    ...(enabled === undefined ? {} : { enabled }),
    now: () => clock
  })
}

describe('needsTranslation', () => {
  it('sends a text written in Latin, whatever Chinese it happens to quote', () => {
    expect(needsTranslation('Read files')).toBe(true)
    // The regression this rule replaced: one Han character — a term, a quoted
    // message, a table row — declined the whole 800-character chunk, and the
    // document path reported it as settled with the English still on screen.
    expect(needsTranslation('Append 中文 labels to the report header and keep file names as authored.')).toBe(true)
    expect(needsTranslation('   ')).toBe(false)
    expect(needsTranslation(undefined)).toBe(false)
  })

  it('declines a text that is already written in Chinese', () => {
    expect(needsTranslation('读取文件')).toBe(false)
    expect(needsTranslation('读取文件，然后按回车键继续。')).toBe(false)
  })

  it('sends an even split, because half of it is not in the target language', () => {
    // A bilingual pair is half English. The provider answers the Chinese half
    // unchanged and translates the other, which is what the reader wanted; the
    // client's own bilingual picker still resolves the segment it renders.
    expect(needsTranslation('读取文件 · Read files')).toBe(true)
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

  it('keeps two entities of one surface apart in the cache', async () => {
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read the market'), 'zh')
    localizer.localize(unit('a/c', 'Write the market'), 'zh')
    await localizer.settle(1_000)
    expect(localizer.localize(unit('a/b', 'Read the market'), 'zh').text).toBe('ZH:Read the market')
    expect(localizer.localize(unit('a/c', 'Write the market'), 'zh').text).toBe('ZH:Write the market')
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

  it('caps one provider call at MAX_BATCH_CHARS characters', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    // The value is the contract, not a tunable: the model hop sizes a call's
    // output from the source that call carries, and the two budgets are two
    // views of one number — 6,400 source characters is what one call's response
    // is sized for. What that costs in tokens is an estimate rather than a
    // measurement (nothing in this tree tokenizes): the character expansion is
    // measured over this repository's 90 bilingual pairs at 0.461 median and
    // 0.617 worst, and ~0.7 tokens per Chinese character puts the worst case
    // near 0.43 tokens per source character. `tests/document-chunks.test.ts`
    // asserts the derivation against the translator's own constant; what is
    // pinned here is the batching this budget drives.
    expect(MAX_BATCH_CHARS).toBe(6_400)
    // A document travels as chunks far larger than a description. The three
    // texts differ so the case pins the character budget rather than the
    // shared-text rule: one text on three entities is one unit now, and would
    // never need a second batch.
    const chunk = 'x'.repeat(MAX_BATCH_CHARS / 2)
    for (let index = 0; index < 3; index += 1) localizer.localize(unit('doc/' + String(index), chunk.slice(0, -1) + String(index)), 'zh')
    await localizer.settle(2_000)
    expect(batches.map(batch => batch.length)).toEqual([2, 1])
    expect(batches.reduce((total, batch) => total + batch.length, 0)).toBe(3)
    localizer.dispose()
  })

  it('still runs a text larger than a whole batch budget, on its own', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('doc/huge', 'x'.repeat(MAX_BATCH_CHARS + 10)), 'zh')
    localizer.localize(unit('doc/small', 'Small text'), 'zh')
    await localizer.settle(2_000)
    // Leaving it for a batch it would fit in would strand it forever: the
    // budget is a ceiling on the call, not a minimum size for a text.
    expect(batches.reduce((total, batch) => total + batch.length, 0)).toBe(2)
    expect(batches.some(batch => batch.length === 1 && (batch[0] ?? '').length > MAX_BATCH_CHARS)).toBe(true)
    localizer.dispose()
  })

  it('coalesces a burst that arrives one unit per turn into full batches', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    // The panel discovers one description per file it reads, so every unit
    // below lands in its own turn — the pattern that used to send one text per
    // provider call.
    const units = MAX_BATCH_SIZE * 3
    for (let index = 0; index < units; index += 1) {
      localizer.localize(unit('suite/' + String(index), 'Text number ' + String(index)), 'zh')
      await Promise.resolve()
    }
    await localizer.settle(2_000)
    expect(batches.reduce((total, batch) => total + batch.length, 0)).toBe(units)
    // One provider call per full batch, not one per unit.
    expect(batches.map(batch => batch.length)).toEqual([MAX_BATCH_SIZE, MAX_BATCH_SIZE, MAX_BATCH_SIZE])
    localizer.dispose()
  })

  it('holds a lone unit for the coalescing window and starts it on that tick', async () => {
    vi.useFakeTimers()
    try {
      const { provider, batches } = recorder()
      const localizer = build([provider])
      await localizer.load()
      const answer = localizer.localize(unit('a/b', 'Read files'), 'zh')
      expect(answer.pending).toBe(true)
      // The deferral is what lets a burst batch up, so the unit is still
      // waiting right after it is queued — a synchronous pump would already
      // have called the provider here.
      expect(batches).toEqual([])
      // And the deferral is bounded by the window: the batch starts on the tick
      // the window closes, not after some second-long wait.
      await vi.advanceTimersByTimeAsync(BATCH_COALESCE_MS)
      expect(batches).toEqual([['Read files']])
      localizer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a batch the moment it is full instead of waiting out the window', async () => {
    vi.useFakeTimers()
    try {
      const { provider, batches } = recorder()
      const localizer = build([provider])
      await localizer.load()
      // One short of a batch: the coalescing window is armed and nothing runs.
      for (let index = 0; index < MAX_BATCH_SIZE - 1; index += 1) {
        localizer.localize(unit('suite/' + String(index), 'Text number ' + String(index)), 'zh')
      }
      expect(batches).toEqual([])
      // The unit that completes the batch cancels the window and starts it:
      // waiting the rest of the deferral could not improve the grouping, so the
      // twentieth unit must not pay for it.
      localizer.localize(unit('suite/last', 'Text number last'), 'zh')
      expect(batches.map(batch => batch.length)).toEqual([MAX_BATCH_SIZE])
      localizer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the authored text while the switch is off, cache or not, and queues nothing new', async () => {
    const { provider, batches } = recorder()
    let enabled = true
    const localizer = build([provider], () => enabled)
    await localizer.load()

    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    expect(batches).toHaveLength(1)
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'ZH:Read files', pending: false })

    // Off means the authored text everywhere. A translation sitting in the cache
    // must not stay on screen while the control reads "off" — that is the
    // contradiction being pinned here, and nothing is re-paid on re-enable.
    enabled = false
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'Read files', pending: false })
    expect(localizer.localize(unit('a/c', 'Write files'), 'zh')).toEqual({ text: 'Write files', pending: false })
    await localizer.settle(200)
    expect(batches).toHaveLength(1)

    // Switched back on, the cache still holds what was paid for, and only the
    // unit that was never translated is queued.
    enabled = true
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    expect(localizer.localize(unit('a/c', 'Write files'), 'zh').pending).toBe(true)
    await localizer.settle(1_000)
    expect(batches).toHaveLength(2)
    expect(localizer.localize(unit('a/c', 'Write files'), 'zh')).toEqual({ text: 'ZH:Write files', pending: false })
    localizer.dispose()
  })

  it('does not strand queued work when it is disposed before the window closes', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    for (let index = 0; index < 5; index += 1) {
      expect(localizer.localize(unit('suite/' + String(index), 'Text number ' + String(index)), 'zh').pending).toBe(true)
    }
    // Nothing has run yet: the coalescing window is still open.
    expect(batches).toEqual([])

    localizer.dispose()
    // A disposed instance cannot deliver its queue, so the queue must not keep
    // reporting itself pending: a settle waiting on it would burn its whole
    // deadline and still answer "not drained".
    expect(localizer.pendingCount).toBe(0)
    expect(await localizer.settle(300)).toBe(true)
    // And the cancelled window never fires a batch behind the teardown.
    await new Promise(resolve => setTimeout(resolve, BATCH_COALESCE_MS * 2))
    expect(batches).toEqual([])
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

  it('keeps a cached entry indefinitely: nothing expires it', async () => {
    const { provider } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    await localizer.flush()
    localizer.dispose()

    // A year later the entry is still served: only an explicit clear removes it.
    clock += 365 * 24 * 60 * 60 * 1000
    const later = build([provider])
    await later.load()
    expect(later.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    later.dispose()
  })

  it('clear empties memory and disk, so the next read translates again', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    await localizer.flush()
    expect(batches).toHaveLength(1)

    await localizer.clear()
    // The in-memory copy must go too, or this instance keeps serving text the
    // file no longer holds.
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh').pending).toBe(true)
    await localizer.settle(1_000)
    expect(batches).toHaveLength(2)

    // And a fresh instance over the same root starts from nothing.
    const reopened = build([provider])
    await reopened.load()
    expect(reopened.localize(unit('a/b', 'Other text'), 'zh').pending).toBe(true)
    localizer.dispose()
    reopened.dispose()
  })

  it('targets the language the market renders, whatever the preference tag says', async () => {
    const { provider, targets } = targetRecorder()
    const localizer = build([provider])
    await localizer.load()
    // A `ja` interface renders the market's Chinese dictionary, so the target
    // is Chinese — not Japanese, which would leave the translated text in a
    // language nothing else on the page is written in.
    expect(localizer.localize(unit('a/b', 'Read files'), 'ja').pending).toBe(true)
    await localizer.settle(1_000)
    expect(targets).toEqual(['zh'])
    // The same entry answers a `zh` or `zh-Hant` reader: the key carries the
    // target, so two preferences that render the same dictionary pay once.
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    expect(localizer.localize(unit('a/b', 'Read files'), 'zh-Hant')).toEqual({ text: 'ZH:Read files', pending: false })
    // An English interface has nothing to translate, exactly as the surfaces'
    // own gate says.
    expect(localizer.localize(unit('a/c', 'Write files'), 'en-US')).toEqual({ text: 'Write files', pending: false })
    await localizer.settle(200)
    expect(targets).toEqual(['zh'])
    localizer.dispose()
  })

  it('clears the provider circuit breaker when the cache is cleared', async () => {
    const failing: TranslationProvider = {
      id: 'microsoft',
      available: () => true,
      translate: async () => {
        throw new Error('offline')
      }
    }
    const localizer = build([failing])
    await localizer.load()
    localizer.localize(unit('a/b', 'Read files'), 'zh')
    await localizer.settle(1_000)
    // One failure retires the provider process-wide: every later batch skips it.
    expect(isTripped('microsoft')).toBe(true)

    // Clearing is the user asking for it again, so the retired provider is part
    // of what is being reset. Without this, one cut-off generation left the
    // chain short a provider until the process restarted, every read reported
    // nothing pending, and no control on screen could bring it back.
    await localizer.clear()
    expect(isTripped('microsoft')).toBe(false)

    const { provider, batches } = recorder()
    const second = build([provider])
    await second.load()
    second.localize(unit('a/b', 'Read files'), 'zh')
    await second.settle(1_000)
    expect(batches).toHaveLength(1)
    localizer.dispose()
    second.dispose()
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

/**
 * One source text has one translation. The cache key names the entity, which is
 * what makes the file the record of what was translated for whom; the provider
 * work is keyed by the text itself, so the second entity carrying a text is
 * answered from the first entity's result instead of paying again.
 */
describe('shared source text', () => {
  const suite: TranslationUnit = { surface: 'market', id: 'source/suite', text: 'Read files' }
  const skill: TranslationUnit = { surface: 'skills', id: 'source/suite/read', text: 'Read files' }

  it('serves two entities of different surfaces from a single provider call', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    expect(localizer.localize(suite, 'zh').pending).toBe(true)
    expect(localizer.localize(skill, 'zh').pending).toBe(true)
    // One text, one queued job: the alias waits for the answer already coming.
    expect(localizer.pendingCount).toBe(1)
    await localizer.settle(1_000)
    expect(batches).toEqual([['Read files']])
    expect(localizer.localize(suite, 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    expect(localizer.localize(skill, 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    localizer.dispose()
  })

  it("records the shared answer under each entity's own key", async () => {
    const { provider, batches } = recorder()
    const first = build([provider])
    await first.load()
    first.localize(suite, 'zh')
    await first.settle(1_000)
    // The alias resolves from the shared answer and gets its own entry, so the
    // cache still records what was translated for whom.
    expect(first.localize(skill, 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    await first.flush()
    first.dispose()
    expect(batches).toHaveLength(1)

    const second = build([provider])
    await second.load()
    expect(second.localize(suite, 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    expect(second.localize(skill, 'zh')).toEqual({ text: 'ZH:Read files', pending: false })
    // Both fields came off disk: the shared call was not paid for a second time.
    expect(batches).toHaveLength(1)
    second.dispose()
  })

  it('queues nothing for a text already in flight for another entity', async () => {
    vi.useFakeTimers()
    try {
      const { provider, batches } = recorder()
      const localizer = build([provider])
      await localizer.load()
      expect(localizer.localize(suite, 'zh').pending).toBe(true)
      expect(localizer.localize(skill, 'zh').pending).toBe(true)
      expect(localizer.pendingCount).toBe(1)
      await vi.advanceTimersByTimeAsync(BATCH_COALESCE_MS)
      expect(batches).toEqual([['Read files']])
      localizer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never answers an English read from the Chinese translation', async () => {
    const { provider, batches } = recorder()
    const localizer = build([provider])
    await localizer.load()
    localizer.localize(suite, 'zh')
    await localizer.settle(1_000)
    // The English panel renders the authored text and queues nothing; the zh
    // answer must not be handed to it as if it were its own.
    expect(localizer.localize(skill, 'en-US')).toEqual({ text: 'Read files', pending: false })
    await localizer.settle(200)
    expect(batches).toHaveLength(1)
    localizer.dispose()
  })

  it('never reuses an answer across provider chains', async () => {
    const { provider, batches } = recorder()
    let identity = 'chain-a'
    const localizer = new TranslationLocalizer({ dataRoot, providers: [provider], providerIdentity: () => identity, now: () => clock })
    await localizer.load()
    localizer.localize(suite, 'zh')
    await localizer.settle(1_000)
    identity = 'chain-b'
    // A new engine must miss what the old chain produced, exactly as the
    // per-entity key already makes it miss.
    expect(localizer.localize(skill, 'zh').pending).toBe(true)
    await localizer.settle(1_000)
    expect(batches).toHaveLength(2)
    localizer.dispose()
  })

  it('records no answer for either entity when the provider fails', async () => {
    let calls = 0
    const failing: TranslationProvider = {
      id: 'microsoft',
      available: () => true,
      translate: async () => {
        calls += 1
        throw new Error('offline')
      }
    }
    const localizer = build([failing])
    await localizer.load()
    expect(localizer.localize(suite, 'zh').pending).toBe(true)
    expect(localizer.localize(skill, 'zh').pending).toBe(true)
    await localizer.settle(1_000)
    // One attempt for the text, not one per entity: the alias reads the same
    // failure out of the same backoff.
    expect(calls).toBe(1)
    expect(localizer.localize(suite, 'zh')).toEqual({ text: 'Read files', pending: false })
    expect(localizer.localize(skill, 'zh')).toEqual({ text: 'Read files', pending: false })
    await localizer.settle(200)
    expect(calls).toBe(1)
    await localizer.flush()
    // A failure is not a result: nothing was recorded, so a fresh instance over
    // the same root still queues the text.
    const reloaded = build([recorder().provider])
    await reloaded.load()
    expect(reloaded.localize(suite, 'zh').pending).toBe(true)
    localizer.dispose()
    reloaded.dispose()
  })
})
