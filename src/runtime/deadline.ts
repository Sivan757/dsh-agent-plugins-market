/**
 * Bounded waits for work this plugin cannot cancel.
 *
 * Every wait here is a race against a timer: the caller stops waiting and the
 * underlying work keeps running. That is the only safe shape for a mount and
 * for the change pipeline that drives it — a spawned server process or a
 * browser authorization the user is completing must not be abandoned just
 * because nobody is waiting for it any more.
 *
 * @module runtime/deadline
 */

/**
 * Resolve `true` once `work` settles, or `false` when `deadlineMs` elapses.
 *
 * A rejection counts as settled: this helper only reports timing, so callers
 * that need the failure attach their own handler to `work`.
 */
export function settlesWithin(work: Promise<unknown>, deadlineMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), deadlineMs)
    timer.unref?.()
    const settle = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    void work.then(settle, settle)
  })
}
