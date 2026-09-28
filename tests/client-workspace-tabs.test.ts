// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// Each tab's surface is heavy; the tab-row contract under test needs only a
// marker naming which tab is mounted.
vi.mock('../src/client/features/market/MarketSection.js', () => ({
  MarketSection: (props: { mode?: string }) => h('output', { 'data-tab': 'market', 'data-mode': props.mode ?? 'settings' })
}))
vi.mock('../src/client/features/mcp/StatusPanel.js', () => ({ McpStatusPanel: () => h('output', { 'data-tab': 'mcp' }) }))
vi.mock('../src/client/features/lsp/LspStatusPanel.js', () => ({ LspStatusPanel: () => h('output', { 'data-tab': 'lsp' }) }))
vi.mock('../src/client/ui/UserPanelSurface.js', () => ({ UserPanelSurface: (props: { kind: string }) => h('output', { 'data-tab': props.kind }) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { PluginWorkspace } from '../src/client/workspace/PluginWorkspace.js'
import type { Translate } from '../src/client/index.js'

const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  window.location.hash = ''
  root = undefined
  host = undefined
})

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(PluginWorkspace, { t })))
}

/** The tab at its display position (market, skills, commands, personas, mcp, lsp). */
const tab = (index: number): HTMLButtonElement | null => host?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index] ?? null
const activePanelTab = (): Element | null => host?.querySelector('[role="tabpanel"] [data-tab]') ?? null

describe('PluginWorkspace tab row', () => {
  it('renders the host tablist with roving focus and opens the clicked tab in its panel', async () => {
    await mount()
    const tablist = host!.querySelector('[role="tablist"]')
    expect(tablist).not.toBeNull()
    expect(tablist!.getAttribute('aria-label')).toBe('workspaceTabMarket')
    expect(host!.querySelectorAll('[role="tab"]').length).toBe(6)
    // Exactly one tab stop: the selected tab only.
    expect(tab(0)?.getAttribute('aria-selected')).toBe('true')
    expect(host!.querySelectorAll('[role="tab"][tabindex="0"]').length).toBe(1)
    // The active surface renders inside the shared tabpanel.
    const panel = host!.querySelector('[role="tabpanel"]')
    expect(panel?.getAttribute('id')).toBe('agent-plugins-panel')
    expect(panel?.getAttribute('aria-labelledby')).toBe('agent-plugins-tab-market')
    expect(activePanelTab()?.getAttribute('data-tab')).toBe('market')

    await act(async () => tab(4)!.click())
    expect(activePanelTab()?.getAttribute('data-tab')).toBe('mcp')
  })

  it('writes the deep-link hash on click and follows a pasted #/agent-plugins/<tab> hash', async () => {
    await mount()
    await act(async () => tab(5)!.click())
    expect(window.location.hash).toBe('#/agent-plugins/lsp')

    await act(async () => {
      window.location.hash = '#/agent-plugins/skills'
      window.dispatchEvent(new Event('hashchange'))
    })
    expect(activePanelTab()?.getAttribute('data-tab')).toBe('skills')

    // An unknown hash leaves the active tab untouched.
    await act(async () => {
      window.location.hash = '#/agent-plugins/nonsense'
      window.dispatchEvent(new Event('hashchange'))
    })
    expect(activePanelTab()?.getAttribute('data-tab')).toBe('skills')
  })
})
