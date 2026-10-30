// @vitest-environment jsdom

/**
 * The collection pages itself.
 *
 * A market with a thousand suites used to mount every card on open: one
 * measured read of the real host put the first paint at a third of a second and
 * the DOM at sixteen thousand nodes. The surface now renders one page at a time
 * and reveals the rest on demand, so the contract worth pinning is that paging
 * never changes what a filter or a search finds.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { RESOURCE_PAGE_SIZE, ResourceSurface, type ResourceEntry } from '../src/ui/ResourceSurface.js'
import type { Translate } from '../src/i18n.js'

const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))

/** More entries than one page, so both the page and the remainder are real. */
const many: ResourceEntry[] = Array.from({ length: RESOURCE_PAGE_SIZE + 30 }, (_, index) => ({
  id: 'entry-' + String(index),
  name: 'entry ' + String(index),
  description: index === RESOURCE_PAGE_SIZE + 5 ? 'buried treasure' : 'entry number ' + String(index)
}))

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

async function mount(entries: readonly ResourceEntry[]): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(h(ResourceSurface, { t, entries, searchLabel: 'search', emptyText: 'nothing here', onOpen: () => {} }))
  })
}

const cards = (): HTMLElement[] => [...(host?.querySelectorAll<HTMLElement>('[data-resource-id]') ?? [])]
const more = (): HTMLButtonElement | undefined => host?.querySelector<HTMLButtonElement>('[data-resource-more] button') ?? undefined

describe('resource collection paging', () => {
  it('mounts one page and offers the rest', async () => {
    await mount(many)
    expect(cards()).toHaveLength(RESOURCE_PAGE_SIZE)
    expect(more()).toBeDefined()
    expect(more()?.textContent).toContain('showMore')
    expect(more()?.textContent).toContain('30')
  })

  it('reveals the next page when the reader asks for it', async () => {
    await mount(many)
    await act(async () => more()?.click())
    expect(cards()).toHaveLength(many.length)
    expect(more()).toBeUndefined()
  })

  it('searches the whole set, not just the mounted page', async () => {
    // The entry past the first page is the only one matching, so a search that
    // only looked at mounted cards would answer "nothing here".
    await mount(many)
    const search = host!.querySelector<HTMLInputElement>('[data-panel-toolbar] input')!
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, 'buried treasure')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cards()).toHaveLength(1)
    expect(cards()[0]?.textContent).toContain('entry ' + String(RESOURCE_PAGE_SIZE + 5))
  })

  it('starts over at the first page after a search, instead of dropping the reader mid-list', async () => {
    await mount(many)
    await act(async () => more()?.click())
    const search = host!.querySelector<HTMLInputElement>('[data-panel-toolbar] input')!
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, 'entry 1')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Every entry matches, and all of them were mounted before the search. The
    // list going back to one page is what proves the search started over rather
    // than keeping the page the reader had grown to.
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, 'entry')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cards()).toHaveLength(RESOURCE_PAGE_SIZE)
    expect(more()).toBeDefined()
  })
})
