// @vitest-environment jsdom

/**
 * The workspace tab-row stowing contract.
 *
 * The row, the stowed-tabs menu and the tab manager are exercised through the
 * real workspace and the real fetch helpers: a stub server answers the two
 * tab-layout routes, so the tests see the same wire round trip the client makes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

// Each tab's surface is heavy; these tests need only a marker naming the panel.
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
import { WORKSPACE_TAB_KEYS } from '../../../packages/market-contracts/src/contracts/tab-layout.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined
/** The stub server's stored layout. */
let stored: { hidden: string[] }
/** When set, the write route answers this error instead of committing. */
let writeError: string | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  window.location.hash = ''
  vi.unstubAllGlobals()
  root = undefined
  host = undefined
  stored = { hidden: [] }
  writeError = undefined
})

function stubServer(initial: { hidden: string[] } = { hidden: [] }): void {
  stored = initial
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/tab-layout')) return json(200, stored)
      if (url.endsWith('/tab-layout/set')) {
        if (writeError !== undefined) return json(400, { ok: false, error: writeError })
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { hidden: string[] }
        stored = { hidden: body.hidden }
        return json(200, { ok: true, hidden: stored.hidden })
      }
      return json(404, { ok: false, error: 'not found' })
    })
  )
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(PluginWorkspace, { t })))
  // The layout read is one fetch; flush it so the row settles before assertions.
  await flush()
}

/** Let the pending layout promise chain run. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const trigger = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
const menuRows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
const chipLabels = (): string[] => [...(host?.querySelectorAll('[role="tab"]') ?? [])].map(node => node.textContent ?? '')
const activePanel = (): string | null => host?.querySelector('[role="tabpanel"] [data-tab]')?.getAttribute('data-tab') ?? null
const rowCheckbox = (key: string): HTMLInputElement | null => dialog()?.querySelector<HTMLInputElement>('[data-tab-stow-row="' + key + '"] input[type="checkbox"]') ?? null
const rowHint = (key: string): string => dialog()?.querySelector('[data-tab-stow-row="' + key + '"] > span:last-child')?.textContent ?? ''
const badge = (): string | null => document.querySelector('[class*="tabStowBadge"]')?.textContent ?? null

/** Open the trailing menu. */
async function openMenu(): Promise<void> {
  await act(async () => trigger()!.click())
}

/** Open the manage dialog through the menu. */
async function openManager(): Promise<void> {
  await openMenu()
  const manage = menuRows().find(row => row.textContent === 'tabMenuManage')
  if (manage === undefined) throw new Error('the manage row is not in the menu')
  await act(async () => manage.click())
}

/** Stow one tab through the manager's checkbox. */
async function stow(key: string): Promise<void> {
  const box = rowCheckbox(key)
  if (box === null) throw new Error('no checkbox for ' + key)
  await act(async () => box.click())
  await flush()
}

