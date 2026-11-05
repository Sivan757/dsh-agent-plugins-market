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

vi.mock('../../../packages/market-ui/src/api.js', () => ({
  fetchOverview: vi.fn().mockResolvedValue(overviewPayload),
  fetchSourceProgress: vi.fn().mockResolvedValue({ step: undefined, error: undefined }),
  fetchSuiteDetail: vi.fn(),
  fetchMcpStatus: vi.fn(),
  fetchSuiteDocument: vi.fn(),
  postAction: vi.fn().mockResolvedValue({})
}))

vi.mock('../../../packages/market-ui/src/features/market/market-resource.js', () => ({
  // Render seeds from the cached answer without starting a request; the mount
  // effect is the only reader. A double must answer both.
  peekOverview: vi.fn(() => ({ initial: overviewPayload, cached: true })),
  loadOverview: vi.fn(() => ({
    initial: overviewPayload,
    revalidating: false,
    promise: Promise.resolve(overviewPayload)
  })),
  invalidateOverview: vi.fn(),
  startSourceProgressPolling: vi.fn(() => ({ stop: () => {} }))
}))

import { MarketSection } from '../../../packages/market-ui/src/features/market/MarketSection.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

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
  const resource = await import('../../../packages/market-ui/src/features/market/market-resource.js')
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
  it('renders the description, source tabs, and suite cards after load', async () => {
    const el = await mountSection()
    const text = el.textContent ?? ''
    // The Market tab already names this page, so the header carries only the
    // description that says something the tab does not.
    expect(text).toContain('navDescription')
    expect(el.querySelector('[data-panel-header] h2')).toBeNull()
    expect(text).toContain('Demo Suite')
    expect(text).toContain('demo')
    expect(el.querySelector('article')).not.toBeNull()
  })

  it('drops the repeated heading but keeps the description row compact', async () => {
    const el = await mountSection()
    const header = el.querySelector('[data-panel-header]')
    expect(header).not.toBeNull()
    expect(header!.querySelector('h2')).toBeNull()
    expect(header!.querySelector('p')?.textContent).toBe('navDescription')
    // The 46px floor is sized for a title plus its description; a
    // description-only header must not carry that band of dead space.
    expect(header!.className).toContain('headerCompact')
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
    const postAction = (await import('../../../packages/market-ui/src/api.js')).postAction as ReturnType<typeof vi.fn>
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

  it('paints three edges: running, installed but off, and not installed at all', async () => {
    // An uninstalled suite used to wear the same grey "off" edge as a suite the
    // reader had switched off, so a market of 971 uninstalled suites read as a
    // wall of disabled ones. The three facts now have three chromes.
    const base = overviewPayload.suites[0]!
    await stubOverview({
      ...overviewPayload,
      suites: [
        { ...base, suiteId: 'running', name: 'Running Suite', installed: true, enabled: true },
        { ...base, suiteId: 'switched-off', name: 'Off Suite', installed: true, enabled: false },
        { ...base, suiteId: 'absent', name: 'Absent Suite', installed: false, enabled: false }
      ]
    })
    const el = await mountSection()
    const stateOf = (name: string): string | null => {
      const card = [...el.querySelectorAll<HTMLElement>('article')].find(node => (node.textContent ?? '').includes(name))
      return card?.getAttribute('data-resource-state') ?? null
    }
    expect(stateOf('Running Suite')).toBe('active')
    expect(stateOf('Off Suite')).toBe('disabled')
    expect(stateOf('Absent Suite')).toBe('absent')
    // Colour is not a state for everyone: each card says its state in words too.
    const stateWords = (name: string): string | null => {
      const card = [...el.querySelectorAll<HTMLElement>('article')].find(node => (node.textContent ?? '').includes(name))!
      return card.querySelector('[class*="srOnly"]')?.textContent ?? null
    }
    expect(stateWords('Running Suite')).toBe('enabledLabel')
    expect(stateWords('Off Suite')).toBe('disabledLabel')
    expect(stateWords('Absent Suite')).toBe('notInstalledLabel')
  })

  it('gives each source pill its label width, capped, so two long ids stay distinguishable', async () => {
    // Equal-width cells truncated `claude-code-plugins-plus-skills` and
    // `claude-code-workflows` to the same stump; an id is how a reader picks a
    // source, so the pill takes its label's width up to a cap.
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('packages/market-ui/src/ui/source-strip.module.css', 'utf8')
    const rowRule = /\.sourceTabsRow \{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rowRule).toMatch(/display: flex/)
    expect(rowRule).toMatch(/flex-wrap: wrap/)
    expect(css).not.toMatch(/minmax\(118px/)
    expect(css).toMatch(/max-width: 220px/)
  })

  it('renders the selected source chip with reachable edit and delete controls', async () => {
    // The selected chip renders with .srcTabOn (not .srcTab), so the hover-reveal
    // selector must cover both classes — the regression that hid the ✎/× plate.
    const el = await mountSection()
    // Select the demo source chip: its main button carries the chip id.
    const chipButton = [...el.querySelectorAll('button')].find(button => (button.textContent ?? '').startsWith('demo '))
    expect(chipButton).toBeDefined()
    await act(async () => {
      chipButton!.click()
    })
    const chip = [...el.querySelectorAll('[class]')].find(node => node.className.includes('srcTabOn'))
    expect(chip).toBeDefined()
    // The plate must exist with both controls, reachable inside the chip.
    const plate = chip!.querySelector('[class*=srcTabControls]')
    expect(plate).not.toBeNull()
    expect(plate!.querySelectorAll('button')).toHaveLength(2)
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
    // Scoped to the source strip: the toolbar's own status filter segment now
    // sits in the host's tablist, and its "All" label would match the same text.
    const chips = (): string[] =>
      [...host!.querySelectorAll('button')]
        .filter(button => button.closest('[role="tablist"]') === null)
        .map(button => button.textContent ?? '')
        .filter(text => text.startsWith('tabAll ') || text.startsWith('alpha') || text.startsWith('zeta'))
    expect(chips()).toEqual(['tabAll 1', 'alpha 0', 'zeta 0'])

    // The picked source moves next to 全部 so the folded strip still shows it.
    const zeta = [...host!.querySelectorAll('button')].find(button => (button.textContent ?? '').startsWith('zeta'))
    act(() => {
      zeta!.click()
    })
    expect(chips()).toEqual(['tabAll 1', 'zeta 0', 'alpha 0'])
  })

  it('cuts the market by state, and leaves the uninstalled suites under 全部', async () => {
    // Every row here is a suite, so the face draws the two state cuts and no
    // provider cut: a suite that is switched on and one that is switched off
    // are two lists a reader asks for separately.
    const base = overviewPayload.suites[0]!
    await stubOverview({
      ...overviewPayload,
      suites: [
        { ...base, suiteId: 'running', name: 'Running Suite', installed: true, enabled: true },
        { ...base, suiteId: 'switched-off', name: 'Off Suite', installed: true, enabled: false },
        { ...base, suiteId: 'absent', name: 'Absent Suite', installed: false, enabled: false }
      ]
    })
    const el = await mountSection()
    const tabs = (): string[] => [...el.querySelectorAll('[role="tab"]')].map(tab => tab.textContent ?? '')
    expect(tabs()).toContain('filterAll 3')
    expect(tabs()).toContain('enabledLabel 1')
    expect(tabs()).toContain('disabledLabel 1')

    // The uninstalled suite is listed but not here yet: it belongs to neither
    // state cut, so it stays visible under 全部 and in no other cut.
    const enabled = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => (tab.textContent ?? '').startsWith('enabledLabel'))
    expect(enabled).toBeDefined()
    await act(async () => {
      enabled?.click()
    })
    expect(el.textContent ?? '').toContain('Running Suite')
    expect(el.textContent ?? '').not.toContain('Absent Suite')
  })

  it('offers the uninstall on the card, and the click only opens the risk acknowledgement', async () => {
    // The card is the entry point to the uninstall again, the way it was
    // before the one-renderer refactor: a hover-revealed danger button beside
    // the refresh action. The click opens the page's own acknowledgement and
    // removes nothing by itself.
    const base = overviewPayload.suites[0]!
    await stubOverview({
      ...overviewPayload,
      suites: [{ ...base, installed: true, enabled: true }]
    })
    const el = await mountSection()
    const card = [...el.querySelectorAll('article')].find(node => (node.textContent ?? '').includes('Demo Suite'))
    expect(card).toBeDefined()
    // The accessible name says the verb and the row; the tooltip is the bare
    // verb, because the row it acts on is already on screen.
    const trash = [...card!.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? '').startsWith('uninstall'))
    expect(trash).toBeDefined()
    expect(trash!.getAttribute('aria-label')).toBe('uninstall Demo Suite')
    expect(trash!.getAttribute('title')).toBe('uninstall')
    // The shared renderer paints a destructive action in its danger hover.
    expect(trash!.className).toMatch(/iconBtnDanger/)
    // The refresh action beside it carries the same two shapes.
    const refresh = [...card!.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? '').startsWith('refresh'))
    expect(refresh!.getAttribute('aria-label')).toBe('refresh Demo Suite')
    expect(refresh!.getAttribute('title')).toBe('refresh')
    await act(async () => {
      trash!.click()
    })
    expect(document.body.textContent ?? '').toContain('uninstallAcknowledge')
    const api = await import('../../../packages/market-ui/src/api.js')
    expect(vi.mocked(api.postAction)).not.toHaveBeenCalled()

    // The suite goes only when the reader acknowledges the risk and confirms.
    const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
    await act(async () => {
      checkbox?.click()
    })
    const confirm = [...document.body.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('confirmDelete'))
    expect(confirm).toBeDefined()
    expect(confirm!.disabled).toBe(false)
    await act(async () => {
      confirm!.click()
    })
    expect(vi.mocked(api.postAction)).toHaveBeenCalledWith('uninstall', { sourceId: 'demo', suiteId: 'demo-suite' })
  })
})
