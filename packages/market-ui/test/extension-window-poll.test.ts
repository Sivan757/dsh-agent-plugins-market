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
})
