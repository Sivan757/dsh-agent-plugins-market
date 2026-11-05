/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// @vitest-environment jsdom
/**
 * A preset created from an AI suggestion has to carry the rows it named.
 *
 * The suggestion names rows the way a person does: a skill that lives inside a suite, a
 * suite, a style. The manager's own switches keep those rows in a closure — a row under a
 * suite carries the suite, a suite carries the rows under it — and the manager counts a row
 * as selected only when that closure holds. A suggestion applied without the closure is
 * stored and reads back as nothing selected, which is what the person reported: the
 * suggestion came back, and saving it stored nothing they could see.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { en as settingsEn } from '../src/locales.js'
import { extensionPresetsEn } from '../src/locales-extension-presets.js'
import { ExtensionPresetEntry } from '../src/features/extension-presets/ExtensionPresetEntry.js'
import { presetSuggestionCandidates } from '../src/features/extension-presets/resource.js'
import type { ExtensionResource, ExtensionWindowPayload } from '../../market-contracts/src/contracts/extension-presets.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const suite: ExtensionResource = {
  id: 'market:src/one',
  face: 'market',
  name: 'One',
  source: 'src',
  available: true,
  globalEnabled: true,
  detail: { kind: 'suite', sourceId: 'src', suiteId: 'one' }
}
const child: ExtensionResource = {
  id: 'skills:src/one/review',
  face: 'skills',
  name: 'Review',
  source: 'src',
  available: true,
  globalEnabled: true,
  suiteResourceId: suite.id,
  detail: { kind: 'panel', panel: 'skills', entryId: 'src/one/review' }
}
const standing: ExtensionResource = {
  id: 'skills:user/mine',
  face: 'skills',
  name: 'Mine',
  source: 'user',
  available: true,
  globalEnabled: true,
  detail: { kind: 'panel', panel: 'skills', entryId: 'user/mine' }
}
const rows = [suite, child, standing]

let root: Root | undefined
let host: HTMLDivElement | undefined
let state: ExtensionWindowPayload
const posts: Array<{ url: string; body: Record<string, unknown> }> = []
/** What the model answers with; the route's own shape. */
let suggestion: { name: string; reason: string; enabledIds: string[] } = { name: 'Suggested', reason: 'because', enabledIds: [] }

function payload(): ExtensionWindowPayload {
  return {
    sessionId: 'session-one',
    workspace: '/workspace',
    started: true,
    busy: false,
    library: { revision: 1, defaultPresetId: null, presets: [{ id: 'preset', name: 'Research', revision: 1, enabledIds: [] }] },
    state: { revision: 1, selection: { presetId: 'preset', presetName: 'Research', presetRevision: 1, modified: false, enabledIds: [] } },
    resources: rows
  }
}

async function mount() {
  state = payload()
  posts.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
        posts.push({ url, body })
        if (url.includes('/ai-preset')) return { ok: true, json: async () => ({ ok: true, ...suggestion }) }
        if (url.includes('/create')) {
          const created = { id: 'preset-2', name: body.name as string, revision: 1, enabledIds: body.enabledIds as string[] }
          state = {
            ...state,
            library: { ...state.library, revision: state.library.revision + 1, presets: [...state.library.presets, created] },
            state: { ...state.state, revision: state.state.revision + 1 }
          }
        } else {
          state = { ...state, library: { ...state.library, revision: state.library.revision + 1 }, state: { ...state.state, revision: state.state.revision + 1 } }
        }
        return { ok: true, json: async () => ({ ok: true, window: state }) }
      }
      return { ok: true, json: async () => state }
    })
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      h(ExtensionPresetEntry, {
        renderDetail: () => null,
        sessionId: state.sessionId,
        t: key => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key
      })
    )
  )
}

async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text)
  expect(button, text).toBeDefined()
  await act(async () => button!.click())
}

/** Open the manager on the preset the session already selects. */
async function openManager() {
  await click('Research')
  await click('Manage presets')
}

/** Open the suggestion modal and type the question. */
async function ask(intent: string) {
  await click('Suggest a preset')
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Suggest a preset"]')
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, intent)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Suggest')
}

/** The switch of the row whose name is given. */
function switchOf(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find(button => (button.getAttribute('aria-label') ?? '').includes(name))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
  root = undefined
})

