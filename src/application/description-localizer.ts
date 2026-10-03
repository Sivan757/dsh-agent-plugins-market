/**
 * Localize suite descriptions without ever blocking the panel.
 *
 * The market reads an upstream catalog whose prose is English. A zh deployment
 * wants Chinese, so every description that has no cached translation is queued
 * for the host LLM and the caller keeps rendering the original until the
 * translation lands.
 *
 * Three properties matter more than throughput:
 *
 * - **The panel never waits.** {@link DescriptionLocalizer.localize} is
 *   synchronous and answers from the in-memory cache. A miss returns the
 *   original text plus a `pending` flag; the work happens off the read path.
 * - **A failure is invisible.** An unavailable, throttled, or broken model
 *   degrades to the original text. Nothing here throws into `overview()`.
 * - **Each description is paid for once.** The cache survives restarts, the
 *   queue de-duplicates concurrent requests for the same key, and a key that
 *   keeps failing backs off instead of retrying in a loop.
 */
import type { DescriptionTranslationRecord } from './state/description-translations.js'
import { descriptionTranslationKey, loadDescriptionTranslations, saveDescriptionTranslations } from './state/description-translations.js'

/** One translation request handed to the model seam. */
export interface DescriptionTranslationRequest {
  /** The source text to translate. */
  text: string
  /** Target locale id, for the system instruction. */
  locale: string
  signal: AbortSignal
}

/**
 * The model seam this localizer calls. Implemented in `src/runtime/host/`
 * over `ctx.llm.stream`; absent when the host LLM service is not mounted.
 */
export interface DescriptionTranslator {
  /**
   * Whether a model route is resolvable right now.
   *
   * Read per call, never cached: the LLM and default-model services provision
   * after plugin `apply()` returns, so an answer captured at composition time
   * would report "unavailable" for the life of the process.
   */
  available(): boolean
  translate(request: DescriptionTranslationRequest): Promise<string>
}

/** The localization answer for one description. */
export interface LocalizedDescription {
  /** The text to render now: the translation when cached, else the original. */
  text: string | undefined
  /** True when a translation is queued or in flight and the text may improve. */
  pending: boolean
}

/** One queued unit of work. */
interface TranslationJob {
  key: string
  text: string
  locale: string
}

export interface DescriptionLocalizerOptions {
  /** The plugin's own storage root; the cache file lives directly inside it. */
  dataRoot: string
  /** Absent when the host LLM service is not mounted; translation is then a no-op. */
  translator?: DescriptionTranslator | undefined
  /** Successful translations to persist before flushing, and the flush interval. */
  now?: (() => number) | undefined
}

/**
 * One global in-flight cap.
 *
 * The card asked for at most three concurrent calls per source; one global cap
 * of three is strictly stronger, and it also bounds how many model calls a
 * panel open can start at once regardless of how many sources are configured.
 */
const MAX_CONCURRENT = 3

/** Retry delays per attempt; a key that exhausts them stops retrying. */
const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000] as const

/** Successful translations are batched into one write at this interval. */
const FLUSH_MS = 1_500

/**
 * True when a description is worth sending to the model.
 *
 * Anything carrying a CJK ideograph is already Chinese or already bilingual —
 * the client picks the Chinese half of a `中文 · English` pair without a model
 * call — so only prose with no Chinese in it needs translating.
 * @param description - the upstream description.
 * @returns whether the model should be asked to translate it.
 */
export function needsTranslation(description: string | undefined): description is string {
  if (description === undefined) return false
  const text = description.trim()
  if (text.length === 0) return false
  return !/\p{Script=Han}/u.test(text)
}

/**
 * Owns the description cache, the de-duplicating queue, and the retry policy.
 *
 * One instance per plugin activation; {@link load} must run before the first
 * {@link localize} so cached translations are available synchronously.
 */
