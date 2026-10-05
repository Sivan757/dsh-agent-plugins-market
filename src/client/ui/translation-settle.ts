/**
 * Re-read a panel until its translations land.
 *
 * The host resolves translations off the read path: a panel's first read returns
 * the authored text plus a count of fields still in flight. This polls until
 * that count reaches zero, which swaps the translated text in without the user
 * refreshing — the same shape the market overview has always used, shared here
 * so every surface behaves alike.
 *
 * Polling stops on the first error, on a read with nothing pending, and when the
 * caller stops it — a panel whose translations never resolve must not poll
 * forever.
 * @module client/ui/translation-settle
 */

/** How long to wait between re-reads; the market overview's long-standing pace. */
export const TRANSLATION_POLL_MS = 1_500

/** What one surface's read reports back. */
export interface PendingRead<T> {
  /** The value to render now. */
  readonly value: T
  /** Fields this read queued that have not landed yet; 0 means settled. */
  readonly pending: number
}

/** What {@link pollUntilTranslated} needs. */
export interface TranslationSettleOptions<T> {
  /** Perform one read and report its value and pending count. */
  readonly read: () => Promise<PendingRead<T>>
  /** Receives every read that completes, the first poll included. */
  readonly report: (value: T) => void
  /** Read before every tick, so an unmounted panel stops. */
  readonly isStopped?: () => boolean
}

/**
 * Poll one surface until nothing is pending.
 * @param options - the reader, the reporter, and the stop probe.
 * @returns a handle that cancels the next tick.
 */
export function pollUntilTranslated<T>(options: TranslationSettleOptions<T>): { stop: () => void } {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stoppedNow = (): boolean => stopped || (options.isStopped?.() ?? false)
  const tick = async (): Promise<void> => {
    if (stoppedNow()) return
    try {
      const { value, pending } = await options.read()
      if (stoppedNow()) return
      options.report(value)
      if (pending === 0) return
    } catch {
      // A failed re-read keeps the text already on screen; the panel stays usable.
      return
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void tick()
      }, TRANSLATION_POLL_MS)
    }
  }
  timer = setTimeout(() => {
    void tick()
  }, TRANSLATION_POLL_MS)
  return {
    stop: () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
