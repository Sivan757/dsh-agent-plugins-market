// @vitest-environment jsdom
/**
 * The client half of description refresh: after a read reports translations
 * still in flight, the panel must re-read until the count reaches zero -- and
 * must stop on its own rather than polling forever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const payloads = vi.hoisted(() => ({ queue: [] as unknown[] }))

vi.mock('../src/client/api.js', () => ({
  // A real failed read rejects: getJson throws on a non-ok response and
  // boundedFetch throws on a network error. Never resolves undefined.
  fetchOverview: vi.fn(async () => {
    const next = payloads.queue.shift()
    if (next instanceof Error) throw next
    return next
  }),
  fetchSourceProgress: vi.fn(async () => ({ active: false, step: undefined, error: undefined })),
  postAction: vi.fn()
}))

import { invalidateOverview, startDescriptionRefresh } from '../src/client/features/market/market-resource.js'

const EMPTY = { sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '', data: '' } }

afterEach(() => {
  invalidateOverview()
  payloads.queue.length = 0
  vi.useRealTimers()
})

describe('startDescriptionRefresh', () => {
  it('re-reads while translations are pending and stops when none are', async () => {
    vi.useFakeTimers()
    payloads.queue.push({ ...EMPTY, translationPending: 2 }, { ...EMPTY, translationPending: 1 }, { ...EMPTY })
    const seen: number[] = []
    const handle = startDescriptionRefresh(data => seen.push(data.translationPending ?? 0))
    // Two ticks for the two pending responses, a third to observe zero.
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.advanceTimersByTimeAsync(5_000)
    handle.stop()
    expect(seen).toEqual([2, 1, 0])
  })

  it('stops permanently once a read reports nothing pending', async () => {
    vi.useFakeTimers()
    payloads.queue.push({ ...EMPTY })
    const seen: unknown[] = []
    const handle = startDescriptionRefresh(data => seen.push(data))
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.advanceTimersByTimeAsync(60_000)
    handle.stop()
    // One report only: the zero-pending answer ended the poll instead of
    // scheduling another tick.
    expect(seen).toHaveLength(1)
  })

  it('stops when the caller reports the panel is gone', async () => {
    vi.useFakeTimers()
    let mounted = true
    payloads.queue.push({ ...EMPTY, translationPending: 5 }, { ...EMPTY, translationPending: 5 }, { ...EMPTY, translationPending: 5 })
    const seen: unknown[] = []
    const handle = startDescriptionRefresh(
      data => seen.push(data),
      () => !mounted
    )
    await vi.advanceTimersByTimeAsync(1_500)
    mounted = false
    await vi.advanceTimersByTimeAsync(60_000)
    handle.stop()
    // The tick after unmount does not report, so a closed panel stops polling.
    expect(seen).toHaveLength(1)
  })

  it('stops on a failed re-read instead of retrying forever', async () => {
    vi.useFakeTimers()
    payloads.queue.push({ ...EMPTY, translationPending: 3 }, new Error('overview: 500'))
    const seen: unknown[] = []
    const handle = startDescriptionRefresh(data => seen.push(data))
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.advanceTimersByTimeAsync(60_000)
    handle.stop()
    // The failure keeps the current text and ends the poll: a panel that
    // cannot reach the host must not hammer it.
    expect(seen).toHaveLength(1)
  })
})
