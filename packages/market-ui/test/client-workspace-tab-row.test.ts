// @vitest-environment jsdom

/**
 * The workspace tab row.
 *
 * The row is a record of the workspace: every tab renders, in the stored order, and the
 * selected one carries the raised chip. Only sorting moves things, and only after a hold.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../../packages/market-ui/src/features/market/MarketSection.js', () => ({
  MarketSection: (props: { mode?: string }) => h('output', { 'data-tab': 'market', 'data-mode': props.mode ?? 'settings' })
}))
vi.mock('../../../packages/market-ui/src/features/mcp/StatusPanel.js', () => ({ McpStatusPanel: () => h('output', { 'data-tab': 'mcp' }) }))
vi.mock('../../../packages/market-ui/src/features/lsp/LspStatusPanel.js', () => ({ LspStatusPanel: () => h('output', { 'data-tab': 'lsp' }) }))
vi.mock('../../../packages/market-ui/src/features/hooks/StatusPanel.js', () => ({ HooksStatusPanel: () => h('output', { 'data-tab': 'hooks' }) }))
vi.mock('../../../packages/market-ui/src/ui/UserPanelSurface.js', () => ({ UserPanelSurface: (props: { kind: string }) => h('output', { 'data-tab': props.kind }) }))
vi.mock('../../../packages/market-ui/src/features/instructions/InstructionsPanel.js', () => ({ InstructionsPanel: () => h('output', { 'data-tab': 'instructions' }) }))
vi.mock('../../../packages/market-ui/src/features/output-styles/OutputStylesPanel.js', () => ({ OutputStylesPanel: () => h('output', { 'data-tab': 'outputStyles' }) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { PluginWorkspace, TAB_ORDER } from '../../../packages/market-ui/src/workspace/PluginWorkspace.js'
import { resetTabLayoutStore } from '../../../packages/market-ui/src/workspace/tab-layout-store.js'
import { WORKSPACE_TAB_KEYS } from '../../../packages/market-contracts/src/contracts/tab-layout.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined
let stored: { order?: string[] }
let writeError: string | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  resetTabLayoutStore()
  host?.remove()
  window.location.hash = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  root = undefined
  host = undefined
  stored = {}
  writeError = undefined
})

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function stubServer(initial: { order?: string[] } = {}): void {
  stored = initial
  const answer = () => ({ hidden: [], order: stored.order ?? [...WORKSPACE_TAB_KEYS] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/tab-layout')) return json(200, answer())
      if (url.endsWith('/tab-layout/set')) return json(200, { ok: true, ...answer() })
      if (url.endsWith('/tab-layout/order')) {
        if (writeError !== undefined) return json(400, { ok: false, error: writeError })
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { order: string[] }
        stored = { ...stored, order: body.order }
        return json(200, { ok: true, ...answer() })
      }
      return json(404, { ok: false, error: 'not found' })
    })
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(PluginWorkspace, { t })))
  await flush()
}

const tabs = (): string[] => [...(host?.querySelectorAll('[role="tab"]') ?? [])].map(node => node.getAttribute('data-value') ?? '')
const activePanel = (): string | null => host?.querySelector('[role="tabpanel"] [data-tab]')?.getAttribute('data-tab') ?? null

describe('workspace tab row', () => {
  it('renders every tab in the contract order', async () => {
    expect(TAB_ORDER).toBe(WORKSPACE_TAB_KEYS)
    stubServer()
    await mount()
    expect(tabs()).toEqual([...WORKSPACE_TAB_KEYS])
  })

  it('reads an authored order from the server', async () => {
    stubServer({ order: ['market', 'hooks', 'skills', 'commands', 'personas', 'mcp', 'lsp', 'outputStyles', 'instructions'] })
    await mount()
    expect(tabs()[1]).toBe('hooks')
    expect(tabs()[0]).toBe('market')
  })

  it('selects the clicked tab and renders its panel', async () => {
    stubServer()
    await mount()
    const hooks = host!.querySelector<HTMLElement>('[role="tab"][data-value="hooks"]')!
    await act(async () => hooks.click())
    expect(activePanel()).toBe('hooks')
    expect(hooks.getAttribute('aria-selected')).toBe('true')
  })

  // The reorder gesture itself is covered where it lives: tab-rail-drag.test.ts drives the
  // pointer and asserts the callback. Persistence is covered by the layout store's cases,
  // which are the ones that see the request. This file keeps the row's own contract.
})
