import { describe, expect, it, vi } from 'vitest'
import { settlesWithin } from '../src/application/deadline.js'

describe('settlesWithin', () => {
  it('reports a timeout while the work keeps running, then the settlement', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    const wait = settlesWithin(pending, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await wait).toBe(false)
    // The deadline ends the wait, never the work: the same promise still settles.
    release()
    expect(await settlesWithin(pending, 1_000)).toBe(true)
    vi.useRealTimers()
  })

  it('counts a rejection as settled and leaves the failure to the caller', async () => {
    expect(await settlesWithin(Promise.reject(new Error('mount failed')), 1_000)).toBe(true)
  })

  it('answers without waiting when asked for no wait at all', async () => {
    // A zero wait is "tell me what is already true", not "arm no timer": a
    // settled promise still wins on its microtask, an unsettled one reports
    // false immediately instead of hanging forever.
    expect(await settlesWithin(Promise.resolve(), 0)).toBe(true)
    const never = new Promise<void>(() => {})
    expect(await settlesWithin(never, 0)).toBe(false)
  })
})
