// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * The surface talks to one route pair; the test drives those answers directly
 * so every assertion is about what the page renders, not about HTTP.
 */
// vi.mock is hoisted above the imports, so the factory builds its own state and
// the test reaches it back through the mocked module.
vi.mock('../../../packages/market-ui/src/api.js', () => ({
  fetchInstructions: vi.fn(),
  saveInstructionFile: vi.fn(),
  deleteInstructionFile: vi.fn()
}))
vi.mock('../../../packages/market-ui/src/ui/CodeEditor.js', () => ({
  CodeEditor: (props: { value: string; onChange: (value: string) => void; label: string }) =>
    h('textarea', { 'data-code-editor': props.label, value: props.value, onChange: (event: { target: HTMLTextAreaElement }) => props.onChange(event.target.value) })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import * as apiModule from '../../../packages/market-ui/src/api.js'
import { InstructionsPanel } from '../../../packages/market-ui/src/features/instructions/InstructionsPanel.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'
import type { InstructionsPayload } from '../../../packages/market-contracts/src/contracts/instructions.js'

interface MockedApi {
  fetchInstructions: ReturnType<typeof vi.fn>
  saveInstructionFile: ReturnType<typeof vi.fn>
  deleteInstructionFile: ReturnType<typeof vi.fn>
}

// The module is mocked above, so every member is a vi.fn at runtime. The cast
// goes through the recorded mock type rather than the real implementation,
// whose members are not spies.
const api = apiModule as unknown as MockedApi

// The real dictionary substitutes into its own sentence; the test translator
// keeps the key and appends the values, so an assertion can see both the
// sentence the page chose and every value it passed.
const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))

const PAYLOAD: InstructionsPayload = {
  available: true,
  cwd: '/work/project/apps/site',
  projectRoot: '/work/project',
  budget: 65536,
  maxSourceBytes: 1_048_576,
  total: 64,
  rows: [
    {
      scope: 'user-global',
      directory: '.',
      candidate: 'AGENTS.md',
      displayPath: '$DSH_HOME/AGENTS.md',
      path: '/home/.dsh/AGENTS.md',
      exists: true,
      size: 20,
      status: 'loaded',
      content: '# Global\n'
    },
    {
      scope: 'agents-global',
      directory: '.',
      candidate: 'AGENTS.md',
      displayPath: '$DSH_AGENTS_HOME/AGENTS.md',
      path: '/home/.agents/AGENTS.md',
      exists: true,
      size: 20,
      status: 'duplicate',
      duplicateOf: '$DSH_HOME/AGENTS.md',
      content: '# Global\n'
    },
    {
      scope: 'project',
      directory: '.',
      candidate: 'AGENTS.md',
      displayPath: 'AGENTS.md',
      path: '/work/project/AGENTS.md',
      exists: true,
      size: 12,
      status: 'loaded',
      content: '# Root\n'
    },
    { scope: 'project', directory: '.', candidate: 'CLAUDE.md', displayPath: 'CLAUDE.md', path: '/work/project/CLAUDE.md', exists: false, status: 'missing' },
    { scope: 'project', directory: 'apps', candidate: 'AGENTS.md', displayPath: 'apps/AGENTS.md', path: '/work/project/apps/AGENTS.md', exists: false, status: 'missing' },
    {
      scope: 'project',
      directory: 'apps/site',
      candidate: 'AGENTS.md',
      displayPath: 'apps/site/AGENTS.md',
      path: '/work/project/apps/site/AGENTS.md',
      exists: true,
      size: 32,
      status: 'truncated',
      originalBytes: 32,
      includedBytes: 0,
      content: '# Site\n'
    }
  ],
  rendered: {
    text: 'Workspace instruction budget 120 bytes: omitted AGENTS.md; truncated apps/site/AGENTS.md from 32 to 0 bytes',
    omitted: [{ absolutePath: '/work/project/AGENTS.md', displayPath: 'AGENTS.md' }],
    truncated: [{ displayPath: 'apps/site/AGENTS.md', originalBytes: 32, includedBytes: 0 }]
  }
}

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  api.fetchInstructions.mockResolvedValue(PAYLOAD)
  api.saveInstructionFile.mockResolvedValue(undefined)
  api.deleteInstructionFile.mockResolvedValue({ aliases: [], targetIsLink: false })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.clearAllMocks()
})

