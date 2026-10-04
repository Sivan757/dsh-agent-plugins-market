// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { displayText } from '../src/client/ui/translated-text.js'
import type { Translate } from '../src/client/index.js'
import { en, zh } from '../src/client/locales.js'

/** Locale probes: the panel's own rule reads the active language from this key. */
const zhT: Translate = key => (key === 'localeProbeLang' ? '中文' : String(key))
const enT: Translate = key => (key === 'localeProbeLang' ? 'English' : String(key))

const api = vi.hoisted(() => ({
  fetchUserPanel: vi.fn(),
  createUserPanelEntry: vi.fn(),
  updateUserPanelEntry: vi.fn(),
  deleteUserPanelEntry: vi.fn(),
  fetchMcpStatus: vi.fn(),
  retryMcpMounts: vi.fn(),
  reauthorizeMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  setMcpServerTool: vi.fn(),
  fetchLspStatus: vi.fn(),
  setLspServerEnabled: vi.fn(),
  migrateLspSeam: vi.fn(),
  postAction: vi.fn(),
  fetchSuiteDetail: vi.fn()
}))
vi.mock('../src/client/api.js', () => api)
vi.mock('../src/client/features/market/market-resource.js', () => ({
  loadOverview: () => ({ initial: overview, revalidating: false, promise: Promise.resolve(overview) }),
  invalidateOverview: vi.fn(),
  startDescriptionRefresh: vi.fn(() => ({ stop: () => {} })),
  startSourceProgressPolling: vi.fn(() => ({ stop: () => {} }))
}))

const overview = {
  sources: [{ id: 'demo', url: undefined, branch: null, local: true, cloned: true, lockCommit: undefined, suiteIds: ['demo-suite'] }],
  suites: [
    {
      sourceId: 'demo',
      suiteId: 'demo-suite',
      name: 'Demo Suite',
      description: 'English description',
      translatedName: '示例套件',
      translatedDescription: '中文描述',
      version: '1.0.0',
      layout: 'agent-plugin-v1',
      dimension: 'user',
      installed: false,
      enabled: false,
      keywords: [],
      surfaces: { skills: 1, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
      errors: [],
      mcpErrors: []
    }
  ],
  totals: { all: 1, installed: 0, enabled: 0 },
  roots: { user: '', data: '' },
  unmanaged: []
}

import { UserPanelSurface } from '../src/client/ui/UserPanelSurface.js'
import { McpStatusPanel } from '../src/client/features/mcp/StatusPanel.js'
import { LspStatusPanel } from '../src/client/features/lsp/LspStatusPanel.js'
import { MarketSection } from '../src/client/features/market/MarketSection.js'

const ENTRY = {
  id: 'plugin:demo/reviewer',
  name: 'reviewer',
  description: 'Review implementation',
  translatedName: '审查者',
  translatedDescription: '审查实现',
  origin: 'plugin' as const,
  suiteName: 'Demo Suite',
  metadata: {},
  rawText: '',
  content: '',
  path: '/plugins/reviewer.md',
  disabled: false
}

const MCP_STATUS = {
  entries: [
    {
      id: 'plugin:demo/service',
      name: 'demo__service',
      translatedName: '连接器服务',
      kind: 'plugin' as const,
      state: 'connected' as const,
      source: 'Demo Suite',
      suiteId: 'demo',
      serverKey: 'service',
      transport: 'stdio',
      endpoint: 'node server.js',
      tools: [{ name: 'search', description: 'Search upstream', translatedDescription: '搜索上游' }]
    }
  ],
  observedAt: '',
  totals: { all: 1, connected: 1, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
}

const LSP_STATUS = {
  entries: [
    {
      id: 'plugin:demo/typescript',
      serverKey: 'typescript',
      translatedName: 'TypeScript 服务',
      suiteId: 'demo',
      suiteName: 'Demo Suite',
      sourceId: 'demo',
      kind: 'plugin' as const,
      command: 'typescript-language-server',
      args: ['--stdio'],
      extensions: { '.ts': 'typescript' },
      state: 'mounted' as const
    }
  ],
  observedAt: '',
  totals: { all: 1, mounted: 1, failed: 0, blocked: 0, disabled: 0 },
  hostMissing: false
}

let root: Root | undefined
let host: HTMLDivElement | undefined

/** Mount one surface into a fresh document and return its host element. */
async function mount(node: ReturnType<typeof h>): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  return host
}

/** The one switch a surface renders; its accessible name is the target view. */
function toggle(target: HTMLElement = host!): HTMLButtonElement | null {
  return target.querySelector<HTMLButtonElement>('[data-bilingual-toggle]')
}

/** Click the switch and let React commit the flip. */
async function flip(target: HTMLElement = host!): Promise<void> {
  const button = toggle(target)
  expect(button).not.toBeNull()
  await act(async () => button!.click())
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  vi.clearAllMocks()
})

