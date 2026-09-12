import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AUTO_UPDATE_INTERVAL_MS, SourceAutoUpdater } from '../src/runtime/source-auto-update.js'

function context(logs: string[]): Context {
  return { logger: { info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) } } as unknown as Context
}

afterEach(() => {
  vi.useRealTimers()
})

describe('background source updater', () => {
  it('stays off until enabled and refreshes once per interval', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => {})
    const updater = new SourceAutoUpdater(context([]), refresh)
    expect(updater.enabled).toBe(false)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    expect(refresh).not.toHaveBeenCalled()
    updater.setEnabled(true)
    expect(updater.enabled).toBe(true)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
    updater.dispose()
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS * 2)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('disabling stops the timer and re-enabling is idempotent', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => {})
    const logs: string[] = []
    const updater = new SourceAutoUpdater(context(logs), refresh)
    updater.setEnabled(true)
    updater.setEnabled(true)
    updater.setEnabled(false)
    updater.setEnabled(false)
    expect(updater.enabled).toBe(false)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    expect(refresh).not.toHaveBeenCalled()
    expect(logs.filter(line => line.includes('background source updates on'))).toHaveLength(1)
    expect(logs.filter(line => line.includes('background source updates off'))).toHaveLength(1)
  })

  it('skips a tick while the previous pass is still running and reports a failed pass', async () => {
    vi.useFakeTimers()
    const logs: string[] = []
    let release: (() => void) | undefined
    const refresh = vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve
        })
    )
    const updater = new SourceAutoUpdater(context(logs), refresh)
    updater.setEnabled(true)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(logs.join('\n')).toContain('previous pass is still running')
    release?.()
    await vi.advanceTimersByTimeAsync(0)
    updater.dispose()

    const failing = new SourceAutoUpdater(context(logs), async () => {
      throw new Error('network down')
    })
    failing.setEnabled(true)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    failing.dispose()
    expect(logs.join('\n')).toContain('background source update failed: network down')
  })
})
