/**
 * The localizer's disposal is the cache write it starts.
 *
 * `dispose` cancels its timers synchronously and then persists the entries a
 * completed provider call recorded. That write is `translation-cache.json`
 * under the plugin data root, so an owner that reports teardown complete
 * before it lands leaves a file appearing under a tree the owner's caller may
 * already be removing: the same race Windows reports as `ENOTEMPTY`.
 *
 * These cases gate the write itself, so the only thing under test is whether
 * `dispose` settles with it. A disposer that starts the write and returns is
 * complete the moment it returns, whatever the disk is doing.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_COALESCE_MS, TranslationLocalizer } from '../../../packages/market-translation/src/application/translation/localizer.js'
import type { TranslationProvider } from '../../../packages/market-translation/src/application/translation/chain.js'

/**
 * The gate the mocked save waits behind. `vi.mock` factories are hoisted above
 * the imports, so the mutable handles have to be hoisted with them.
 */
const gate = vi.hoisted(() => ({
  announce: undefined as (() => void) | undefined,
  release: undefined as (() => void) | undefined
}))

vi.mock('../../../packages/market-translation/src/application/state/translation-cache.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../packages/market-translation/src/application/state/translation-cache.js')>()
  return {
    ...actual,
    saveTranslationCache: async (dataRoot: string, entries: Parameters<typeof actual.saveTranslationCache>[1]) => {
      // Report the write, then stay open until the case lets it through. Any
      // assertion about the caller having settled is decided here, not by a
      // disk that happens to be fast.
      await new Promise<void>(resolve => {
        gate.release = resolve
        gate.announce?.()
      })
      await actual.saveTranslationCache(dataRoot, entries)
    }
  }
})

let dataRoot: string

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'translation-dispose-'))
  gate.announce = undefined
  gate.release = undefined
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

/** A provider that answers every text immediately. */
function provider(): TranslationProvider {
  return {
    id: 'microsoft',
    available: () => true,
    translate: async ({ texts }) => texts.map(text => 'ZH:' + text)
  }
}

/**
 * Build a localizer holding one recorded translation and exactly one pending
 * cache write: the batch has run, and the flush timer it armed has not.
 */
async function dirtyLocalizer(): Promise<TranslationLocalizer> {
  const localizer = new TranslationLocalizer({
    dataRoot,
    providers: [provider()],
    providerIdentity: () => 'test-chain',
    now: () => 1_000_000
  })
  await localizer.load()
  localizer.localize({ surface: 'market', id: 'a/b', text: 'Read files' }, 'zh')
  // Let the coalescing window close so the batch answers and marks the cache
  // dirty. The flush timer is 1500ms, so it is still armed after this.
  await vi.advanceTimersByTimeAsync(BATCH_COALESCE_MS)
  return localizer
}

describe('TranslationLocalizer disposal', () => {
  it('settles only after the cache write it started landed', async () => {
    vi.useFakeTimers()
    const localizer = await dirtyLocalizer()

    let writeStarted!: () => void
    const started = new Promise<void>(resolve => {
      writeStarted = resolve
    })
    gate.announce = () => writeStarted()

    // `Promise.resolve` keeps this meaningful for a disposer that returns
    // nothing: that shape is complete the instant it returns.
    const disposing = Promise.resolve(localizer.dispose())
    let settled = false
    void disposing.then(() => {
      settled = true
    })
    await started
    // Plenty of turns for a disposer that only started the write to report
    // itself finished.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settled).toBe(false)

    gate.release?.()
    await disposing
    expect(settled).toBe(true)

    const written = JSON.parse(await readFile(join(dataRoot, 'translation-cache.json'), 'utf8')) as {
      entries: Record<string, { text: string }>
    }
    expect(Object.values(written.entries).map(entry => entry.text)).toContain('ZH:Read files')
  })

  it('writes nothing when no call completed before disposal', async () => {
    vi.useFakeTimers()
    gate.announce = () => {
      throw new Error('disposal wrote an unchanged cache')
    }
    const localizer = new TranslationLocalizer({
      dataRoot,
      providers: [provider()],
      providerIdentity: () => 'test-chain',
      now: () => 1_000_000
    })
    await localizer.load()

    await localizer.dispose()
    await expect(readFile(join(dataRoot, 'translation-cache.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
