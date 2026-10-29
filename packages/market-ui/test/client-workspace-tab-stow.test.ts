// @vitest-environment jsdom

/**
 * The workspace tab-row contract after the stow rework.
 *
 * The row keeps every tab: the ones in use first, then a divider and the stowed group,
 * dimmed. Putting a tab away and bringing it back are one gesture each, and the guards
 * that keep the rail usable are stated where a reader will look for them.
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
let stored: { hidden: string[]; order?: string[] }
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
  stored = { hidden: [] }
  writeError = undefined
})

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function stubServer(initial: { hidden: string[]; order?: string[] } = { hidden: [] }): void {
  stored = initial
  const answer = () => ({ hidden: stored.hidden, order: stored.order ?? [...WORKSPACE_TAB_KEYS] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/tab-layout')) return json(200, answer())
      if (url.endsWith('/tab-layout/set')) {
        if (writeError !== undefined) return json(400, { ok: false, error: writeError })
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { hidden: string[] }
        stored = { ...stored, hidden: body.hidden }
        return json(200, { ok: true, ...answer() })
      }
      if (url.endsWith('/tab-layout/order')) {
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

const shown = (): string[] => [...(host?.querySelectorAll('[role="tab"][data-stowed="false"]') ?? [])].map(node => node.getAttribute('data-value') ?? '')
const stowed = (): string[] => [...(host?.querySelectorAll('[role="tab"][data-stowed="true"]') ?? [])].map(node => node.getAttribute('data-value') ?? '')
const activePanel = (): string | null => host?.querySelector('[role="tabpanel"] [data-tab]')?.getAttribute('data-tab') ?? null

async function key(k: string, altKey = false): Promise<void> {
  const target = document.activeElement ?? host!.querySelector('[role="tab"]')!
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey, bubbles: true }))
  })
  await flush()
}

describe('workspace tab stowing', () => {
  it('keeps the contract order and renders every tab', async () => {
    expect(TAB_ORDER).toBe(WORKSPACE_TAB_KEYS)
    stubServer()
    await mount()
    expect(shown()).toEqual([...WORKSPACE_TAB_KEYS])
    expect(stowed()).toEqual([])
  })

  it('moves a tab into the stowed group with Alt+ArrowDown and writes it', async () => {
    stubServer()
    await mount()
    const tab = host!.querySelector<HTMLElement>('[role="tab"][data-value="skills"]')!
    await act(async () => tab.focus())
    await key('ArrowDown', true)
    expect(shown()).not.toContain('skills')
    expect(stowed()).toContain('skills')
    expect(stored.hidden).toEqual(['skills'])
  })

  it('brings a stowed tab back by clicking it, and shows its panel', async () => {
    stubServer({ hidden: ['hooks'] })
    await mount()
    expect(stowed()).toEqual(['hooks'])
    const ghost = host!.querySelector<HTMLElement>('[role="tab"][data-value="hooks"]')!
    await act(async () => ghost.click())
    await flush()
    expect(shown()).toContain('hooks')
    expect(activePanel()).toBe('hooks')
    expect(stored.hidden).toEqual([])
  })

  it('never stows the pinned tab or the last one showing', async () => {
    stubServer({ hidden: WORKSPACE_TAB_KEYS.filter(key => key !== 'market') })
    await mount()
    expect(shown()).toEqual(['market'])
    const pinned = host!.querySelector<HTMLElement>('[role="tab"][data-value="market"]')!
    await act(async () => pinned.focus())
    await key('ArrowDown', true)
    expect(shown()).toEqual(['market'])
    expect(stored.hidden).toHaveLength(WORKSPACE_TAB_KEYS.length - 1)
  })

  it('puts a tab away when a drag ends past the divider', async () => {
    stubServer()
    await mount()
    const tab = host!.querySelector<HTMLElement>('[role="tab"][data-value="commands"]')!
    const divider = host!.querySelector<HTMLElement>('[role="separator"]')
    // jsdom boxes are zero-sized, so the geometry the gesture reads is stubbed.
    const box = { left: 40, right: 100, top: 0, bottom: 24, width: 60, height: 24, x: 40, y: 0, toJSON: () => ({}) }
    tab.getBoundingClientRect = () => box
    if (divider !== null) {
      const line = { left: 320, right: 321, top: 0, bottom: 24, width: 1, height: 24, x: 320, y: 0, toJSON: () => ({}) }
      divider.getBoundingClientRect = () => line
    }
    await act(async () => {
      tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 60, pointerType: 'mouse' }))
      tab.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 70, pointerType: 'mouse' }))
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 400, pointerType: 'mouse' }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 400, pointerType: 'mouse' }))
    })
    await flush()
    expect(stowed()).toContain('commands')
    expect(stored.hidden).toEqual(['commands'])
  })

  it('reverts the row and keeps the reason when the write fails', async () => {
    stubServer()
    await mount()
    writeError = 'boom'
    const tab = host!.querySelector<HTMLElement>('[role="tab"][data-value="skills"]')!
    await act(async () => tab.focus())
    await key('ArrowDown', true)
    expect(shown()).toContain('skills')
    expect(host!.textContent).toContain('tabLayoutWriteFailed')
  })

  it('reveals a stowed tab reached by a deep link without saving the reveal', async () => {
    stubServer({ hidden: ['mcp'] })
    window.location.hash = '#/agent-plugins/mcp'
    await mount()
    expect(activePanel()).toBe('mcp')
    expect(shown()).toContain('mcp')
    expect(stored.hidden).toEqual(['mcp'])
  })
})
