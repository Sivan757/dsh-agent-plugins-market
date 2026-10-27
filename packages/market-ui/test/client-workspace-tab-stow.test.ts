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
import { TAB_HOVER_ARM_MS, TAB_HOVER_DISMISS_MS, TAB_HOVER_GUIDE_MS } from '../../../packages/market-ui/src/workspace/TabHoverActions.js'
import { WORKSPACE_TAB_KEYS } from '../../../packages/market-contracts/src/contracts/tab-layout.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined
/** The stub server's stored layout. */
let stored: { hidden: string[]; order?: string[] }
/** When set, the write route answers this error instead of committing. */
let writeError: string | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  window.location.hash = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  root = undefined
  host = undefined
  stored = { hidden: [] }
  writeError = undefined
})

function stubServer(initial: { hidden: string[]; order?: string[] } = { hidden: [] }): void {
  stored = initial
  const answer = (): { hidden: string[]; order: string[] } => ({ hidden: stored.hidden, order: stored.order ?? [...WORKSPACE_TAB_KEYS] })
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
        if (writeError !== undefined) return json(400, { ok: false, error: writeError })
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { order: string[] }
        stored = { ...stored, order: body.order }
        return json(200, { ok: true, ...answer() })
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
// The count is the trailing control's own content: no badge stacked on a glyph,
// the number is what the row's edge shows.
const badge = (): string | null => document.querySelector('[class*="tabStowCount"]')?.textContent ?? null

/** The long-hover actions bubble, when one is armed. */
const bubble = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-tab-hover]')
/** The bubble's buttons, in rendered order: left, right, stow, open the list. */
const bubbleButtons = (): HTMLButtonElement[] => [...(bubble()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]

/** Rest the pointer on the tab at one position and let the arm delay pass. */
async function restOn(index: number): Promise<void> {
  const tab = host!.querySelectorAll('[role="tab"]')[index]!
  await act(async () => {
    tab.dispatchEvent(new Event('pointerover', { bubbles: true }))
  })
  await act(async () => {
    vi.advanceTimersByTime(TAB_HOVER_ARM_MS)
  })
}

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

/** The manager's move buttons for one tab, in rendered order. */
const moveButtons = (key: string): HTMLButtonElement[] => [...(dialog()?.querySelectorAll<HTMLButtonElement>('[data-tab-stow-row="' + key + '"] button') ?? [])]

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

  it('reorders the row from the manager and persists the new order', async () => {
    stubServer()
    await mount()
    const start = chipLabels()
    expect(start.slice(0, 3)).toEqual(['workspaceTabMarket', 'workspaceTabInstructions', 'workspaceTabOutputStyles'])

    await openManager()
    // Move the third chip one place left, then one place right: the same pair of
    // buttons has to work in both directions or a move cannot be undone.
    await act(async () => moveButtons('outputStyles')[0]!.click())
    await flush()
    expect(chipLabels().slice(0, 3)).toEqual(['workspaceTabMarket', 'workspaceTabOutputStyles', 'workspaceTabInstructions'])
    expect(stored.order?.slice(0, 3)).toEqual(['market', 'outputStyles', 'instructions'])

    await act(async () => moveButtons('outputStyles')[1]!.click())
    await flush()
    expect(chipLabels().slice(0, 3)).toEqual(start.slice(0, 3))
  })

  it('offers no move buttons for a stowed tab', async () => {
    stubServer({ hidden: ['commands'] })
    await mount()

    await openManager()
    // Reordering acts on the rendered row, so a stowed tab has no target: the
    // arrows would have to lie about where an invisible chip lands.
    expect(moveButtons('commands')).toHaveLength(0)
    expect(moveButtons('skills')).toHaveLength(2)
    // The pinned tab is the row's floor, so it cannot move at all.
    expect(moveButtons('market')).toHaveLength(0)
  })

  it('keeps a stowed tab in place when a visible one moves', async () => {
    stubServer({ hidden: ['commands'] })
    await mount()
    await openManager()

    await act(async () => moveButtons('skills')[0]!.click())
    await flush()

    // The visible chip moved one slot; the stowed tab kept its own, so it comes
    // back where it was rather than at the end.
    expect(stored.order?.indexOf('commands')).toBe(WORKSPACE_TAB_KEYS.indexOf('commands'))
  })

  it('moves a tab with Alt and an arrow key, and leaves the walk keys alone', async () => {
    stubServer()
    await mount()
    const start = chipLabels()
    const second = host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!

    await act(async () => second.focus())
    // A plain arrow is the host tab walk, so sorting needs the modifier.
    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(chipLabels()).toEqual(start)

    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }))
    })
    await flush()
    expect(chipLabels().slice(0, 3)).toEqual(['workspaceTabMarket', 'workspaceTabOutputStyles', 'workspaceTabInstructions'])
    expect(stored.order?.slice(0, 3)).toEqual(['market', 'outputStyles', 'instructions'])

    // The pinned tab stays first: a left move on the second chip is a no-op.
    await act(async () => {
      host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))
    })
    await flush()
    expect(chipLabels()[0]).toBe('workspaceTabMarket')
  })

  it('keeps the confirmed order when the reorder write fails', async () => {
    stubServer()
    await mount()
    const start = chipLabels()
    await openManager()

    writeError = 'disk is full'
    await act(async () => moveButtons('outputStyles')[0]!.click())
    await flush()

    // The row goes back to what the server has, and the reason is visible.
    expect(chipLabels()).toEqual(start)
    expect(dialog()?.textContent).toContain('tabLayoutWriteFailed')
  })

  it('does not open the actions bubble before the pointer has rested', async () => {
    stubServer()
    await mount()
    vi.useFakeTimers()

    const tab = host!.querySelectorAll('[role="tab"]')[1]!
    await act(async () => {
      tab.dispatchEvent(new Event('pointerover', { bubbles: true }))
    })
    // Crossing the row must not open anything: only a pause does.
    await act(async () => {
      vi.advanceTimersByTime(TAB_HOVER_ARM_MS - 60)
    })
    expect(bubble()).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(60)
    })
    expect(bubble()).not.toBeNull()
  })

  it('offers move, stow and the full list in the bubble above a rested tab', async () => {
    stubServer()
    await mount()
    vi.useFakeTimers()

    await restOn(2)
    expect(bubble()?.getAttribute('data-tab-hover')).toBe('outputStyles')
    expect(bubbleButtons()).toHaveLength(4)
    // The second visible tab can move both ways; the arrows are the same pair
    // the manager offers, so a pointer user never learns a second gesture.
    expect(bubbleButtons()[0]!.disabled).toBe(false)
    expect(bubbleButtons()[1]!.disabled).toBe(false)

    await act(async () => bubbleButtons()[1]!.click())
    await flush()
    expect(chipLabels().slice(0, 4)).toEqual(['workspaceTabMarket', 'workspaceTabInstructions', 'workspaceTabSkills', 'workspaceTabOutputStyles'])
    expect(stored.order?.slice(0, 4)).toEqual(['market', 'instructions', 'skills', 'outputStyles'])
    // Acting on the bubble closes it, so it cannot describe a stale row.
    expect(bubble()).toBeNull()
  })

  it('disables the arrow that would move a tab past the pinned one', async () => {
    stubServer()
    await mount()
    vi.useFakeTimers()

    await restOn(1)
    // The chip beside the pinned tab has nowhere to go left: the pinned tab owns
    // the first column in every layout.
    expect(bubbleButtons()[0]!.disabled).toBe(true)
    expect(bubbleButtons()[1]!.disabled).toBe(false)

    const last = host!.querySelectorAll('[role="tab"]')
    await restOn(last.length - 1)
    expect(bubbleButtons()[1]!.disabled).toBe(true)
  })

  it('stows the tab the bubble belongs to, and drops its chip', async () => {
    stubServer()
    await mount()
    vi.useFakeTimers()

    await restOn(3)
    const stowed_key = bubble()?.getAttribute('data-tab-hover')
    expect(stowed_key).toBe('skills')
    await act(async () => bubbleButtons()[2]!.click())
    await flush()

    expect(chipLabels()).not.toContain('workspaceTabSkills')
    expect(stored.hidden).toEqual(['skills'])
    expect(bubble()).toBeNull()
  })

  it('opens the manager from the bubble, where every tab is listed', async () => {
    stubServer()
    await mount()
    vi.useFakeTimers()

    await restOn(2)
    await act(async () => bubbleButtons()[3]!.click())
    await flush()

    expect(bubble()).toBeNull()
    expect(dialog()).not.toBeNull()
    expect(dialog()?.querySelectorAll('input[type="checkbox"]')).toHaveLength(9)
  })

  it('never opens the bubble on the pinned tab', async () => {
    stubServer()
    await mount()
    vi.useFakeTimers()

    const pinned = host!.querySelectorAll('[role="tab"]')[0]!
    await act(async () => {
      pinned.dispatchEvent(new Event('pointerover', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(TAB_HOVER_ARM_MS * 2)
    })
    // The pinned tab has nowhere to move and nothing to stow, so a bubble would
    // be a card of disabled buttons.
    expect(bubble()).toBeNull()
  })

  it('dismisses the bubble on Escape and after the pointer leaves', async () => {
    stubServer()
    await mount()
    vi.useFakeTimers()

    await restOn(2)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(bubble()).toBeNull()

    await restOn(2)
    expect(bubble()).not.toBeNull()
    const tab = host!.querySelectorAll('[role="tab"]')[2]!
    await act(async () => {
      tab.dispatchEvent(new Event('pointerout', { bubbles: true }))
    })
    // The delay is what lets the pointer travel from the tab into the bubble.
    await act(async () => {
      vi.advanceTimersByTime(TAB_HOVER_DISMISS_MS - 40)
    })
    expect(bubble()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(40)
    })
    expect(bubble()).toBeNull()
  })

  it('introduces the hover gesture once, then stays out of the way', async () => {
    vi.useFakeTimers()
    stubServer()
    await mount()
    // The measuring pass retries while the row has not laid out yet, which is also
    // what a real first paint does; the last attempt is the one that lands.
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    const guide = document.querySelector('[data-tab-hover-guide]')
    expect(guide).not.toBeNull()
    // It points at a tab, not at the row: the lesson is about pausing there.
    expect(guide?.getAttribute('data-tab-hover-guide')).toBe('instructions')
    expect(window.localStorage.getItem('agent-plugins.tab-hover-guide.v1')).toBeNull()

    await act(async () => {
      guide?.querySelector('button')?.click()
    })
    expect(document.querySelector('[data-tab-hover-guide]')).toBeNull()
    // Retiring it is what records it, so it cannot nag twice.
    expect(window.localStorage.getItem('agent-plugins.tab-hover-guide.v1')).toBe('seen')
  })

  it('skips the guide when this browser has already seen it', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem('agent-plugins.tab-hover-guide.v1', 'seen')
    stubServer()
    await mount()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(document.querySelector('[data-tab-hover-guide]')).toBeNull()
  })

  it('retires the guide on its own so it cannot sit over the workspace', async () => {
    vi.useFakeTimers()
    stubServer()
    await mount()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(document.querySelector('[data-tab-hover-guide]')).not.toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(TAB_HOVER_GUIDE_MS + 100)
    })
    expect(document.querySelector('[data-tab-hover-guide]')).toBeNull()
  })

  it('keeps the default row when the layout read fails, leaves every tab reachable, and reports it in the manager', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(500, { ok: false, error: 'boom' }))
    )
    await mount()

    // A failed read cannot leave the workspace with nothing: the starting row
    // still renders, and the three default-stowed tabs are one row away.
    expect(chipLabels()).toHaveLength(6)
    await openManager()
    expect(dialog()?.textContent).toContain('tabLayoutLoadFailed')
    // Every one of the nine surfaces is still listed and togglable.
    expect(dialog()?.querySelectorAll('input[type="checkbox"]').length).toBe(9)
  })
})
