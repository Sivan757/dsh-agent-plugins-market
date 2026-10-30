/**
 * The retry schedule forgets a mount that came back.
 *
 * Its budget is what stops a crash-looping server; a key that mounted is not
 * crash-looping. Without the reset, five failures spread over a server's whole
 * life would silence every retry after them, however long it had been healthy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetryScheduler } from '../../../packages/market-runtime/src/runtime/core/mount-lifecycle.js'

afterEach(() => {
  vi.useRealTimers()
})

function scheduler(): { retries: RetryScheduler; replays: () => number } {
  let replays = 0
  const retries = new RetryScheduler({
    replay: async () => {
      replays += 1
    },
    log: () => {}
  })
  return { retries, replays: () => replays }
}

describe('retry scheduler', () => {
  it('gives up after the schedule length, then retries again once the key settles', async () => {
    vi.useFakeTimers()
    const { retries, replays } = scheduler()
    // One failure per timer: each schedule replaces the key's pending timer, so
    // firing between attempts is what makes five distinct failures.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      retries.schedule({ key: 'suite/server', label: 'suite/server', reason: 'boom' })
      await vi.advanceTimersByTimeAsync(120_000)
    }
    expect(replays()).toBe(5)
    // The sixth failure is past the budget: no timer, so no further replay.
    retries.schedule({ key: 'suite/server', label: 'suite/server', reason: 'boom' })
    await vi.runAllTimersAsync()
    expect(replays()).toBe(5)

    // The mount came back: the next failure is a new outage and arms a timer
    // on the first delay.
    retries.settle('suite/server')
    retries.schedule({ key: 'suite/server', label: 'suite/server', reason: 'boom again' })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(replays()).toBe(6)
  })

  it('settling cancels a pending retry for that key', async () => {
    vi.useFakeTimers()
    const { retries, replays } = scheduler()
    retries.schedule({ key: 'k', label: 'k', reason: 'boom' })
    retries.settle('k')
    await vi.runAllTimersAsync()
    expect(replays()).toBe(0)
  })

  it('a deterministic skip drops the budget instead of arming a timer', async () => {
    vi.useFakeTimers()
    const { retries, replays } = scheduler()
    retries.schedule({ key: 'k', label: 'k', reason: 'boom' })
    // A skip carries no reason: it is not a transient failure.
    retries.schedule({ key: 'k', label: 'k' })
    await vi.runAllTimersAsync()
    expect(replays()).toBe(0)
    retries.schedule({ key: 'k', label: 'k', reason: 'boom' })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(replays()).toBe(1)
  })
})
