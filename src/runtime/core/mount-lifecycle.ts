/**
 * Shared mount lifecycle: the pass queue and the bounded retry schedule that
 * every surface registry runs on top of its own mount/unmount semantics. Which
 * failures are worth retrying stays the surface's own decision; only the timing
 * and the bookkeeping live here.
 */

/** Structural `ctx.plugin` handle for one dynamically mounted plugin. */
export interface MountPluginHandle {
  await(): Promise<unknown>
  dispose(): void | Promise<void>
}

/** Structural `ctx.plugin` surface for mounting one plugin instance. */
export interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountPluginHandle
}

/** One failed mount offered to the retry schedule. */
export interface RetryTarget {
  /** Mount key; also the retry identity, so a key holds at most one pending timer. */
  key: string
  /** How the mount is named in log lines, e.g. `suite/server`. */
  label: string
  /** Why the mount failed; omitted when the failure must not be retried. */
  reason?: string
}

/** A pass failure reaches the caller's promise, so the queue tail stays usable. */
const swallow = (): undefined => undefined

/** Serializes reconcile passes: each pass starts after the previous one settles. */
export class SerialPassQueue {
  private tail: Promise<void> = Promise.resolve()

  /** Queue one pass behind the in-flight one, so a disable cannot race an in-flight spawn. */
  run<T>(pass: () => Promise<T>): Promise<T> {
    const run = this.tail.then(pass)
    this.tail = run.then(swallow, swallow)
    return run
  }
}

/**
 * Bounded retry schedule for a failed mount/unmount. The cap keeps a
 * crash-looping or permanently broken server from consuming attempt budget
 * forever, and the count resets with every reconcile pass.
 */
const RETRY_SCHEDULE_MS = [1_500, 5_000, 15_000, 45_000, 120_000]
const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length

export interface RetrySchedulerOptions {
  /** Re-run the surface's reconcile against its last known input. */
  replay(): Promise<unknown>
  /** Write one lifecycle log line through the surface's own logger. */
  log(message: string): void
}

/** Delayed re-attempts for a mount that is not live yet, keyed by mount key. */
export class RetryScheduler {
  /** Pending retry timers keyed by mount key, so a teardown can cancel them. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Attempt count per mount key, dropped when its target stops being retryable. */
  private readonly attempts = new Map<string, number>()

  constructor(private readonly options: RetrySchedulerOptions) {}

  /**
   * Arm the retry for one failed mount, replacing any timer already pending for
   * its key. A target carrying no reason is a deterministic skip rather than a
   * transient failure: it drops that key's budget and cancels its timer.
   */
  schedule(target: RetryTarget): void {
    const pending = this.timers.get(target.key)
    if (pending !== undefined) clearTimeout(pending)
    this.timers.delete(target.key)
    if (target.reason === undefined) {
      this.attempts.delete(target.key)
      return
    }
    const attempt = (this.attempts.get(target.key) ?? 0) + 1
    this.attempts.set(target.key, attempt)
    if (attempt > MAX_RETRY_ATTEMPTS) {
      this.options.log(`${target.label}: giving up after ${MAX_RETRY_ATTEMPTS} attempts — ${target.reason}`)
      return
    }
    const delay = RETRY_SCHEDULE_MS[attempt - 1] ?? RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]
    const timer = setTimeout(() => {
      this.timers.delete(target.key)
      // Replay the surface's last known input: a retry must not resurrect a
      // server that has since been disabled or uninstalled.
      void this.options.replay().catch(() => {})
    }, delay)
    timer.unref?.()
    this.timers.set(target.key, timer)
  }

  /** Cancel every pending retry and drop all attempt budgets. */
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.attempts.clear()
  }
}
