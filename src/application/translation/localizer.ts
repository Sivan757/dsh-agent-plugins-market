/**
 * Localize translatable fields without ever blocking the read path.
 *
 * The market reads an upstream catalog whose prose is English. A zh deployment
 * wants Chinese, so every unit with no cached translation is queued for the
 * provider chain and the caller keeps rendering the original until the
 * translation lands.
 *
 * Three properties matter more than throughput:
 *
 * - **The read never waits.** {@link TranslationLocalizer.localize} is
 *   synchronous and answers from the in-memory cache. A miss returns the
 *   original text plus a pending flag; the work happens off the read path.
 * - **A failure is invisible.** An unavailable, throttled, or broken provider
 *   degrades to the original text. Nothing here throws into the caller.
 * - **Each text is paid for once.** The cache survives restarts, the queue
 *   de-duplicates by key, and a key that keeps failing backs off instead of
 *   retrying in a loop.
 * @module application/translation/localizer
 */
import type { TranslationUnit } from './unit.js'
import { runChain, type TranslationProvider } from './chain.js'
import { clearTranslationCache, loadTranslationCache, saveTranslationCache, translationKey, type TranslationRecord } from '../state/translation-cache.js'

/** The localization answer for one field. */
export interface LocalizedText {
  /** The text to render now: the translation when cached, else the original. */
  text: string
  /** True when a translation is queued or in flight and the text may improve. */
  pending: boolean
}

/** One queued unit of work. */
interface TranslationJob {
  key: string
  unit: TranslationUnit
  locale: string
}

export interface LocalizerOptions {
  /** The plugin's own storage root; the cache file lives directly inside it. */
  dataRoot: string
  /** The ordered provider chain; empty means translation is a no-op. */
  providers: readonly TranslationProvider[]
  /**
   * Stable identity of the current chain, folded into every cache key.
   *
   * Read per call, never cached: a deployment that switches providers must
   * miss the cache it filled under the old one rather than serve the old
   * engine's output as if it were the new engine's.
   */
  providerIdentity: () => string
  /** Clock seam; tests drive backoff and TTL through it. */
  now?: (() => number) | undefined
}

/** In-flight batches, not in-flight texts: one batch is one provider call. */
const MAX_CONCURRENT_BATCHES = 3

/** Texts per provider call. Bounds both payload size and the blast radius of one failure. */
export const MAX_BATCH_SIZE = 20

/** Retry delays per attempt; a key that exhausts them stops retrying. */
const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000] as const

/** Successful translations are batched into one write at this interval. */
const FLUSH_MS = 1_500

/**
 * True when a text is worth sending to a provider.
 *
 * Anything carrying a CJK ideograph is already Chinese or already bilingual —
 * the client picks the Chinese half of a bilingual pair without a provider
 * call — so only prose with no Chinese in it needs translating.
 * @param text - the upstream text.
 * @returns whether the chain should be asked to translate it.
 */
export function needsTranslation(text: string | undefined): text is string {
  if (text === undefined) return false
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  return !/\p{Script=Han}/u.test(trimmed)
}

/**
 * Owns the translation cache, the de-duplicating queue, and the retry policy.
 *
 * One instance per plugin activation; {@link load} must run before the first
 * {@link localize} so cached translations are available synchronously.
 */
export class TranslationLocalizer {
  private readonly dataRoot: string
  private readonly providers: readonly TranslationProvider[]
  private readonly providerIdentity: () => string
  private readonly now: () => number
  private entries: Record<string, TranslationRecord> = {}
  private readonly pending = new Map<string, TranslationJob>()
  /** Keys already running, so a second request for one key does not queue twice. */
  private readonly inflight = new Set<string>()
  /** Per-key attempt count and the earliest retry time. */
  private readonly retry = new Map<string, { attempts: number; notBefore: number }>()
  private active = 0
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(options: LocalizerOptions) {
    this.dataRoot = options.dataRoot
    this.providers = options.providers
    this.providerIdentity = options.providerIdentity
    this.now = options.now ?? Date.now
  }

  /**
   * Read the persisted cache once. A missing or unreadable file is not an
   * error: the market simply starts with nothing translated.
   */
  async load(): Promise<void> {
    this.entries = await loadTranslationCache(this.dataRoot)
  }

  /**
   * Drop every cached translation, in memory and on disk.
   *
   * The caller re-reads afterwards: the panel translates lazily, so the next
   * read is what repopulates the cache.
   * @returns fulfillment once the file is gone and memory is empty.
   */
  async clear(): Promise<void> {
    this.entries = {}
    this.retry.clear()
    this.dirty = false
    await clearTranslationCache(this.dataRoot)
  }

  /** Number of texts waiting for a provider call; drives the client's re-read. */
  get pendingCount(): number {
    return this.pending.size + this.inflight.size
  }

