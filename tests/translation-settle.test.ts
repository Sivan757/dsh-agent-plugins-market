import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollUntilTranslated, TRANSLATION_POLL_MS } from '../src/client/ui/translation-settle.js'

/** Advance one poll interval and let the read settle. */
async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pollUntilTranslated', () => {
  it('re-reads until nothing is pending, reporting every read', async () => {
    vi.useFakeTimers()
    // The first read hands back authored text with work queued; the second is
    // the settled answer. This is the shape the host actually serves.
    const reads = [
      { value: 'authored', pending: 2 },
      { value: 'translated', pending: 0 }
    ]
    const read = vi.fn(async () => reads.shift() ?? { value: 'translated', pending: 0 })
    const seen: string[] = []
    pollUntilTranslated({ read, report: value => seen.push(value) })

    await tick()
    expect(seen).toEqual(['authored'])
    await tick()
    expect(seen).toEqual(['authored', 'translated'])
    // Settled: no further read is scheduled.
    await tick()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('stops after one read when the first answer is already settled', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({ value: 'translated', pending: 0 }))
    pollUntilTranslated({ read, report: () => {} })
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('stops on a failed read, keeping the text already on screen', async () => {
    vi.useFakeTimers()
    let calls = 0
    const read = vi.fn(async () => {
      calls += 1
      if (calls > 1) throw new Error('read failed')
      return { value: 'authored', pending: 1 }
    })
    const seen: string[] = []
    pollUntilTranslated({ read, report: value => seen.push(value) })
    await tick()
    await tick()
    expect(seen).toEqual(['authored'])
    // A failed read ends the loop rather than retrying into a broken panel.
    await tick()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('cancels the next tick when stopped', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({ value: 'authored', pending: 1 }))
    const settle = pollUntilTranslated({ read, report: () => {} })
    settle.stop()
    await tick()
    expect(read).not.toHaveBeenCalled()
  })

  it('stops when the caller reports itself gone', async () => {
    vi.useFakeTimers()
    let mounted = true
    const read = vi.fn(async () => ({ value: 'authored', pending: 1 }))
    pollUntilTranslated({ read, report: () => {}, isStopped: () => !mounted })
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
    // The panel unmounts: its pending work must not keep polling.
    mounted = false
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
  })
})