async function mount(payload: InstructionsPayload = PAYLOAD, sessionId?: string): Promise<void> {
  api.fetchInstructions.mockResolvedValue(payload)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(InstructionsPanel, { t, sessionId })))
  // The read settles after the first paint.
  await act(async () => {})
}

const cards = (): HTMLElement[] => [...(host?.querySelectorAll<HTMLElement>('[data-resource-state]') ?? [])]
const paths = (): string[] => cards().map(card => card.querySelector('span')?.textContent ?? '')
const statuses = (): string[] => cards().map(card => card.getAttribute('data-resource-state') ?? '')

describe('instructions panel', () => {
  it('draws its toolbar and list box before the first read lands', async () => {
    // Same reason as every other panel: the skeleton cannot be shorter than the
    // settled surface, or switching to this tab moves everything below the header.
    api.fetchInstructions.mockReturnValueOnce(new Promise(() => {}))
    await mount()
    expect(host!.querySelector('[data-panel-toolbar]')).not.toBeNull()
    expect(host!.querySelector('[class*="results"]')).not.toBeNull()
    expect(host!.textContent).toContain('loading')
  })

  it('lists every existing file in the chain, project half included, in load order', async () => {
    await mount()
    // The project rows used to be filtered out, which hid the files that actually live in a
    // repository — and made 新建 unable to create one.
    expect(paths()).toEqual(['$DSH_HOME/AGENTS.md', '$DSH_AGENTS_HOME/AGENTS.md', 'AGENTS.md', 'apps/site/AGENTS.md'])
    expect(statuses()).toEqual(['active', 'active', 'active', 'active'])
    expect(host!.textContent).toContain('instructionsGroupProject')
    // No session is named, so the page says which directory it read. Without the
    // line a reader whose project files are missing has no way to tell why.
    expect(host!.querySelector('[data-instructions-session-hint]')?.textContent).toBe('instructionsSessionHint')
  })

  it('drops the scope line when a session names the directory', async () => {
    await mount(PAYLOAD, 'session-1')
    expect(host!.querySelector('[data-instructions-session-hint]')).toBeNull()
  })

  it('leaves the file rows out when the file does not exist', async () => {
    await mount({
      ...PAYLOAD,
      rows: PAYLOAD.rows.map(row => (row.scope === 'agents-global' ? { ...row, exists: false, status: 'missing' as const, size: undefined, content: undefined } : row))
    })
    // A list of things that are not there cannot be seen, found, or used.
    expect(paths()).toEqual(['$DSH_HOME/AGENTS.md', 'AGENTS.md', 'apps/site/AGENTS.md'])
  })

  it('shows neither a budget bar nor the injected text', async () => {
    await mount()
    expect(host!.querySelector('[role="progressbar"]')).toBeNull()
    expect(host!.querySelector('[data-instructions-preview]')).toBeNull()
  })

  it('names the package when the profile does not provide it', async () => {
    await mount({ ...PAYLOAD, available: false, reason: 'missing package', rows: [], rendered: { text: '', omitted: [], truncated: [] } })
    const state = host!.querySelector('[data-instructions-unavailable]')
    expect(state).not.toBeNull()
    expect(state!.textContent).toContain('@deepseek-ai/dsh-agent-instructions')
    expect(cards()).toEqual([])
  })

  it('takes focus into its dialog and gives it back to the card on Escape', async () => {
    // The connector panel pins this for the dialogs the host draws; this one is ours, and a
    // reading-first page is exactly where a misplaced focus would be invisible.
    await mount()
    const card = cards()[0]!.querySelector<HTMLElement>('[data-card-open]')!
    card.focus()
    await act(async () => card.click())
    expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true)
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(card)
  })

  it('opens a card for reading, and edits only when asked', async () => {
    await mount()
    await act(async () => cards()[0]!.click())
    // Reading first: the dialog shows the file, the path and the preview, and no editor.
    expect(document.querySelector('[data-code-editor]')).toBeNull()
    expect(document.querySelector('[data-instruction-preview]')?.textContent).toBe('# Global\n')
    expect(document.body.textContent).toContain('instructionsDetailPath')
    const edit = [...document.querySelectorAll('button')].find(button => button.textContent === 'instructionsEdit')
    await act(async () => edit!.click())

    const editor = document.querySelector<HTMLTextAreaElement>('[data-code-editor]')
    expect(editor).not.toBeNull()
    expect(editor!.value).toBe('# Global\n')
    // React tracks the DOM value itself, so the native setter is what a real keystroke goes
    // through before the change event fires.
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setValue = descriptor?.set
      setValue?.call(editor, '# Global edited\n')
      editor!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'save')
    await act(async () => save!.click())
    await act(async () => {})

    expect(api.saveInstructionFile).toHaveBeenCalledWith({ scope: 'user-global', directory: '.', candidate: 'AGENTS.md', text: '# Global edited\n' }, undefined)
    // The save re-reads the files, which is how the card reflects the new bytes.
    expect(api.fetchInstructions).toHaveBeenCalledTimes(2)
  })

  it('asks which candidate to create instead of picking one', async () => {
    await mount({
      ...PAYLOAD,
      rows: PAYLOAD.rows.map(row => (row.scope === 'user-global' ? { ...row, exists: false, status: 'missing' as const, size: undefined, content: undefined } : row))
    })
    // The missing file is not listed, so creation starts from the header action — and the
    // action lists every candidate the host would load, one menu item per file.
    const add = [...host!.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'instructionsCreate')
    await act(async () => add!.click())
    const item = [...document.querySelectorAll('[role="menuitem"], [role="menuitembutton"]')].find(node => (node.textContent ?? '').includes('$DSH_HOME/AGENTS.md'))
    expect(item, 'the menu names the file to create').toBeDefined()
    await act(async () => (item as HTMLElement).click())
    const editor = document.querySelector<HTMLTextAreaElement>('[data-code-editor]')
    expect(editor?.value).toBe('')
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'save')
    await act(async () => save!.click())
    await act(async () => {})
    expect(api.saveInstructionFile).toHaveBeenCalledWith({ scope: 'user-global', directory: '.', candidate: 'AGENTS.md', text: '' }, undefined)
  })

  it('warns about the other names a deletion leaves behind', async () => {
    api.deleteInstructionFile.mockResolvedValue({ aliases: ['CLAUDE.md'], targetIsLink: false })
    await mount()
    await act(async () => cards()[0]!.click())
    // The destructive action sits inside the dialog the card opened.
    const remove = [...document.querySelectorAll('button')].find(button => button.textContent === 'panelDelete')
    await act(async () => remove!.click())
    const confirm = [...document.querySelectorAll('button')].filter(button => button.textContent === 'panelDelete').at(-1)
    await act(async () => confirm!.click())
    await act(async () => {})
    expect(api.deleteInstructionFile).toHaveBeenCalledWith({ scope: 'user-global', directory: '.', candidate: 'AGENTS.md' }, undefined)
    expect(host!.textContent).toContain('CLAUDE.md')
  })
  it('searches the list, filters by state, and switches the layout', async () => {
    await mount()
    const field = host!.querySelector<HTMLInputElement>('[data-panel-toolbar] input')!
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(field, 'DSH_AGENTS')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(paths()).toEqual(['$DSH_AGENTS_HOME/AGENTS.md'])

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(field, '')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Two scope cuts, and no state cut: the card's own tag names each status, so every row
    // stays reachable while browsing. The cuts answer "which half is this file in", not
    // "which files loaded".
    const cuts = [...host!.querySelectorAll('[data-panel-toolbar] [role="tab"]')].map(node => (node.textContent ?? '').trim())
    expect(cuts).toEqual(['filterAll 4', 'instructionsGroupGlobal 2', 'instructionsGroupProject 2'])

    // The view switch re-lays the same collection out as a list.
    const toList = host!.querySelector<HTMLButtonElement>('[data-panel-toolbar] button[aria-label="list"]')!
    await act(async () => toList.click())
    expect(host!.querySelector('[data-resource-view]')?.getAttribute('data-resource-view')).toBe('list')
  })

  it('gives every class it applies a rule in its own stylesheet', async () => {
    // The loading line, the read failure and the unavailable card applied six
    // class names that existed nowhere, so they rendered with browser defaults
    // (an `h3` with its own margins) inside a panel that insets everything else.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('packages/market-ui/src/features/instructions/InstructionsPanel.tsx', 'utf8')
    const styles = readFileSync('packages/market-ui/src/features/instructions/instructions.module.css', 'utf8')
    const used = [...new Set([...source.matchAll(/css\.([A-Za-z0-9_]+)/g)].map(match => match[1]))]
    const defined = new Set([...styles.matchAll(/^\.([A-Za-z0-9_]+)/gm)].map(match => match[1]))
    expect(used.filter(name => !defined.has(name))).toEqual([])
  })
})
