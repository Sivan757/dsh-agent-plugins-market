// @vitest-environment jsdom

/**
 * The one resource list's interaction contract.
 *
 * Every surface renders through this component, so the meaning of a click is decided
 * here and nowhere else: a card opens its entry, a switch toggles it, and the two never
 * share a hit area.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { ResourceSurface } from '../src/ui/ResourceSurface.js'
import type { Translate } from '../src/i18n.js'

const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))

const entries = [
  { id: 'a', name: 'alpha', tag: '用户', tagId: 'user', description: 'First entry', meta: 'meta-a' },
  { id: 'b', name: 'beta', tag: '插件', tagId: 'suite', description: 'Second entry', meta: 'meta-b' }
]

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

async function mount(props: Partial<Parameters<typeof ResourceSurface>[0]> = {}): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      h(ResourceSurface, {
        t,
        entries,
        emptyText: 'nothing here',
        onOpen: () => {},
        ...props
      })
    )
  })
}

const cards = (): HTMLElement[] => [...(host?.querySelectorAll<HTMLElement>('[data-resource-id]') ?? [])]
const cardOf = (id: string): HTMLElement => cards().find(card => card.getAttribute('data-resource-id') === id)!

describe('resource surface contract', () => {
  it('opens the entry when its card is clicked', async () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    await mount({ capabilities: { toggle: true }, onOpen, onToggle, isOn: () => false })
    await act(async () => cardOf('a').click())
    expect(onOpen).toHaveBeenCalledWith('a')
    // A click on the card is never a toggle.
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('toggles from the switch without opening the entry', async () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    await mount({ capabilities: { toggle: true }, onOpen, onToggle, isOn: () => false })
    const toggle = cardOf('a').querySelector<HTMLElement>('[role="switch"]')!
    await act(async () => toggle.click())
    expect(onToggle).toHaveBeenCalledWith('a', true)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('carries no pressed state on the card itself', async () => {
    await mount({ capabilities: { toggle: true }, onToggle: () => {}, isOn: () => true })
    // The card is a dialog opener, not a switch: the pressed state belongs to the switch.
    expect(cardOf('a').getAttribute('aria-pressed')).toBeNull()
    // The switch exists as its own control; the card carries no pressed state at all.
    expect(cardOf('a').querySelector('[role="switch"]')).not.toBeNull()
  })

  it('filters and searches the same collection', async () => {
    await mount({
      searchLabel: 'search',
      searchPlaceholder: 'search',
      filters: [{ id: 'suite', label: 'plugins', match: entry => entry.tagId === 'suite' }]
    })
    const field = host!.querySelector<HTMLInputElement>('[data-panel-toolbar] input')!
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- a property descriptor's accessor is invoked with the element as its receiver.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(field, 'beta')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cards().map(card => card.getAttribute('data-resource-id'))).toEqual(['b'])
  })

  it('opens the entry from the keyboard, not only from a pointer', async () => {
    const onOpen = vi.fn()
    await mount({ onOpen })
    const all = cards()
    expect(all[0]!.tabIndex).toBe(0)
    expect(all[1]!.tabIndex).toBe(0)
    await act(async () => all[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(onOpen).toHaveBeenLastCalledWith('b')
    await act(async () => all[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
    expect(onOpen).toHaveBeenLastCalledWith('a')
  })
})