export class DescriptionLocalizer {
  private readonly dataRoot: string
  private readonly translator: DescriptionTranslator | undefined
  private readonly now: () => number
  private entries: Record<string, DescriptionTranslationRecord> = {}
  private readonly pending = new Map<string, TranslationJob>()
  /** Keys already running, so a second request for one key does not queue twice. */
  private readonly inflight = new Set<string>()
  /** Per-key attempt count and the earliest retry time. */
  private readonly retry = new Map<string, { attempts: number; notBefore: number }>()
  private active = 0
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(options: DescriptionLocalizerOptions) {
    this.dataRoot = options.dataRoot
    this.translator = options.translator
    this.now = options.now ?? Date.now
  }

  /**
   * Read the persisted cache once. A missing or unreadable file is not an
   * error: the market simply starts with nothing translated.
   */
  async load(): Promise<void> {
    this.entries = await loadDescriptionTranslations(this.dataRoot)
  }

  /** Number of descriptions waiting for a model call; drives the client's re-read. */
  get pendingCount(): number {
    return this.pending.size + this.inflight.size
  }

  /**
   * Resolve one description for the active locale.
   *
   * Never awaits and never throws. A cached translation wins; otherwise the
   * original text is returned and the description is queued when the model
   * seam is available and the text actually needs translating.
   * @param sourceId - the owning source id, part of the cache key.
   * @param suiteId - the suite id inside that source, part of the cache key.
   * @param description - the upstream description.
   * @param locale - the locale the panel is rendering in.
   * @returns the text to render now and whether it may still improve.
   */
  localize(sourceId: string, suiteId: string, description: string | undefined, locale: string): LocalizedDescription {
    if (description === undefined) return { text: undefined, pending: false }
    if (this.translator === undefined || !this.translator.available()) return { text: description, pending: false }
    const key = descriptionTranslationKey(sourceId, suiteId, description, locale)
    const cached = this.entries[key]
    if (cached !== undefined) return { text: cached.text, pending: false }
    if (!needsTranslation(description)) return { text: description, pending: false }
    return { text: description, pending: this.enqueue({ key, text: description, locale }) }
  }

  /**
   * Queue one job unless it is already queued, running, or backing off.
   *
   * The return value is what the caller reports as pending, so a key that is
   * waiting out a backoff — or that has exhausted its attempts — answers
   * "nothing more is coming" and the panel stops re-reading. Reporting pending
   * for work that will never start would poll the overview forever.
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

  /** Start as many queued jobs as the concurrency cap allows. */
  private pump(): void {
    while (!this.disposed && this.active < MAX_CONCURRENT && this.pending.size > 0) {
      const first = this.pending.keys().next()
      if (first.done === true) return
      const job = this.pending.get(first.value)
      this.pending.delete(first.value)
      if (job === undefined) continue
      this.inflight.add(job.key)
      this.active += 1
      void this.run(job)
    }
  }

  /**
   * Run one translation. Every failure path is terminal for this attempt and
   * silent for the caller: the panel keeps the original text either way.
   */
  private async run(job: TranslationJob): Promise<void> {
    const controller = new AbortController()
    try {
      const translated = await this.translator!.translate({ text: job.text, locale: job.locale, signal: controller.signal })
      const text = translated.trim()
      if (text.length === 0) throw new Error('the model returned no text')
      this.entries[job.key] = { text, at: this.now() }
      this.retry.delete(job.key)
      this.dirty = true
      this.scheduleFlush()
    } catch {
      const attempts = (this.retry.get(job.key)?.attempts ?? 0) + 1
      const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 0
      this.retry.set(job.key, { attempts, notBefore: this.now() + delay })
    } finally {
      this.inflight.delete(job.key)
      this.active -= 1
      this.pump()
    }
  }

  /** Batch successful translations into one write instead of one per suite. */
  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.disposed) return
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
      await saveDescriptionTranslations(this.dataRoot, this.entries)
    } catch {
      // The cache is an optimization: losing a write costs one more model call.
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
