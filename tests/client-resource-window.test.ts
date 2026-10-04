// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { ResourceWindow } from '../src/client/features/resource-window/ResourceWindow.js'
import type { ResourceTranslate } from '../src/client/features/resource-window/ResourceWindow.js'
import { ComposerResourceEntry } from '../src/client/features/resource-window/ComposerResourceEntry.js'
import type { ResourceWindowPayload } from '../src/contracts/resource-window.js'
import { typeInto } from './helpers/dom-events.js'

const t: ResourceTranslate = (key, params) => {
  let text = String(key)
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}

/** One fully-on window: two faces populated, one saved favorite applied. */
function payload(): ResourceWindowPayload {
  return {
    workspace: '/ws/demo-project',
    entries: [
      { id: 'skills:dsh-doc', face: 'skills', name: 'dsh-doc', version: '0.1.0', source: 'dsh-workflow', description: 'Doc skill', enabled: true },
      { id: 'skills:ponytail', face: 'skills', name: 'ponytail', source: 'user', description: 'Lazy solutions', enabled: false },
      { id: 'mcp:alpha__db', face: 'mcp', name: 'alpha__db', source: 'demo', description: 'stdio', enabled: true }
    ],
    favorites: [
      {
        id: 'fav-1',
        name: '前端开发',
        createdAt: '2026-10-03T00:00:00.000Z',
        surfaces: { market: true, skills: true, commands: true, agents: true, mcp: false, lsp: true },
        offEntries: ['skills:ponytail']
      }
    ]
  }
}

/** The module-level fetch double every mutation route answers through. */
const fetchState = {
  window: payload(),
  calls: [] as Array<{ url: string; body: Record<string, unknown> | undefined }>
}

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string | URL, init?: RequestInit) => {
    const target = url instanceof URL ? url.href : url
    const rawBody = init?.body
    fetchState.calls.push({ url: target, body: rawBody === undefined || typeof rawBody !== 'string' ? undefined : (JSON.parse(rawBody) as Record<string, unknown>) })
    // The GET inventory route serves the window bare; every POST route wraps
    // it in the market API's result envelope. A minimal Response double:
    // undici's real Response schedules its body read on macrotasks the act
    // loop cannot flush deterministically.
    const window = structuredClone(fetchState.window)
    const json = target.endsWith('/resource-window') ? window : target.endsWith('/favorites/save') ? { ok: true, window, favoriteId: 'fav-2' } : { ok: true, window }
    return { ok: true, status: 200, json: async () => json } as unknown as Response
  })
)

let root: Root | undefined
let host: HTMLDivElement | undefined
/** The mount helper's live open state; onClose flips it through a re-render. */
let windowOpen = true

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  windowOpen = true
  window.location.hash = ''
  fetchState.window = payload()
  fetchState.calls = []
})

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  // onClose really closes: the render is driven by this open flag, so a
  // view action's onClose lands as an unmounted dialog.
  const rerender = (open: boolean): void => {
    root!.render(
      h(ResourceWindow, {
        t,
        open,
        onClose: () => {
          windowOpen = false
          rerender(false)
        }
      })
    )
  }
  await act(async () => rerender(true))
  // The first paint renders before the inventory fetch resolves; settle the
  // promise chain (fetch -> json -> setState) before asserting on data.
  await act(async () => {
    await settled()
  })
}

