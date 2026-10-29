// @vitest-environment jsdom

/**
 * The two market surfaces render one tab list.
 *
 * The preset manager opens inside the workspace, so both rows are mounted at
 * once and both read the shared store. These cases pin the two halves of that:
 * they agree about a layout the server already holds, and a change made from one
 * row is visible in the other without a remount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../../packages/market-ui/src/features/market/MarketSection.js', () => ({ MarketSection: () => h('output', { 'data-tab': 'market' }) }))
vi.mock('../../../packages/market-ui/src/features/mcp/StatusPanel.js', () => ({ McpStatusPanel: () => h('output', { 'data-tab': 'mcp' }) }))
vi.mock('../../../packages/market-ui/src/features/lsp/LspStatusPanel.js', () => ({ LspStatusPanel: () => h('output', { 'data-tab': 'lsp' }) }))
vi.mock('../../../packages/market-ui/src/features/hooks/StatusPanel.js', () => ({ HooksStatusPanel: () => h('output', { 'data-tab': 'hooks' }) }))
vi.mock('../../../packages/market-ui/src/ui/UserPanelSurface.js', () => ({ UserPanelSurface: (props: { kind: string }) => h('output', { 'data-tab': props.kind }) }))
vi.mock('../../../packages/market-ui/src/features/instructions/InstructionsPanel.js', () => ({ InstructionsPanel: () => h('output', { 'data-tab': 'instructions' }) }))
vi.mock('../../../packages/market-ui/src/features/output-styles/OutputStylesPanel.js', () => ({ OutputStylesPanel: () => h('output', { 'data-tab': 'outputStyles' }) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { PluginWorkspace } from '../../../packages/market-ui/src/workspace/PluginWorkspace.js'
import { applyTabMove, resetTabLayoutStore } from '../../../packages/market-ui/src/workspace/tab-layout-store.js'
import { ResourceList } from '../../../packages/market-ui/src/features/extension-presets/ResourceList.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

const t = ((key: string) => String(key)) as unknown as Translate
const ORDER = ['market', 'instructions', 'outputStyles', 'skills', 'commands', 'personas', 'mcp', 'lsp', 'hooks']

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  resetTabLayoutStore()
  host?.remove()
  vi.unstubAllGlobals()
  root = undefined
  host = undefined
})

function json(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body }
}

/** One stub server for both surfaces: they share the layout routes, not a pair of fakes. */
function stubServer(hidden: string[], order: string[] = ORDER): void {
  let stored = { hidden, order }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/tab-layout')) return json(200, stored)
      if (url.endsWith('/tab-layout/set')) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { hidden: string[] }
        stored = { ...stored, hidden: body.hidden }
        return json(200, { ok: true, ...stored })
      }
      if (url.endsWith('/tab-layout/order')) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { order: string[] }
        stored = { ...stored, order: body.order }
        return json(200, { ok: true, ...stored })
      }
      return json(404, { ok: false, error: 'unexpected ' + url })
    })
  )
}

/** Labels of one row's tabs, split by whether they are stowed. */
function labelsOf(list: Element | undefined): string[] {
  if (list === undefined) return []
  return [...list.querySelectorAll('[role="tab"]')].map(tab => (tab.textContent ?? '').trim())
}
/** The workspace row: the only list whose active tab is the market one. */
const workspaceList = (): Element | undefined => [...document.querySelectorAll('[role="tablist"]')].find(list => (list.textContent ?? '').includes('workspaceTabMarket'))
/** The preset manager row: the only one that renders its own hooks tab label. */
const presetList = (): Element | undefined => [...document.querySelectorAll('[role="tablist"]')].find(list => (list.textContent ?? '').includes('epHooksTab'))
const visibleRow = (): string[] => labelsOf(workspaceList())
const presetVisible = (): string[] => labelsOf(presetList())

async function mountBoth(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      h(
        'div',
        null,
        h(PluginWorkspace, { t }),
        h(ResourceList, { resources: [], ids: [], disabled: false, t: t as never, showOriginal: false, onToggleShowOriginal: () => {}, onToggle: () => {}, onView: () => {} })
      )
    )
  })
  // The layout read resolves on the microtask queue; let it land before asserting.
  await act(async () => {
    await Promise.resolve()
  })
}

describe('shared tab layout', () => {
  it('renders both rows from one layout order', async () => {
    // An authored order with skills second: both surfaces read the same document, so the
    // face they share has to sit in the same place on each.
    stubServer([], ['market', 'skills', 'instructions', 'outputStyles', 'commands', 'personas', 'mcp', 'lsp', 'hooks'])
    await mountBoth()
    expect(visibleRow().slice(0, 3)).toEqual(['workspaceTabMarket', 'workspaceTabSkills', 'workspaceTabInstructions'])
    expect(presetVisible().slice(0, 2)).toEqual(['workspaceTabMarket', 'workspaceTabSkills'])
  })

  it('shows an order change made in one row in the other without a remount', async () => {
    stubServer([], ['market', 'skills', 'instructions', 'outputStyles', 'commands', 'personas', 'mcp', 'lsp', 'hooks'])
    await mountBoth()
    await act(async () => {
      await applyTabMove('hooks', 'skills', () => 'write failed')
    })
    expect(visibleRow().indexOf('workspaceTabHooks')).toBeLessThan(visibleRow().indexOf('workspaceTabSkills'))
    expect(presetVisible().indexOf('epHooksTab')).toBeGreaterThan(-1)
  })
})
