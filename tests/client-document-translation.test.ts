// @vitest-environment jsdom
/** The expanded document starts in original reading; one shared mode serves every document. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { translateMarkdownDocument } from '../packages/market-translation/src/application/translation/document.js'
import { DetailRow, DetailRows } from '../packages/market-ui/src/ui/DetailRows.js'
import { DocumentTranslationView } from '../packages/market-ui/src/ui/DocumentTranslation.js'
import { RequestTimeoutError } from '../packages/market-ui/src/request-error.js'
import { TRANSLATION_POLL_MS } from '../packages/market-ui/src/ui/translation-settle.js'
import { readingMode } from '../packages/market-ui/src/ui/reading-mode.js'
import { bindTranslationEnabled } from '../packages/market-ui/src/ui/translation-enabled.js'
import type { Translate } from '../packages/market-ui/src/index.js'
import type { DocumentTranslation } from '../packages/market-contracts/src/contracts/translation.js'

/** The active-locale probe answers Chinese; every other key surfaces as itself. */
const chinese: Translate = key => (key === 'localeProbeLang' ? '中文' : key)
const english: Translate = key => (key === 'localeProbeLang' ? 'English' : key)

/** The authored document, which is the body until the reader asks otherwise. */
const AUTHORED = '# Title\n\nAuthored paragraph.'

let root: Root | undefined
let host: HTMLDivElement | undefined
let unbind: (() => void) | undefined

