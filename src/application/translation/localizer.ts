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
 * - **Each text is paid for once.** The cache survives restarts, and the queue
 *   is indexed by the source text: the cache key names the entity, but two
 *   entities carrying one text share one provider call and each keeps its own
 *   entry. A text that keeps failing backs off instead of retrying in a loop.
 * @module application/translation/localizer
 */
import type { TranslationUnit } from './unit.js'
import { resetCircuitBreaker, runChain, type TranslationProvider } from './chain.js'
import { resolveTranslationTarget } from '../../contracts/settings.js'
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
  /** The resolved target language tag; every job in one batch shares it. */
  target: string
  /** Identity of the source text under this target and chain; see {@link textIdentity}. */
  textId: string
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
  /**
   * Whether translation is switched on, read per call rather than captured.
   *
   * The settings switch can flip long after construction, so a chain built once
   * must still stop and start with it. Absent means always on, which keeps the
   * localizer usable on its own in a test.
   */
  enabled?: (() => boolean) | undefined
  /** Clock seam; tests drive backoff and TTL through it. */
  now?: (() => number) | undefined
}

/** In-flight batches, not in-flight texts: one batch is one provider call. */
const MAX_CONCURRENT_BATCHES = 3

/** One Han ideograph; the script the market renders its own copy in. */
const HAN = /\p{Script=Han}/gu

/** One Latin letter; the script upstream catalogs are authored in. */
const LATIN = /\p{Script=Latin}/gu

/** How many characters of one script a text carries. */
function scriptCount(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

/** Texts per provider call. Bounds both payload size and the blast radius of one failure. */
export const MAX_BATCH_SIZE = 20

/**
 * Source characters per provider call.
 *
 * The model hop sizes one call's output from the source that call carries (see
 * `runtime/host/llm-translator.ts`), so this is the input half of the same
 * number: 6,400 source characters is what one call's response is sized for, and
 * {@link MAX_DOCUMENT_CHUNK_CHARS} bounds each text inside it first. A
 * count-only cap let a batch of document chunks ask for several times the output
 * the call is allowed to produce, and a generation cut off at that ceiling fails
 * the whole batch *and* retires the model hop for the rest of the session
 * (`chain.ts` trips a provider on any failure).
 *
 * The expansion this covers is measured over this repository's own bilingual
 * documents — 0.461 of the English character count at the median, 0.617 at the
 * worst, over 90 pairs. What that costs in *tokens* is an estimate rather than a
 * measurement, because nothing in this tree tokenizes; the arithmetic lives with
 * the translator's own constant.
 *
 * The binding constraint is the model hop's own output budget, not a vendor
 * request limit. The two public endpoints this chain calls are the consumer
 * endpoints the vendors' own translation widgets call, not the Cloud APIs whose
 * documented per-request limits are quoted for these products, so no
 * request-size number is claimed here. Moving a hop onto an officially
 * documented API would have to re-derive this constant against that API's own
 * limit.
 *
 * Description traffic reaches this budget only for a long field: a description
 * longer than one chunk travels in chunks like a document body, and everything
 * shorter batches by count.
 */
export const MAX_BATCH_CHARS = 6_400

/**
 * English output can expand Chinese source; reserve a smaller raw-source batch
 * for the model adapter's estimated 1.5 tokens per source character. Separators
 * and masking can expand the payload further, so this is not a truncation guarantee.
 */
export const MAX_EN_BATCH_CHARS = 2_400

function batchCharLimit(target: string): number {
  return target === 'en' ? MAX_EN_BATCH_CHARS : MAX_BATCH_CHARS
}

/**
 * How long an enqueue waits for company before its batch starts.
 *
 * Callers enqueue as they discover text: the panel learns one description per
 * file it reads, so a synchronous pump sent one text per provider call. A
 * short deferral lets a burst land in one batch, and a lone unit waits at most
 * this long — invisible beside a provider round trip. A batch that is already
 * full never waits: {@link TranslationLocalizer.schedulePump} cancels the
 * window and starts it immediately, so a burst's throughput is unchanged and
 * only its grouping is.
 */
export const BATCH_COALESCE_MS = 25

/** Retry delays per attempt; a key that exhausts them stops retrying. */
const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000] as const

/** Successful translations are batched into one write at this interval. */
const FLUSH_MS = 1_500

/**
 * Whether prose contains text to translate into the resolved interface language.
 * Chinese targets retain the Latin-versus-Han heuristic; English targets accept
 * any Han text, including Chinese embedded in predominantly English prose.
 * @param text - upstream prose; blank and absent values never queue work.
 * @param target - resolved target language, defaulting to Chinese for existing callers.
 */
export function needsTranslation(text: string | undefined, target = 'zh'): text is string {
  if (text === undefined) return false
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  const han = scriptCount(trimmed, HAN)
  if (target === 'en') return han > 0
  return scriptCount(trimmed, LATIN) >= han
}