/** Await until the load lands (a filter count above zero marks the data render). */
async function settled(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const options = filterOptions()
    if (options.some(node => /[1-9]/.test(node.textContent ?? ''))) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

// The window has two tablists and both read the tab-section label, so the
// queries go through the tabs' stable ids — the caller-supplied bases — with
// role=tab keeping the tabpanel (whose id shares the filter base) out.
/** The face tablist's six plain tabs, in face order. */
function faceTabs(): HTMLButtonElement[] {
  return [...document.querySelectorAll('[role="tab"][id^="agent-plugins-resource-tab-"]')] as HTMLButtonElement[]
}

/** The toolbar's three-state entry filter, in segment order. */
function filterOptions(): HTMLButtonElement[] {
  return [...document.querySelectorAll('[role="tab"][id^="agent-plugins-resource-filter-"]')] as HTMLButtonElement[]
}

/** The toolbar's single view toggle: one always-pressed Pill, the shared shape. */
function viewToggle(): HTMLButtonElement {
  return document.querySelector('[aria-pressed="true"][aria-label="resourceWindowViewList"]') as HTMLButtonElement
}

/** The entry card acting as its own toggle: role=button carrying aria-pressed. */
function entryCard(name: string): HTMLElement {
  const card = [...document.querySelectorAll('article[role="button"][aria-pressed]')].find(node => (node.textContent ?? '').includes(name))
  expect(card).toBeDefined()
  return card as HTMLElement
}

describe('ResourceWindow', () => {
  it('renders the favorites row with the tail save button, six face tabs, and the filter counts', async () => {
    await mount()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-label')).toBe('resourceWindowTitle')
    // The window drops the subtitle sentence and the workspace chip: the
    // title row is the only header, the list gains the visible area.
    expect(document.body.textContent).not.toContain('resourceWindowSubtitle')
    expect(document.querySelector('[class*="workspaceChip"]')).toBeNull()
    // The save-favorite icon button rides the favorites row's tail; the
    // refresh button is gone — opening re-reads the inventory every time.
    const favoritesRow = document.querySelector('[class*="favoritesRow"]')
    expect(favoritesRow).not.toBeNull()
    expect(favoritesRow!.querySelector('[aria-label="resourceWindowSaveFavorite"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="resourceWindowRefresh"]')).toBeNull()
    // The favorites strip rides the market's source strip: follow-global as
    // the first chip (the market's 全部 slot), the saved favorite next.
    expect(favoritesRow!.querySelector('[class*="sourceTabsBox"]')).not.toBeNull()
    const chipMains = [...favoritesRow!.querySelectorAll<HTMLButtonElement>('button[class*="srcTabMain"]')]
    expect(chipMains).toHaveLength(2)
    expect(chipMains[0]!.textContent).toContain('resourceWindowFollowGlobal')
    expect(chipMains[1]!.textContent).toContain('前端开发')
    // Six plain face tabs, named with the settings page's words: the tests'
    // translator echoes keys, so the main-dictionary tab keys read verbatim.
    const tabs = faceTabs()
    expect(tabs).toHaveLength(6)
    expect(tabs[0]!.textContent).toBe('workspaceTabMarket')
    expect(tabs[1]!.textContent).toBe('workspaceTabSkills')
    expect(tabs[4]!.textContent).toBe('workspaceTabMcp')
    // The counts live in the filter segment, one per mounted state, computed
    // for the active face: the skills face has 2 on, 1 off.
    const options = filterOptions()
    expect(options.map(option => option.textContent)).toEqual(['resourceWindowFilterAll 2', 'resourceWindowFilterOn 1', 'resourceWindowFilterOff 1'])
  })

  it('switches tabs without closing the window', async () => {
    await mount()
    const tabs = faceTabs()
    await act(async () => tabs[4]!.click())
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(document.body.textContent).toContain('alpha__db')
    expect(tabs[4]!.getAttribute('aria-selected')).toBe('true')
    // The face switch recomputes the filter counts for the new face.
    const options = filterOptions()
    expect(options.map(option => option.textContent)).toEqual(['resourceWindowFilterAll 1', 'resourceWindowFilterOn 1', 'resourceWindowFilterOff 0'])
  })

  it('filters rows by the search query across name and description', async () => {
    await mount()
    const search = document.querySelector('input[aria-label="resourceWindowSearchPh"]') as HTMLInputElement
    expect(document.body.textContent).toContain('dsh-doc')
    await act(async () => {
      typeInto(search, 'lazy')
    })
    expect(document.body.textContent).toContain('ponytail')
    expect(document.body.textContent).not.toContain('dsh-doc')
  })

  it('restores the settings-page card anatomy: provenance tag, view-then-switch cluster', async () => {
    await mount()
    const card = entryCard('dsh-doc')
    // The identity row carries the source tag, the foot the source line.
    const tag = card.querySelector('[class*="rowId"] [data-tone="neutral"]')
    expect(tag).not.toBeNull()
    expect(tag!.textContent).toBe('dsh-workflow')
    expect(card.querySelector('[class*="rowFoot"]')!.textContent).toContain('dsh-workflow')
    // The cluster: view details first, the enable switch at its trailing edge.
    const actions = card.querySelector('[class*="rowActions"]')!
    const viewBtn = actions.querySelector('button[aria-label="resourceWindowView dsh-doc"]')
    expect(viewBtn).not.toBeNull()
    const sw = actions.querySelector('[role="switch"]') as HTMLElement
    expect(sw).not.toBeNull()
    expect(actions.querySelector('[class*="switchWrap"]')).not.toBeNull()
    expect(actions.children[actions.children.length - 1]).toBe(actions.querySelector('[class*="switchWrap"]'))
    // The pressed card still reads the entry's mount state.
    expect(card.getAttribute('aria-pressed')).toBe('true')
    // Flipping through the switch stays a single entry write: the wrapper
    // keeps the click (and its key press) off the card's own toggle.
    await act(async () => sw.click())
    const switchCalls = fetchState.calls.filter(call => call.url.endsWith('/resource-window/entry'))
    expect(switchCalls).toHaveLength(1)
    expect(switchCalls[0]!.body).toMatchObject({ face: 'skills', entryId: 'skills:dsh-doc', enabled: false })
  })

  it('locks the switch of a globally disabled entry with the explaining title', async () => {
    // ponytail rides the fixture globally off: the settings pages turned it
    // off themselves, so this surface can filter further but never re-enable.
    fetchState.window = {
      ...payload(),
      entries: payload().entries.map(entry => (entry.id === 'skills:ponytail' ? { ...entry, globalDisabled: true } : entry))
    }
    await mount()
    const card = entryCard('ponytail')
    const sw = card.querySelector('[role="switch"]') as HTMLInputElement
    expect(sw).not.toBeNull()
    expect(sw.disabled).toBe(true)
    expect(sw.getAttribute('aria-disabled') ?? sw.getAttribute('disabled')).not.toBeNull()
    // The title names the reason instead of the generic toggle action.
    const wrap = sw.closest('[class*="switchWrap"]')!
    const labelled = [...wrap.querySelectorAll('[title]')].find(node => (node.getAttribute('title') ?? '').includes('resourceWindowGloballyOff'))
    expect(labelled).not.toBeNull()
    // No entry write can come from the locked row's card either.
    await act(async () => card.click())
    expect(fetchState.calls.find(call => call.url.endsWith('/resource-window/entry') && JSON.stringify(call.body).includes('ponytail'))).toBeUndefined()
  })

  it('toggles an entry through its card and reports the pressed state', async () => {
    await mount()
    const cards = [...document.querySelectorAll('article[role="button"][aria-pressed]')] as HTMLElement[]
    expect(cards).toHaveLength(2)
    expect(cards[0]!.getAttribute('aria-label')).toBe('resourceWindowToggleEntry dsh-doc')
    expect(cards[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(cards[1]!.getAttribute('aria-pressed')).toBe('false')
    await act(async () => cards[0]!.click())
    const entryCall = fetchState.calls.find(call => call.url.endsWith('/resource-window/entry'))
    expect(entryCall?.body).toMatchObject({ face: 'skills', entryId: 'skills:dsh-doc', enabled: false })
  })

  it('views an entry: closes the window and deep-links to its settings tab', async () => {
    await mount()
    const tabs = faceTabs()
    await act(async () => tabs[4]!.click())
    // The mcp entry's view action: the window closes, the settings page's
    // mcp tab is selected through the hash, and the panel event lifts the
    // market panel in page mode.
    const viewBtn = document.querySelector<HTMLButtonElement>('button[aria-label="resourceWindowView alpha__db"]')
    expect(viewBtn).not.toBeNull()
    const events: string[] = []
    const listener = (event: Event): void => {
      events.push((event as CustomEvent<string>).detail)
    }
    document.addEventListener('dsh-panel-activate', listener)
    try {
      await act(async () => viewBtn!.click())
    } finally {
      document.removeEventListener('dsh-panel-activate', listener)
    }
    expect(window.location.hash).toBe('#/agent-plugins/mcp')
    expect(events).toEqual(['agent-plugins-market'])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(windowOpen).toBe(false)
  })

  it('switches views through the shared toolbar toggle', async () => {
    await mount()
    // One always-pressed Pill inside the shared toolbar: the glyph names the
    // mode in force, the accessible label names the view a click leads to.
    const toggle = viewToggle()
    expect(toggle).not.toBeNull()
    // The card view rides the shared anatomy's grid view (data-resource-view).
    expect(document.querySelector('[data-resource-view]')!.getAttribute('data-resource-view')).toBe('grid')
    await act(async () => toggle.click())
    expect(document.querySelector('[data-resource-view]')!.getAttribute('data-resource-view')).toBe('list')
    // The view switch is the shared toolbar's flat icon button now: pressed
    // reports the mode in force (list mode is the unpressed state), and the
    // accessible name says where a click leads.
    expect(document.querySelector('[aria-pressed="false"][aria-label="resourceWindowViewCard"]')).not.toBeNull()
    // The list keeps the search: switching views must not clear the query.
    const search = document.querySelector('input[aria-label="resourceWindowSearchPh"]') as HTMLInputElement
    await act(async () => {
      typeInto(search, 'lazy')
    })
    await act(async () => toggle.click())
    expect((document.querySelector('input[aria-label="resourceWindowSearchPh"]') as HTMLInputElement).value).toBe('lazy')
  })

  it('narrows the list through the entry filter segment', async () => {
    await mount()
    const options = filterOptions()
    await act(async () => options[2]!.click())
    // Only the filtered-out entry survives the 'off' segment.
    expect(document.body.textContent).toContain('ponytail')
    expect(document.body.textContent).not.toContain('dsh-doc')
  })

  it('keeps the search term and the open window across tab switches', async () => {
    await mount()
    const search = document.querySelector('input[aria-label="resourceWindowSearchPh"]') as HTMLInputElement
    await act(async () => {
      typeInto(search, 'lazy')
    })
    const tabs = faceTabs()
    await act(async () => tabs[4]!.click())
    expect((document.querySelector('input[aria-label="resourceWindowSearchPh"]') as HTMLInputElement).value).toBe('lazy')
    // The window stays open and the empty state names the face with no match.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('resourceWindowEmpty')
  })

  it('resets the workspace through the follow-global chip and reports it', async () => {
    await mount()
    // The follow-global chip is an action: it clears every project-level
    // opinion through the reset route and answers with the plain inventory.
    const chip = [...document.querySelectorAll<HTMLButtonElement>('button[class*="srcTabMain"]')]
    expect(chip[0]!.textContent).toContain('resourceWindowFollowGlobal')
    await act(async () => chip[0]!.click())
    const resetCall = fetchState.calls.find(call => call.url.endsWith('/resource-window/reset'))
    expect(resetCall).toBeDefined()
    expect(document.body.textContent).toContain('resourceWindowResetDone')
  })

  it('keeps the favorites chips pure actions: a manual flip changes no chip', async () => {
    await mount()
    // Flipping a row is workspace state only: no favorite applies, no chip
    // highlights, the strip stays exactly as it was.
    const before = [...document.querySelectorAll('button[class*="srcTabMain"]')].map(node => node.textContent)
    await act(async () => entryCard('dsh-doc').click())
    const after = [...document.querySelectorAll('button[class*="srcTabMain"]')].map(node => node.textContent)
    expect(after).toEqual(before)
    expect(fetchState.calls.find(call => call.url.endsWith('/favorites/apply'))).toBeUndefined()
  })

  it('applies a favorite through its strip chip and reports a toast', async () => {
    await mount()
    // The strip chip's main button carries the favorite's name.
    const favoriteChip = [...document.querySelectorAll<HTMLButtonElement>('button[class*="srcTabMain"]')].find(chip => chip.textContent?.includes('前端开发'))
    expect(favoriteChip).toBeDefined()
    await act(async () => favoriteChip!.click())
    const applyCall = fetchState.calls.find(call => call.url.endsWith('/favorites/apply'))
    expect(applyCall?.body).toMatchObject({ id: 'fav-1' })
    expect(document.body.textContent).toContain('resourceWindowApplyFavoriteDone')
  })

  it('opens the naming dialog from the favorites-row save button and posts the chosen name', async () => {
    await mount()
    const add = document.querySelector('button[aria-label="resourceWindowSaveFavorite"]') as HTMLButtonElement
    await act(async () => add.click())
    const field = document.querySelector<HTMLInputElement>('input[aria-label="resourceWindowNameDialogToken"]')
    expect(field).not.toBeNull()
    expect(field?.value).toBe('resourceWindowNameDefault')
    await act(async () => {
      typeInto(field!, '我的常用 daily')
    })
    const confirm = ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find(chip => chip.textContent === 'resourceWindowNameDialogConfirm')
    await act(async () => confirm!.click())
    const saveCall = fetchState.calls.find(call => call.url.endsWith('/favorites/save'))
    expect(saveCall?.body).toMatchObject({ name: '我的常用 daily' })
    expect(document.body.textContent).toContain('resourceWindowSaveFavoriteDone')
  })

  it('deletes a favorite from its chip without applying it', async () => {
    await mount()
    // The strip chip's trailing delete control is a real button whose aria
    // name rides the resource window's own delete wording.
    const del = document.querySelector<HTMLButtonElement>('button[class*="srcTabDel"][aria-label^="resourceWindowDeleteFavorite"]')
    expect(del).not.toBeNull()
    expect(del!.title).toBe('resourceWindowDeleteFavorite')
    await act(async () => del!.click())
    const deleteCall = fetchState.calls.find(call => call.url.endsWith('/favorites/delete'))
    expect(deleteCall?.body).toMatchObject({ id: 'fav-1' })
    expect(fetchState.calls.find(call => call.url.endsWith('/favorites/apply'))).toBeUndefined()
  })
})

describe('ComposerResourceEntry', () => {
  afterEach(async () => {
    await act(async () => root?.unmount())
    host?.remove()
    root = undefined
    host = undefined
  })

  it('renders the filled four-cell glyph with a conditional filter dot and opens the window', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(ComposerResourceEntry, { t })))
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="resourceWindowOpen"]')
    expect(button).not.toBeNull()
    // Four filled cells, two of them dimmed: the prototype's .plugin-entry .grid.
    const cells = [...button!.querySelectorAll('span[class*="entryCell"]')]
    expect(cells).toHaveLength(4)
    // The inventory carries one denied row, so the dot is lit.
    expect(button!.querySelector('[class*="entryDot"]')).not.toBeNull()
    // The window opens through the same button and closes again.
    await act(async () => button!.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const dialog = document.querySelector('[role="dialog"]')
    await act(async () => {
      ;(dialog!.querySelector('button[aria-label="resourceWindowClose"]') as HTMLButtonElement).click()
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the dot dark while nothing is filtered', async () => {
    fetchState.window = {
      ...payload(),
      entries: payload().entries.map(entry => ({ ...entry, enabled: true }))
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(ComposerResourceEntry, { t })))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="resourceWindowOpen"]')!
    expect(button.querySelector('[class*="entryDot"]')).toBeNull()
  })
})
