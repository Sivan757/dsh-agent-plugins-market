// @vitest-environment jsdom
/**
 * The document translation section: absent where it can say nothing, read only
 * when the reader asks for it, and filled in as its chunks land.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentTranslationView } from '../src/client/ui/DocumentTranslation.js'
import { TRANSLATION_POLL_MS } from '../src/client/ui/translation-settle.js'
import { bindTranslationEnabled } from '../src/client/ui/translation-enabled.js'
import type { Translate } from '../src/client/index.js'
import type { DocumentTranslation } from '../src/contracts/translation.js'

/** The active-locale probe answers Chinese; every other key surfaces as itself. */
const chinese: Translate = key => (key === 'localeProbeLang' ? '中文' : key)
const english: Translate = key => (key === 'localeProbeLang' ? 'English' : key)

let root: Root | undefined
let host: HTMLDivElement | undefined
let unbind: (() => void) | undefined

afterEach(async () => {
  vi.useRealTimers()
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  unbind?.()
  unbind = undefined
})

/** Bind the shared translation preference the section subscribes to. */
function translationEnabled(value: boolean): void {
  unbind = bindTranslationEnabled({ getSnapshot: () => ({ value: { translationEnabled: value } }), subscribe: () => () => {} })
}

async function mount(t: Translate, load: () => Promise<DocumentTranslation>): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  host = element
  const created = createRoot(element)
  root = created
  await act(async () => created.render(h(DocumentTranslationView, { t, load })))
}

/** Open the section the way a reader does. */
async function expand(): Promise<void> {
  const button = host?.querySelector('button')
  if (button === null || button === undefined) throw new Error('the section rendered no disclosure row')
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('DocumentTranslationView', () => {
  it('renders nothing, and reads nothing, while translation is off', async () => {
    translationEnabled(false)
    const load = vi.fn(async () => ({ text: 'translated', pending: 0 }))
    await mount(chinese, load)
    expect(host?.textContent).toBe('')
    expect(load).not.toHaveBeenCalled()
  })

  it('renders nothing under the language the documents are already authored in', async () => {
    translationEnabled(true)
    const load = vi.fn(async () => ({ text: 'translated', pending: 0 }))
    await mount(english, load)
    // Offering an English reader an English "translation" of an English
    // document is a control that cannot do anything.
    expect(host?.textContent).toBe('')
    expect(load).not.toHaveBeenCalled()
  })

  it('reads the document only once the reader opens the section', async () => {
    translationEnabled(true)
    const load = vi.fn(async () => ({ text: '# Title', pending: 0 }))
    await mount(chinese, load)
    // The section is there to be opened; the document behind it is not read
    // until someone asks, because a document is the largest thing this plugin
    // ever sends a provider.
    expect(host?.textContent).toContain('translationDocToggle')
    expect(load).not.toHaveBeenCalled()
    await expand()
    expect(load).toHaveBeenCalledTimes(1)
    // The markdown is rendered, not echoed: the heading arrives as its text.
    expect(host?.textContent).toContain('Title')
  })

  it('shows the authored text as pending until the last chunk lands', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    const answers: DocumentTranslation[] = [
      { text: '# Title\n\nAuthored paragraph.', pending: 1 },
      { text: '# Title\n\nTranslated paragraph.', pending: 0 }
    ]
    const load = vi.fn(async () => answers.shift() ?? { text: '# Title\n\nTranslated paragraph.', pending: 0 })
    await mount(chinese, load)
    await expand()
    expect(host?.textContent).toContain('translationDocPending')
    expect(host?.textContent).toContain('Authored paragraph.')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS)
    })
    expect(load).toHaveBeenCalledTimes(2)
    expect(host?.textContent).toContain('Translated paragraph.')
    expect(host?.textContent).not.toContain('translationDocPending')
  })

  it('reports a failed read instead of a document', async () => {
    translationEnabled(true)
    const load = vi.fn(async () => {
      throw new Error('translation endpoint unavailable')
    })
    await mount(chinese, load)
    await expand()
    expect(host?.textContent).toContain('translationDocFailed')
    expect(host?.textContent).toContain('translation endpoint unavailable')
  })
})
