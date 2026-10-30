// @vitest-environment jsdom

/**
 * The output-styles surface: one card per style, the detail a card opens, the
 * capture state, and the text a person reads before any of it reaches the prompt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../../packages/market-ui/src/api.js', () => ({
  fetchOutputStyles: vi.fn(),
  selectOutputStyle: vi.fn(),
  captureOutputStyle: vi.fn(),
  saveUserOutputStyle: vi.fn(),
  deleteUserOutputStyle: vi.fn()
}))
vi.mock('../../../packages/market-ui/src/ui/CodeEditor.js', () => ({
  CodeEditor: (props: { value: string; onChange: (value: string) => void; label: string }) =>
    h('textarea', { 'data-code-editor': props.label, value: props.value, onChange: (event: { target: HTMLTextAreaElement }) => props.onChange(event.target.value) })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import * as apiModule from '../../../packages/market-ui/src/api.js'
import { OutputStylesPanel } from '../../../packages/market-ui/src/features/output-styles/OutputStylesPanel.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'
import type { OutputStylesPayload } from '../../../packages/market-contracts/src/contracts/output-styles.js'

interface MockedApi {
  fetchOutputStyles: ReturnType<typeof vi.fn>
  selectOutputStyle: ReturnType<typeof vi.fn>
  captureOutputStyle: ReturnType<typeof vi.fn>
  saveUserOutputStyle: ReturnType<typeof vi.fn>
  deleteUserOutputStyle: ReturnType<typeof vi.fn>
}

const api = apiModule as unknown as MockedApi

const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))

const PAYLOAD: OutputStylesPayload = {
  styles: [
    { id: 'user:brief', label: 'brief', description: 'Be brief', body: 'Be brief.', source: 'user' },
    {
      id: 'suite:src/teaching',
      label: 'teaching-style',
      description: 'A suite style',
      body: '',
      source: 'suite',
      suiteKey: 'src/teaching',
      fingerprint: 'fp-1',
      capture: 'missing'
    }
  ],
  selected: 'user:brief',
  workspace: '/work/project',
  injected: '## Output Style: brief\nBe brief.'
}

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  api.fetchOutputStyles.mockResolvedValue(PAYLOAD)
  api.selectOutputStyle.mockResolvedValue(PAYLOAD)
  api.captureOutputStyle.mockResolvedValue({ suiteKey: 'src/teaching', fingerprint: 'fp-1', text: 'Teach as you go.' })
  api.saveUserOutputStyle.mockResolvedValue(PAYLOAD)
  api.deleteUserOutputStyle.mockResolvedValue(PAYLOAD)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.clearAllMocks()
})

async function mount(payload: OutputStylesPayload = PAYLOAD): Promise<void> {
  api.fetchOutputStyles.mockResolvedValue(payload)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(OutputStylesPanel, { t })))
  await act(async () => {})
}

const cards = (): HTMLElement[] => [...(host?.querySelectorAll<HTMLElement>('[data-resource-state]') ?? [])]
const cardOf = (name: string): HTMLElement => cards().find(card => (card.textContent ?? '').includes(name))!
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
const button = (label: string, scope: HTMLElement | null = document.body): HTMLButtonElement | null =>
  [...(scope?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(node => node.textContent === label) ?? null

describe('output styles panel', () => {
  it('lists every style as a card, tagged by its source', async () => {
    await mount()
    expect(cards()).toHaveLength(2)
    // Source is a chip on the card, not a section heading: one list, no groups.
    expect(cardOf('brief').textContent).toContain('outputStylesGroupUser')
    expect(cardOf('teaching-style').textContent).toContain('outputStylesGroupSuite')
    expect(host!.textContent).not.toContain('outputStylesGroupBuiltin')
  })

  it('opens a card, shows its text, and selects it from the detail', async () => {
    await mount({ ...PAYLOAD, selected: '', injected: '' })
    await act(async () => cardOf('brief').click())
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('Be brief.')

    await act(async () => button('outputStylesSelect', dialog())!.click())
    await act(async () => {})
    expect(api.selectOutputStyle).toHaveBeenCalledWith('user:brief', undefined)
  })

  it('shows the injected text a selected style contributes', async () => {
    await mount()
    await act(async () => cardOf('brief').click())
    const preview = dialog()!.querySelector('[data-output-style-preview]')
    expect(preview?.textContent).toBe('## Output Style: brief\nBe brief.')
  })

  it('offers capture on a suite style with no text, and refuses selection until then', async () => {
    await mount()
    await act(async () => cardOf('teaching-style').click())
    expect(dialog()!.textContent).toContain('outputStylesCaptureMissing')
    expect(button('outputStylesSelect', dialog())!.disabled).toBe(true)

    await act(async () => button('outputStylesCapture', dialog())!.click())
    await act(async () => {})
    expect(api.captureOutputStyle).toHaveBeenCalledWith('src/teaching', undefined)
  })

  it('edits a user style from its detail', async () => {
    await mount()
    await act(async () => cardOf('brief').click())
    await act(async () => button('panelEdit', dialog())!.click())

    const editor = document.querySelector<HTMLTextAreaElement>('[data-code-editor]')
    expect(editor?.value).toBe('Be brief.')
    await act(async () => button('save')!.click())
    await act(async () => {})
    expect(api.saveUserOutputStyle).toHaveBeenCalledWith({ name: 'brief', description: 'Be brief', body: 'Be brief.' }, undefined)
  })

  it('deletes a user style from its detail', async () => {
    await mount()
    await act(async () => cardOf('brief').click())
    await act(async () => button('panelDelete', dialog())!.click())
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent === 'panelDelete').at(-1)
    await act(async () => confirm!.click())
    await act(async () => {})
    expect(api.deleteUserOutputStyle).toHaveBeenCalledWith('brief', undefined)
  })
})
