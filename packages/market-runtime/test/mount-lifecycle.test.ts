/**
 * The bounded retry schedule a mount registry arms for a failed mount.
 *
 * Two properties make it safe, and neither was owned by a test: a teardown
 * cancels the retry it armed, so nothing replays after the registry reported
 * its mounts gone, and the attempt budget resets, so a server that failed five
 * times over unrelated reconciles is retried again rather than given up on for
 * the life of the process. Timers are fake here; the schedule's real delays are
 * 1.5s to 120s.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetryScheduler } from '../../../packages/market-runtime/src/runtime/core/mount-lifecycle.js'

/** Longer than the schedule's longest delay, so any armed retry has fired. */
const PAST_EVERY_DELAY_MS = 120_001

afterEach(() => {
  vi.useRealTimers()
})

/** A scheduler over recorded ports. */
function scheduler(): { retries: RetryScheduler; replays: string[]; logs: string[] } {
  const replays: string[] = []
  const logs: string[] = []
  const retries = new RetryScheduler({
    replay: async () => {
      replays.push('replay')
    },
    log: message => logs.push(message)
  })
  return { retries, replays, logs }
}

const failed = (key: string) => ({ key, label: 'suite/' + key, reason: 'connection refused' })

describe('RetryScheduler teardown', () => {
  it('cancels every pending retry, so nothing replays after the registry was disposed', async () => {
    vi.useFakeTimers()
    const { retries, replays } = scheduler()
    retries.schedule(failed('one'))
    retries.schedule(failed('two'))
    await vi.advanceTimersByTimeAsync(0)
    expect(replays).toEqual([])

    retries.clear()
    await vi.advanceTimersByTimeAsync(PAST_EVERY_DELAY_MS)
    expect(replays).toEqual([])
  })

  it('drops the attempt budget, so a later schedule starts the schedule over', async () => {
    vi.useFakeTimers()
    const { retries, replays, logs } = scheduler()
    // Five schedules exhaust the budget, and the sixth reports the give-up.
    for (let attempt = 0; attempt < 5; attempt += 1) retries.schedule(failed('one'))
    expect(logs).toEqual([])
    retries.schedule(failed('one'))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('giving up after 5 attempts')

    retries.clear()
    // A budget that survived the teardown would make this the seventh attempt
    // and log a second give-up instead of arming a retry.
    retries.schedule(failed('one'))
    expect(logs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(PAST_EVERY_DELAY_MS)
    expect(replays).toHaveLength(1)
  })

  it('forgets a target that stops being retryable, instead of retrying a disabled mount', async () => {
    vi.useFakeTimers()
    const { retries, replays } = scheduler()
    retries.schedule(failed('one'))
    retries.schedule(failed('one'))
    // No reason is a deterministic skip: that key's timer and budget both go.
    retries.schedule({ key: 'one', label: 'suite/one' })
    await vi.advanceTimersByTimeAsync(PAST_EVERY_DELAY_MS)
    expect(replays).toEqual([])

    // The budget reset with it, so the next failure is attempt one again.
    retries.schedule(failed('one'))
    await vi.advanceTimersByTimeAsync(PAST_EVERY_DELAY_MS)
    expect(replays).toHaveLength(1)
  })
})