  /**
   * Resolve one field for the active locale.
   *
   * Never awaits and never throws. A cached translation wins; otherwise the
   * original text is returned and the unit is queued when the chain has an
   * available provider and the text actually needs translating.
   * @param unit - the surface, entity id, role, and upstream text.
   * @param locale - the locale the panel is rendering in.
   * @returns the text to render now and whether it may still improve.
   */
  localize(unit: TranslationUnit, locale: string): LocalizedText {
    const text = unit.text
    if (text.trim().length === 0) return { text, pending: false }
    if (!this.providers.some(provider => provider.available())) return { text, pending: false }
    const key = translationKey(unit, locale, this.providerIdentity())
    const cached = this.entries[key]
    if (cached !== undefined) return { text: cached.text, pending: false }
    if (!needsTranslation(text)) return { text, pending: false }
    return { text, pending: this.enqueue({ key, unit, locale }) }
  }

  /**
   * Queue one job unless it is already queued, running, or backing off.
   *
   * The return value is what the caller reports as pending, so a key that is
   * waiting out a backoff — or that has exhausted its attempts — answers
   * "nothing more is coming" and the panel stops re-reading. Reporting pending
   * for work that will never start would poll the overview forever.
   * @param job - the unit to translate and the key it will be cached under.
   * @returns whether this key now has work queued or running.
   */
  private enqueue(job: TranslationJob): boolean {
    if (this.disposed) return false
    if (this.pending.has(job.key) || this.inflight.has(job.key)) return true
    const backoff = this.retry.get(job.key)
    if (backoff !== undefined) {
      if (backoff.attempts >= BACKOFF_MS.length) return false
      if (backoff.notBefore > this.now()) return false
    }
    this.pending.set(job.key, job)
    this.pump()
    return true
  }

  /** Start as many queued batches as the concurrency cap allows. */
  private pump(): void {
    while (!this.disposed && this.active < MAX_CONCURRENT_BATCHES && this.pending.size > 0) {
      const batch: TranslationJob[] = []
      for (const key of this.pending.keys()) {
        if (batch.length >= MAX_BATCH_SIZE) break
        const job = this.pending.get(key)
        if (job === undefined) continue
        this.pending.delete(key)
        this.inflight.add(key)
        batch.push(job)
      }
      if (batch.length === 0) return
      this.active += 1
      void this.run(batch)
    }
  }

  /**
   * Run one batch. A batch-level failure backs off every member; a single empty
   * result backs off only its own key, so one bad text cannot stall nineteen
   * good ones. Every failure path is silent for the caller: the panel keeps the
   * original text either way.
   */
  private async run(batch: readonly TranslationJob[]): Promise<void> {
    const controller = new AbortController()
    try {
      const locale = batch[0]?.locale ?? ''
      const result = await runChain(
        this.providers,
        batch.map(job => job.unit.text),
        locale,
        controller.signal
      )
      const at = this.now()
      batch.forEach((job, index) => {
        const text = (result.texts[index] ?? '').trim()
        if (text.length === 0) {
          this.fail(job.key)
          return
        }
        this.entries[job.key] = { text, provider: result.provider, at }
        this.retry.delete(job.key)
        this.dirty = true
      })
      if (this.dirty) this.scheduleFlush()
    } catch {
      for (const job of batch) this.fail(job.key)
    } finally {
      for (const job of batch) this.inflight.delete(job.key)
      this.active -= 1
      this.pump()
    }
  }

  /** Record one failed attempt and push the key's next try further out. */
  private fail(key: string): void {
    const attempts = (this.retry.get(key)?.attempts ?? 0) + 1
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 0
    this.retry.set(key, { attempts, notBefore: this.now() + delay })
  }

  /**
   * Batch successful translations into one write instead of one per text.
   *
   * A translation that lands after {@link dispose} has no timer to ride and no
   * later read to pick it up, so it is written immediately: otherwise the call
   * is paid for and the result is dropped on unload.
   */
  private scheduleFlush(): void {
    if (this.disposed) {
      void this.flush()
      return
    }
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, FLUSH_MS)
    // A pending flush must not hold the host process open.
    this.flushTimer.unref?.()
  }

  /** Persist the cache when it changed. A failed write keeps the in-memory copy. */
  async flush(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    try {
      await saveTranslationCache(this.dataRoot, this.entries)
    } catch {
      // The cache is an optimization: losing a write costs one more call.
      this.dirty = true
    }
  }

  /**
   * Wait until the queue drains or the deadline passes.
   *
   * Warm-up uses this so a scan can hand off and a test can assert the result
   * without polling; production never blocks a request on it.
   * @param deadlineMs - maximum wait; omitted waits for the queue alone.
   * @returns whether the queue drained before the deadline.
   */
  async settle(deadlineMs?: number): Promise<boolean> {
    const started = this.now()
    while (this.pendingCount > 0) {
      if (deadlineMs !== undefined && this.now() - started >= deadlineMs) return false
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await this.flush()
    return true
  }

  /** Cancel timers; in-flight calls finish and are persisted by {@link flush}. */
  dispose(): void {
    this.disposed = true
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    void this.flush()
  }
}
