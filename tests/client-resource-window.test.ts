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
    ],
    activeFavoriteId: 'fav-1'
  }
}

/** The module-level fetch double every mutation route answers through. */
const fetchState = {
  window: payload(),
  calls: [] as Array<{ url: string; body: Record<string, unknown> | undefined }>,
  /** A manual flip detaches the active favorite server-side; the double mirrors that. */
  deviated: false
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
    const window =
      fetchState.deviated && target.endsWith('/resource-window') === false ? { ...structuredClone(fetchState.window), activeFavoriteId: null } : structuredClone(fetchState.window)
    const json = target.endsWith('/resource-window') ? window : target.endsWith('/favorites/save') ? { ok: true, window, favoriteId: 'fav-2' } : { ok: true, window }
    return { ok: true, status: 200, json: async () => json } as unknown as Response
  })
)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  fetchState.window = payload()
  fetchState.calls = []
  fetchState.deviated = false
})

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(ResourceWindow, { t, open: true, onClose: () => {} })))
  // The first paint renders before the inventory fetch resolves; settle the
  // promise chain (fetch -> json -> setState) before asserting on data.
  await act(async () => {
    await settled()
  })
}

/** Await until the load lands (a tab count above zero marks the data render). */
async function settled(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const counts = [...document.querySelectorAll('[aria-label="resourceWindowTabList"] [role="tab"] [class*="tabCount"]')]
    if (counts.some(node => /[1-9]/.test(node.textContent ?? ''))) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('ResourceWindow', () => {
  it('renders the header, favorites row, and six face tabs with counts', async () => {
    await mount()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-label')).toBe('resourceWindowTitle')
    expect(document.body.textContent).toContain('demo-project')
    expect(document.body.textContent).toContain('resourceWindowSubtitle')
    // Favorite chips: follow-global (inactive here), the saved one (active), save-current, cross note.
    expect(document.body.textContent).toContain('resourceWindowFollowGlobal')
    expect(document.body.textContent).toContain('前端开发')
    expect(document.body.textContent).toContain('resourceWindowSaveFavorite')
    expect(document.body.textContent).toContain('resourceWindowFavoriteCrossNote')
    const tablist = document.querySelector('[aria-label="resourceWindowTabList"]')
    expect(tablist).not.toBeNull()
    const tabs = [...tablist!.querySelectorAll('[role="tab"]')]
    expect(tabs).toHaveLength(6)
    // The two-level label: face word, then the small count span.
    expect(tabs[1]!.querySelector('[class*="tabCount"]')?.textContent).toBe('2')
    expect(tabs[1]!.textContent).toContain('resourceWindowCountSkills')
    expect(tabs[4]!.querySelector('[class*="tabCount"]')?.textContent).toBe('1')
    expect(tabs[4]!.textContent).toContain('resourceWindowCountMcp')
  })

  it('switches tabs without closing the window', async () => {
    await mount()
    const tablist = document.querySelector('[aria-label="resourceWindowTabList"]')!
    const tabs = [...tablist.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    await act(async () => tabs[4]!.click())
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(document.body.textContent).toContain('alpha__db')
    expect(tabs[4]!.getAttribute('aria-selected')).toBe('true')
  })

  it('filters rows by the search query across name and description', async () => {
    await mount()
    const search = document.querySelector('input[type="search"]') as HTMLInputElement
    expect(document.body.textContent).toContain('dsh-doc')
    await act(async () => {
      typeInto(search, 'lazy')
    })
    expect(document.body.textContent).toContain('ponytail')
    expect(document.body.textContent).not.toContain('dsh-doc')
  })

  it('flips an entry switch through the mutation route and re-renders the row state', async () => {
    await mount()
    const switches = [...document.querySelectorAll('[role="switch"]')] as HTMLElement[]
    expect(switches).toHaveLength(2)
    await act(async () => switches[0]!.click())
    const entryCall = fetchState.calls.find(call => call.url.endsWith('/resource-window/entry'))
    expect(entryCall?.body).toMatchObject({ face: 'skills', entryId: 'skills:dsh-doc', enabled: false })
  })

  it('switches views through the two-segment icon group', async () => {
    await mount()
    const group = document.querySelector('[role="group"][aria-label="resourceWindowViewGroup"]')
    expect(group).not.toBeNull()
    const segments = [...group!.querySelectorAll('button')] as HTMLButtonElement[]
    expect(segments).toHaveLength(2)
    // Card is selected by default; only the card segment reads pressed. The
    // card view rides the shared anatomy's grid view (data-resource-view).
    expect(segments[0]!.getAttribute('aria-pressed')).toBe('false')
    expect(segments[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-resource-view]')!.getAttribute('data-resource-view')).toBe('grid')
    await act(async () => segments[0]!.click())
    expect(document.querySelector('[data-resource-view]')!.getAttribute('data-resource-view')).toBe('list')
    expect(segments[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(segments[1]!.getAttribute('aria-pressed')).toBe('false')
    // The list keeps the search: switching views must not clear the query.
    const search = document.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      typeInto(search, 'lazy')
    })
    await act(async () => segments[1]!.click())
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('lazy')
  })

  it('keeps the search term and the open window across tab switches', async () => {
    await mount()
    const search = document.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      typeInto(search, 'lazy')
    })
    const tablist = document.querySelector('[aria-label="resourceWindowTabList"]')!
    const tabs = [...tablist.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    await act(async () => tabs[4]!.click())
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('lazy')
    // The window stays open and the empty state names the face with no match.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('resourceWindowEmpty')
  })

  it('detaches the follow-global state when a manual flip deviates from the favorite', async () => {
    await mount()
    // Favorite fav-1 is applied, so the follow-global chip is NOT the active
    // pill here. Pill carries the exact `active` class token when active (a
    // static Pill renders a span, an interactive one a button).
    // The favorite chip embeds its delete button, so match by prefix.
    const chip = (name: string) => [...document.querySelectorAll('[class*="pill"]')].find(node => (node.textContent ?? '').startsWith(name))
    // Vitest serves CSS modules as hashed class names (_active_<hash>), so the
    // active state reads through a token-boundary match on the class attribute.
    const isActive = (node: Element | undefined): boolean => {
      if (node === undefined) return false
      return node.className.split(/\s+/).some(token => /(^|[^a-z])active($|[^a-z])/.test(token))
    }
    expect(isActive(chip('前端开发'))).toBe(true)
    expect(isActive(chip('resourceWindowFollowGlobal'))).toBe(false)
    // One manual switch flip: the refreshed window carries activeFavoriteId null.
    fetchState.deviated = true
    const switches = [...document.querySelectorAll('[role="switch"]')] as HTMLElement[]
    await act(async () => switches[0]!.click())
    // The mutation rides a fire-and-forget promise; settle the chain so the
    // refreshed window's re-render lands before reading the chips.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    // The deviation detaches the favorite: follow-global becomes the active state.
    expect(isActive(chip('resourceWindowFollowGlobal'))).toBe(true)
    expect(isActive(chip('前端开发'))).toBe(false)
  })

  it('applies a favorite through its chip and reports a toast', async () => {
    await mount()
    const chips = [...document.querySelectorAll('button')] as HTMLButtonElement[]
    const favoriteChip = chips.find(chip => chip.textContent?.includes('前端开发'))
    expect(favoriteChip).toBeDefined()
    await act(async () => favoriteChip!.click())
    const applyCall = fetchState.calls.find(call => call.url.endsWith('/favorites/apply'))
    expect(applyCall?.body).toMatchObject({ id: 'fav-1' })
    expect(document.body.textContent).toContain('resourceWindowApplyFavoriteDone')
  })

  it('opens the naming dialog for save-current and posts the chosen name', async () => {
    await mount()
    const chips = [...document.querySelectorAll('button')] as HTMLButtonElement[]
    const saveChip = chips.find(chip => chip.textContent?.includes('resourceWindowSaveFavorite'))
    await act(async () => saveChip!.click())
    const field = document.querySelector<HTMLInputElement>('input:not([type="search"])')
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
    const del = document.querySelector<HTMLButtonElement>('[aria-label^="resourceWindowDeleteFavorite"]')
    expect(del).not.toBeNull()
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
