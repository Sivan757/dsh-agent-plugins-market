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
const t = (key: string) => en[key] ?? key
const tZh = (key: string) => zh[key] ?? key

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
      detail: { kind: 'suite', sourceId: '@user-hooks', suiteId: 'user-hooks' }
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
      detail: { kind: 'suite', sourceId: '@user-hooks', suiteId: 'user-hooks' }
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
  expect(supported.textContent).toContain('echo guard')
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

it('gives the settings workspace a seventh Hooks tab on a static, non-scrolling row', async () => {
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
  // The settings row carries the static class, not the scrolling one, and the
  // stylesheet keeps it free of any overflow rule.
  const workspaceCss = readFileSync('packages/market-ui/src/workspace/workspace.module.css', 'utf8')
  const staticRule = /\.tabRowStatic\s*\{[^}]*/.exec(workspaceCss)?.[0] ?? ''
  expect(staticRule).toMatch(/flex:\s*none/)
  expect(staticRule).not.toMatch(/overflow/)
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
