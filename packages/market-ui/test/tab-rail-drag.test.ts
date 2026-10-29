// @vitest-environment jsdom

/**
 * The rail's pointer reordering.
 *
 * jsdom reports every box as zero-sized, so the cases give each tab a width and a
 * position first; without that the row cannot tell one midpoint from another and a
 * passing test would prove nothing about the gesture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { TabRail, type TabRailItem } from '../../../packages/market-ui/src/ui/TabRail.js'

const items: TabRailItem<string>[] = ['市场', '技能', '命令'].map((text, index) => ({ value: 'tab-' + String(index), text, id: 'rail-tab-' + String(index), panelId: 'panel' }))

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

/** Give every tab a 100px box so midpoints land at 50, 150 and 250, and put the divider
 * past the last one: a zero-width divider sits at 0, which would make every drop look
 * like a drop into the stowed group. */
function layoutTabs(): void {
  for (const [index, tab] of [...document.querySelectorAll<HTMLElement>('[role="tab"]')].entries()) {
    tab.getBoundingClientRect = () => ({ left: index * 100, width: 100, right: index * 100 + 100, top: 0, bottom: 20, height: 20, x: index * 100, y: 0, toJSON: () => ({}) })
  }
  const divider = document.querySelector<HTMLElement>('[role="separator"]')
  if (divider !== null) {
    divider.getBoundingClientRect = () => ({ left: 320, width: 1, right: 321, top: 0, bottom: 20, height: 20, x: 320, y: 0, toJSON: () => ({}) })
  }
}

function pointer(type: string, clientX: number, pointerType: 'mouse' | 'touch' = 'mouse'): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

async function mount(onReorder: (from: number, to: number) => void): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(h(TabRail<string>, { value: 'tab-0', onChange: () => {}, label: 'row', items, onReorder }))
  })
  layoutTabs()
}

