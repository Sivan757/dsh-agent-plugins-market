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

async function mount(payload: InstructionsPayload = PAYLOAD): Promise<void> {
  api.fetchInstructions.mockResolvedValue(payload)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(InstructionsPanel, { t })))
  // The read settles after the first paint.
  await act(async () => {})
}

const cards = (): HTMLElement[] => [...(host?.querySelectorAll<HTMLElement>('[data-resource-state]') ?? [])]
const paths = (): string[] => cards().map(card => card.firstElementChild?.textContent ?? '')
const statuses = (): string[] => cards().map(card => card.getAttribute('data-resource-state') ?? '')

describe('instructions panel', () => {
  it('lists the user-level files as clickable cards, in load order', async () => {
    await mount()
    // The project candidates and the session directory are not listed: the row answers which
    // files this session loads, and the cards open them the way every other panel does.
    expect(paths()).toEqual(['$DSH_HOME/AGENTS.md', '$DSH_AGENTS_HOME/AGENTS.md'])
    expect(statuses()).toEqual(['active', 'active'])
    expect(host!.textContent).not.toContain('instructionsGroupProject')
    expect(host!.textContent).not.toContain('instructionsSessionHint')
  })

  it('shows the rendered total against the budget', async () => {
    await mount()
    const bar = host!.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('0')
    expect(host!.textContent).toContain('instructionsBudgetUsage')

    await mount({ ...PAYLOAD, total: 32768 })
    expect(host!.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50')
  })

  it('names the package when the profile does not provide it', async () => {
    await mount({ ...PAYLOAD, available: false, reason: 'missing package', rows: [], rendered: { text: '', omitted: [], truncated: [] } })
    const state = host!.querySelector('[data-instructions-unavailable]')
    expect(state).not.toBeNull()
    expect(state!.textContent).toContain('@deepseek-ai/dsh-agent-instructions')
    expect(cards()).toEqual([])
  })

  it('previews the injected text and names the omitted and truncated files', async () => {
    await mount()
    const preview = host!.querySelector('[data-instructions-preview]')
    expect(preview?.querySelector('pre')?.textContent).toBe(String(PAYLOAD.rendered.text))
    expect(preview?.textContent).toContain('instructionsPreviewOmitted')
    expect(preview?.textContent).toContain('instructionsPreviewTruncated')
  })

  it('opens a card for editing and saves the draft', async () => {
    await mount()
    await act(async () => cards()[0]!.click())

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

  it('offers creation on a global file that does not exist yet', async () => {
    await mount({
      ...PAYLOAD,
      rows: PAYLOAD.rows.map(row => (row.scope === 'user-global' ? { ...row, exists: false, status: 'missing' as const, size: undefined, content: undefined } : row))
    })
    await act(async () => cards()[0]!.click())
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
})
