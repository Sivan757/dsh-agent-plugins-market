// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { typeInto } from './helpers/dom-events.js'
import { en as settingsEn, zh as settingsZh } from '../packages/market-ui/src/locales.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { bindTranslationEnabled } from '../packages/market-ui/src/ui/translation-enabled.js'
import { ResourceList } from '../packages/market-ui/src/features/extension-presets/ResourceList.js'
import { ExtensionPresetEntry } from '../packages/market-ui/src/features/extension-presets/ExtensionPresetEntry.js'
import { extensionPresetsEn as en, extensionPresetsZh } from '../packages/market-ui/src/locales-extension-presets.js'
import type { ExtensionDetailProps } from '../packages/market-ui/src/features/extension-presets/details.js'
import type { ExtensionResource, ExtensionWindowPayload } from '../packages/market-contracts/src/contracts/extension-presets.js'
const suite: ExtensionResource = {
  id: 'suite',
  face: 'market',
  name: 'frontend-kit',
  source: 'Source',
  available: true,
  globalEnabled: true,
  detail: { kind: 'suite', sourceId: 'source', suiteId: 'suite' }
}
const skill: ExtensionResource = {
  id: 'skill',
  face: 'skills',
  name: 'security-audit',
  source: 'frontend-kit',
  available: true,
  globalEnabled: false,
  suiteResourceId: suite.id,
  detail: { kind: 'panel', panel: 'skills', entryId: 'skill' }
}
let state: ExtensionWindowPayload
let root: Root | undefined
let detailProps: ExtensionDetailProps | undefined
const posts: Array<{ action: string; body: Record<string, unknown> }> = []
const t = (key: string) => en[key as keyof typeof en] ?? settingsEn[key as keyof typeof settingsEn] ?? key
async function mount(started = false, resources: ExtensionResource[] = [suite, skill]) {
  state = {
    sessionId: 'v5',
    workspace: '/workspace/acme',
    started,
    busy: false,
    library: { revision: 1, defaultPresetId: null, presets: [{ id: 'saved', name: 'Frontend', revision: 1, enabledIds: [suite.id] }] },
    state: { revision: 1, selection: { presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: [suite.id] } },
    resources
  }
  posts.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
        const action = url.split('/').at(-1)!
        posts.push({ action, body })
        if (action === 'create')
          state = {
            ...state,
            library: {
              ...state.library,
              revision: state.library.revision + 1,
              presets: [...state.library.presets, { id: 'created', name: String(body.name), enabledIds: body.enabledIds as string[], revision: 1 }]
            }
          }
        if (action === 'default') state = { ...state, library: { ...state.library, revision: state.library.revision + 1, defaultPresetId: body.id as string | null } }
        if (action === 'select') {
          const p = state.library.presets.find(p => p.id === body.presetId)!
          state = {
            ...state,
            state: {
              revision: state.state.revision + 1,
              selection: { presetId: p.id, presetName: p.name, presetRevision: p.revision, modified: false, enabledIds: [...p.enabledIds] }
            }
          }
        }
        return { ok: true, json: async () => ({ ok: true, window: state }) }
      }
      return { ok: true, json: async () => state }
    })
  )
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      h(ExtensionPresetEntry, {
        sessionId: 'v5',
        t,
        renderDetail: props => {
          detailProps = props
          return null
        }
      })
    )
  )
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)!
  expect(button, label).toBeDefined()
  await act(async () => button.click())
}
async function open() {
  await click('Default')
  await click('Manage presets')
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
it('offers the text switch in the manager toolbar and flips the cards with it', async () => {
  // The screenshot's gap: the settings panels put a text-view switch at the
  // toolbar's trailing edge, and the manager's toolbar carried none.
  const unbind = bindTranslationEnabled({ getSnapshot: () => ({ value: { translationEnabled: true } }), subscribe: () => () => {} })
  try {
    const translated: ExtensionResource = { ...suite, description: 'English description', translatedDescription: '中文描述' }
    await mount(false, [translated])
    await open()
    const toolbar = document.querySelector('[data-panel-toolbar]')!
    const button = toolbar.querySelector<HTMLButtonElement>('[data-bilingual-toggle]')!
    expect(button).not.toBeNull()
    // The trailing cluster is where every settings panel puts its own switch:
    // it sits beside the grid/list button, right of the filter segment.
    const viewSwitch = toolbar.querySelector('[data-view-switch]')!
    expect(button.parentElement!.nextElementSibling).toBe(viewSwitch)
    expect(document.body.textContent).toContain('中文描述')

    await act(async () => button.click())
    expect(document.body.textContent).toContain('English description')
    expect(document.body.textContent).not.toContain('中文描述')
    // The name is an identifier: it reads the same in both views.
    expect(document.body.textContent).toContain('frontend-kit')
  } finally {
    await act(async () => unbind())
  }
})

it.each([false, true])('uses the shared agent extension icon for started=%s', async started => {
  await mount(started)
  const button = document.querySelector('button')!
  expect(button.textContent).toBe('')
  expect(button.querySelector('svg')!.getAttribute('width')).toBe('16')
  expect(button.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 28 28')
  await click('Default')
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  expect(document.body.textContent).not.toContain('Adjust this session')
})
it('opens compact default and saved pills without a name field and keeps footer actions', async () => {
  await mount()
  await open()
  const group = document.querySelector('[role="group"]')!
  expect(group.textContent).toContain('Default')
  expect(group.textContent).toContain('Frontend')
  expect(document.querySelector('input[aria-label="Preset name"]')).toBeNull()
  expect(document.querySelector('button[aria-label="Save as a new preset"]')).not.toBeNull()
  expect(document.body.textContent).toContain('Done')
  expect(document.body.textContent).toContain('New-session default')
  expect(document.querySelector('article')!.textContent).toContain('frontend-kit')
})
it('edits global-off into a named library draft before explicit session selection', async () => {
  await mount()
  await open()
  await click('Skills')
  const card = document.querySelector<HTMLElement>('article')!
  expect(card.getAttribute('data-resource-state')).toBe('disabled')
  await act(async () => card.click())
  expect(posts).toHaveLength(0)
  expect(document.body.textContent).toContain('Unnamed preset')
  await click('Save preset')
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter(b => b.textContent === 'Save preset')
      .at(-1)!
      .click()
  )
  expect(posts.map(p => p.action)).toEqual(['create'])
  expect(posts[0]!.body.enabledIds).toEqual(['suite', 'skill'])
  expect(state.state.selection.enabledIds).toEqual(['suite'])
  await click('Done')
  await click('Default')
  await click('Custom preset')
  expect(posts.map(p => p.action)).toEqual(['create', 'select'])
  expect(state.state.selection.enabledIds).toEqual(['suite', 'skill'])
})
it('coalesces same-id project cards and toggles the unnamed draft', async () => {
  await mount(false, [suite, { ...suite }, { ...skill, globalEnabled: true }])
  await open()
  const cards = () => [...document.querySelectorAll<HTMLElement>('article')]
  await act(async () => cards()[0]!.click())
  expect(cards().map(card => card.getAttribute('data-resource-state'))).toEqual(['disabled'])
  expect(document.body.textContent).toContain('Unnamed preset')
  await act(async () => cards()[0]!.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
  expect(cards().map(card => card.getAttribute('data-resource-state'))).toEqual(['active'])
  await act(async () => cards()[0]!.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
  expect(cards().map(card => card.getAttribute('data-resource-state'))).toEqual(['disabled'])
  expect(posts).toHaveLength(0)
  await click('Enabled 0')
  expect(cards()).toHaveLength(0)
  await click('All 1')
  expect(cards()).toHaveLength(1)
  await act(async () => cards()[0]!.click())
  expect(cards().map(card => card.getAttribute('data-resource-state'))).toEqual(['active'])
  await click('Disabled 0')
  expect(cards()).toHaveLength(0)
  await click('All 1')
  await act(async () => cards()[0]!.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
  expect(cards().map(card => card.getAttribute('data-resource-state'))).toEqual(['disabled'])
})
it('does not retain stale duplicate cards after a filtered row is removed', async () => {
  await mount(false, [{ ...suite, id: 'before', name: 'before' }, suite, { ...suite, available: false }, skill])
  await open()
  await act(async () => typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Search installed extensions"]')!, 'frontend'))
  const cards = () => [...document.querySelectorAll<HTMLElement>('article')]
  await act(async () => cards()[0]!.click())
  expect(cards()[0]!.getAttribute('data-resource-state')).toBe('disabled')
  await act(async () => cards()[0]!.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
  expect(cards()[0]!.getAttribute('data-resource-state')).toBe('active')
})
it('omits the workspace name from the footer and carries no help affordance', async () => {
  await mount()
  await open()
  expect(document.querySelector('[title="/workspace/acme"]')).toBeNull()
  expect(document.body.textContent).not.toContain('acme')
  // The manager carries no help entry, no guide copy and no hint row: the
  // library, its tabs and its actions are the whole surface.
  expect(document.body.textContent).not.toContain(en.epHelp)
  expect(document.body.textContent).not.toContain(en.epGuide)
  expect(document.body.textContent).not.toContain(en.epLibraryHint)
  expect(document.body.textContent).not.toContain(en.epClipboardHelp)
  expect(document.querySelector('button[aria-label="' + en.epHelp + '"]')).toBeNull()
  expect([...document.querySelectorAll('[role="dialog"]')].some(node => node.getAttribute('aria-label') === en.epHelp)).toBe(false)
})
it('requires confirmation before discarding a global library draft', async () => {
  await mount()
  await open()
  await click('Skills')
  await act(async () => document.querySelector<HTMLElement>('article')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
  expect(document.body.textContent).toContain(en.epDiscardHint)
  await click('Cancel')
  expect(document.body.textContent).toContain('Unnamed preset')
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
  await click('Discard and continue')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(posts).toHaveLength(0)
})
it('routes real detail toggles through the library draft without global mutation', async () => {
  await mount()
  await open()
  await click('Skills')
  await click('View details · security-audit')
  expect(detailProps?.checked).toBe(false)
  expect(detailProps?.disabled).toBe(false)
  await act(async () => detailProps!.onToggle!(true))
  expect(detailProps?.checked).toBe(true)
  expect(document.body.textContent).toContain('Unnamed preset')
  expect(posts).toHaveLength(0)
})
it('opens no automatic guide and remembers no dismissal for a workspace', async () => {
  await mount()
  localStorage.removeItem('dsh-extension-guide:/workspace/acme')
  await open()
  // The first-run guide is gone: opening the manager shows the library only,
  // and nothing is written on its behalf.
  expect([...document.querySelectorAll('[role="dialog"]')].some(node => node.getAttribute('aria-label') === en.epHelp)).toBe(false)
  expect(document.body.textContent).not.toContain(en.epGuide)
  expect(localStorage.getItem('dsh-extension-guide:/workspace/acme')).toBeNull()
  await click('Done')
  await open()
  expect([...document.querySelectorAll('[role="dialog"]')].some(node => node.getAttribute('aria-label') === en.epHelp)).toBe(false)
})
it('shows selection failures through the native visible toast', async () => {
  await mount()
  await click('Default')
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, error: 'selection conflict' }) } as Response)
  await click('Frontend')
  const text = document.body.textContent ?? ''
  expect(text).toContain('selection conflict')
  expect(text).toContain(en.epFailed)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('ignores repeated Enter while a named draft save is pending', async () => {
  await mount()
  await open()
  await click('Save as a new preset')
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Preset name"]')!
  expect(input.hasAttribute('data-modal-autofocus')).toBe(true)
  let reject!: (reason: Error) => void
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      })
  )
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  await act(async () => reject(new Error('held save failed')))
})
it('uses the same source, count and name classes as current settings cards', async () => {
  await mount()
  await open()
  const rc = await import('../packages/market-ui/src/ui/resource-card.module.css')
  const source = await import('../packages/market-ui/src/ui/source-strip.module.css')
  const card = document.querySelector('article')!
  const name = card.querySelector('.' + rc.default.name)!
  expect(name.classList.contains(rc.default.nameMono!)).toBe(false)
  expect(card.querySelector('.' + rc.default.provenance)!.textContent).toBe('Source')
  expect(card.querySelector('.' + rc.default.countValue)!.textContent).toBe('1')
  expect(card.querySelector('.' + rc.default.count)!.textContent).toContain(settingsEn.surfaceSkills)
  const labels = [...document.querySelectorAll('[role="tab"]')].slice(0, 6).map(node => node.textContent)
  expect(labels).toEqual([
    settingsEn.workspaceTabMarket,
    settingsEn.workspaceTabSkills,
    settingsEn.workspaceTabCommands,
    settingsEn.workspaceTabPersonas,
    settingsEn.workspaceTabMcp,
    settingsEn.workspaceTabLsp
  ])
  expect(card.querySelector('.' + rc.default.switchWrap)).not.toBeNull()
  expect(document.querySelector('[role="group"] .' + source.default.srcTabMain)).not.toBeNull()
})
it('classifies project-scan rows into their surface tabs and renders no local tab', async () => {
  await mount()
  const local: ExtensionResource = {
    ...suite,
    id: 'project-parent',
    name: '.agents',
    configuration: 'project',
    detail: { kind: 'suite', sourceId: 'project', suiteId: 'native', sessionId: 'v5' }
  }
  const hooks: ExtensionResource = {
    ...suite,
    id: '@user-hooks/user-hooks',
    name: 'User Hooks',
    configuration: 'user-hooks',
    available: false,
    description: 'Hook table',
    unavailableReason: 'Invalid hook command'
  }
  const child: ExtensionResource = { ...skill, id: 'project-skill', suiteResourceId: local.id }
  const toggle = vi.fn(),
    view = vi.fn()
  await act(async () =>
    root!.render(
      h(ResourceList, {
        resources: [suite, local, hooks, child],
        ids: [local.id, child.id],
        disabled: false,
        t,
        showOriginal: false,
        onToggleShowOriginal: () => {},
        onToggle: toggle,
        onView: view
      })
    )
  )
  const faceTabs = [
    settingsEn.workspaceTabMarket,
    settingsEn.workspaceTabSkills,
    settingsEn.workspaceTabCommands,
    settingsEn.workspaceTabPersonas,
    settingsEn.workspaceTabMcp,
    settingsEn.workspaceTabLsp,
    en.epHooksTab
  ]
  const faceTabLabels = () =>
    [...document.querySelectorAll('[role="tablist"]')].find(list => list.querySelector('[aria-controls$="-market-panel"]'))!.querySelectorAll('[role="tab"]')
  // A project configuration adds no local tab: the row is always the six faces plus Hooks.
  expect([...faceTabLabels()].map(node => node.textContent)).toEqual(faceTabs)
  // Market shows only genuine market suites: the project parent renders no card.
  const cardIds = () => [...document.querySelectorAll('article')].map(node => node.getAttribute('data-resource-id'))
  expect(cardIds()).toEqual([suite.id])
  // Neither the project parent nor the user-hooks configuration renders a card.
  expect(cardIds()).not.toContain(local.id)
  expect(cardIds()).not.toContain(hooks.id)
  // Search cannot surface the unrendered row either: its description matches nothing.
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search installed extensions"]')!
  await act(async () => typeInto(search, 'Hook table'))
  expect(document.querySelectorAll('article')).toHaveLength(0)
  await act(async () => typeInto(search, ''))
  // Project-scan child rows ride their face tabs; the parent has no card anywhere.
  await click(settingsEn.workspaceTabSkills)
  expect(cardIds()).toEqual([child.id])
  // No face tab anywhere renders the user-hooks row.
  for (const label of faceTabs) {
    await click(label)
    expect(cardIds()).not.toContain(hooks.id)
  }
})
it('keeps frame geometry but delegates card layout and typography to shared styles', () => {
  const css = readFileSync('packages/market-ui/src/features/extension-presets/presets.module.css', 'utf8')
  expect(css).toContain('width: 800px')
  expect(css).toContain('height: 800px')
  expect(css).toContain('max-width: 100%')
  expect(css).toContain('max-height: 100%')
  expect(css).toContain('max-width: 600px')
  expect(css).toContain('width: 28px')
  expect(css).not.toContain('grid-template-columns')
  expect(css).not.toContain('font-size:')
  expect(css).not.toContain('position: absolute')
  expect(css).not.toContain('--dsw-menu-surface-fill:')
})

/** One user-hooks configuration row as the server inventory ships it. */
const hooksRow: ExtensionResource = {
  ...suite,
  id: '@user-hooks/user-hooks',
  name: 'User Hooks',
  configuration: 'user-hooks',
  available: false,
  description: 'Hook table',
  unavailableReason: 'Invalid hook command',
  detail: { kind: 'suite', sourceId: '@user-hooks', suiteId: 'user-hooks' }
}
/** The zh dictionary the resource list consults for the hooks row's display name. */
const zh = { ...settingsZh, ...extensionPresetsZh } as Record<string, string>
const tZh = (key: string) => zh[key] ?? key

describe('user hooks configuration row', () => {
  it('keeps the tab row on equal columns with ellipsized labels instead of a sideways scroll', async () => {
    const toggle = vi.fn(),
      view = vi.fn()
    await mount()
    await act(async () =>
      root!.render(
        h(ResourceList, { resources: [suite, hooksRow], ids: [], disabled: false, t: tZh, showOriginal: false, onToggleShowOriginal: () => {}, onToggle: toggle, onView: view })
      )
    )
    // The shared row policy: the host sizes the columns, and a label that does
    // not fit ellipsizes inside its own share. Nothing scrolls sideways.
    const sharedCss = readFileSync('packages/market-ui/src/ui/resource-tabs.module.css', 'utf8')
    const rowRule = /\.row\s*\{[^}]*/.exec(sharedCss)?.[0] ?? ''
    expect(rowRule).toMatch(/overflow:\s*hidden/)
    expect(rowRule).toMatch(/min-width:\s*0/)
    expect(sharedCss).not.toMatch(/overflow-x:\s*auto/)
    expect(sharedCss).toMatch(/\.labelText\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(sharedCss).toMatch(/\.labelText\s*\{[^}]*white-space:\s*nowrap/)
    // Equal columns are the host's own inline grid, so the indicator geometry
    // stays correct at any width.
    const faceTablist = [...document.querySelectorAll('[role="tablist"]')].find(list => list.querySelector('[aria-controls$="-market-panel"]'))!
    expect(faceTablist.getAttribute('style') ?? '').toContain('minmax(0, 1fr)')
    // The rendered row actually carries the module class the policy rides on.
    const rowClass = (await import('../packages/market-ui/src/ui/resource-tabs.module.css')).default.row
    expect(document.querySelector('.' + rowClass)!.querySelector('[role="tablist"]')).not.toBeNull()
  })

  it('keeps the user-hooks configuration row out of every face tab in a localized build', async () => {
    const toggle = vi.fn(),
      view = vi.fn()
    await mount()
    await act(async () =>
      root!.render(
        h(ResourceList, { resources: [hooksRow], ids: [], disabled: false, t: tZh, showOriginal: false, onToggleShowOriginal: () => {}, onToggle: toggle, onView: view })
      )
    )
    // No local tab exists, and the row stays unrendered under every face.
    const tabs = [
      tZh('workspaceTabMarket'),
      tZh('workspaceTabSkills'),
      tZh('workspaceTabCommands'),
      tZh('workspaceTabPersonas'),
      tZh('workspaceTabMcp'),
      tZh('workspaceTabLsp'),
      tZh('epHooksTab')
    ]
    const faceTablist = [...document.querySelectorAll('[role="tablist"]')].find(list => list.querySelector('[aria-controls$="-market-panel"]'))!
    expect([...faceTablist.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(tabs)
    for (const label of tabs) {
      await click(label)
      expect(document.querySelector('[data-configuration-id="@user-hooks/user-hooks"]')).toBeNull()
      expect(document.body.textContent ?? '').not.toContain('User Hooks')
    }
    // Search cannot surface the unrendered row either.
    const search = document.querySelector<HTMLInputElement>('input[aria-label="' + tZh('epSearch') + '"]')!
    await act(async () => typeInto(search, 'User Hooks'))
    expect(document.querySelector('[data-configuration-id="@user-hooks/user-hooks"]')).toBeNull()
  })

  it('shows the localized title and the empty explanation in the detail dialog for an invalid configuration', async () => {
    await mount()
    // The window fetch double now answers the suite detail GET the dialog issues.
    vi.mocked(fetch).mockImplementation(async () => ({ ok: true, json: async () => hooksDetailPayload }) as Response)
    const { ExtensionDetailView } = await import('../packages/market-ui/src/workspace/ExtensionResourceDetail.js')
    await act(async () => root!.render(h(ExtensionDetailView, { resource: hooksRow, t: tZh, onClose: vi.fn(), checked: false, disabled: true, onToggle: vi.fn() })))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain(tZh('epUserHooks'))
    expect(dialog.textContent).toContain(tZh('epConfigurationUnavailable'))
    // The footer switch speaks the same localized name, not the raw wire name.
    const footerSwitch = dialog.querySelector<HTMLButtonElement>('[role="switch"]')
    expect(footerSwitch?.getAttribute('aria-label')).toBe(tZh('epUserHooks'))
    // The raw wire name never reaches the reader in a localized build.
    expect(dialog.textContent).not.toContain('User Hooks')
  })
})

/** The suite detail payload the hooks configuration row fetches: empty, the way an invalid configuration reads. */
const hooksDetailPayload = {
  sourceId: '@user-hooks',
  suiteId: 'user-hooks',
  name: 'user-hooks',
  version: null,
  description: null,
  author: null,
  keywords: [],
  updatedAt: null,
  layout: 'agent-plugin-v1',
  dimension: 'user',
  root: '/agents',
  remoteUrl: null,
  installed: false,
  enabled: false,
  surfaceToggles: null,
  skills: [],
  mcpServers: [],
  hooks: { count: 0, entries: [] },
  commands: [],
  agents: [],
  lsp: { servers: [], raw: [] },
  errors: [],
  mcpErrors: []
}

/**
 * One Hooks-face row the inventory emits for the user's hook declarations, the
 * exact shape src/application/extension-inventory.ts builds: description
 * carries the event name the tab groups by.
 */
const HOOKS_PARENT = 'market:@user-hooks/user-hooks'
const hookRow = (id: string, over: Partial<ExtensionResource> = {}): ExtensionResource => {
  const row: ExtensionResource = {
    id,
    face: 'hooks',
    name: 'cmd',
    source: 'user-hooks',
    available: false,
    description: 'PreToolUse',
    suiteResourceId: HOOKS_PARENT,
    detail: { kind: 'suite', sourceId: '@user-hooks', suiteId: 'user-hooks' },
    ...over
  }
  // The server now addresses the hook itself, so the fixture carries the same
  // metadata the inventory emits: provenance, the authored command, the event
  // and the host's support verdict.
  return {
    ...row,
    detail: {
      kind: 'hook',
      sourceId: '@user-hooks',
      suiteId: 'user-hooks',
      event: row.description ?? 'PreToolUse',
      command: row.name,
      provenance: 'user-hooks',
      support: row.available ? 'supported' : 'registered-only'
    }
  }
}

describe('hooks tab', () => {
  it('renders the Hooks face tab and lists every event with its stage on the card', async () => {
    const toggle = vi.fn(),
      view = vi.fn()
    await mount()
    await act(async () =>
      root!.render(
        h(ResourceList, {
          resources: [
            hookRow('hooks:@user-hooks/user-hooks/PreToolUse/0', { name: 'echo lint', description: 'PreToolUse', available: true, globalEnabled: true }),
            hookRow('hooks:@user-hooks/user-hooks/PreToolUse/1', { name: 'echo test', description: 'PreToolUse', available: true, globalEnabled: true }),
            hookRow('hooks:@user-hooks/user-hooks/SessionStart/0', { name: 'echo start', description: 'SessionStart', available: true, globalEnabled: true })
          ],
          ids: [HOOKS_PARENT, 'hooks:@user-hooks/user-hooks/PreToolUse/0'],
          disabled: false,
          t,
          showOriginal: false,
          onToggleShowOriginal: () => {},
          onToggle: toggle,
          onView: view
        })
      )
    )
    // The tab row carries no count summary: the removed strip printed the
    // filtered item count and the preview's enabled count, and neither belongs
    // to the row any surface renders now.
    expect(document.body.textContent ?? '').not.toContain(en.epPreview)
    // The Hooks tab rides the primary row unconditionally: it is a face, not a conditional local tab.
    const faceTablist = [...document.querySelectorAll('[role="tablist"]')].find(list => list.querySelector('[aria-controls$="-market-panel"]'))!
    expect([...faceTablist.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual([
      settingsEn.workspaceTabMarket,
      settingsEn.workspaceTabSkills,
      settingsEn.workspaceTabCommands,
      settingsEn.workspaceTabPersonas,
      settingsEn.workspaceTabMcp,
      settingsEn.workspaceTabLsp,
      en.epHooksTab
    ])
    await click(en.epHooksTab)
    // No secondary event row remains: every declaration lists at once, and each
    // card names its own stage.
    expect([...document.querySelectorAll('[role="tablist"]')].filter(list => list.querySelector('[aria-controls$="-PreToolUse-panel"]'))).toHaveLength(0)
    expect([...document.querySelectorAll('article')].map(node => node.getAttribute('data-resource-id'))).toEqual([
      'hooks:@user-hooks/user-hooks/PreToolUse/0',
      'hooks:@user-hooks/user-hooks/PreToolUse/1',
      'hooks:@user-hooks/user-hooks/SessionStart/0'
    ])
    expect(document.querySelector('article[data-resource-id="hooks:@user-hooks/user-hooks/SessionStart/0"]')!.textContent).toContain('SessionStart')
    // A supported declaration keeps its switch and toggles through the preset draft.
    await act(async () =>
      document.querySelector<HTMLElement>('article[data-resource-id="hooks:@user-hooks/user-hooks/PreToolUse/1"]')!.querySelector<HTMLButtonElement>('[role="switch"]')!.click()
    )
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'hooks:@user-hooks/user-hooks/PreToolUse/1' }), true)
  })

  it('states the support verdict on the card: a switch when supported, a limited tag otherwise', async () => {
    const toggle = vi.fn(),
      view = vi.fn()
    await mount()
    await act(async () =>
      root!.render(
        h(ResourceList, {
          resources: [
            // Supported and one hook enabled: done.
            hookRow('hooks:@user-hooks/user-hooks/PreToolUse/0', { name: 'echo on', description: 'PreToolUse', available: true, globalEnabled: true }),
            // Supported but nothing enabled: idle.
            hookRow('hooks:@user-hooks/user-hooks/Stop/0', { name: 'echo off', description: 'Stop', available: true, globalEnabled: false }),
            // Partial support: warning whatever the selection says.
            hookRow('hooks:@user-hooks/user-hooks/Notification/0', {
              name: 'notify',
              description: 'Notification',
              available: false,
              control: 'global-only',
              unavailableReason: 'hook-event-partial'
            }),
            // Registered only: warning.
            hookRow('hooks:@user-hooks/user-hooks/SessionEnd/declared', {
              name: 'SessionEnd',
              description: 'SessionEnd',
              available: false,
              control: 'global-only',
              unavailableReason: 'hook-event-unsupported'
            })
          ],
          ids: [HOOKS_PARENT, 'hooks:@user-hooks/user-hooks/PreToolUse/0'],
          disabled: false,
          t,
          showOriginal: false,
          onToggleShowOriginal: () => {},
          onToggle: toggle,
          onView: view
        })
      )
    )
    await click(en.epHooksTab)
    const cardOf = (id: string) => document.querySelector<HTMLElement>('article[data-resource-id="' + id + '"]')!
    // A supported event keeps its own switch; the selection is the only difference.
    expect(cardOf('hooks:@user-hooks/user-hooks/PreToolUse/0').querySelector('[role="switch"]')).not.toBeNull()
    expect(cardOf('hooks:@user-hooks/user-hooks/Stop/0').querySelector('[role="switch"]')).not.toBeNull()
    // A partial or registered-only event is read-only and its card says why.
    for (const id of ['hooks:@user-hooks/user-hooks/Notification/0', 'hooks:@user-hooks/user-hooks/SessionEnd/declared']) {
      const card = cardOf(id)
      expect(card.querySelector('[role="switch"]')).toBeNull()
      expect([...card.querySelectorAll('span')].some(node => node.getAttribute('data-tone') === 'quiet')).toBe(true)
    }
  })

  it('renders unsupported-event rows read-only with the localized note and no switch', async () => {
    // The host tooltip positions through ResizeObserver, which jsdom does not ship.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const toggle = vi.fn(),
      view = vi.fn()
    await mount()
    await act(async () =>
      root!.render(
        h(ResourceList, {
          resources: [
            hookRow('hooks:@user-hooks/user-hooks/Notification/0', {
              name: 'notify-me',
              description: 'Notification',
              available: false,
              control: 'global-only',
              unavailableReason: 'hook-event-partial'
            }),
            hookRow('hooks:@user-hooks/user-hooks/SessionEnd/declared', {
              name: 'SessionEnd',
              description: 'SessionEnd',
              available: false,
              control: 'global-only',
              unavailableReason: 'hook-event-unsupported'
            })
          ],
          ids: [],
          disabled: false,
          t: tZh,
          showOriginal: false,
          onToggleShowOriginal: () => {},
          onToggle: toggle,
          onView: view
        })
      )
    )
    await click(tZh('epHooksTab'))
    // Both read-only rows list at once, each with its own reason tag.
    expect(document.querySelectorAll('article')).toHaveLength(2)
    const cardOf = (id: string) => document.querySelector<HTMLElement>('article[data-resource-id="' + id + '"]')!
    const hover = async (card: HTMLElement): Promise<void> => {
      const tag = [...card.querySelectorAll('span')].find(node => node.getAttribute('data-tone') === 'quiet')!
      await act(async () => {
        tag.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
    const partial = cardOf('hooks:@user-hooks/user-hooks/Notification/0')
    expect(partial.querySelector('[role="switch"]')).toBeNull()
    await hover(partial)
    expect(document.body.textContent).toContain(tZh('epHookEventPartial'))
    const registered = cardOf('hooks:@user-hooks/user-hooks/SessionEnd/declared')
    expect(registered.querySelector('[role="switch"]')).toBeNull()
    await hover(registered)
    expect(document.body.textContent).toContain(tZh('epHookEventUnsupported'))
  })

  it('keeps the seven one-line face tabs on the shared tab-row policy', async () => {
    const toggle = vi.fn(),
      view = vi.fn()
    await mount()
    await act(async () =>
      root!.render(
        h(ResourceList, {
          resources: [hookRow('hooks:@user-hooks/user-hooks/PreToolUse/0', { name: 'echo', description: 'PreToolUse', available: true, globalEnabled: true })],
          ids: [],
          disabled: false,
          t,
          showOriginal: false,
          onToggleShowOriginal: () => {},
          onToggle: toggle,
          onView: view
        })
      )
    )
    const rowClass = (await import('../packages/market-ui/src/ui/resource-tabs.module.css')).default.row
    // Seven primary faces on one shared component with one one-line,
    // non-scrolling policy. The secondary event row is gone.
    const faceRow = document.querySelector('.' + rowClass)!
    expect(faceRow.querySelectorAll('[role="tab"]')).toHaveLength(7)
    await click(en.epHooksTab)
    expect([...document.querySelectorAll('.' + rowClass)]).toHaveLength(1)
    // One line each, and never a sideways scroll: the shared truncation rule is
    // the only thing that gives on a narrow frame.
    const sharedCss = readFileSync('packages/market-ui/src/ui/resource-tabs.module.css', 'utf8')
    expect(sharedCss).toMatch(/\.labelText\s*\{[^}]*white-space:\s*nowrap/)
    expect(sharedCss).toMatch(/\.labelText\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(sharedCss).not.toMatch(/overflow-x:\s*auto/)
  })
})
