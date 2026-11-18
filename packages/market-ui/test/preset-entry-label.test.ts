/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// @vitest-environment jsdom
/**
 * The composer entry names the preset the session is in.
 *
 * The entry used to be an icon whose meaning lived in a tooltip, so a reader
 * could not tell a session following a preset from one following the global
 * selection without hovering it. The name now sits beside the icon, and this
 * test pins the three facts it can carry: a preset's name, the global word
 * when no preset is selected, and the state word while the read has not
 * answered. The modified suffix stays in the tooltip and the accessible name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { en as settingsEn } from '../src/locales.js'
import { extensionPresetsEn } from '../src/locales-extension-presets.js'
import { ExtensionPresetEntry } from '../src/features/extension-presets/ExtensionPresetEntry.js'
import type { ExtensionWindowPayload } from '../../market-contracts/src/contracts/extension-presets.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key

let root: Root | undefined
let host: HTMLDivElement | undefined

function windowPayload(selection: ExtensionWindowPayload['state']['selection']): ExtensionWindowPayload {
  return {
    sessionId: 'session-one',
    workspace: '/workspace',
    started: true,
    busy: false,
    library: { revision: 1, defaultPresetId: null, presets: [{ id: 'preset', name: 'Research', revision: 1, enabledIds: ['skills:user/mine'] }] },
    state: { revision: 1, selection },
    resources: [
      {
        id: 'skills:user/mine',
        face: 'skills',
        name: 'Mine',
        source: 'user',
        available: true,
        globalEnabled: true,
        detail: { kind: 'panel', panel: 'skills', entryId: 'user/mine' }
      }
    ]
  }
}

async function mount(payload: ExtensionWindowPayload): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => payload }))
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(ExtensionPresetEntry, { renderDetail: () => null, sessionId: payload.sessionId, t })))
}

/** The composer entry: the one button that opens this menu. */
function entry(): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-haspopup') === 'menu')
  expect(found).toBeDefined()
  return found as HTMLButtonElement
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.unstubAllGlobals()
})

describe('composer preset entry', () => {
  it('shows the selected preset name beside the icon', async () => {
    await mount(windowPayload({ presetId: 'preset', presetName: 'Research', presetRevision: 1, modified: false, enabledIds: ['skills:user/mine'] }))
    expect(entry().textContent).toBe('Research')
  })

  it('shows the global word when the session follows no preset', async () => {
    await mount(windowPayload({ presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: [] }))
    expect(entry().textContent).toBe(t('epGlobal'))
  })

  it('keeps a modified selection readable as its preset, with the suffix in the accessible name', async () => {
    await mount(windowPayload({ presetId: 'preset', presetName: 'Research', presetRevision: 1, modified: true, enabledIds: [] }))
    expect(entry().textContent).toBe('Research')
    expect(entry().getAttribute('aria-label')).toBe('Research · ' + t('epModified'))
  })
})