describe('workspace tab stowing', () => {
  it('reads its display order from the contract key list rather than a copy', async () => {
    // TAB_ORDER is WORKSPACE_TAB_KEYS, so one list owns the order. A copy would
    // let a tab exist in the contract and be missing from the row, which is a
    // tab the server accepts a stow for and the row cannot show.
    expect(TAB_ORDER).toBe(WORKSPACE_TAB_KEYS)
    expect(TAB_ORDER[0]).toBe('market')

    // Every tab in that one list renders a chip and a panel: the row is built
    // from it, so a tab with no panel would fail to compile instead of landing
    // here. This states the end-to-end shape the list promises.
    // The personas tab renders the shared user-panel surface for the agents
    // kind, so its panel marker names the kind rather than the tab.
    const panelOf: Record<string, string> = { personas: 'agents' }
    stubServer()
    await mount()
    expect(chipLabels()).toHaveLength(TAB_ORDER.length)
    for (const [index, key] of TAB_ORDER.entries()) {
      await act(async () => host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]!.click())
      expect(activePanel()).toBe(panelOf[key] ?? key)
    }
  })

  it('removes a stowed chip from the row, adds a menu row, and keeps display order', async () => {
    stubServer()
    await mount()
    expect(chipLabels()).toHaveLength(9)

    await openManager()
    await stow('commands')

    // The chip left the row and the rest kept their order.
    expect(chipLabels()).toEqual(TAB_ORDER.filter(key => key !== 'commands').map(key => String('workspaceTab' + key[0]!.toUpperCase() + key.slice(1))))
    // It is now in the menu, under the stowed heading, ahead of the manage row.
    await act(async () => dialog()!.querySelector<HTMLButtonElement>('[aria-label="tabManageDone"]')?.click())
    await openMenu()
    const labels = menuRows().map(row => row.textContent)
    expect(labels).toEqual(['workspaceTabCommands', 'tabMenuManage'])
    // The trigger counts it.
    expect(badge()).toBe('1')
    // The write reached the server.
    expect(stored.hidden).toEqual(['commands'])
  })

  it('activates a stowed tab chosen from the menu and renders its panel', async () => {
    stubServer({ hidden: ['hooks'] })
    await mount()
    // Stowed on load, so the chip is gone from the row.
    expect(chipLabels()).not.toContain('workspaceTabHooks')

    await openMenu()
    const row = menuRows().find(entry => entry.textContent === 'workspaceTabHooks')
    if (row === undefined) throw new Error('the stowed tab is not in the menu')
    await act(async () => row.click())
    await flush()

    // The panel matches, and the chip is back while it is the active tab.
    expect(activePanel()).toBe('hooks')
    expect(chipLabels()).toContain('workspaceTabHooks')
    // Following the row is not a layout change: nothing was written.
    expect(stored.hidden).toEqual(['hooks'])
  })

  it('moves the selection to the first visible tab when the active tab is stowed', async () => {
    stubServer()
    await mount()
    // The workspace opens on market, which is the pinned tab and is never
    // stowed, so activate a stowable tab before stowing it. It is the fourth
    // chip: market, instructions, outputStyles, skills.
    await act(async () => host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[3]!.click())
    expect(activePanel()).toBe('skills')

    await openManager()
    await stow('skills')

    // The row cannot keep a panel whose tab it does not render.
    expect(activePanel()).toBe('market')
    expect(chipLabels()[0]).toBe('workspaceTabMarket')
    expect(stored.hidden).toEqual(['skills'])
  })

  it('refuses to stow the pinned tab', async () => {
    stubServer()
    await mount()
    await openManager()
    // The manager's market row is the one control that never leaves the row.
    expect(rowCheckbox('market')?.checked).toBe(true)
    await stow('market')

    expect(chipLabels()).toHaveLength(9)
    expect(stored.hidden).toEqual([])
  })

  it('disables the control that would leave no visible tab and says why', async () => {
    stubServer()
    await mount()
    await openManager()

    // Stow everything the row may stow. Each step leaves at least one visible,
    // so each is accepted.
    for (const key of TAB_ORDER.filter(entry => entry !== 'market')) await stow(key)

    // Every other tab stowed, one visible: the last control is refused, not just clamped.
    expect(rowCheckbox('market')?.disabled).toBe(true)
    expect(rowCheckbox('market')?.checked).toBe(true)
    expect(rowHint('market')).toBe('tabManageLastVisibleHint')
    expect(stored.hidden).toEqual(WORKSPACE_TAB_KEYS.filter(key => key !== 'market'))
    expect(chipLabels()).toEqual(['workspaceTabMarket'])
  })

  it('keeps the pinned tab when a hand-written layout tries to stow everything', async () => {
    // A document naming every tab, the pinned one included, cannot empty the
    // row: the pinned key is dropped, so the row keeps exactly it.
    stubServer({ hidden: [...WORKSPACE_TAB_KEYS] })
    await mount()

    expect(chipLabels()).toEqual(['workspaceTabMarket'])
    expect(activePanel()).toBe('market')

    // An ordinary layout is honoured as written.
    stubServer({ hidden: ['skills'] })
    await act(async () => root!.unmount())
    root = undefined
    host?.remove()
    host = undefined
    await mount()
    expect(chipLabels()).toHaveLength(8)
    expect(chipLabels()).toContain('workspaceTabMarket')
    expect(chipLabels()).not.toContain('workspaceTabSkills')
  })

  it('keeps a deep link to a stowed tab working without saving the reveal', async () => {
    stubServer({ hidden: ['mcp'] })
    window.location.hash = '#/agent-plugins/mcp'
    await mount()

    // The hash won: its panel renders, and its chip is in the row although the
    // tab is stowed.
    expect(activePanel()).toBe('mcp')
    expect(chipLabels()).toContain('workspaceTabMcp')
    expect(window.location.hash).toBe('')
    // The saved layout never changed because of the link.
    expect(stored.hidden).toEqual(['mcp'])

    // Leaving the tab drops the reveal again.
    await act(async () => host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]!.click())
    await flush()
    expect(chipLabels()).not.toContain('workspaceTabMcp')
  })

  it('opens a stowed instructions tab from a deep link and renders its panel', async () => {
    stubServer({ hidden: ['instructions'] })
    window.location.hash = '#/agent-plugins/instructions'
    await mount()

    // A stowed tab is stowable like any other, and a link to it still selects
    // it: the panel renders and its chip joins the row for the visit.
    expect(activePanel()).toBe('instructions')
    expect(chipLabels()).toContain('workspaceTabInstructions')
    expect(window.location.hash).toBe('')
    // The reveal is derived, never saved.
    expect(stored.hidden).toEqual(['instructions'])

    await act(async () => host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]!.click())
    await flush()
    expect(chipLabels()).not.toContain('workspaceTabInstructions')
  })

  it('shows every tab again from the manager', async () => {
    stubServer({ hidden: ['mcp', 'lsp'] })
    await mount()
    expect(chipLabels()).toHaveLength(7)

    await openManager()
    const showAll = [...dialog()!.querySelectorAll('button')].find(button => button.textContent === 'tabManageShowAll')
    if (showAll === undefined) throw new Error('the show-all action is missing')
    await act(async () => showAll.click())
    await flush()

    expect(chipLabels()).toHaveLength(9)
    expect(stored.hidden).toEqual([])
  })

  it('reverts an optimistic stow when the write fails and reports it in the manager', async () => {
    stubServer()
    await mount()
    writeError = 'disk is full'
    await openManager()
    await stow('hooks')

    // The row is back to the confirmed layout, and the reason is where the user acted.
    expect(chipLabels()).toContain('workspaceTabHooks')
    expect(dialog()?.textContent).toContain('tabLayoutWriteFailed')
    expect(stored.hidden).toEqual([])
  })

  it('keeps the host walk keys over the visible tabs and the trigger outside the tablist', async () => {
    stubServer({ hidden: ['commands', 'lsp'] })
    await mount()

    // The trigger is not a child of the tablist, so it never joins the walk.
    const tablist = host!.querySelector('[role="tablist"]')
    expect(tablist).not.toBeNull()
    expect(tablist!.contains(trigger())).toBe(false)
    expect(trigger()!.getAttribute('aria-haspopup')).toBe('menu')

    // Exactly one tab stop, and the walk covers the seven visible chips.
    const chips = [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(chips.map(chip => chip.textContent)).toEqual([
      'workspaceTabMarket',
      'workspaceTabInstructions',
      'workspaceTabOutputStyles',
      'workspaceTabSkills',
      'workspaceTabPersonas',
      'workspaceTabMcp',
      'workspaceTabHooks'
    ])
    expect(host!.querySelectorAll('[role="tab"][tabindex="0"]').length).toBe(1)

    await act(async () => chips[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(activePanel()).toBe('instructions')
    await act(async () => chips[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    // End lands on the last VISIBLE chip, which is hooks, not the last declared tab.
    expect(activePanel()).toBe('hooks')
    await act(async () => chips[6]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(activePanel()).toBe('market')
  })

  it('keeps every tab visible when the layout read fails, and reports it in the manager', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(500, { ok: false, error: 'boom' }))
    )
    await mount()

    expect(chipLabels()).toHaveLength(9)
    await openManager()
    expect(dialog()?.textContent).toContain('tabLayoutLoadFailed')
  })
})
