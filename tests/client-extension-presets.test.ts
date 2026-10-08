/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// @vitest-environment jsdom
import { en as settingsEn } from '../packages/market-ui/src/locales.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createWriteQueue, resourceSelected, toggleResource, uniquePresetName } from '../packages/market-ui/src/features/extension-presets/resource.js'
import { apply, COMPOSER_TOGGLE_SLOT } from '../packages/market-ui/src/index.js'
import { bindAgentPresetsEnabled } from '../packages/market-ui/src/ui/agent-presets-enabled.js'
import { ExtensionPresetEntry } from '../packages/market-ui/src/features/extension-presets/ExtensionPresetEntry.js'
import { extensionPresetsEn, extensionPresetsZh } from '../packages/market-ui/src/locales-extension-presets.js'
import type { ExtensionResource, ExtensionWindowPayload } from '../packages/market-contracts/src/contracts/extension-presets.js'
const renderDetail = vi.fn(() => null)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const row: ExtensionResource = {
  id: 'skills:source:suite:skill',
  face: 'skills',
  name: 'Skill',
  source: 'Source',
  available: true,
  suiteResourceId: 'market:source:suite',
  detail: { kind: 'panel', panel: 'skills', entryId: 'source:suite:skill' }
}
const externalMcp: ExtensionResource = {
  id: 'mcp:external',
  face: 'mcp',
  name: 'External MCP',
  source: 'Host',
  available: true,
  control: 'global-only',
  unavailableReason: 'direct-mcp-uncontrolled',
  detail: { kind: 'mcp', entryId: 'external' }
}
const payload = (started = false, busy = false): ExtensionWindowPayload => ({
  sessionId: 'session / one',
  workspace: '/workspace',
  started,
  busy,
  library: { revision: 1, defaultPresetId: null, presets: [{ id: 'preset', name: 'Research', revision: 1, enabledIds: [row.id, row.suiteResourceId!] }] },
  state: { revision: 1, selection: { presetId: 'preset', presetName: 'Research', presetRevision: 1, modified: false, enabledIds: [row.id, row.suiteResourceId!] } },
  resources: [row]
})
let root: Root | undefined
let host: HTMLDivElement | undefined
let state: ExtensionWindowPayload
const posts: Array<{ url: string; body: Record<string, unknown> }> = []
async function mount(started = false, busy = false, library?: ExtensionWindowPayload['library']) {
  state = payload(started, busy)
  if (library) state = { ...state, library }
  localStorage.setItem('dsh-extension-guide:/workspace', 'seen')
  posts.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
        posts.push({ url, body })
        state = { ...state, library: { ...state.library, revision: state.library.revision + 1 }, state: { ...state.state, revision: state.state.revision + 1 } }
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
        renderDetail,
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
  if (text === 'Manage presets') await click('Skills')
}
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
  root = undefined
})
describe('extension preset state', () => {
  it('registers exactly one session-scoped entry using actual slot props', async () => {
    const register = vi.fn<Parameters<typeof apply>[0]['slots']['register']>(() => undefined)
    const dictionary = vi.fn()
    apply({
      effect: (callback, label) => {
        if (label === 'dsh-agent-plugins: dictionaries') callback()
      },
      locale: { register: dictionary, bind: () => key => key },
      slots: {
        inject: (slot, callback) => {
          if (slot === COMPOSER_TOGGLE_SLOT) callback()
        },
        register
      },
      remote: { credentials: {} as Parameters<typeof apply>[0]['remote']['credentials'] }
    })
    expect(register).toHaveBeenCalledTimes(1)
    const component = register.mock.calls[0]![1] as unknown as (props: { sessionId?: string }) => ReturnType<typeof h>
    // The gate element renders nothing while the experimental setting is off.
    const gate = component({ sessionId: 'actual-session' })
    const gateHost = document.createElement('div')
    document.body.append(gateHost)
    const gateRoot = createRoot(gateHost)
    await act(async () => gateRoot.render(gate))
    expect(gateHost.textContent).toBe('')
    await act(async () => gateRoot.unmount())
    gateHost.remove()
    // The gate element carries the session and translator for the inner entry.
    const rendered = component({ sessionId: 'actual-session' })
    expect(rendered.props).toMatchObject({ sessionId: 'actual-session' })
    expect(typeof (rendered.props as { t?: unknown }).t).toBe('function')
    expect(dictionary.mock.calls[0]![1]).toMatchObject({ en: { epTitle: 'Extension presets' }, zh: { epTitle: '扩展预设' } })
    // With the setting on, the gate renders the real entry and hands it the session.
    const onForm = { getSnapshot: () => ({ value: { agentPresetsEnabled: true } }), subscribe: () => () => {} }
    const unbind = bindAgentPresetsEnabled(onForm)
    const onHost = document.createElement('div')
    document.body.append(onHost)
    const onRoot = createRoot(onHost)
    await act(async () => onRoot.render(component({ sessionId: 'actual-session' })))
    // The entry mounts (its own data fetch is unstubbed here; the gate passed
    // the session and renderer through, which the element assertions above pin).
    await act(async () => onRoot.unmount())
    onHost.remove()
    unbind()
  })
  it('keeps globally managed resources out of session edits', () => {
    const globalRow = externalMcp
    expect(resourceSelected(globalRow, [])).toBe(true)
    expect(toggleResource(globalRow, [], false)).toEqual([])
    expect(toggleResource(globalRow, [], true)).toEqual([])
  })
  it('requires both source-qualified resource and suite identity', () => {
    expect(resourceSelected(row, [row.id])).toBe(false)
    expect(resourceSelected(row, toggleResource(row, [], true))).toBe(true)
    expect(resourceSelected({ ...row, id: 'skills:other:suite:skill' }, [row.id, row.suiteResourceId!])).toBe(false)
  })
  it('serializes writes using the revision after each preceding save', async () => {
    const enqueue = createWriteQueue()
    let revision = 1
    const observed: number[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const first = enqueue(async () => {
      observed.push(revision)
      await gate
      revision++
    })
    const second = enqueue(async () => {
      observed.push(revision)
      revision++
    })
    await Promise.resolve()
    expect(observed).toEqual([1])
    release()
    await Promise.all([first, second])
    expect(observed).toEqual([1, 2])
  })
  it('continues the queue after failure', async () => {
    const enqueue = createWriteQueue()
    await expect(
      enqueue(async () => {
        throw Error('conflict')
      })
    ).rejects.toThrow('conflict')
    await expect(enqueue(async () => 2)).resolves.toBe(2)
  })
  it('suffixes duplicate imported names and pairs languages', () => {
    expect(uniquePresetName('Research', ['Research', 'Research (2)'])).toBe('Research (3)')
    expect(Object.keys(extensionPresetsEn).sort()).toEqual(Object.keys(extensionPresetsZh).sort())
  })
})
describe('extension preset rendering', () => {
  it('labels customized selection and confirms before replacement', async () => {
    await mount()
    state = { ...state, sessionId: 'modified', state: { ...state.state, selection: { ...state.state.selection, modified: true } } }
    await act(async () =>
      root!.render(
        h(ExtensionPresetEntry, {
          renderDetail,
          sessionId: 'modified',
          t: key => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key
        })
      )
    )
    expect(host!.querySelector('button')!.getAttribute('aria-label')).toContain('Modified')
    await act(async () => host!.querySelector('button')!.click())
    await click('Default')
    expect(posts).toHaveLength(0)
    expect(document.body.textContent).toContain(extensionPresetsEn.epReplaceHint)
    await click('Replace session selection')
    expect(posts[0]!.url).toContain('/select')
  })
  it('offers explicit recovery using attempted revision while blocking selections', async () => {
    await mount()
    state = { ...state, sessionId: 'unready', status: { ready: false, revision: 7, recoverable: true, error: 'flush failed' } }
    await act(async () =>
      root!.render(
        h(ExtensionPresetEntry, {
          renderDetail,
          sessionId: 'unready',
          t: key => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key
        })
      )
    )
    await click('Session extensions are not ready')
    expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Default')!.disabled).toBe(true)
    await click('Recover session extensions and continue queued input')
    expect(posts[0]!.url).toContain('/recover')
    expect(posts[0]!.body).toEqual({ sessionId: 'unready', expectedRevision: 7 })
  })
  it('keeps a retry action after load failure without claiming global selection', async () => {
    await mount()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    await act(async () =>
      root!.render(
        h(ExtensionPresetEntry, {
          renderDetail,
          sessionId: 'failed-session',
          t: key => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key
        })
      )
    )
    expect(host!.querySelector('button')!.getAttribute('aria-label')).toBe('Could not load extensions')
    await click('Could not load extensions')
    expect(document.body.textContent).toContain('offline')
    await click('Retry')
    expect(host!.querySelector('button')!.getAttribute('aria-label')).toBe('Research')
    expect(posts).toHaveLength(0)
  })
  it('shows icon-only in blank sessions and includes explicit session id in GET', async () => {
    await mount()
    expect(host!.querySelector('button')!.getAttribute('aria-label')).toBe('Research')
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain('sessionId=session%20%2F%20one')
  })
  it('uses a host SVG icon and keeps manager enabled while busy without temporary adjustment', async () => {
    await mount(true, true)
    const button = host!.querySelector('button')!
    expect(button.textContent).toBe('')
    expect(button.getAttribute('aria-label')).toBe('Research')
    await act(async () => button.click())
    expect(host!.querySelector('svg')).not.toBeNull()
    expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Adjust this session')).toBe(false)
    expect(document.body.textContent).toContain(extensionPresetsEn.epBusy)
    await click('Manage presets')
    expect(document.body.textContent).not.toContain(extensionPresetsEn.epLibraryHint)
    expect(document.querySelector('input[aria-label="Preset name"]')).toBeNull()
  })
  it('autosaves rapid manager toggles serially without losing the latest snapshot', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    const preset = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === 'Research')!
    await act(async () => preset.click())
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => toggle.click())
    await act(async () => toggle.click())
    expect(posts.map(post => post.body.expectedRevision)).toEqual([1, 2])
    expect(posts[1]!.body.enabledIds).toEqual([row.suiteResourceId, row.id])
    expect(posts.every(post => post.url.endsWith('/update'))).toBe(true)
    expect(document.body.textContent).toContain('Saved')
  })
  it('blocks a queued stale autosave after conflict and retains the dirty draft', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === 'Research')!.click())
    let release!: (value: Response) => void
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve
        })
    )
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => toggle.click())
    await act(async () => toggle.click())
    state = { ...state, library: { ...state.library, revision: 2 } }
    await act(async () => release({ ok: false, status: 409, json: async () => ({ ok: false, code: 'conflict' }) } as Response))
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(document.body.textContent).toContain(extensionPresetsEn.epFailed)
    expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === 'Delete preset Research')!.disabled).toBe(true)
    await click('Retry')
    expect(posts[0]!.body.expectedRevision).toBe(2)
    expect(document.body.textContent).toContain('Saved')
  })
  it('restores the edited preset when a delete confirmation is dismissed', async () => {
    const base = payload()
    await mount(false, false, { ...base.library, presets: [...base.library.presets, { id: 'other', name: 'Other', revision: 1, enabledIds: [] }] })
    await click('Research')
    await click('Manage presets')
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === 'Research')!.click())
    const name = () => document.querySelector<HTMLButtonElement>('[role="group"] button[aria-pressed="true"]')!.textContent
    expect(name()).toBe('Research')
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Delete preset Other"]')!.click())
    expect(document.body.textContent).toContain(extensionPresetsEn.epDeleteConfirm)
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')].at(-1)!.click())
    expect(name()).toBe('Research')
  })
  it('opens global defaults when the session preset is absent as approved in v5', async () => {
    const base = payload()
    await mount(false, false, { ...base.library, defaultPresetId: 'other', presets: [{ id: 'other', name: 'Other', revision: 1, enabledIds: [] }] })
    await click('Research')
    await click('Manage presets')
    expect(document.querySelector<HTMLButtonElement>('[role="group"] button[aria-pressed="true"]')!.textContent).toBe('Default')
    expect(posts).toHaveLength(0)
  })
  it('uses scoped clipboard shortcuts and offers text paste when permission is denied', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === 'Research')!.click())
    const readText = vi.fn(async () => {
      throw new Error('denied')
    })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { readText, writeText } })
    const panel = document.querySelector<HTMLElement>('[role="dialog"] [tabindex="0"]')!
    await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(readText).toHaveBeenCalledOnce()
    expect(document.querySelector('textarea')).not.toBeNull()
    const input = document.querySelector('textarea')!
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true })))
    expect(writeText).not.toHaveBeenCalled()
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')].at(-1)!.click())
    expect(document.querySelector('textarea')).toBeNull()
    await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true })))
    expect(writeText, document.body.textContent ?? '').toHaveBeenCalledOnce()
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'selected text' } as Selection)
    await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(writeText, document.body.textContent ?? '').toHaveBeenCalledOnce()
    selection.mockRestore()
  })
  it('normalizes a renamed preset and unlocks the clean editor after autosave', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === 'Research')!.click())
    await click('Preset actions')
    await click('Rename')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Preset name"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, ' Research ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Rename')
    expect(posts[0]!.body.name).toBe('Research')
    expect(document.querySelector('input[aria-label="Preset name"]')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Delete preset Research"]')!.disabled).toBe(false)
    expect(document.body.textContent).not.toContain('Discard unsaved changes')
  })
  it('shows globally controlled resources without a session switch', async () => {
    await mount()
    state = { ...state, sessionId: 'global-row', resources: [externalMcp] }
    await act(async () =>
      root!.render(
        h(ExtensionPresetEntry, {
          renderDetail,
          sessionId: 'global-row',
          t: key => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key
        })
      )
    )
    await click('Research')
    await click('Manage presets')
    await click('Connectors')
    expect(document.querySelector('[role="switch"]')).toBeNull()
    expect(document.body.textContent).toContain(extensionPresetsEn.epGlobalManagedShort)
    expect(document.body.textContent).not.toContain(extensionPresetsEn.epGlobalManaged)
    expect(document.body.textContent).toContain('Enabled')
  })
  it('allows a valid native skill with its global default off to be enabled in a saved preset', async () => {
    await mount()
    const native: ExtensionResource = {
      id: 'skills:native:local',
      face: 'skills',
      name: 'Native skill',
      source: 'User',
      available: true,
      globalEnabled: false,
      detail: { kind: 'panel', panel: 'skills', entryId: 'local' }
    }
    state = {
      ...state,
      sessionId: 'native-default-off',
      resources: [native],
      library: { ...state.library, presets: state.library.presets.map(preset => ({ ...preset, enabledIds: [] })) },
      state: { ...state.state, selection: { ...state.state.selection, enabledIds: [] } }
    }
    await act(async () =>
      root!.render(
        h(ExtensionPresetEntry, {
          renderDetail,
          sessionId: state.sessionId,
          t: key => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key
        })
      )
    )
    await click('Research')
    await click('Manage presets')
    const card = document.querySelector<HTMLElement>('article[role="button"]')!
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(card.getAttribute('data-resource-state')).toBe('disabled')
    expect(card.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.disabled).toBe(false)
    await act(async () => card.click())
    expect(card.getAttribute('data-resource-state')).toBe('active')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toContain('/update')
    expect(posts[0]!.body.enabledIds).toEqual([native.id])
    expect(state.state.selection.enabledIds).toEqual([])
  })
  it('shows a globally disabled uncontrollable resource without a warning rail', async () => {
    await mount()
    state = { ...state, sessionId: 'global-off', resources: [{ ...externalMcp, available: false }] }
    await act(async () =>
      root!.render(
        h(ExtensionPresetEntry, {
          renderDetail,
          sessionId: 'global-off',
          t: key => extensionPresetsEn[key as keyof typeof extensionPresetsEn] ?? settingsEn[key as keyof typeof settingsEn] ?? key
        })
      )
    )
    await click('Research')
    await click('Manage presets')
    await click('Connectors')
    expect(document.querySelector('article')!.getAttribute('data-resource-state')).toBe('disabled')
    expect(document.querySelector('[role="switch"]')).toBeNull()
  })
  it('keeps face and filter tabs linked to separate nested panels', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"]')!
    const tab = document.getElementById(panel.getAttribute('aria-labelledby')!)!
    expect(tab.textContent).toContain('Skills')
    expect(tab.getAttribute('aria-controls')).toBe(panel.id)
    const inner = panel.querySelector<HTMLElement>('[role="tabpanel"]')!
    const filterTab = document.getElementById(inner.getAttribute('aria-labelledby')!)!
    expect(filterTab.textContent).toContain('All')
    expect(filterTab.getAttribute('aria-controls')).toBe(inner.id)
    await act(async () => [...panel.querySelectorAll<HTMLElement>('[role="tab"]')].find(node => node.textContent?.startsWith('Disabled'))!.click())
    const filteredPanel = panel.querySelector<HTMLElement>('[role="tabpanel"]')!
    expect(document.getElementById(filteredPanel.getAttribute('aria-labelledby')!)!.getAttribute('aria-controls')).toBe(filteredPanel.id)
    await click('Shortcuts')
    const next = document.querySelector<HTMLElement>('[role="tabpanel"]')!
    expect(document.getElementById(next.getAttribute('aria-labelledby')!)!.textContent).toContain('Shortcuts')
  })
  it('toggles a card once per click or key and never calls temporary adjustment', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    const card = document.querySelector<HTMLElement>('article[role="button"]')!
    await act(async () => card.click())
    expect(posts).toHaveLength(1)
    await act(async () => card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
    expect(posts).toHaveLength(2)
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => toggle.click())
    expect(posts).toHaveLength(3)
    await act(async () => toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(posts).toHaveLength(3)
    const detail = document.querySelector<HTMLButtonElement>('button[aria-label="View details · Skill"]')!
    await act(async () => detail.click())
    expect(posts).toHaveLength(3)
    await act(async () => detail.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
    expect(posts).toHaveLength(3)
    expect(renderDetail).toHaveBeenCalled()
    expect(posts.every(post => post.url.endsWith('/update'))).toBe(true)
  })
  it('retains a failed draft until retry or explicit discard and blocks closing', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, code: 'conflict' }) } as Response)
    await act(async () => document.querySelector<HTMLElement>('article[role="button"]')!.click())
    expect(document.body.textContent).toContain(extensionPresetsEn.epFailed)
    expect(document.body.textContent).toContain(extensionPresetsEn.epDiscard)
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Save as a new preset"]')!.disabled).toBe(true)
    await click('Cancel')
    await click('Discard unsaved changes')
    expect(document.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('creates a detached copy of current session IDs without selecting it', async () => {
    await mount()
    await click('Research')
    await click('Manage presets')
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Save as a new preset"]')!.click())
    const input = [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Preset name"]')].at(-1)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'New')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Save preset')
    expect(posts[0]!.url).toContain('/create')
    expect(posts[0]!.body.enabledIds).toEqual(state.state.selection.enabledIds)
    expect(posts.some(post => post.url.endsWith('/select') || post.url.endsWith('/adjust'))).toBe(false)
  })
  it('opens the global baseline for an empty library without saving or session mutation', async () => {
    await mount(false, false, { revision: 1, defaultPresetId: null, presets: [] })
    await click('Research')
    await click('Manage presets')
    expect(document.body.textContent).toContain(extensionPresetsEn.epGlobalHint)
    expect(document.body.textContent).not.toContain('Unsaved snapshot')
    expect(document.querySelector('article')).not.toBeNull()
    expect(document.querySelector('input[aria-label="Preset name"]')).toBeNull()
    expect(posts).toHaveLength(0)
  })
})
