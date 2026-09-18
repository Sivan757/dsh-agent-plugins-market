/**
 * Bounded waits for work this plugin cannot cancel.
 *
 * Every wait here is a race against a timer: the caller stops waiting and the
 * underlying work keeps running. That is the only safe shape for a mount and
 * for the change pipeline that drives it — a spawned server process or a
 * browser authorization the user is completing must not be abandoned just
 * because nobody is waiting for it any more.
 *
 * The timer and its reason come from the host's own deadline primitive, which
 * only notifies. This module adds the one thing that primitive does not answer
 * and these callers need: whether the work settled at all.
 *
 * @module runtime/deadline
 */
import { deadline } from '@deepseek-ai/dsh-timeout'

/** Identifies this plugin's bounded waits inside a timeout reason. */
export const MARKET_DEADLINE_CODE = 'MARKET_DEADLINE'

/**
 * Resolve `true` once `work` settles, or `false` when `deadlineMs` elapses.
 *
 * A rejection counts as settled: this helper only reports timing, so callers
 * that need the failure attach their own handler to `work`.
 *
 * A non-positive wait means "do not wait": the answer is simply whether the
 * work had already settled. That is deliberately not the host primitive's own
 * reading of a non-positive timeout, which is "arm no timer at all" — the floor
 * below keeps the two from collapsing into opposite behaviors.
 * @param work - the work to wait for; it is never cancelled, only stopped being awaited.
 * @param deadlineMs - how long to wait, in milliseconds.
 * @returns whether the work settled before the deadline.
 */
export function settlesWithin(work: Promise<unknown>, deadlineMs: number): Promise<boolean> {
  const bound = deadline(undefined, Math.max(1, deadlineMs), MARKET_DEADLINE_CODE)
  let settled = false
  return new Promise<boolean>(resolve => {
    const settle = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    bound.signal.addEventListener(
      'abort',
      () => {
        settle(false)
      },
      { once: true }
    )
    void work.then(
      () => {
        settle(true)
      },
      () => {
        settle(true)
      }
    )
  }).finally(() => {
    bound[Symbol.dispose]()
  })
}
