/**
 * Tests for the timer seat: the host's `timer` service when the context can
 * resolve it, and the unref'd fallback when it cannot. Both paths have to
 * schedule the same way, and both have to stop on dispose. The seat is read
 * from the service rather than from the `interval`/`timeout`/`debounce`
 * accessors the service mixes into contexts, because Cordis refuses those
 * accessors in a fiber that does not inject `timer` — the case the last test
 * mounts for real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { coalesce, defer, repeat, type CoalescedTrigger } from '../src/runtime/timer-seat.js'

/** Let a mounted plugin fiber activate: Cordis loads one on a later tick. */
const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** The host's timer service, including the accessors it mixes into contexts. */
class FakeTimerService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'timer')
    // The host's timer plugin declares `timer` on `Context`; this stand-in registers the same
    // accessors without that declaration, so the call is narrowed to what it registers.
    const mixin = ctx as unknown as { mixin(source: string, mixins: string[]): void }
    mixin.mixin('timer', ['interval', 'timeout', 'debounce'])
  }

  interval(_callback: () => void, _delayMs: number): () => void {
    return () => {}
  }

  timeout(_callback: () => void, _delayMs: number): () => void {
    return () => {}
  }

  debounce(callback: () => void, _delayMs: number): (() => void) & { dispose?: () => void } {
    return Object.assign(() => callback(), { dispose: () => {} })
  }
}

/** A context that resolves no timer service: the minimal embedding. */
function bareContext(): Context {
  return new Context()
}

/** A context whose `timer` service records how the seat was used. */
function seatedContext() {
  const disposers: string[] = []
  const debounces: Array<() => void> = []
  const seat = {
    interval: (_callback: () => void, _delayMs: number) => {
      disposers.push('interval')
      return () => {
        disposers.push('interval-stop')
      }
    },
    timeout: (_callback: () => void, _delayMs: number) => {
      disposers.push('timeout')
      return () => {
        disposers.push('timeout-stop')
      }
    },
    debounce: (callback: () => void, _delayMs: number) => {
      disposers.push('debounce')
      const trigger = () => {
        debounces.push(callback)
      }
      return trigger
    }
  }
  const ctx = { get: (name: string) => (name === 'timer' ? seat : undefined) } as unknown as Context
  return { ctx, disposers, debounces }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('timer seat', () => {
  it('prefers the host seat for every schedule kind', () => {
    const seated = seatedContext()
    const dispose = repeat(seated.ctx, () => {}, 10)
    expect(seated.disposers).toEqual(['interval'])
    dispose()
    expect(seated.disposers).toEqual(['interval', 'interval-stop'])

    defer(seated.ctx, () => {}, 10)()
    expect(seated.disposers).toContain('timeout')
    expect(seated.disposers).toContain('timeout-stop')

    const flush = coalesce(seated.ctx, () => {}, 10)
    flush()
    flush.dispose()
    expect(seated.disposers).toContain('debounce')
  })

  it('serves a fiber that does not inject the timer service', async () => {
    const root = new Context()
    root.plugin(FakeTimerService)
    await settled()

    let accessorError: unknown
    let trigger: CoalescedTrigger | undefined
    root.plugin({
      name: 'uninjected',
      apply(ctx: Context) {
        try {
          void (ctx as unknown as { timeout: unknown }).timeout
        } catch (error) {
          accessorError = error
        }
        trigger = coalesce(ctx, () => {}, 10)
      }
    })
    await settled()

    expect(String(accessorError)).toContain('without inject')
    expect(typeof trigger).toBe('function')
    trigger?.dispose()
  })

  it('repeats and defers on a plain context, and stops on dispose', async () => {
    vi.useFakeTimers()
    const ticks = vi.fn()
    const stop = repeat(bareContext(), ticks, 1_000)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(ticks).toHaveBeenCalledTimes(3)
    stop()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(ticks).toHaveBeenCalledTimes(3)

    const once = vi.fn()
    const cancel = defer(bareContext(), once, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(once).toHaveBeenCalledTimes(1)
    // A cancelled deferral never runs.
    const dropped = vi.fn()
    const cancelDropped = defer(bareContext(), dropped, 1_000)
    cancelDropped()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(dropped).not.toHaveBeenCalled()
    void cancel
  })

  it('coalesces a burst into one run on a plain context', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const trigger = coalesce(bareContext(), run, 150)
    trigger()
    trigger()
    trigger()
    await vi.advanceTimersByTimeAsync(149)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)

    trigger()
    trigger.dispose()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
