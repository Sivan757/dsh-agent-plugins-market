import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AUTO_UPDATE_INTERVAL_MS, SourceAutoUpdater } from '../../../packages/market-runtime/src/runtime/core/source-auto-update.js'

/** Per-test roots for the writes a refresh pass stands in for. */
const roots: string[] = []

/** A context that resolves no service, so the timer seat takes its plain-handle fallback. */
function context(logs: string[]): Context {
  return {
    get: () => undefined,
    logger: { info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) }
  } as unknown as Context
}

afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
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
    await updater.dispose()
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
    await updater.dispose()
    const failing = new SourceAutoUpdater(context(logs), async () => {
      throw new Error('network down')
    })
    failing.setEnabled(true)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    await failing.dispose()
    expect(logs.join('\n')).toContain('background source update failed: network down')
  })

  /**
   * A refresh pass writes under the user root: it clones source checkouts and
   * commits the state file. Disposing the updater has to mean no pass is still
   * writing, not merely that no new tick starts.
   *
   * The gate holds the pass open, so the marker file can only exist once the
   * caller that awaited the disposal let it through.
   */
  it('settles only after the pass already running finished its write', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'source-auto-update-'))
    roots.push(root)
    const logs: string[] = []

    let releasePass!: () => void
    let announcePass!: () => void
    const passStarted = new Promise<void>(resolve => {
      announcePass = resolve
    })
    const refresh = vi.fn(async () => {
      announcePass()
      await new Promise<void>(resolve => {
        releasePass = resolve
      })
      await writeFile(join(root, 'refreshed'), '')
    })

    const updater = new SourceAutoUpdater(context(logs), refresh)
    updater.setEnabled(true)
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS)
    await passStarted
    expect(refresh).toHaveBeenCalledTimes(1)

    // `Promise.resolve` keeps this meaningful for a disposer that returns
    // nothing: that shape is complete the instant it returns.
    const disposing = Promise.resolve(updater.dispose())
    let settled = false
    void disposing.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS * 2)
    // The disarm is synchronous, so the interval stopped even though the pass
    // it had already started is still running.
    expect(updater.enabled).toBe(false)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)

    releasePass()
    await disposing
    expect(settled).toBe(true)
    await expect(readFile(join(root, 'refreshed'), 'utf8')).resolves.toBe('')
  })
})
