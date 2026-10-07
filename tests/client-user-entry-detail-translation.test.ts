// @vitest-environment jsdom
/** The expanded document defaults to bilingual reading and retains three explicit modes. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { bindTranslationEnabled } from '../packages/market-ui/src/ui/translation-enabled.js'
import type { Translate } from '../packages/market-ui/src/index.js'
import type { UserPanelEntry } from '../packages/market-ui/src/api.js'

const api = vi.hoisted(() => ({
  fetchUserPanelEntry: vi.fn(),
  fetchDocumentTranslation: vi.fn()
}))
vi.mock('../packages/market-ui/src/api.js', () => api)

import { UserEntryDetailModal } from '../packages/market-ui/src/ui/UserEntryDetail.js'

/** The active-locale probe answers Chinese; every other key surfaces as itself. */
const chinese: Translate = key => (key === 'localeProbeLang' ? '中文' : key)
const english: Translate = key => (key === 'localeProbeLang' ? 'English' : key)

/** A long-authored skill: frontmatter, a heading, and many body lines. */
const LONG_SKILL = ['---', 'name: greet', 'description: Greet the reader', '---', '# Greet', '', ...Array.from({ length: 120 }, (_, index) => `- step ${index + 1}`), ''].join('\n')

const entry: UserPanelEntry = {
  name: 'greet',
  description: 'Greet the reader',
  disabled: false,
  origin: 'user',
  metadata: {},
  path: '/tmp/skills/greet/SKILL.md'
}

let root: Root | undefined
let unbind: (() => void) | undefined

afterEach(async () => {
  vi.useRealTimers()
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  unbind?.()
  unbind = undefined
  vi.clearAllMocks()
})

/** Bind the shared translation preference the section subscribes to. */
function translationEnabled(value: boolean): void {
  unbind = bindTranslationEnabled({ getSnapshot: () => ({ value: { translationEnabled: value } }), subscribe: () => () => {} })
}

async function mount(t: Translate = chinese): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  api.fetchUserPanelEntry.mockResolvedValue({ ...entry, rawText: LONG_SKILL })
  api.fetchDocumentTranslation.mockResolvedValue({ text: '# 问候', bilingualText: LONG_SKILL + '\n\n问候', pending: 0 })
  await act(async () => {
    root?.render(h(UserEntryDetailModal, { t, kind: 'skills', entry, onClose: () => {} }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/** The disclosure button whose band carries this text. */
function button(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(candidate => (candidate.textContent ?? '').includes(text))
  if (found === undefined) throw new Error(`no disclosure button carrying "${text}"`)
  return found
}

/** The open row's body: the document, and the control that swaps it. */
function rowBody(text: string): HTMLElement {
  const body = button(text).parentElement?.children[1]
  if (!(body instanceof HTMLElement)) throw new Error(`the row carrying "${text}" is not open`)
  return body
}

/** Open one row the way a reader does, and let its own read land. */
async function open(text: string): Promise<void> {
  await act(async () => {
    button(text).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe('user-panel detail document translation', () => {
  it('settles a cold description supplied on the initial detail entry', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    await mount()
    const pendingEntry = { ...entry, translationPending: 1 }
    api.fetchUserPanelEntry
      .mockResolvedValueOnce({ ...pendingEntry, rawText: LONG_SKILL })
      .mockResolvedValue({ ...entry, rawText: LONG_SKILL, translatedDescription: 'Settled description' })
    await act(async () => root!.render(h(UserEntryDetailModal, { t: chinese, kind: 'skills', entry: pendingEntry, onClose: () => {} })))
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(document.body.textContent).toContain('Settled description')
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(2)
  })

  it('polls only while the server reports pending translation and stops when settled', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    await mount(chinese)
    api.fetchUserPanelEntry
      .mockResolvedValueOnce({ ...entry, rawText: LONG_SKILL, translationPending: 1 })
      .mockResolvedValue({ ...entry, rawText: LONG_SKILL, translatedDescription: 'New translated description' })
    await act(async () => root!.render(h(UserEntryDetailModal, { t: english, kind: 'skills', entry, onClose: () => {} })))
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(document.body.textContent).toContain('New translated description')
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(2)
  })
  it('hides old-target descriptions immediately and accepts only the new-target read', async () => {
    translationEnabled(true)
    await mount()
    const translatedEntry = { ...entry, translatedDescription: '旧中文描述' }
    await act(async () => root!.render(h(UserEntryDetailModal, { t: chinese, kind: 'skills', entry: translatedEntry, onClose: () => {} })))
    expect(document.body.textContent).toContain('旧中文描述')
    let finish!: (value: UserPanelEntry) => void
    api.fetchUserPanelEntry.mockImplementationOnce(
      () =>
        new Promise<UserPanelEntry>(resolve => {
          finish = resolve
        })
    )
    await act(async () => root!.render(h(UserEntryDetailModal, { t: english, kind: 'skills', entry: translatedEntry, onClose: () => {} })))
    expect(document.body.textContent).not.toContain('旧中文描述')
    await act(async () => finish({ ...entry, translatedDescription: 'New English description' }))
    expect(document.body.textContent).toContain('New English description')
  })

  it('translates only the expanded document and defaults to bilingual reading', async () => {
    translationEnabled(true)
    await mount()
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
    expect(api.fetchUserPanelEntry).not.toHaveBeenCalled()
    await open('SKILL.md')
    const body = rowBody('SKILL.md')
    expect(api.fetchDocumentTranslation).toHaveBeenCalledWith('skills', 'greet', undefined)
    expect(body.textContent).toContain('step 120')
    expect(body.textContent).toContain('问候')
    expect(body.querySelectorAll('[role="tab"]')).toHaveLength(3)
    const choose = async (label: string): Promise<void> => {
      const target = [...body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === label)!
      await act(async () => target.click())
    }
    await choose('translationViewTranslated')
    expect(body.textContent).toContain('问候')
    expect(body.textContent).not.toContain('step 120')
    await choose('translationViewOriginal')
    expect(body.textContent).toContain('step 120')
    expect(body.textContent).not.toContain('问候')
    expect(api.fetchDocumentTranslation).toHaveBeenCalledTimes(1)
  })
  it('shows the full original and makes no translation read while disabled', async () => {
    translationEnabled(false)
    await mount()
    await open('SKILL.md')
    expect(rowBody('SKILL.md').textContent).toContain('step 120')
    expect(rowBody('SKILL.md').querySelector('[role="tablist"]')).toBeNull()
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
  })
  it('allows an explicitly enabled English reader to translate', async () => {
    translationEnabled(true)
    await mount(english)
    await open('SKILL.md')
    expect(rowBody('SKILL.md').querySelector('[role="tablist"]')).not.toBeNull()
    expect(api.fetchDocumentTranslation).toHaveBeenCalledTimes(1)
  })
})
