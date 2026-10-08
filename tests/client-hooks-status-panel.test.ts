// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { en as settingsEn, zh as settingsZh } from '../packages/market-ui/src/locales.js'
import { extensionPresetsEn as presetEn, extensionPresetsZh as presetZh } from '../packages/market-ui/src/locales-extension-presets.js'
import { HooksStatusPanel } from '../packages/market-ui/src/features/hooks/StatusPanel.js'
import { PluginWorkspace } from '../packages/market-ui/src/workspace/PluginWorkspace.js'
import type { ExtensionHooksOverview } from '../packages/market-contracts/src/contracts/extension-presets.js'

const en = { ...settingsEn, ...presetEn } as Record<string, string>
const zh = { ...settingsZh, ...presetZh } as Record<string, string>
/** Dictionary lookup with the host's {param} substitution, as the modal's timeout row uses it. */
const fill = (dict: Record<string, string>, key: string, params?: Record<string, unknown>): string => {
  const text = dict[key] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}
const t = (key: string, params?: Record<string, unknown>) => fill(en, key, params)
const tZh = (key: string, params?: Record<string, unknown>) => fill(zh, key, params)

const overview: ExtensionHooksOverview = {
  rows: [
    {
      id: 'hooks:@user-hooks/user-hooks/PreToolUse/0',
      face: 'hooks',
      name: 'echo guard',
      source: 'user-hooks',
      description: 'PreToolUse',
      suiteResourceId: 'market:@user-hooks/user-hooks',
      available: true,
      globalEnabled: true,
      detail: {
        kind: 'hook',
        sourceId: '@user-hooks',
        suiteId: 'user-hooks',
        event: 'PreToolUse',
        hookIndex: 0,
        command: 'echo guard --strict',
        matcher: 'Edit',
        timeoutSec: 12,
        provenance: 'user-hooks',
        support: 'supported'
      }
    },
    {
      id: 'hooks:@user-hooks/user-hooks/SessionEnd/declared',
      face: 'hooks',
      name: 'SessionEnd',
      source: 'user-hooks',
      description: 'SessionEnd',
      available: false,
      control: 'global-only',
      unavailableReason: 'hook-event-unsupported',
      detail: {
        kind: 'hook',
        sourceId: '@user-hooks',
        suiteId: 'user-hooks',
        event: 'SessionEnd',
        provenance: 'user-hooks',
        support: 'registered-only',
        diagnostic: 'hooks.json: unsupported hook event SessionEnd'
      }
    }
  ]
}

let root: Root | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

async function mountPanel(translator: (key: string) => string = t) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => overview }) as Response)
  )
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(HooksStatusPanel, { t: translator })))
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

it('renders configured hooks grouped by event with support notes and no switches', async () => {
  await mountPanel()
  // Same presentation model as the manager: one secondary event tab per event,
  // first event active, only its rows visible.
  const eventTabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(tab => ['PreToolUse', 'SessionEnd'].includes(tab.textContent ?? ''))
  expect(eventTabs.map(tab => tab.textContent)).toEqual(['PreToolUse', 'SessionEnd'])
  const cards = [...document.querySelectorAll('article')]
  expect(cards).toHaveLength(1)
  const supported = cards[0]!
  expect(supported.getAttribute('data-resource-state')).toBe('active')
  expect(supported.textContent).toContain('echo guard --strict')
  expect(supported.textContent).not.toContain('SessionEnd')
  // Switching to the limited event shows its warning row with the reason.
  const sessionEndTab = eventTabs.find(tab => tab.textContent === 'SessionEnd')!
  await act(async () => sessionEndTab.click())
  const limited = document.querySelector('article[data-resource-state="warning"]')!
  expect(limited.textContent).toContain('SessionEnd')
  expect(limited.textContent).toContain(en.hooksEventUnsupported)
  // Read-only surface: no switch anywhere in the panel.
  expect(document.querySelector('[role="switch"]')).toBeNull()
  // The subtitle states where the declarations are edited.
  expect(document.body.textContent).toContain(en.hooksPanelSubtitle)
  // No help entry, hint row, guide copy or count summary reaches this surface
  // either: the panel is the inventory, and every card opens its own detail.
  expect(document.body.textContent).not.toContain(presetEn.epHelp)
  expect(document.body.textContent).not.toContain(presetEn.epGuide)
  expect(document.body.textContent).not.toContain(presetEn.epLibraryHint)
  expect(document.body.textContent).not.toContain(presetEn.epPreview)
})

