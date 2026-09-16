/**
 * The fiber's timer seat, with a fallback for contexts that carry none.
 *
 * The host mounts `@deepseek-ai/cordis-plugin-timer`, the service named `timer`
 * whose helpers a callback is scheduled through: the timer is cancelled when
 * the fiber that created it disposes, so a plugin cannot leak one past its own
 * teardown. That is the scheduling this module prefers. The service also mixes
 * `interval`, `timeout` and `debounce` into every context as accessors, but
 * Cordis resolves an accessor through its service, so a fiber that does not
 * inject `timer` reads the service instead. The fallback exists for the minimal
 * contexts tests build and for compositions without the timer plugin; it is the
 * one path that has to unref its own handles, so an armed fallback timer never
 * keeps a host process alive on its own.
 *
 * @module runtime/timer-seat
 */
import type { Context } from '@deepseek-ai/cordis'

/** The timer methods the `timer` service exposes. */
interface TimerSeat {
  interval(callback: () => void, delayMs: number): () => void
  timeout(callback: () => void, delayMs: number): () => void
  debounce(callback: () => void, delayMs: number): (() => void) & { dispose?: () => void }
}

function seatOf(ctx: Context): TimerSeat | undefined {
  const seat = ctx.get('timer') as Partial<TimerSeat> | undefined
  if (seat === undefined) return undefined
  return typeof seat.interval === 'function' && typeof seat.timeout === 'function' && typeof seat.debounce === 'function' ? (seat as TimerSeat) : undefined
}

/**
 * Repeat `callback` every `delayMs` until the returned disposer runs or the
 * fiber disposes.
 * @param ctx - the owning plugin context.
 * @param callback - the repeating work.
 * @param delayMs - the period.
 * @returns the disposer that stops the repetition.
 */
export function repeat(ctx: Context, callback: () => void, delayMs: number): () => void {
  const seat = seatOf(ctx)
  if (seat !== undefined) return seat.interval(callback, delayMs)
  const timer = setInterval(callback, delayMs)
  timer.unref?.()
  return () => {
    clearInterval(timer)
  }
}

/**
 * Run `callback` once after `delayMs`, unless the returned disposer runs first
 * or the fiber disposes.
 * @param ctx - the owning plugin context.
 * @param callback - the deferred work.
 * @param delayMs - the delay.
 * @returns the disposer that cancels the pending run.
 */
export function defer(ctx: Context, callback: () => void, delayMs: number): () => void {
  const seat = seatOf(ctx)
  if (seat !== undefined) return seat.timeout(callback, delayMs)
  const timer = setTimeout(callback, delayMs)
  timer.unref?.()
  return () => {
    clearTimeout(timer)
  }
}

/** One coalescing trigger: call it per event; dispose drops any pending run. */
export interface CoalescedTrigger {
  /** Record one event, (re)starting the quiet period. */
  (): void
  /** Drop a pending run. */
  dispose(): void
}

/**
 * Collapse a burst of calls into one run of `callback`, `delayMs` after the
 * last call, until the trigger is disposed or the fiber disposes.
 * @param ctx - the owning plugin context.
 * @param callback - the coalesced work.
 * @param delayMs - the quiet period.
 * @returns the trigger to call per event and to dispose at teardown.
 */
export function coalesce(ctx: Context, callback: () => void, delayMs: number): CoalescedTrigger {
  const seat = seatOf(ctx)
  if (seat !== undefined) {
    const debounced = seat.debounce(callback, delayMs)
    // The seat returns the debounced function itself, carrying its own
    // disposer; capture that disposer before this wrapper replaces the field.
    const stopSeat = debounced.dispose
    const trigger = debounced as CoalescedTrigger
    trigger.dispose = () => {
      stopSeat?.call(debounced)
    }
    return trigger
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const trigger = (() => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      callback()
    }, delayMs)
    timer.unref?.()
  }) as CoalescedTrigger
  trigger.dispose = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return trigger
}
