// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Translate } from '../src/index.js'
import { stubTranslate as t } from './helpers/translate.js'

const apiMock = vi.hoisted(() => ({ saveUserHook: vi.fn(async () => ({ file: 'hooks.json' })) }))
vi.mock('../src/api.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/api.js')>()),
  saveUserHook: apiMock.saveUserHook
}))

import { HookCreateModal } from '../src/features/hooks/HookCreateModal.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>

afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})

async function mount(translate: Translate = t): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(h(HookCreateModal, { t: translate, onClose: vi.fn(), onSaved: vi.fn() })))
}

const button = (text: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(node => node.textContent === text)
const field = (label: string): HTMLInputElement | HTMLSelectElement => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[role="dialog"] [aria-label="${label}"]`)!

/** One controlled field, written the way a browser writes it. */
async function write(node: HTMLInputElement | HTMLSelectElement, value: string, type: 'input' | 'change'): Promise<void> {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value)
  await act(async () => node.dispatchEvent(new Event(type, { bubbles: true })))
}

describe('the hook create dialog', () => {
  it('asks for the three fields a hook is and nothing more', async () => {
    await mount()
    // The form is the feature: the event names when, the matcher narrows to
    // tools, the command is the entry. There is no intent field and no drafting
    // action, because a hook is configuration the reader writes, not prose.
    expect(field('hooksEventLabel')).not.toBeNull()
    expect(field('hooksMatcherLabel')).not.toBeNull()
    expect(field('hooksCommandLabel')).not.toBeNull()
    expect(document.querySelector('[data-ai-draft]')).toBeNull()
    expect(button('hooksDraftAi')).toBeUndefined()
    expect(button('aiDraftLabel')).toBeUndefined()
  })

  it('appends the entry from the dialog footer', async () => {
    await mount()
    await write(field('hooksEventLabel'), 'PostToolUse', 'change')
    await write(field('hooksMatcherLabel'), 'Bash|Edit', 'input')
    await write(field('hooksCommandLabel'), 'pnpm lint --fix', 'input')
    const save = button('hooksSave')!
    // One action row at the bottom edge, like every other create dialog here.
    expect(save.closest('[class*="footer"]')).not.toBeNull()
    await act(async () => save.click())
    expect(apiMock.saveUserHook).toHaveBeenCalledWith({ event: 'PostToolUse', command: 'pnpm lint --fix', matcher: 'Bash|Edit' })
  })

  it('refuses an empty command', async () => {
    await mount()
    expect(button('hooksSave')!.disabled).toBe(true)
  })
})
