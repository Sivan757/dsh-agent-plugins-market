/**
 * The ordered provider chain: one batch in, the first provider that answers wins.
 *
 * Providers run in the order the composition root hands them over, which is the
 * market's own quality order — the keyless public endpoints first, the user's
 * model last. A provider that fails is remembered for the rest of the process:
 * an unreachable endpoint then costs one timeout per session rather than one
 * per batch, which matters because a blocked network does not refuse the
 * connection, it holds it open until the timeout fires.
 * @module application/translation/chain
 */
import type { TranslationProviderId } from '../../contracts/translation.js'

/** One translation backend: a public endpoint or the user's own model. */
export interface TranslationProvider {
  /** Which provider this is; also the identity folded into the cache key. */
  readonly id: TranslationProviderId
  /**
   * Whether this provider can serve a call right now.
   *
   * Read per call and never cached: a model route provisions after the plugin's
   * apply() returns, so an answer captured at composition time would report
   * "unavailable" for the life of the process.
   */
  available(): boolean
  /** Translate one batch, preserving order and length. Rejects on any failure. */
  translate(request: { texts: readonly string[]; locale: string; signal: AbortSignal }): Promise<string[]>
}

/**
 * Per-provider timeout, in chain order.
 *
 * Google is first and shortest because a blocked network makes it hang rather
 * than fail: the whole session should pay that wait at most once. The model
 * gets the longest budget because a generation legitimately takes seconds.
 */
export const PROVIDER_TIMEOUT_MS: Record<TranslationProviderId, number> = {
  google: 3_000,
  microsoft: 15_000,
  llm: 30_000
}

/** Providers that already failed in this process; the chain skips them from then on. */
const tripped = new Set<TranslationProviderId>()

/** Clear the circuit breaker. Tests call this between cases. */
export function resetCircuitBreaker(): void {
  tripped.clear()
}

/** Whether a provider has been taken out of the chain by an earlier failure. */
export function isTripped(id: TranslationProviderId): boolean {
  return tripped.has(id)
}

/** One error's message, whatever was thrown. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run one batch through the chain.
 *
 * Every provider failure — a throw, a timeout, a short result — takes that
 * provider out of the chain and moves on to the next. The caller's own
 * cancellation is not a provider failure: it rethrows immediately and leaves
 * the breaker untouched, so a panel that closed does not disable a provider for
 * the rest of the session. Deadline and caller cancellation settle independently
 * of provider cooperation. A late provider result cannot replace the chosen result.
 * @param providers - the ordered chain, best first.
 * @param texts - the batch, already masked.
 * @param locale - target locale id.
 * @param signal - caller cancellation, merged with the per-provider deadline.
 * @param canContinue - live work gate checked before hops and after each result; false cancels without tripping a provider.
 * @returns the translated batch and the provider that produced it.
 * @throws when every provider is unavailable, tripped, or fails.
 */
export async function runChain(
  providers: readonly TranslationProvider[],
  texts: readonly string[],
  locale: string,
  signal?: AbortSignal,
  canContinue?: () => boolean
): Promise<{ texts: string[]; provider: TranslationProviderId }> {
  if (texts.length === 0) throw new Error('translation chain: nothing to translate')
  // Read through a closure: a direct check narrows the property for the rest of
  // the function, and the abort state legitimately changes while a provider runs.
  const cancelled = (): boolean => signal?.aborted === true || canContinue?.() === false
  const failures: string[] = []
  for (const provider of providers) {
    if (cancelled()) throw new Error('translation chain: cancelled by the caller')
    if (tripped.has(provider.id)) {
      failures.push(provider.id + ': skipped after an earlier failure')
      continue
    }
    if (!provider.available()) {
      failures.push(provider.id + ': unavailable')
      continue
    }
    const controller = new AbortController()
    let rejectStopped: (error: Error) => void = () => {}
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectStopped = reject
    })
    const stop = (message: string): void => {
      rejectStopped(new Error(message))
      controller.abort()
    }
    const onAbort = (): void => stop('translation chain: cancelled by the caller')
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => stop(provider.id + ': translation deadline exceeded'), PROVIDER_TIMEOUT_MS[provider.id])
    timer.unref?.()
    try {
      // Abort requests cleanup, but only the race bounds a provider that ignores it.
      // The async wrapper also captures synchronous throws before attaching the race.
      const work = (async () => provider.translate({ texts, locale, signal: controller.signal }))()
      const result = await Promise.race([work, stopped])
      if (cancelled()) throw new Error('translation chain: cancelled by the caller')
      if (result.length !== texts.length) {
        throw new Error('returned ' + String(result.length) + ' of ' + String(texts.length) + ' results')
      }
      return { texts: result, provider: provider.id }
    } catch (error) {
      if (cancelled()) throw new Error('translation chain: cancelled by the caller', { cause: error })
      tripped.add(provider.id)
      failures.push(provider.id + ': ' + reason(error))
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new Error('translation chain exhausted — ' + failures.join('; '))
}
