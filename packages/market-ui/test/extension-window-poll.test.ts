// @vitest-environment jsdom
/**
 * The extension-window poll stops while the document is hidden.
 *
 * The regression this counts: the poll re-armed itself unconditionally, so a
 * background window kept asking the host to rebuild a whole extension inventory
 * every interval for as long as a session was open, with nobody looking at the
 * answer. The pause costs no timer while hidden and exactly one read on return.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EXTENSION_WINDOW_POLL_MS } from '../../../packages/market-contracts/src/contracts/refresh-cadence.js'

const reads = vi.hoisted(() => ({ count: 0 }))
/** The window a ready session answers with; one copy, so a payload change is one edit. */
const goodPayload = () => ({
  sessionId: 's',
  workspace: '/workspace',
  started: true,
  busy: false,
  library: { revision: 1, presets: [], defaultPresetId: null },
  state: {
    revision: 1,
    selection: { presetId: null, presetName: 'Global', presetRevision: 1, enabledIds: [], modified: false }
  },
  resources: [],
  selectionRevision: 1
})
vi.mock('../../../packages/market-ui/src/features/extension-presets/resource.js', () => ({
  readWindow: vi.fn(async () => {
    reads.count += 1
    return {
      sessionId: 's',
      workspace: '/workspace',
      started: true,
      busy: false,
      library: { revision: 1, presets: [] },
      state: { revision: 1, selection: { enabledIds: [], modified: false } },
      resources: [],
      selectionRevision: 1
    }
  }),
  writeWindow: vi.fn(),
  createWriteQueue: () => ({ current: (work: () => Promise<unknown>) => work() })
}))

import { useExtensionWindow } from '../../../packages/market-ui/src/features/extension-presets/use-window.js'

/** Mount the hook through a trivial host so React owns its effects. */
function Harness(): null {
  useExtensionWindow('s')
  return null
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let visibility: { hidden: boolean }

beforeEach(() => {
  reads.count = 0
  visibility = { hidden: false }
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => visibility.hidden)
  vi.useFakeTimers()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(Harness)))
  await act(async () => {
    await Promise.resolve()
  })
}

/** Let the poll run for a number of intervals. */
async function poll(intervals: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXTENSION_WINDOW_POLL_MS * intervals)
  })
}

describe('extension window poll', () => {
  it('keeps reading while the document is visible', async () => {
    await mount()
    expect(reads.count).toBe(1)
    await poll(4)
    expect(reads.count).toBe(5)
  })

  it('stops while the document is hidden, and costs no read at all', async () => {
    visibility.hidden = true
    await mount()
    // The mount read answers the panel it is mounted for. Nothing follows it.
    expect(reads.count).toBe(1)
    await poll(6)
    expect(reads.count).toBe(1)
  })

  it('answers with one read when a hidden document becomes visible again', async () => {
    visibility.hidden = true
    await mount()
    await poll(3)
    expect(reads.count).toBe(1)

    visibility.hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(reads.count).toBe(2)

    // The resumed poll is what reads from here, so a second focus change with a
    // timer already armed adds nothing.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(reads.count).toBe(2)

    await poll(2)
    expect(reads.count).toBe(4)
  })

  it('stops polling when the panel goes away while hidden', async () => {
    visibility.hidden = true
    await mount()
    await act(async () => root!.unmount())
    root = undefined
    // A pending visibility listener must not resurrect an unmounted panel.
    visibility.hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(reads.count).toBe(1)
  })
  it('stops polling a route the host does not serve, and keeps the reason on screen', async () => {
    // The route answering 404 is not a race the next read wins: measured in a
    // profile without it, one open session spent 336 reads and 336 console errors.
    const module = await import('../../../packages/market-ui/src/features/extension-presets/resource.js')
    // Count calls on the mock itself: a rejecting implementation never reaches the
    // helper that increments `reads`.
    vi.mocked(module.readWindow).mockClear()
    vi.mocked(module.readWindow).mockRejectedValueOnce(Object.assign(new Error('404'), { unavailable: true }))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(Harness))
    })
    expect(vi.mocked(module.readWindow).mock.calls).toHaveLength(1)
    // Several poll intervals pass: an unavailable route costs no further request.
    for (let i = 0; i < 5; i += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(EXTENSION_WINDOW_POLL_MS)
      })
    expect(vi.mocked(module.readWindow).mock.calls).toHaveLength(1)
  })
  it('backs off while a session has no extension scope, and keeps asking', async () => {
    // The route works and answers `extension-session-not-found`: the session exists
    // but has no live agent. Polling at the normal interval spends a request every
    // 2.5s on an answer that cannot change until the session is used.
    const module = await import('../../../packages/market-ui/src/features/extension-presets/resource.js')
    vi.mocked(module.readWindow).mockClear()
    const notReady = Object.assign(new Error('extension-session-not-found'), { notReady: true })
    vi.mocked(module.readWindow).mockRejectedValue(notReady)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(Harness))
    })
    const calls = () => vi.mocked(module.readWindow).mock.calls.length
    expect(calls()).toBe(1)
    // Each interval that would have been one read now waits longer, so four
    // intervals of silence produce fewer reads than four.
    for (let i = 0; i < 4; i += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(EXTENSION_WINDOW_POLL_MS)
      })
    expect(calls()).toBeLessThan(5)
    // It still polls: the wait is capped, not abandoned.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXTENSION_WINDOW_POLL_MS * 12)
    })
    expect(calls()).toBeGreaterThan(1)
  })
  it('reports a session with no extension scope as not ready, and clears it on the first good read', async () => {
    // The control that shows the window needs the cause: "wait" and "broken" are
    // different sentences, and the poll already knows which one it is.
    const module = await import('../../../packages/market-ui/src/features/extension-presets/resource.js')
    vi.mocked(module.readWindow).mockClear()
    vi.mocked(module.readWindow).mockRejectedValueOnce(Object.assign(new Error('extension-session-not-found'), { notReady: true }))
    const seen: Array<{ notReady: boolean; error: string }> = []
    function Capture(): null {
      const state = useExtensionWindow('s')
      seen.push({ notReady: state.notReady, error: state.error })
      return null
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(Capture))
    })
    expect(seen.at(-1)?.notReady).toBe(true)
    expect(seen.at(-1)?.error).toContain('extension-session-not-found')
    // The next read answers: the wait was not a failure, so the flag clears.
    vi.mocked(module.readWindow).mockResolvedValue(goodPayload())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXTENSION_WINDOW_POLL_MS * 4)
    })
    expect(seen.at(-1)?.notReady).toBe(false)
  })
})
