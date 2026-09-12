// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const overviewPayload = vi.hoisted(() => ({
  sources: [
    {
      id: 'demo',
      url: 'https://example.com/demo.git',
      branch: null,
      local: false,
      cloned: true,
      lockCommit: 'f0e9fdf066c1',
      suiteIds: ['demo-suite']
    }
  ],
  suites: [
    {
      sourceId: 'demo',
      suiteId: 'demo-suite',
      name: 'Demo Suite',
      description: 'A demo suite for rendering tests',
      version: '1.0.0',
      layout: 'agent-plugin-v1',
      dimension: 'user',
      installed: false,
      enabled: false,
      remoteUrl: undefined,
      keywords: ['demo'],
      surfaces: { skills: 2, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
      errors: [],
      mcpErrors: []
    }
  ],
  totals: { all: 1, installed: 0 }
}))

vi.mock('../src/client/api.js', () => ({
  fetchOverview: vi.fn().mockResolvedValue(overviewPayload),
  fetchSourceProgress: vi.fn().mockResolvedValue({ step: undefined, error: undefined }),
  fetchSuiteDetail: vi.fn(),
  fetchMcpStatus: vi.fn(),
  fetchSkillContent: vi.fn(),
  postAction: vi.fn().mockResolvedValue({})
}))

vi.mock('../src/client/features/market/market-resource.js', () => ({
  loadOverview: vi.fn(() => ({
    initial: overviewPayload,
    revalidating: false,
    promise: Promise.resolve(overviewPayload)
  })),
  invalidateOverview: vi.fn(),
  startSourceProgressPolling: vi.fn(() => ({ stop: () => {} }))
}))

import { MarketSection } from '../src/client/MarketSection.js'
import type { Translate } from '../src/client/index.js'

// A permissive translate that returns the key — enough to render labels.
const t: Translate = (key, params) => {
  if (params !== undefined && 'sourceId' in params) return String(params['sourceId'])
  return String(key)
}

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
})

/** Mount the section and flush the initial async refresh. */
async function mountSection(): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(h(MarketSection, { t, mode: 'settings' }))
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return host
}

/** Point the mocked overview resource at a payload before the section mounts. */
async function stubOverview(payload: unknown): Promise<void> {
  const resource = await import('../src/client/features/market/market-resource.js')
  vi.mocked(resource.loadOverview).mockReturnValue({ initial: payload as never, revalidating: false, promise: Promise.resolve(payload as never) })
}

/** The suite card's install button; scoped to the card because the toolbar's own "uninstalled" filter label also contains the substring `install`. */
function installButton(): HTMLButtonElement {
  const buttons = [...host!.querySelectorAll<HTMLButtonElement>('article button')].filter(button => (button.textContent ?? '').includes('install'))
  expect(buttons.length).toBe(1)
  const [button] = buttons
  if (button === undefined) throw new Error('expected exactly one suite card install button')
  return button
}

describe('MarketSection rendering', () => {
  it('renders the section title, source tabs, and suite cards after load', async () => {
    const el = await mountSection()
    const text = el.textContent ?? ''
    expect(text).toContain('nav')
    expect(text).toContain('Demo Suite')
    expect(text).toContain('demo')
    expect(el.querySelector('article')).not.toBeNull()
  })

  it('renders the add-source and refresh controls in the header', async () => {
    await mountSection()
    const buttons = host!.querySelectorAll('header button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('opens the install confirmation dialog and does NOT install on cancel', async () => {
    await mountSection()

    const install = installButton()
    const probe = vi.fn()
    install.addEventListener('click', probe)
    act(() => install.click())
    expect(probe).toHaveBeenCalledTimes(1)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // The confirmation dialog appears with the surface tags and risk notice.
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).toContain('installConfirmTitle')
    expect(bodyText).toContain('surfaceMcp 1')
    // The locked source commit is shown before confirming.
    expect(bodyText).toContain('f0e9fdf066c1')

    // Click 取消 (the ghost cancel button) — no install action may fire.
    const cancelButton = [...document.body.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('cancel'))
    expect(cancelButton).toBeDefined()
    act(() => {
      cancelButton!.click()
    })
    const postAction = (await import('../src/client/api.js')).postAction as ReturnType<typeof vi.fn>
    expect(postAction).not.toHaveBeenCalledWith('install', expect.anything())
  })

  it('shows the local-working-tree note when the source has no locked commit', async () => {
    await stubOverview({ ...overviewPayload, sources: [{ ...overviewPayload.sources[0], lockCommit: undefined, local: true }] })
    await mountSection()
    act(() => installButton().click())
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).toContain('installConfirmLocalTree')
    expect(bodyText).not.toContain('f0e9fdf066c1')
  })

  it('renders an adopted source like any other chip, without an adoption badge', async () => {
    await stubOverview({
      ...overviewPayload,
      sources: [
        { ...overviewPayload.sources[0], adopted: true },
        { ...overviewPayload.sources[0], id: 'second', url: 'https://example.com/second.git', suiteIds: [] }
      ]
    })
    const el = await mountSection()
    const text = el.textContent ?? ''
    // jsdom reports no content height, so the strip never folds and every chip renders.
    expect(text).toContain('demo')
    expect(text).toContain('second')
    // The translate stub echoes keys, so a rendered badge would surface as `sourceAdopted`.
    expect(text).not.toContain('sourceAdopted')
  })

  it('moves the picked source next to 全部 and leaves the rest in id order', async () => {
    await stubOverview({
      ...overviewPayload,
      sources: [
        { ...overviewPayload.sources[0], id: 'zeta', url: 'https://example.com/zeta.git', suiteIds: [] },
        { ...overviewPayload.sources[0], id: 'alpha', url: 'https://example.com/alpha.git', suiteIds: [] }
      ]
    })
    await mountSection()
    const chips = (): string[] =>
      [...host!.querySelectorAll('button')]
        .map(button => button.textContent ?? '')
        // The toolbar's own status filters read `tabAll<n>` without the space.
        .filter(text => text.startsWith('tabAll ') || text.startsWith('alpha') || text.startsWith('zeta'))
    expect(chips()).toEqual(['tabAll 1', 'alpha 0', 'zeta 0'])

    // The picked source moves next to 全部 so the folded strip still shows it.
    const zeta = [...host!.querySelectorAll('button')].find(button => (button.textContent ?? '').startsWith('zeta'))
    act(() => {
      zeta!.click()
    })
    expect(chips()).toEqual(['tabAll 1', 'zeta 0', 'alpha 0'])
  })
})
