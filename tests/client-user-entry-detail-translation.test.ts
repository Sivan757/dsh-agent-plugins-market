// @vitest-environment jsdom
/** The detail dialog opens its one document row, starts in original reading, and one shared mode serves every document. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readingMode } from '../packages/market-ui/src/ui/reading-mode.js'
import { bindTranslationEnabled } from '../packages/market-ui/src/ui/translation-enabled.js'
import type { Translate } from '../packages/market-ui/src/index.js'
import type { UserPanelEntry, UserPanelKind } from '../packages/market-ui/src/api.js'

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

/**
 * The dialog reads its document as it opens, so that read is one
 * `fetchUserPanelEntry` call every test in this file starts with. Counts below
 * add this constant instead of hiding the call behind an exact number.
 */
const DOCUMENT_READ = 1

let root: Root | undefined
let unbind: (() => void) | undefined

afterEach(async () => {
  readingMode.set('original')
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

/**
 * Mount the dialog. `read` replaces the document read, which is how a test
 * holds the dialog in its loading state.
 */
async function mount(t: Translate = chinese, kind: UserPanelKind = 'skills', read?: () => Promise<UserPanelEntry>): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  if (read === undefined) api.fetchUserPanelEntry.mockResolvedValue({ ...entry, rawText: LONG_SKILL })
  else api.fetchUserPanelEntry.mockImplementation(read)
  api.fetchDocumentTranslation.mockResolvedValue({ text: '# 问候', bilingualText: LONG_SKILL + '\n\n问候', pending: 0 })
  await act(async () => {
    root?.render(h(UserEntryDetailModal, { t, kind, entry, onClose: () => {} }))
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
  const body = button(text).closest('[data-detail-row]')?.querySelector('[data-detail-body]')
  if (!(body instanceof HTMLElement)) throw new Error(`the row carrying "${text}" is not open`)
  return body
}

/** The row band holding the name, its hint and the reading controls. */
function rowHeader(text: string): HTMLElement {
  return button(text).closest('[data-detail-row]')!.querySelector<HTMLElement>('[data-detail-header]')!
}

/**
 * Choose one reading mode, the way a reader does. The click starts a
 * translation read, so the flush keeps that read's state update inside act.
 */
async function chooseMode(header: HTMLElement, index: number): Promise<void> {
  await act(async () => {
    header.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]!.click()
  })
  // The click's effect starts the read at the end of the first act round, so a
  // second round is what keeps that read's state update inside act.
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

/** Activate one row band, the way a reader does, and let its own work settle. */
async function toggle(text: string): Promise<void> {
  await act(async () => {
    button(text).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe('user-panel detail document translation', () => {
  it('opens its document row with the dialog, and closes it on request', async () => {
    translationEnabled(true)
    await mount()
    // The dialog exists to show this document: the row arrives open and read.
    expect(button('SKILL.md').getAttribute('aria-expanded')).toBe('true')
    expect(rowBody('SKILL.md').textContent).toContain('step 120')
    // The hint names the action the click performs, so it flips with the row.
    expect(rowHeader('SKILL.md').textContent).toContain('detailDocCollapseHint')
    await toggle('SKILL.md')
    expect(button('SKILL.md').getAttribute('aria-expanded')).toBe('false')
    expect(button('SKILL.md').closest('[data-detail-row]')?.querySelector('[data-detail-body]')).toBeNull()
    expect(rowHeader('SKILL.md').textContent).toContain('detailDocHint')
    await toggle('SKILL.md')
    expect(rowBody('SKILL.md').textContent).toContain('step 120')
  })

  it.each(['skills', 'commands', 'agents'] as const)('keeps the %s reader controls in its own file header', async kind => {
    translationEnabled(true)
    await mount(chinese, kind)
    const name = kind === 'skills' ? 'SKILL.md' : 'greet.md'
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
    expect(rowHeader(name).querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(rowHeader(name).closest('[data-document-headers]')).not.toBeNull()
    expect(rowBody(name).querySelector('[role="tablist"]')).toBeNull()
    expect(document.body.querySelector('button button')).toBeNull()
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
    await chooseMode(rowHeader(name), 2)
    expect(api.fetchDocumentTranslation).toHaveBeenCalledWith(kind, 'greet', undefined, undefined)
  })

  it('keeps header actions outside the collapse button during source and translation loading', async () => {
    translationEnabled(true)
    let finish!: (value: UserPanelEntry) => void
    await mount(
      chinese,
      'skills',
      () =>
        new Promise<UserPanelEntry>(resolve => {
          finish = resolve
        })
    )
    // The row is open from the start, so the pending read is the dialog's own.
    const header = rowHeader('SKILL.md')
    expect(header.querySelector('[role="tablist"]')).not.toBeNull()
    expect(header.querySelector('button button')).toBeNull()
    expect(button('SKILL.md').querySelector('[role="tab"]')).toBeNull()
    expect(header.querySelector('[data-translation-spinner]')).not.toBeNull()
    expect(rowBody('SKILL.md').textContent).toBe('')
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
    await act(async () => finish({ ...entry, rawText: LONG_SKILL }))
    expect(header.querySelector('[data-translation-spinner]')).toBeNull()
    expect(rowBody('SKILL.md').textContent).toContain('step 120')
    expect(rowBody('SKILL.md').querySelector('[role="tablist"]')).toBeNull()
    await chooseMode(header, 2)
    expect(button('SKILL.md').getAttribute('aria-expanded')).toBe('true')
  })

  it('settles a cold description supplied on the initial detail entry', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    await mount()
    const pendingEntry = { ...entry, translationPending: 1 }
    api.fetchUserPanelEntry
      .mockResolvedValueOnce({ ...pendingEntry, rawText: LONG_SKILL })
      .mockResolvedValue({ ...entry, rawText: LONG_SKILL, translatedDescription: 'Settled description' })
    await act(async () => root!.render(h(UserEntryDetailModal, { t: chinese, kind: 'skills', entry: pendingEntry, onClose: () => {} })))
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(DOCUMENT_READ + 1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(document.body.textContent).toContain('Settled description')
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(DOCUMENT_READ + 2)
  })

  it('polls only while the server reports pending translation and stops when settled', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    await mount(chinese)
    api.fetchUserPanelEntry
      .mockResolvedValueOnce({ ...entry, rawText: LONG_SKILL, translationPending: 1 })
      .mockResolvedValue({ ...entry, rawText: LONG_SKILL, translatedDescription: 'New translated description' })
    await act(async () => root!.render(h(UserEntryDetailModal, { t: english, kind: 'skills', entry, onClose: () => {} })))
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(DOCUMENT_READ + 1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(document.body.textContent).toContain('New translated description')
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(DOCUMENT_READ + 2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(DOCUMENT_READ + 2)
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

  it('reads the whole document on open and translates only on request', async () => {
    translationEnabled(true)
    await mount()
    // The dialog read its document; it started no translation.
    expect(api.fetchUserPanelEntry).toHaveBeenCalledTimes(DOCUMENT_READ)
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
    const body = rowBody('SKILL.md')
    expect(body.textContent).toContain('step 120')
    expect(body.textContent).not.toContain('问候')
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
    expect(body.parentElement!.querySelectorAll('[role="tab"]')).toHaveLength(3)
    const choose = async (label: string): Promise<void> => {
      const target = [...body.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === label)!
      await act(async () => target.click())
    }
    await choose('translationViewTranslated')
    expect(api.fetchDocumentTranslation).toHaveBeenCalledWith('skills', 'greet', undefined, undefined)
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
    expect(rowBody('SKILL.md').textContent).toContain('step 120')
    expect(rowHeader('SKILL.md').querySelector('[role="tablist"]')).toBeNull()
    expect(api.fetchDocumentTranslation).not.toHaveBeenCalled()
  })
  it('allows an explicitly enabled English reader to translate', async () => {
    translationEnabled(true)
    await mount(english)
    const header = rowHeader('SKILL.md')
    expect(header.querySelector('[role="tablist"]')).not.toBeNull()
    await chooseMode(header, 2)
    expect(api.fetchDocumentTranslation).toHaveBeenCalledTimes(1)
  })
})
