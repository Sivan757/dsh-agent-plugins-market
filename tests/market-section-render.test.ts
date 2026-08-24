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

describe('MarketSection rendering', () => {
  it('renders the section title, source tabs, and suite cards after load', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(MarketSection, { t, mode: 'settings' }))
    })
    // Allow the async refresh() to resolve.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const text = host.textContent ?? ''
    expect(text).toContain('nav')
    expect(text).toContain('Demo Suite')
    expect(text).toContain('demo')
    expect(host.querySelector('article')).not.toBeNull()
  })

  it('renders the add-source and refresh controls in the header', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(MarketSection, { t, mode: 'page' }))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const buttons = host.querySelectorAll('header button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })
})
