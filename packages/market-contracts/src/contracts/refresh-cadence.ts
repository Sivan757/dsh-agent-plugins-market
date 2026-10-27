/**
 * How often the client re-reads, and how long the host's panel rows may answer.
 *
 * Two packages have to agree on one number and did not. The client decides when
 * to ask again; the host decides how long the rows it already scanned may serve
 * that ask. Stating the second as a bare literal in the runtime let the two
 * drift, and they drifted: the rows expired 500 ms before the read that needed
 * them, so every window poll rescanned every document while the cache's own
 * contract claimed to absorb the poll that was scanning it.
 *
 * The bound is derived here instead of restated, and it is a sandwich between
 * the two client cadences. Both edges have a visible consequence.
 *
 * - It must outlive the fast poll. The translation poll re-reads a panel every
 *   {@link TRANSLATION_POLL_MS} while translated text lands, and absorbing that
 *   is most of what the cache exists for.
 * - It must expire before the slow poll. The window poll re-reads every
 *   {@link EXTENSION_WINDOW_POLL_MS} for the whole life of a session, and a panel
 *   promises that a hand edit to a document on disk shows up by the next one. A
 *   bound that reached the poll interval would serve a scan two polls old, which
 *   doubles how long an edit stays invisible, so the interval is a ceiling and
 *   not a target.
 *
 * Sitting strictly between the two satisfies both edges: the cache absorbs the
 * fast poll and never masks an edit past the slow one.
 * @module contracts/refresh-cadence
 */

/** How long the client waits between extension-window reads. */
export const EXTENSION_WINDOW_POLL_MS = 2_500

/** How long the client waits between panel reads while translated text is landing. */
export const TRANSLATION_POLL_MS = 1_500

/**
 * How much sooner than the next window read the scanned rows must expire.
 *
 * The slack is what keeps an edit visible at that read rather than the one after
 * it, so it must stay greater than zero.
 */
export const ROW_CACHE_SLACK_MS = 500

/**
 * Derive one row-cache bound, refusing a schedule that cannot hold both edges.
 *
 * The two edges are checked rather than documented, because this relation has
 * already been lost once: a value written as a literal looks correct beside a
 * comment that describes a different cadence. A bound at or below the fast poll
 * wastes the cache, and one at or above the slow poll hides edits, so both
 * fail here instead of shipping.
 * @param windowPollMs - the slow poll a hand edit must be visible by.
 * @param translationPollMs - the fast poll the cache must absorb.
 * @param slackMs - how much sooner than the slow poll the rows expire.
 * @returns the bound in milliseconds.
 */
export function rowCacheMaxAgeMs(windowPollMs: number, translationPollMs: number, slackMs: number): number {
  const bound = windowPollMs - slackMs
  if (slackMs <= 0) throw new Error(`row cache slack must be positive so a scan cannot outlive the next read; received ${String(slackMs)}`)
  if (bound <= translationPollMs)
    throw new Error(`row cache bound ${String(bound)}ms must outlive the ${String(translationPollMs)}ms translation poll, or the cache never absorbs it`)
  if (bound >= windowPollMs)
    throw new Error(`row cache bound ${String(bound)}ms must expire before the ${String(windowPollMs)}ms window poll, or an edit stays invisible for two polls`)
  return bound
}

/**
 * How long one set of scanned panel rows may answer a read.
 *
 * Derived, so changing a client cadence moves it and the checks above fail loud
 * when the new value cannot satisfy both edges.
 */
export const ROW_CACHE_MAX_AGE_MS = rowCacheMaxAgeMs(EXTENSION_WINDOW_POLL_MS, TRANSLATION_POLL_MS, ROW_CACHE_SLACK_MS)
