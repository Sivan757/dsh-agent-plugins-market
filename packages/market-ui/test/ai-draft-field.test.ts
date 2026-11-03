// @vitest-environment jsdom

/**
 * The AI draft row: ask, review, and never save.
 *
 * The field is shared by every surface with an authored document, so what it guarantees is
 * narrow and worth pinning: it sends what the person typed and nothing else, it hands the
 * answer back to the editor, and a failure surfaces as the server described it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../market-ui/src/api.js', () => ({ requestAiDraft: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import * as apiModule from '../../market-ui/src/api.js'
import { AiDraftField } from '../../market-ui/src/ui/AiDraftField.js'
import type { Translate } from '../../market-ui/src/i18n.js'

const api = apiModule as unknown as { requestAiDraft: ReturnType<typeof vi.fn> }
const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.clearAllMocks()
})

async function mount(props: { onDrafted?: (text: string) => void } = {}): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onDrafted = props.onDrafted ?? ((): void => {})
  await act(async () => {
    root!.render(h(AiDraftField, { t, face: 'skills', onDrafted }))
  })
  return host
}

const input = (el: HTMLDivElement): HTMLInputElement => el.querySelector('input')!
const button = (el: HTMLDivElement): HTMLButtonElement => el.querySelector('button')!

describe('AI draft field', () => {
  it('sends the intent and hands the answer to the editor', async () => {
    const drafted: string[] = []
    const el = await mount({ onDrafted: text => drafted.push(text) })
    api.requestAiDraft.mockResolvedValue({ text: '---\ndescription: 审查\n---\n\n步骤', provider: 'deepseek', model: 'fixture-model' })

    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input(el), '审查我的改动')
      input(el).dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      button(el).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(api.requestAiDraft).toHaveBeenCalledWith(expect.objectContaining({ face: 'skills', intent: '审查我的改动' }))
    expect(drafted).toEqual(['---\ndescription: 审查\n---\n\n步骤'])
    // The row names the model that produced it, so the answer can be judged as a suggestion.
    expect(el.textContent).toContain('aiDraftDone')
    expect(el.textContent).toContain('fixture-model')
  })

  it('stays disabled until there is something to ask for', async () => {
    const el = await mount()
    expect(button(el).disabled).toBe(true)
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input(el), '  ')
      input(el).dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(button(el).disabled).toBe(true)
  })

  it('reports a failure instead of leaving the row silent', async () => {
    const el = await mount()
    api.requestAiDraft.mockRejectedValue(new Error('no model is configured'))
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input(el), 'anything')
      input(el).dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      button(el).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('no model is configured')
  })
})