describe('a preset created from an AI suggestion', () => {
  it('stores the suite that owns a named row, so the row reads back as selected', async () => {
    suggestion = { name: 'Suggested', reason: 'because', enabledIds: [child.id] }
    await mount()
    await openManager()
    await ask('a code review setup')
    await click('Create this preset')

    const create = posts.find(post => post.url.includes('/create'))
    expect(create).toBeDefined()
    const stored = create!.body.enabledIds as string[]
    // The row the suggestion named, and the suite that owns it: the manager counts the row as
    // selected only when both are there.
    expect(stored).toContain(child.id)
    expect(stored).toContain(suite.id)

    // The manager reads the rows back as selected.
    await click('Skills')
    expect(switchOf('Review')?.getAttribute('aria-checked')).toBe('true')
    await click('Market')
    expect(switchOf('One')?.getAttribute('aria-checked')).toBe('true')
  })

  it('stores the rows under a named suite, so the suite is not on with its contents off', async () => {
    suggestion = { name: 'Suggested', reason: 'because', enabledIds: [suite.id] }
    await mount()
    await openManager()
    await ask('a code review setup')
    await click('Create this preset')

    const stored = posts.find(post => post.url.includes('/create'))!.body.enabledIds as string[]
    expect(stored).toContain(suite.id)
    expect(stored).toContain(child.id)
  })

  it('builds the same selection the manager switches build', async () => {
    // The manual path and the suggestion path have to agree: the same row, named either way,
    // has to end up in the same selection.
    suggestion = { name: 'Suggested', reason: 'because', enabledIds: [child.id] }
    await mount()
    await openManager()
    // The manual path: switch the row on in the skills face.
    await click('Skills')
    const manual = switchOf('Review')!
    expect(manual.getAttribute('aria-checked')).toBe('false')
    await act(async () => manual.click())
    const update = posts.find(post => post.url.includes('/update'))
    expect(update).toBeDefined()

    // The suggestion path: name the same row.
    await ask('a code review setup')
    await click('Create this preset')
    const create = posts.find(post => post.url.includes('/create'))!
    expect(create.body.enabledIds).toEqual(update!.body.enabledIds)
  })

  it('takes a name that is already taken, so the suggestion is not lost to a conflict', async () => {
    suggestion = { name: 'Research', reason: 'because', enabledIds: [child.id] }
    await mount()
    await openManager()
    await ask('a code review setup')
    await click('Create this preset')

    const create = posts.find(post => post.url.includes('/create'))!
    expect(create.body.name).toBe('Research (2)')
    // The new preset is the one the editor opens, not one found by the name it asked for.
    const tab = [...document.querySelectorAll('button')].find(button => button.textContent === 'Research (2)')
    expect(tab?.getAttribute('aria-pressed')).toBe('true')
  })

  it('reports a refused save instead of failing silently', async () => {
    suggestion = { name: 'Suggested', reason: 'because', enabledIds: [child.id] }
    await mount()
    await openManager()
    await ask('a code review setup')
    vi.mocked(fetch).mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    await click('Create this preset')
    expect(document.body.textContent).toContain('offline')
  })
})

describe('the rows a suggestion may choose from', () => {
  it('keeps the rows that carry a selection when the list is cut at the bound', () => {
    // The rows on offer are bounded, so the order decides what survives it. A suite and a
    // row that stands on its own carry a selection by themselves; a row under a suite only
    // exists inside one.
    const many: ExtensionResource[] = [suite]
    for (let index = 0; index < 400; index++) {
      many.push({ ...child, id: 'skills:src/one/' + index, name: 'Skill ' + index, suiteResourceId: suite.id })
    }
    many.push(standing)
    const offered = presetSuggestionCandidates(many, 10)
    expect(offered.length).toBe(10)
    expect(offered[0]!.id).toBe(suite.id)
    expect(offered.some(row => row.id === standing.id)).toBe(true)
  })

  it('does not offer a row the preset could not carry', () => {
    const globalOnly: ExtensionResource = { ...standing, id: 'mcp:direct', control: 'global-only' }
    const configuration: ExtensionResource = { ...standing, id: 'skills:project/mine', configuration: 'project' }
    const offered = presetSuggestionCandidates([...rows, globalOnly, configuration])
    // The suite first, then the row that stands on its own, then the row under the suite.
    expect(offered.map(row => row.id)).toEqual([suite.id, standing.id, child.id])
  })
})