describe('displayText with the authored-text view', () => {
  it('keeps the existing resolution when no view is asked for', () => {
    expect(displayText('译文', '原名', zhT)).toBe('译文')
    expect(displayText(undefined, '原名', zhT)).toBe('原名')
    expect(displayText(undefined, undefined, zhT)).toBeUndefined()
    expect(displayText('中文名 · English name', undefined, enT)).toBe('English name')
  })

  it('returns the authored text under the original view, translation or not', () => {
    expect(displayText('译文', '原名', zhT, { original: true })).toBe('原名')
    expect(displayText(undefined, '原名', zhT, { original: true })).toBe('原名')
    // A field nothing was translated for reads the same either way.
    expect(displayText(undefined, '原名', zhT, { original: true })).toBe(displayText(undefined, '原名', zhT))
    // A translation is never a fallback for the authored text.
    expect(displayText('译文', undefined, zhT, { original: true })).toBeUndefined()
  })

  it('still resolves the locale segment of an authored bilingual field', () => {
    expect(displayText('译文', '中文名 · English name', enT, { original: true })).toBe('English name')
    expect(displayText('译文', '中文名 · English name', zhT, { original: true })).toBe('中文名')
  })

  it('pairs the switch labels in both dictionaries', () => {
    for (const key of ['translationShowOriginal', 'translationShowTranslated'] as const) {
      expect(zh[key]).not.toBe('')
      expect(en[key]).not.toBe('')
    }
    expect(zh.translationShowOriginal).not.toBe(zh.translationShowTranslated)
    expect(en.translationShowOriginal).not.toBe(en.translationShowTranslated)
  })
})

describe('the panel text-view switch', () => {
  // One surface component renders skills, commands, and personas; each is a
  // face of its own, so each gets the switch.
  it.each(['skills', 'commands', 'agents'] as const)('flips the %s panel from translated to authored text, name and description together', async kind => {
    api.fetchUserPanel.mockResolvedValue([ENTRY])
    await mount(h(UserPanelSurface, { t: zhT, kind }))
    // A command keeps its bare call name: that identity is what the user types
    // and the slash menu matches, so the switch never rewrites it.
    if (kind === 'commands') expect(host!.textContent).toContain('reviewer')
    else expect(host!.textContent).toContain('审查者')
    expect(host!.textContent).toContain('审查实现')

    const button = toggle()!
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    expect(button.title).toBe('translationShowOriginal')
    expect(button.getAttribute('aria-label')).toBe('translationShowOriginal')
    expect(button.getAttribute('aria-pressed')).toBe('false')

    await flip()
    expect(host!.textContent).toContain('Review implementation')
    expect(host!.textContent).not.toContain('审查实现')
    // Commands show the call name in both views; the other kinds flip to it.
    expect(host!.textContent).toContain('reviewer')
    const back = toggle()!
    expect(back.title).toBe('translationShowTranslated')
    expect(back.getAttribute('aria-pressed')).toBe('true')

    // Reading the authored text is a display flip, not a translation request:
    // the panel reads its list once, and switching asks the server for nothing.
    expect(api.fetchUserPanel).toHaveBeenCalledTimes(1)

    await flip()
    expect(host!.textContent).toContain('审查实现')
    expect(api.fetchUserPanel).toHaveBeenCalledTimes(1)
  })

  it('flips the MCP panel, its detail dialog riding the same state', async () => {
    api.fetchMcpStatus.mockResolvedValue(MCP_STATUS)
    await mount(h(McpStatusPanel, { t: zhT }))
    expect(host!.textContent).toContain('连接器服务')
    // One list read at mount; the switch never asks the server for text.
    expect(api.fetchMcpStatus).toHaveBeenCalledTimes(1)

    // The detail dialog opens on the panel's current view and carries the same
    // switch: flipping it there flips the panel's cards behind it too.
    const card = host!.querySelector<HTMLElement>('[role="button"]')!
    await act(async () => card.click())
    expect(document.body.textContent).toContain('搜索上游')
    await flip(document.body)
    expect(document.body.textContent).toContain('Search upstream')
    expect(document.body.textContent).not.toContain('搜索上游')
    expect(host!.textContent).toContain('service')
    expect(host!.textContent).not.toContain('连接器服务')
    expect(api.fetchMcpStatus).toHaveBeenCalledTimes(1)
  })

  it('flips the LSP panel and its detail dialog', async () => {
    api.fetchLspStatus.mockResolvedValue(LSP_STATUS)
    await mount(h(LspStatusPanel, { t: zhT }))
    expect(host!.textContent).toContain('TypeScript 服务')

    await flip()
    expect(host!.textContent).toContain('typescript')
    expect(host!.textContent).not.toContain('TypeScript 服务')
    expect(api.fetchLspStatus).toHaveBeenCalledTimes(1)
  })

  it('flips the market cards and the suite detail together', async () => {
    await mount(h(MarketSection, { t: enT }))
    expect(host!.textContent).toContain('示例套件')
    expect(host!.textContent).toContain('中文描述')

    await flip()
    expect(host!.textContent).toContain('Demo Suite')
    expect(host!.textContent).toContain('English description')
    expect(host!.textContent).not.toContain('中文描述')

    // The suite detail renders the same view and flips the same state. Its own
    // read returns the same description, translated and authored.
    api.fetchSuiteDetail.mockResolvedValue({
      sourceId: 'demo',
      suiteId: 'demo-suite',
      name: 'Demo Suite',
      description: 'English description',
      translatedDescription: '中文描述',
      version: null,
      author: null,
      layout: 'agent-plugin-v1',
      dimension: 'user',
      installed: false,
      enabled: false,
      root: '/tmp/demo',
      updatedAt: null,
      skills: [],
      mcpServers: [],
      mcpErrors: [],
      mcpOverrides: {},
      commands: [],
      agents: [],
      hooks: { count: 0, entries: [] },
      lsp: { servers: [], raw: [] },
      errors: [],
      surfaceToggles: null
    })
    const card = host!.querySelector<HTMLElement>('article')!
    await act(async () => card.click())
    expect(document.body.textContent).toContain('English description')
    await flip(document.body)
    expect(document.body.textContent).toContain('中文描述')
    expect(document.body.textContent).not.toContain('English description')
  })
})
