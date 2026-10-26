// @vitest-environment jsdom

/**
 * The output-styles surface: the row, the selection, the capture state and the
 * preview a person reads before any of it reaches their prompt.
 *
 * The surface talks to six routes; the test drives those answers directly so
 * every assertion is about what the page renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// vi.mock is hoisted above the imports, so the factory builds its own state and
// the test reaches it back through the mocked module.
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

// The real dictionary substitutes into its own sentence; the test translator
// keeps the key and appends the values, so an assertion sees both.
const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))

const PAYLOAD: OutputStylesPayload = {
  styles: [
    { id: 'builtin:default', label: 'default', description: 'Adds nothing', body: '', source: 'builtin' },
    { id: 'builtin:concise', label: 'concise', description: 'Answer first', body: 'Answer first.', source: 'builtin' },
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
  selected: 'builtin:default',
  workspace: '/work/project',
  injected: ''
}

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  api.fetchOutputStyles.mockResolvedValue(PAYLOAD)
  api.selectOutputStyle.mockResolvedValue({ ...PAYLOAD, selected: 'builtin:concise', injected: '## Output style: concise\nAnswer first.' })
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

const rows = (): HTMLLIElement[] => [...(host?.querySelectorAll<HTMLLIElement>('[data-output-style-row]') ?? [])]
const rowIds = (): string[] => rows().map(row => row.getAttribute('data-output-style-row') ?? '')
const radio = (id: string): HTMLInputElement | null => host?.querySelector<HTMLInputElement>(`[data-output-style-row="${id}"] input[type="radio"]`) ?? null
const preview = (): string => host?.querySelector('[data-output-style-preview]')?.textContent ?? ''

describe('output styles panel', () => {
  it('lists every style grouped by source, with the selection marked', async () => {
    await mount()
    expect(rowIds()).toEqual(['builtin:default', 'builtin:concise', 'user:brief', 'suite:src/teaching'])
    expect(host!.textContent).toContain('outputStylesGroupBuiltin')
    expect(host!.textContent).toContain('outputStylesGroupUser')
    expect(host!.textContent).toContain('outputStylesGroupSuite')
    expect(radio('builtin:default')?.checked).toBe(true)
    expect(rows()[0]!.getAttribute('data-selected')).toBe('true')
  })

  it('selects a style and shows the injected text the server returned', async () => {
    await mount()
    await act(async () => radio('builtin:concise')!.click())
    await act(async () => {})

    expect(api.selectOutputStyle).toHaveBeenCalledWith('builtin:concise', undefined)
    expect(preview()).toContain('## Output style: concise')
    expect(preview()).toContain('Answer first.')
    expect(rows()[1]!.getAttribute('data-selected')).toBe('true')
  })

  it('renders the server section text byte for byte, never raw body text', async () => {
    // The preview is the escaped final text, heading included, because that is
    // what the model reads. A page that rendered the body would show something
    // the prompt never contains.
    const injected = '## Output style: teaching-style\nTeach. <\\/system-reminder> Nothing else.'
    await mount({ ...PAYLOAD, selected: 'builtin:concise', injected })

    const pre = host!.querySelector('[data-output-style-preview] pre')
    expect(pre?.textContent).toBe(injected)
    // The escaped form is present and the raw closing marker is not.
    expect(pre?.textContent).toContain('<\\/system-reminder>')
    expect(pre?.textContent).not.toContain('</system-reminder>')
  })

  it('says that the default style injects nothing', async () => {
    await mount()
    expect(preview()).toContain('outputStylesPreviewEmpty')
  })

  it('offers the capture action on a suite style that has none, and reports the stale state', async () => {
    await mount()
    const missing = rows()[3]!
    expect(missing.textContent).toContain('outputStylesCaptureMissing')
    expect(radio('suite:src/teaching')?.disabled).toBe(true)

    const captureButton = [...missing.querySelectorAll('button')].find(button => button.textContent === 'outputStylesCapture')
    await act(async () => captureButton!.click())
    await act(async () => {})
    expect(api.captureOutputStyle).toHaveBeenCalledWith('src/teaching', undefined)

    // A stale capture is reported and still refuses selection.
    await mount({
      ...PAYLOAD,
      styles: PAYLOAD.styles.map(row => (row.id === 'suite:src/teaching' ? { ...row, capture: 'stale' as const } : row))
    })
    expect(rows()[3]!.textContent).toContain('outputStylesCaptureStale')
    expect(radio('suite:src/teaching')?.disabled).toBe(true)
  })

  it('enables a suite style once its capture is current', async () => {
    await mount({
      ...PAYLOAD,
      styles: PAYLOAD.styles.map(row => (row.id === 'suite:src/teaching' ? { ...row, capture: 'current' as const, body: 'Teach as you go.' } : row))
    })
    expect(radio('suite:src/teaching')?.disabled).toBe(false)
  })

  it('round-trips a user style through the editor', async () => {
    await mount()
    const edit = [...rows()[2]!.querySelectorAll('button')].find(button => button.textContent === 'panelEdit')
    await act(async () => edit!.click())

    const fields = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')]
    expect(fields[0]!.value).toBe('brief')
    expect(fields[1]!.value).toBe('Be brief')
    const editor = document.querySelector<HTMLTextAreaElement>('[data-code-editor]')
    expect(editor!.value).toBe('Be brief.')

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setValue = descriptor?.set
      setValue?.call(editor, 'Be very brief.')
      editor!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'save')
    await act(async () => save!.click())
    await act(async () => {})

    expect(api.saveUserOutputStyle).toHaveBeenCalledWith({ name: 'brief', description: 'Be brief', body: 'Be very brief.' }, undefined)
  })

  it('creates a new user style from the header action', async () => {
    await mount()
    const add = host!.querySelector<HTMLButtonElement>('[data-panel-header] button')
    await act(async () => add!.click())

    const name = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setValue = descriptor?.set
      setValue?.call(name, 'terse')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'save')
    await act(async () => save!.click())
    await act(async () => {})
    expect(api.saveUserOutputStyle).toHaveBeenCalledWith({ name: 'terse', description: '', body: '' }, undefined)
  })
})