/**
 * Owns the translation cache, the text-indexed queue, and the retry policy.
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
  /**
   * Translations indexed by source text rather than by entity.
   *
   * The cache key names the entity, which is what makes the file the record of
   * what was translated for whom — and it is also what made one text two
   * provider calls when two entities carried it. This index is the other half:
   * a text already answered for one entity answers for every other, and the
   * answer is written under the second entity's own key so its durable record
   * is complete as well.
   *
   * Derived state, never loaded from disk: entries are keyed by entity and
   * carry no text, so the index warms as reads hit those entries and as batches
   * land. Every entity read in one session is therefore served from the first
   * read of its text, and the next session serves each entity from its own
   * entry.
   */
  private readonly byText = new Map<string, TranslationRecord>()
  /** The text each queued or running job owns, so a second entity carrying it waits for that answer. */
  private readonly owners = new Map<string, string>()
  private readonly pending = new Map<string, TranslationJob>()
  /** Keys already running, so a second request for one key does not queue twice. */
  private readonly inflight = new Set<string>()
  /**
   * Per-text attempt count and the earliest retry time.
   *
   * Keyed by text rather than by entity key: a text the provider cannot answer
   * fails the same way wherever it is rendered, so one attempt budget belongs
   * to it. Keyed per entity, a broken chain would burn that budget once per
   * field — the spend this index exists to bound.
   */
  private readonly retry = new Map<string, { attempts: number; notBefore: number }>()
  private active = 0
  /** Invalidated work cannot mutate a later queue or cache. */
  private generation = 0
  private readonly controllers = new Set<AbortController>()
  private lastEnabled: boolean | undefined
  /** Serializes cache writes and deletion, including a write already in flight. */
  private persistence: Promise<void> = Promise.resolve()
  /** The armed coalescing window, or undefined when no pump is scheduled. */
  private pumpTimer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  /** Consulted per call: the settings switch may flip long after construction. */
  private readonly enabled: () => boolean

  constructor(options: LocalizerOptions) {
    this.dataRoot = options.dataRoot
    this.providers = options.providers
    this.providerIdentity = options.providerIdentity
    this.enabled = options.enabled ?? (() => true)
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
   *
   * A provider the chain retired after an earlier failure goes with it. Clearing
   * is an explicit "translate this again", and without this half a single
   * cut-off generation — or one endpoint that was down for a minute — leaves
   * the model hop out of the chain for the rest of the process: every later
   * batch skips it, every read reports nothing pending, and no control on screen
   * can bring it back. The cost bound the chain exists for is one attempt per
   * user request, not one for the process's lifetime.
   * Invalidates queued and running work. Calls made after the reset starts may
   * enqueue new work; their writes follow the deletion.
   * @returns fulfillment after prior cache writes and the deletion finish.
   */
  async clear(): Promise<void> {
    this.cancelWork()
    this.entries = {}
    this.byText.clear()
    this.retry.clear()
    this.dirty = false
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    resetCircuitBreaker()
    this.persistence = this.persistence.then(() => clearTranslationCache(this.dataRoot))
    await this.persistence
  }

  /**
   * Forget why translation failed, keeping every translation already made.
   *
   * This is the settings switch's own "try again", and it is not the same as
   * {@link clear}: clearing re-pays for the whole cache, while switching back on
   * only asks for the failures to be forgotten. Both halves of a failure record
   * go together — the per-text attempt budget, or a text that spent its four
   * attempts never queues again, and the chain's process-wide breaker, or a
   * retired provider is skipped for the rest of the process. Resetting one
   * without the other is why switching off and on used to recover nothing that
   * clearing the cache did not.
   */
  resetFailures(): void {
    this.retry.clear()
    resetCircuitBreaker()
  }

  /**
   * Apply a live settings change. Off cancels unfinished work without deleting
   * cached answers; on resets failures and waits for the next read to enqueue.
   * Call from the settings subscription so cancellation needs no panel read.
   */
  onEnabledChanged(): void {
    this.syncEnabled()
  }

  private syncEnabled(): boolean {
    const enabled = this.enabled()
    if (enabled !== this.lastEnabled) {
      const previous = this.lastEnabled
      this.lastEnabled = enabled
      if (!enabled) this.cancelWork()
      else if (previous === false) this.resetFailures()
    }
    return enabled
  }

  private cancelWork(): void {
    this.generation += 1
    if (this.pumpTimer !== undefined) {
      clearTimeout(this.pumpTimer)
      this.pumpTimer = undefined
    }
    this.pending.clear()
    this.inflight.clear()
    this.owners.clear()
    this.active = 0
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
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
   *
   * The preference is resolved to the language the interface actually renders
   * before anything else reads it, and that target — not the preference tag —
   * is what the cache key and the provider call carry. So `ja` and `zh-Hant`
   * read the Chinese dictionary and are served the Chinese entry a `zh` reader
   * already paid for, and an English interface answers the same way here as it
   * does at every surface's own gate.
   * @param unit - the surface, entity id, role, and upstream text.
   * @param locale - the host interface preference the panel renders under.
   * @returns the text to render now and whether it may still improve.
   */
  localize(unit: TranslationUnit, locale: string): LocalizedText {
    const text = unit.text
    if (text.trim().length === 0) return { text, pending: false }
    const target = resolveTranslationTarget(locale)
    // The switch is read live and it gates everything, the cache included: off
    // means every surface renders the authored text, whether or not a
    // translation happens to be sitting in the cache. Leaving cached text on
    // screen while the control reads "off" is a contradiction the user cannot
    // resolve, and the cache survives, so nothing is re-paid on re-enable.
    if (!this.syncEnabled()) return { text, pending: false }
    const identity = this.providerIdentity()
    const key = translationKey(unit, target, identity)
    const textId = this.textIdentity(target, identity, text)
    const cached = this.entries[key]
    if (cached !== undefined) {
      // Reading an entry teaches the index which text it answers, so the next
      // entity carrying that text is served without a provider call.
      this.byText.set(textId, cached)
      return { text: cached.text, pending: false }
    }
    // One source text has one translation, and which entity carried it first
    // says nothing about what it says: an answer another entity already paid
    // for is served here. The entity still gets its own entry, so the cache
    // keeps recording what was translated for whom and the next start serves
    // this field from disk rather than from a fresh call.
    const shared = this.byText.get(textId)
    if (shared !== undefined) {
      this.record(key, shared)
      return { text: shared.text, pending: false }
    }
    // Availability is checked after the cache: a warm cache must still serve
    // when every provider is down, or the panel would fall back to authored text.
    if (!this.providers.some(provider => provider.available())) return { text, pending: false }
    if (!needsTranslation(text, target)) return { text, pending: false }
    return { text, pending: this.enqueue({ key, unit, target, textId }) }
  }

  /**
   * Identity of one source text under a target and a provider chain.
   *
   * The target and the chain are part of it for the reason the cache key
   * carries them: a Chinese answer must never serve an English request, and one
   * engine's output must never be handed over as another's. The role is absent
   * on purpose — a description and a document chunk with the same text are one
   * text to translate, and the translation of a string does not depend on which
   * field it fills.
   * @param target - the resolved target language tag.
   * @param identity - the provider chain's identity for this call.
   * @param text - the source text exactly as authored.
   * @returns the index key shared by every entity carrying this text.
   */
  private textIdentity(target: string, identity: string, text: string): string {
    return [target, identity, text].join('\u0000')
  }

  /** Write one shared answer under one entity's key and mark the cache for a flush. */
  private record(key: string, answer: TranslationRecord): void {
    this.entries[key] = { ...answer }
    this.dirty = true
    this.scheduleFlush()
  }

  /**
   * Queue one job unless its text is already queued, running, or backing off.
   *
   * The return value is what the caller reports as pending, so a text that is
   * waiting out a backoff — or that has exhausted its attempts — answers
   * "nothing more is coming" and the panel stops re-reading. Reporting pending
   * for work that will never start would poll the overview forever. An entity
   * whose text is in flight for another entity reports pending without queueing
   * a call of its own: one call answers both, and the alias is served the
   * moment it lands.
   * @param job - the unit to translate and the key it will be cached under.
   * @returns whether this text now has work queued or running.
   */
  private enqueue(job: TranslationJob): boolean {
    if (this.disposed) return false
    if (this.pending.has(job.key) || this.inflight.has(job.key)) return true
    if (this.owners.has(job.textId)) return true
    const backoff = this.retry.get(job.textId)
    if (backoff !== undefined) {
      if (backoff.attempts >= BACKOFF_MS.length) return false
      if (backoff.notBefore > this.now()) return false
    }
    this.pending.set(job.key, job)
    this.owners.set(job.textId, job.key)
    this.schedulePump()
    return true
  }

  /**
   * Arrange the next pump: now for a full batch, else after the coalescing
   * window so the units a burst is still adding ride the same provider call.
   */
  private schedulePump(): void {
    if (this.disposed || !this.syncEnabled()) return
    // A full batch never waits: an armed window is cancelled rather than sat
    // out, so the unit that completed the batch starts it now. Its members can
    // no longer improve by waiting, and a lone unit still gets the window.
    if (this.hasFullBatch()) {
      this.pump()
      return
    }
    if (this.pumpTimer !== undefined) return
    if (this.pending.size === 0) return
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined
      this.pump()
    }, BATCH_COALESCE_MS)
    // A waiting batch must not hold the host process open.
    this.pumpTimer.unref?.()
  }

  /** Only work with the same target can fill a provider batch. */
  private hasFullBatch(): boolean {
    const totals = new Map<string, { count: number; chars: number }>()
    for (const job of this.pending.values()) {
      const total = totals.get(job.target) ?? { count: 0, chars: 0 }
      total.count += 1
      total.chars += job.unit.text.length
      if (total.count >= MAX_BATCH_SIZE || total.chars >= batchCharLimit(job.target)) return true
      totals.set(job.target, total)
    }
    return false
  }

  /** Start as many queued batches as the concurrency cap allows. */
  private pump(): void {
    if (this.pumpTimer !== undefined) {
      clearTimeout(this.pumpTimer)
      this.pumpTimer = undefined
    }
    while (!this.disposed && this.syncEnabled() && this.active < MAX_CONCURRENT_BATCHES && this.pending.size > 0) {
      const batch: TranslationJob[] = []
      let chars = 0
      for (const key of this.pending.keys()) {
        if (batch.length >= MAX_BATCH_SIZE) break
        const job = this.pending.get(key)
        if (job === undefined) continue
        if (batch.length > 0 && job.target !== batch[0]!.target) continue
        const size = job.unit.text.length
        // A text that would push the call past its budget waits for the next
        // one instead of being dropped: the loop always takes it when it opens
        // a batch, so a chunk longer than the whole budget still runs — alone.
        if (batch.length > 0 && chars + size > batchCharLimit(job.target)) continue
        this.pending.delete(key)
        this.inflight.add(key)
        chars += size
        batch.push(job)
      }
      if (batch.length === 0) return
      this.active += 1
      void this.run(batch)
    }
  }

  /**
   * Run one batch. A batch-level failure backs off every member; a single empty
   * result backs off only that text, so one bad text cannot stall nineteen good
   * ones. Every failure path is silent for the caller: the panel keeps the
   * original text either way.
   */
  private async run(batch: readonly TranslationJob[]): Promise<void> {
    const controller = new AbortController()
    const generation = this.generation
    this.controllers.add(controller)
    try {
      const target = batch[0]?.target ?? ''
      const result = await runChain(
        this.providers,
        batch.map(job => job.unit.text),
        target,
        controller.signal,
        () => this.syncEnabled() && generation === this.generation
      )
      if (generation !== this.generation || controller.signal.aborted) return
      const at = this.now()
      batch.forEach((job, index) => {
        const text = result.texts[index] ?? ''
        if (text.trim().length === 0) {
          this.fail(job.textId)
          return
        }
        const answer: TranslationRecord = { text, provider: result.provider, at }
        this.entries[job.key] = answer
        // The index learns the answer here, which is what lets every other
        // entity carrying this text resolve without a call of its own.
        this.byText.set(job.textId, answer)
        this.retry.delete(job.textId)
        this.dirty = true
      })
      if (this.dirty) this.scheduleFlush()
    } catch {
      if (generation === this.generation && !controller.signal.aborted) {
        for (const job of batch) this.fail(job.textId)
      }
    } finally {
      this.controllers.delete(controller)
      if (generation === this.generation) {
        for (const job of batch) {
          this.inflight.delete(job.key)
          if (this.owners.get(job.textId) === job.key) this.owners.delete(job.textId)
        }
        this.active -= 1
        this.schedulePump()
      }
    }
  }

  /** Record one failed attempt and push the text's next try further out. */
  private fail(textId: string): void {
    const attempts = (this.retry.get(textId)?.attempts ?? 0) + 1
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 0
    this.retry.set(textId, { attempts, notBefore: this.now() + delay })
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
    if (this.dirty) {
      this.dirty = false
      const entries = this.entries
      const snapshot = { ...entries }
      this.persistence = this.persistence.then(async () => {
        try {
          await saveTranslationCache(this.dataRoot, snapshot)
        } catch {
          if (this.entries === entries) this.dirty = true
        }
      })
    }
    await this.persistence
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

  /**
   * Cancel timers and drop queued work; in-flight calls finish and are
   * persisted by {@link flush}.
   *
   * A disposed instance cannot deliver its queue — {@link enqueue} refuses new
   * work and the pump refuses to start — so leaving it populated would strand
   * its units behind a {@link pendingCount} that never falls, and a
   * {@link settle} waiting on them would run out its deadline instead of
   * returning. Dropping them costs nothing durable: translation is lazy, the
   * cache is the only state that has to survive, and the next activation's
   * first read queues whatever is still missing.
   */
  dispose(): void {
    this.disposed = true
    if (this.pumpTimer !== undefined) {
      clearTimeout(this.pumpTimer)
      this.pumpTimer = undefined
    }
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    this.pending.clear()
    // Ownership goes with the queue: no later read can be answered from a job
    // this instance will never run. In-flight calls still land and are written.
    this.owners.clear()
    void this.flush()
  }
}