it('opens one hook detail per card, with the declared command, matcher and timeout', async () => {
  await mountPanel()
  await act(async () => document.querySelector<HTMLElement>('article')!.click())

  // The shared modal names the provenance and shows the declaration itself.
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('user-hooks')
  expect(dialog.textContent).toContain(en.hookDetailEvent)
  expect(dialog.textContent).toContain('PreToolUse')
  expect(dialog.textContent).toContain(en.hookDetailMatcher)
  expect(dialog.textContent).toContain('Edit')
  expect(dialog.textContent).toContain(en.hookDetailTimeout)
  expect(dialog.textContent).toContain('12 seconds')
  expect(dialog.textContent).toContain(en.hookDetailCommand)
  expect(dialog.textContent).toContain('echo guard --strict')
  expect(dialog.querySelector('[role="switch"]')).toBeNull()

  // Closing it and opening the rejected declaration shows its diagnostic and
  // claims no command, because no hook was admitted behind it.
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="' + en.mcpClose + '"]')!.click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  const sessionEndTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'SessionEnd')!
  await act(async () => sessionEndTab.click())
  await act(async () => document.querySelector<HTMLElement>('article')!.click())

  const rejected = document.querySelector('[role="dialog"]')!
  expect(rejected.textContent).toContain(en.hookDetailDiagnostic)
  expect(rejected.textContent).toContain('hooks.json: unsupported hook event SessionEnd')
  expect(rejected.textContent).not.toContain(en.hookDetailCommand)
  // The matcher row states the catch-all rather than leaving a blank.
  expect(rejected.textContent).toContain('*')
})

it('renders the localized tags and subtitle in a zh build', async () => {
  await mountPanel(tZh)
  const eventTabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(tab => ['PreToolUse', 'SessionEnd'].includes(tab.textContent ?? ''))
  const sessionEndTabZh = eventTabs.find(tab => tab.textContent === 'SessionEnd')!
  await act(async () => sessionEndTabZh.click())
  const warning = document.querySelector('article[data-resource-state="warning"]')!
  expect(warning.textContent).toContain(zh.hooksEventUnsupported)
  expect(document.body.textContent).toContain(zh.hooksPanelSubtitle)
})

it('shows the empty state when nothing is configured', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ rows: [] }) }) as Response)
  )
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(HooksStatusPanel, { t })))
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(document.body.textContent).toContain(en.hooksPanelEmpty)
})

it('gives the settings workspace a seventh Hooks tab on the shared, non-scrolling row', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('/hooks')
              ? { rows: [] }
              : { sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/user', data: '/data' }, unmanaged: [] }
        }) as Response
    )
  )
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(PluginWorkspace, { t })))
  const tablist = document.querySelector('[role="tablist"]')!
  const labels = [...tablist.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)
  expect(labels).toEqual([
    en.workspaceTabMarket,
    en.workspaceTabSkills,
    en.workspaceTabCommands,
    en.workspaceTabPersonas,
    en.workspaceTabMcp,
    en.workspaceTabLsp,
    en.workspaceTabHooks
  ])
  // Equal columns come from the host's own inline grid, so no label can take a
  // wider share than another and the row never has to grow past its frame.
  expect(tablist.getAttribute('style') ?? '').toContain('minmax(0, 1fr)')
  // The shared row clips and ellipsizes instead of scrolling: the manager
  // renders the same module, and no stylesheet asks for a sideways scroll.
  const sharedCss = readFileSync('packages/market-ui/src/ui/resource-tabs.module.css', 'utf8')
  const rowRule = /\.row\s*\{[^}]*/.exec(sharedCss)?.[0] ?? ''
  expect(rowRule).toMatch(/overflow:\s*hidden/)
  expect(rowRule).toMatch(/min-width:\s*0/)
  expect(sharedCss).not.toMatch(/overflow-x:\s*auto/)
  expect(sharedCss).toMatch(/\.labelText\s*\{[^}]*text-overflow:\s*ellipsis/)
  expect(sharedCss).toMatch(/\.labelText\s*\{[^}]*white-space:\s*nowrap/)
  const workspaceCss = readFileSync('packages/market-ui/src/workspace/workspace.module.css', 'utf8')
  expect(workspaceCss).not.toMatch(/overflow-x:\s*auto/)
  expect(workspaceCss).not.toMatch(/tabRow/)
  // The rendered row is the shared one and holds the host tablist; the roving
  // tab stop stays the host's: one selected, focusable tab.
  const rowClass = (await import('../packages/market-ui/src/ui/resource-tabs.module.css')).default.row
  expect(document.querySelector('.' + rowClass)!.querySelector('[role="tablist"]')).not.toBeNull()
  const tabs = [...tablist.querySelectorAll('[role="tab"]')]
  const selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true')
  expect(selected).toHaveLength(1)
  expect(selected[0]!.getAttribute('tabindex')).toBe('0')
})

it('renders the Hooks panel inside the workspace when the tab is selected', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('/hooks')
              ? overview
              : { sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/user', data: '/data' }, unmanaged: [] }
        }) as Response
    )
  )
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(PluginWorkspace, { t })))
  const hooksTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === en.workspaceTabHooks)!
  await act(async () => hooksTab.click())
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(document.body.textContent).toContain('echo guard')
  expect(document.querySelector('[role="switch"]')).toBeNull()
})