afterEach(async () => {
  readingMode.set('original')
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

async function mount(t: Translate, load: () => Promise<DocumentTranslation>, original = AUTHORED): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  host = element
  const created = createRoot(element)
  root = created
  await act(async () => created.render(h(DocumentTranslationView, { t, original, load })))
}

/** Select the host-owned reading-mode tab. */
async function choose(mode: string): Promise<void> {
  const tab = [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent === mode)!
  await act(async () => tab.click())
}

describe('document header scope', () => {
  it('marks only document frames for sticky headers and preserves normal rows', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    host = element
    root = createRoot(element)
    await act(async () =>
      root!.render(
        h(
          'div',
          null,
          h(DetailRows, { documentHeaders: true }, h(DetailRow, { name: 'Document', open: true, headerActions: h('span', null, 'actions'), children: 'text' })),
          h(DetailRows, null, h(DetailRow, { name: 'Ordinary', open: true, children: 'data' }))
        )
      )
    )
    expect(host.querySelectorAll('[data-document-headers]')).toHaveLength(1)
    expect(host.querySelector('[data-document-headers] [data-detail-header][data-open="true"]')).not.toBeNull()
    const ordinary = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Ordinary'))!
    expect(ordinary.closest('[data-document-headers]')).toBeNull()
    expect(ordinary.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('DocumentTranslationView', () => {
  it('marks partial translation failure in the header and sends true only on an explicit retry', async () => {
    translationEnabled(true)
    const load = vi
      .fn<(retry?: boolean) => Promise<DocumentTranslation>>()
      .mockResolvedValueOnce({ text: AUTHORED, pending: 0, failed: 1 })
      .mockResolvedValue({ text: '译文完成', bilingualText: AUTHORED + '\n译文完成', pending: 0 })
    await mount(chinese, load)
    await choose('translationViewBilingual')
    expect(host?.querySelector('[aria-selected="true"] [title]')?.getAttribute('title')).toContain('translationFailed')
    expect(host?.querySelector('[data-translation-spinner]')).toBeNull()
    const selected = host!.querySelector<HTMLButtonElement>('[aria-selected="true"]')!
    await act(async () => selected.click())
    expect(load.mock.calls.map(call => call[0])).toEqual([undefined, true])
    expect(host?.textContent).toContain('译文完成')
    expect(host?.querySelector('[role="status"]')).toBeNull()
  })
  it('replaces only the selected icon with a spinner without adding body status text', async () => {
    translationEnabled(true)
    let finish!: (value: DocumentTranslation) => void
    const load = () =>
      new Promise<DocumentTranslation>(resolve => {
        finish = resolve
      })
    await mount(chinese, load)
    await choose('translationViewBilingual')
    const selected = host!.querySelector<HTMLButtonElement>('[aria-selected="true"]')!
    expect(selected.querySelectorAll('svg')).toHaveLength(1)
    expect(selected.querySelector('[data-translation-spinner]')).not.toBeNull()
    expect(host?.querySelector('[role="tabpanel"]')?.textContent).not.toContain('loading')
    await choose('translationViewOriginal')
    expect(host?.querySelector('[data-translation-spinner]')).toBeNull()
    await act(async () => finish({ text: '迟到译文', pending: 0 }))
    expect(host?.textContent).not.toContain('迟到译文')
  })

  it('does not publish a late failed poll after the document unmounts', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    let reject!: (reason: unknown) => void
    const load = vi
      .fn()
      .mockResolvedValueOnce({ text: AUTHORED, pending: 1 })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          })
      )
    await mount(chinese, load)
    await choose('translationViewBilingual')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS)
    })
    await act(async () => root?.unmount())
    root = undefined
    await act(async () => reject(new Error('unmounted poll failed')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS * 3)
    })
    expect(host?.textContent).toBe('')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries a failed cold poll without hiding authored content or clearing completed chunks', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    const load = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Partly translated', bilingualText: 'Authored paragraph.\n\nPartly translated', pending: 1 })
      .mockRejectedValueOnce(new Error('poll failed'))
      .mockResolvedValueOnce({ text: 'Translation complete', bilingualText: 'Authored paragraph.\n\nTranslation complete', pending: 0 })
    await mount(chinese, load)
    await choose('translationViewBilingual')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS)
    })
    expect(host?.querySelector('[role="status"]')?.getAttribute('aria-label')).toContain('poll failed')
    expect(host?.textContent).toContain('Partly translated')
    expect(host?.textContent).toContain('Authored paragraph.')
    expect(host?.querySelectorAll('[role="tab"]')).toHaveLength(3)
    const retry = host!.querySelector<HTMLButtonElement>('[aria-selected="true"]')!
    await act(async () => retry.click())
    expect(load).toHaveBeenCalledTimes(3)
    expect(host?.textContent).toContain('Translation complete')
    expect(host?.textContent).not.toContain('poll failed')
    expect(host?.textContent).not.toContain('loading')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS * 4)
    })
    expect(load).toHaveBeenCalledTimes(3)
  })
  it('shows the localized read timeout and retry after the first cold request fails', async () => {
    translationEnabled(true)
    await mount(chinese, async () => {
      throw new RequestTimeoutError(15_000)
    })
    await choose('translationViewBilingual')
    expect(host?.querySelector('[role="status"]')?.getAttribute('aria-label')).toContain('requestTimeout')
    expect(host?.querySelector('[aria-selected="true"] [title]')?.getAttribute('title')).toContain('translationRetry')
    expect(host?.textContent).not.toContain('loading')
    expect(host?.textContent).toContain('Authored paragraph.')
  })
  it('ignores a pending-poll failure after returning to original mode', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    let reject!: (reason: unknown) => void
    const load = vi
      .fn()
      .mockResolvedValueOnce({ text: AUTHORED, pending: 1 })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          })
      )
    await mount(chinese, load)
    await choose('translationViewBilingual')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS)
    })
    await choose('translationViewOriginal')
    await act(async () => reject(new Error('late poll error')))
    expect(host?.textContent).not.toContain('late poll error')
    expect(host?.textContent).not.toContain('loading')
    expect(host?.textContent).toContain('Authored paragraph.')
  })

  it('reports a failed pending poll instead of leaving a permanent loading label', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    const load = vi.fn().mockResolvedValueOnce({ text: AUTHORED, bilingualText: AUTHORED, pending: 1 }).mockRejectedValue(new Error('poll request failed'))
    await mount(chinese, load)
    await choose('translationViewBilingual')
    expect(host?.querySelector('[data-translation-spinner]')).not.toBeNull()
    expect(host?.textContent).not.toContain('loading')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS)
    })
    expect(load).toHaveBeenCalledTimes(2)
    expect(host?.querySelector('[role="status"]')?.getAttribute('aria-label')).toContain('poll request failed')
    expect(host?.textContent).not.toContain('loading')
    expect(host?.textContent).toContain('Authored paragraph.')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS * 5)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('uses compact icon tabs with accessible labels and a linked current panel', async () => {
    translationEnabled(true)
    await mount(chinese, async () => ({ text: '译文', bilingualText: '原文\n\n译文', pending: 0 }))
    const tabs = [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map(tab => tab.textContent)).toEqual(['translationViewOriginal', 'translationViewTranslated', 'translationViewBilingual'])
    expect(tabs.every(tab => tab.querySelector('svg') !== null)).toBe(true)
    expect(tabs.every(tab => tab.querySelector('[title]')?.getAttribute('title') === tab.textContent)).toBe(true)
    const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')!
    expect(selected.textContent).toBe('translationViewOriginal')
    expect(document.getElementById(selected.getAttribute('aria-controls')!)?.getAttribute('aria-labelledby')).toBe(selected.id)
    expect(host?.querySelector('[data-document-translation-controls]')?.nextElementSibling?.getAttribute('role')).toBe('tabpanel')
  })
  it('keeps the host arrow and Home/End keyboard navigation for icon-only tabs', async () => {
    translationEnabled(true)
    await mount(chinese, async () => ({ text: '译文', bilingualText: '原文\n\n译文', pending: 0 }))
    const tabs = [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    tabs[2]!.focus()
    for (const [key, index] of [
      ['ArrowLeft', 1],
      ['Home', 0],
      ['End', 2],
      ['ArrowRight', 0]
    ] as const) {
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
      expect(document.activeElement).toBe(tabs[index])
      expect(tabs[index]!.getAttribute('aria-selected')).toBe('true')
      expect(tabs.filter(tab => tab.tabIndex === 0)).toHaveLength(1)
    }
  })

  it('renders whole-tree bilingual Markdown through the real host component', async () => {
    translationEnabled(true)
    const source = [
      '# Read heading',
      '',
      '1. Read **important** [guide][ref].',
      '   - Read nested.',
      '',
      '> Read quote.',
      '',
      'Read footnote[^n].',
      '',
      '[ref]: https://example.test/docs',
      '',
      '[^n]: Read note.',
      '',
      '| Read header | Value |',
      '| --- | --- |',
      '| Read cell | 1 |',
      '',
      '\x60\x60\x60js',
      'const exact = 1;',
      '\x60\x60\x60'
    ].join('\n')
    const value = translateMarkdownDocument(source, text => ({ text: text.replaceAll('Read', '读取'), pending: false }))
    await mount(chinese, async () => value, source)
    await choose('translationViewBilingual')
    expect(host?.querySelectorAll('h1')).toHaveLength(2)
    expect(host?.querySelector('ol')?.children).toHaveLength(1)
    expect(host?.querySelector('ol > li ul li')?.textContent).toContain('读取 nested')
    expect(host?.querySelector('blockquote')?.textContent).toContain('Read quote.')
    expect(host?.querySelector('blockquote')?.textContent).toContain('读取 quote.')
    expect(host?.querySelector('strong')?.textContent).toBe('important')
    expect(host?.querySelector('a[href="https://example.test/docs"]')).not.toBeNull()
    expect(host?.querySelector('sup')?.textContent).toBe('1')
    expect(host?.querySelector('[data-footnotes]')?.textContent).toContain('读取 note.')
    expect(host?.querySelectorAll('table')).toHaveLength(2)
    expect(host?.querySelectorAll('pre code')).toHaveLength(1)
    expect(host?.querySelector('pre code')?.textContent).toContain('const exact = 1;')
  })

  it('keeps original readable with zero requests while disabled', async () => {
    translationEnabled(false)
    const load = vi.fn(async () => ({ text: 'translated', pending: 0 }))
    await mount(chinese, load)
    expect(host?.textContent).toContain('Authored paragraph.')
    expect(host?.querySelector('[role="tablist"]')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
  it('loads on expansion and defaults to original reading with three explicit modes', async () => {
    translationEnabled(true)
    const load = vi.fn(async () => ({ text: 'Translated paragraph.', bilingualText: 'Authored paragraph.\n\nTranslated paragraph.', pending: 0 }))
    await mount(chinese, load)
    expect(host?.textContent).toContain('Authored paragraph.')
    expect(load).not.toHaveBeenCalled()
    await choose('translationViewBilingual')
    expect(load).toHaveBeenCalledTimes(1)
    expect(host?.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(host?.querySelector('[aria-selected="true"]')?.textContent).toBe('translationViewBilingual')
    expect(host?.textContent).toContain('Authored paragraph.')
    expect(host?.textContent).toContain('Translated paragraph.')
    await choose('translationViewTranslated')
    expect(host?.textContent).not.toContain('Authored paragraph.')
    expect(host?.textContent).toContain('Translated paragraph.')
    await choose('translationViewOriginal')
    expect(host?.textContent).toContain('Authored paragraph.')
    expect(host?.textContent).not.toContain('Translated paragraph.')
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('supports English when explicitly enabled', async () => {
    translationEnabled(true)
    const load = vi.fn(async () => ({ text: 'Read files', bilingualText: '读取文件\n\nRead files', pending: 0 }))
    await mount(english, load, '读取文件')
    await choose('translationViewBilingual')
    expect(load).toHaveBeenCalledTimes(1)
    expect(host?.textContent).toContain('Read files')
  })
  it('revalidates the target and never displays an old-language answer', async () => {
    translationEnabled(true)
    const load = vi.fn(async () => ({ text: '旧译文', bilingualText: 'Old source\n\n旧译文', pending: 0 }))
    await mount(chinese, load)
    await choose('translationViewBilingual')
    let finish!: (value: DocumentTranslation) => void
    const next = vi.fn(
      () =>
        new Promise<DocumentTranslation>(resolve => {
          finish = resolve
        })
    )
    await act(async () => root!.render(h(DocumentTranslationView, { t: english, original: AUTHORED, load: next })))
    expect(next).toHaveBeenCalledTimes(1)
    expect(host?.textContent).not.toContain('旧译文')
    await act(async () => finish({ text: 'New translation', bilingualText: 'New translation', pending: 0 }))
    expect(host?.textContent).toContain('New translation')
  })
  it('polls pending chunks and stops after settlement', async () => {
    vi.useFakeTimers()
    translationEnabled(true)
    const load = vi
      .fn()
      .mockResolvedValueOnce({ text: AUTHORED, bilingualText: AUTHORED, pending: 1 })
      .mockResolvedValue({ text: 'Translated paragraph.', bilingualText: 'Translated paragraph.', pending: 0 })
    await mount(chinese, load)
    await choose('translationViewBilingual')
    expect(host?.querySelector('[data-translation-spinner]')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS)
    })
    expect(host?.textContent).toContain('Translated paragraph.')
    expect(host?.textContent).not.toContain('loading')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSLATION_POLL_MS * 2)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('keeps authored content readable on a failed request', async () => {
    translationEnabled(true)
    await mount(chinese, async () => {
      throw new Error('translation endpoint unavailable')
    })
    await choose('translationViewBilingual')
    expect(host?.querySelector('[role="status"]')?.getAttribute('aria-label')).toContain('translation endpoint unavailable')
    expect(host?.textContent).toContain('Authored paragraph.')
    await choose('translationViewOriginal')
    expect(host?.textContent).not.toContain('translation endpoint unavailable')
  })
})
