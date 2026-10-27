// @vitest-environment jsdom
/**
 * One Market mount issues one overview read.
 *
 * The regression this counts: the component seeded its state from a render-time
 * read and then invalidated that read in its mount effect, so the render-time
 * request was discarded and a second one replaced it. Every visit to the Market
 * tab paid two round trips for one answer, and the module cache never survived a
 * remount because the mount itself cleared it.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const payload = vi.hoisted(() => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '', data: '' }, unmanaged: [] }))
const gets = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../../packages/market-ui/src/api.js', () => ({
  fetchOverview: vi.fn(() => {
    gets.count += 1
    return Promise.resolve(payload)
  }),
  fetchSourceProgress: vi.fn().mockResolvedValue({ step: undefined, error: undefined }),
  fetchSuiteDetail: vi.fn(),
  fetchMcpStatus: vi.fn(),
  fetchSuiteDocument: vi.fn(),
  postAction: vi.fn().mockResolvedValue({})
}))

import { MarketSection } from '../../../packages/market-ui/src/features/market/MarketSection.js'
import { invalidateOverview } from '../../../packages/market-ui/src/features/market/market-resource.js'

const t = ((key: string) => key) as never
let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  invalidateOverview()
  vi.clearAllMocks()
})

/** Mount the real section and let its mount effect settle. */
async function mount(): Promise<void> {
  if (host === undefined) {
    host = document.createElement('div')
    document.body.append(host)
  }
  root = createRoot(host)
  await act(async () => root!.render(h(MarketSection, { t })))
  await act(async () => {
    await Promise.resolve()
  })
}

describe('market overview reads', () => {
  it('reads once on a first mount and once on a remount', async () => {
    gets.count = 0
    await mount()
    expect(gets.count).toBe(1)

    await act(async () => root!.unmount())
    const afterFirst = gets.count
    await mount()
    // The remount revalidates the answer it already had instead of starting a
    // second read beside it, and it does not throw the cache away first.
    expect(gets.count).toBe(afterFirst + 1)
  })

  it('paints the cached answer before the revalidating read lands', async () => {
    await mount()
    await act(async () => root!.unmount())

    // The remount starts with an answer, so it must not report itself as loading
    // from empty: the module cache is what makes the first paint instant.
    root = createRoot(host!)
    await act(async () => root!.render(h(MarketSection, { t })))
    const rendered = host!.textContent ?? ''
    expect(rendered).not.toContain('marketLoading')
  })
})