describe('tab rail reordering', () => {
  it('commits a move when a press is held and then travels past the drag threshold', async () => {
    vi.useFakeTimers()
    const onReorder = vi.fn()
    await mount(onReorder)
    const first = document.querySelectorAll<HTMLElement>('[role="tab"]')[0]!
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown', 10))
      vi.advanceTimersByTime(400)
      first.dispatchEvent(pointer('pointermove', 40))
      window.dispatchEvent(pointer('pointermove', 260))
      window.dispatchEvent(pointer('pointerup', 260))
      await Promise.resolve()
    })
    expect(onReorder).toHaveBeenCalledWith(0, 2)
    vi.useRealTimers()
  })

  it('waits for a hold before a touch drags, so a swipe still scrolls the rail', async () => {
    vi.useFakeTimers()
    const onReorder = vi.fn()
    await mount(onReorder)
    const first = document.querySelectorAll<HTMLElement>('[role="tab"]')[0]!
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown', 10, 'touch'))
      // A swipe before the hold completes belongs to the browser's sideways pan.
      first.dispatchEvent(pointer('pointermove', 90, 'touch'))
      window.dispatchEvent(pointer('pointerup', 90, 'touch'))
      await Promise.resolve()
    })
    expect(onReorder).not.toHaveBeenCalled()
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown', 10, 'touch'))
      vi.advanceTimersByTime(400)
      first.dispatchEvent(pointer('pointermove', 90, 'touch'))
      window.dispatchEvent(pointer('pointermove', 260, 'touch'))
      window.dispatchEvent(pointer('pointerup', 260, 'touch'))
      await Promise.resolve()
    })
    expect(onReorder).toHaveBeenCalledWith(0, 2)
    vi.useRealTimers()
  })

  it('treats a press that does not travel as a click, leaving the order alone', async () => {
    const onReorder = vi.fn()
    await mount(onReorder)
    const second = document.querySelectorAll<HTMLElement>('[role="tab"]')[1]!
    await act(async () => {
      second.dispatchEvent(pointer('pointerdown', 120))
      second.dispatchEvent(pointer('pointermove', 121))
      window.dispatchEvent(pointer('pointerup', 121))
      await Promise.resolve()
    })
    expect(onReorder).not.toHaveBeenCalled()
  })
  it('moves focus with the arrow keys, so the roving tab stop follows the selection', async () => {
    await mount(() => {})
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    tabs[0]!.focus()
    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1]!.getAttribute('tabindex')).toBe('0')
    expect(tabs[0]!.getAttribute('tabindex')).toBe('-1')
  })
  it('draws the selection pill on the measured box of the selected tab', async () => {
    // The pill is what makes a switch read as movement: it is one element that travels,
    // not a background on whichever chip is current. jsdom reports zero-sized boxes, so
    // the measurement is stubbed and the assertion is that the pill takes exactly it.
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(TabRail<string>, { value: 'tab-1', onChange: () => {}, label: 'row', items }))
    })
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    for (const [index, tab] of tabs.entries()) {
      Object.defineProperty(tab, 'offsetLeft', { configurable: true, value: index * 100 })
      Object.defineProperty(tab, 'offsetWidth', { configurable: true, value: 96 })
    }
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    const pill = document.querySelector<HTMLElement>('[class*="pill"]')
    expect(pill).not.toBeNull()
    expect(pill!.style.transform).toBe('translateX(100px)')
    expect(pill!.style.width).toBe('96px')
    expect(pill!.getAttribute('aria-hidden')).toBe('true')
  })
  it('keeps the motion and the reduced-motion override in the stylesheet', async () => {
    // The interaction is the feature here, so its absence should fail a test rather than
    // be noticed in front of a user: the pill must animate, hover must respond, and the
    // reduced-motion block must switch all of it off.
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('packages/market-ui/src/ui/tab-rail.module.css', 'utf8')
    const rule = (selector: string): string => new RegExp('\\' + selector + '\\s*\\{[^}]*').exec(css)?.[0] ?? ''
    expect(rule('.pill')).toMatch(/transition:[^;]*transform/)
    expect(rule('.pill')).toMatch(/cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
    expect(rule('.tab')).toMatch(/transition:/)
    // Hover must not move the tab: a row that lifts under the pointer makes aiming at a
    // neighbour harder. The feedback is colour and a tint instead.
    expect(rule('.tab:hover')).not.toMatch(/transform:/)
    expect(rule('.tab:hover')).toMatch(/background: var\(--dsw-alias-interactive-bg-hover\)/)
    expect(rule('.tab')).toMatch(/font-weight: 400/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.pill,/)
    expect(reduced).toMatch(/transition: none/)
    // The label sits at body size and weight: 12px over 400, not a bold chip.
    expect(rule('.tab')).toMatch(/font-size: 12px/)
  })
  it('scrolls sideways with the wheel and shows a chevron for each side it can reach', async () => {
    // A mouse has no sideways gesture and the row hides its scrollbar, so the row maps the
    // wheel to its own axis and offers a chevron per reachable side.
    const rail = document.createElement('div')
    const calls: Array<{ left: number }> = []
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(TabRail<string>, { value: 'tab-0', onChange: () => {}, label: 'row', items }))
    })
    const element = document.querySelector<HTMLElement>('[role="tablist"]')!
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(element, 'scrollLeft', { configurable: true, writable: true, value: 0 })
    element.scrollBy = (options?: ScrollToOptions | number) => {
      const left = typeof options === 'number' ? options : (options?.left ?? 0)
      calls.push({ left })
      Object.defineProperty(element, 'scrollLeft', { configurable: true, writable: true, value: Math.max(0, element.scrollLeft + left) })
      element.dispatchEvent(new Event('scroll'))
    }
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    // At the start: the right chevron exists, the left one does not.
    expect(document.querySelector('[aria-label="row · 向后"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="row · 向前"]')).toBeNull()
    await act(async () => {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 240 }))
    })
    expect(calls.at(-1)?.left).toBe(240)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="row · 向后"]')!.click()
    })
    expect(calls.at(-1)?.left).toBeGreaterThan(0)
    void rail
  })
})
