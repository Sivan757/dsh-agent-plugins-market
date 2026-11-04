// @vitest-environment jsdom

/**
 * The explanation block: one press, then prose, and never a change.
 *
 * The block is read-only by construction, so what it guarantees is narrow: the request carries
 * the facts the panel established, the answer is rendered where the reader is looking, and a
 * refusal is stated rather than swallowed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../market-ui/src/api.js', () => ({ requestAiDiagnosis: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import * as apiModule from '../../market-ui/src/api.js'
import { DiagnoseBlock } from '../../market-ui/src/ui/DiagnoseBlock.js'
import type { Translate } from '../../market-ui/src/i18n.js'

const api = apiModule as unknown as { requestAiDiagnosis: ReturnType<typeof vi.fn> }
const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))
const failure = { state: 'failed', code: 'connection-timeout', reason: '连接超时', causes: ['endpoint 无响应'], transport: 'streamable-http', mountMs: 10000 }

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.clearAllMocks()
})

async function mount(overrides: { state?: string } = {}): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(h(DiagnoseBlock, { t, face: 'mcp', failure: overrides.state === undefined ? failure : { ...failure, state: overrides.state } }))
  })
  return host
}

const press = async (el: HTMLDivElement): Promise<void> => {
  await act(async () => {
    el.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('diagnose block', () => {
  it('sends the failure facts and shows the explanation in place', async () => {
    const el = await mount()
    api.requestAiDiagnosis.mockResolvedValue({ text: '连不上这台服务：先确认地址可达，再检查是否需要认证。', provider: 'deepseek', model: 'flash' })

    await press(el)

    expect(api.requestAiDiagnosis).toHaveBeenCalledWith(expect.objectContaining({ face: 'mcp', failure }))
    expect(el.textContent).toContain('连不上这台服务')
    // The press becomes a re-ask once an answer is on screen.
    expect((el.querySelector('button')!.textContent ?? '').trim()).toBe('aiDiagnoseAgain')
  })

  it('states a refusal the same way the draft field does', async () => {
    const el = await mount()
    api.requestAiDiagnosis.mockRejectedValue(Object.assign(new Error('provider said no'), { code: 'ai-provider-limited' }))

    await press(el)

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('aiDraftLimited')
    expect(el.textContent).not.toContain('provider said no')
  })

  it('asks about a state that is not a failure in its own words', async () => {
    const el = await mount({ state: 'disabled' })
    expect(el.querySelector('button')?.textContent).toBe('aiDiagnoseAskState')
  })

  it('renders nothing but the button until it has an answer', async () => {
    const el = await mount()
    expect(el.querySelector('button')?.textContent).toBe('aiDiagnoseAsk')
    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(el.textContent).not.toContain('diagnoseAnswer')
  })
})
