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
    root!.render(h(TabRail<string>, { value: 'tab-0', onChange: () => {}, label: 'row', stepPreviousLabel: '向前一个', stepNextLabel: '向后一个', items, onReorder }))
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
  it('keeps the chip, the fade and the reduced-motion override in the stylesheet', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('packages/market-ui/src/ui/tab-rail.module.css', 'utf8')
    const rule = (selector: string): string => new RegExp('\\' + selector + '\\s*\\{[^}]*').exec(css)?.[0] ?? ''
    // The selected tab is a chip of its own; there is no separate travelling pill.
    expect(rule('.tabActive')).toMatch(/background: var\(--dsw-alias-bg-layer-1\)/)
    expect(css).not.toMatch(/\\.pill/)
    // A clipped side dissolves through the row's own mask, not a coloured band: the
    // band carried no colour the panel surface could be trusted to match in both themes.
    expect(css).not.toMatch(/\.fadeRight/)
    expect(css).not.toMatch(/\.fadeLeft/)
    expect(rule('.tab')).toMatch(/font-size: 14px/)
    // The row is a strip: a column parent must not stretch it, or the tabs float in a
    // panel-sized empty box and the panel below is pushed off screen.
    const wrapRule = /\.wrap \{[^}]*/.exec(css)?.[0] ?? ''
    expect(wrapRule).toMatch(/flex: none/)
    expect(wrapRule).not.toMatch(/flex: 1 1 auto/)
    // The step arrow is a narrow overlay inside the rail. It exists only while its side
    // is clipped, so it reads at rest: a row that runs past the edge says so before hover.
    expect(rule('.stepRight')).toMatch(/width: 14px/)
    expect(rule('.stepRight')).toMatch(/height: 26px/)
    expect(rule('.stepRight')).toMatch(/background: transparent/)
    expect(rule('.stepRight')).not.toMatch(/opacity: 0\)/)
    // The hold must be visible: a ring that fills, and a lifted, shadowed tab while dragged.
    expect(css).toMatch(/\.tabPressing::after/)
    expect(css).toMatch(/@keyframes hold-fill/)
    expect(rule('.tabDragging')).toMatch(/box-shadow:/)
    expect(rule('.tabDragging')).toMatch(/cursor: grabbing/)
    expect(rule('.tab')).toMatch(/cursor: grab/)
    expect(rule('.tab')).toMatch(/font-weight: 400/)
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/transition: none/)
  })

  it('measures once more after the frame, so a row that settles late still gets its affordance', async () => {
    // The settings dialog mounts its content while the layout is still settling:
    // the first measurement can see a row that fits, and nothing dispatches a
    // resize afterwards. One frame later the row overflows, and the mask and the
    // chevron have to exist by then.
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(TabRail<string>, { value: 'tab-0', onChange: () => {}, label: 'row', stepPreviousLabel: '向前一个', stepNextLabel: '向后一个', items }))
    })
    const element = document.querySelector<HTMLElement>('[role="tablist"]')!
    expect(element.style.maskImage).toBe('')
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: 300 })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 40))
    })
    expect(element.style.maskImage).toContain('linear-gradient')
    expect(document.querySelector('[aria-label="row · 向后一个"]')).not.toBeNull()
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
      root!.render(h(TabRail<string>, { value: 'tab-0', onChange: () => {}, label: 'row', stepPreviousLabel: '向前一个', stepNextLabel: '向后一个', items }))
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
    // At the start: the right chevron exists, the left one does not, and the row
    // dissolves at the one edge it hides content behind.
    expect(document.querySelector('[aria-label="row · 向后一个"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="row · 向前一个"]')).toBeNull()
    expect(element.style.maskImage).toContain('linear-gradient')
    expect(element.style.maskImage).toContain('calc(100% - 40px)')
    await act(async () => {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 240 }))
    })
    expect(calls.at(-1)?.left).toBe(240)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="row · 向后一个"]')!.click()
    })
    expect(calls.at(-1)?.left).toBeGreaterThan(0)
    void rail
  })
  it('shows the hold filling, then lifts the tab and follows the pointer', async () => {
    // The complaint this answers: a hold with no visible change leaves the user unsure
    // whether a drag is even possible. The ring fills while pressing, and once the hold is
    // spent the tab lifts and moves with the pointer.
    vi.useFakeTimers()
    const onReorder = vi.fn()
    await mount(onReorder)
    const first = document.querySelectorAll<HTMLElement>('[role="tab"]')[0]!
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown', 10))
    })
    expect(first.className).toContain('Pressing')
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(first.className).toContain('Dragging')
    expect(first.className).not.toContain('Pressing')
    await act(async () => {
      window.dispatchEvent(pointer('pointermove', 130))
    })
    expect(first.style.transform).toContain('translate(120px')
    expect(first.style.transform).toContain('scale(1.03)')
    await act(async () => {
      window.dispatchEvent(pointer('pointerup', 130))
    })
    expect(first.style.transform).toBe('')
    vi.useRealTimers()
  })
  it('ends the drag when the release lands on the tab, not on the window', async () => {
    // React's handler on the button runs before the window listener, so a release over the
    // tab used to clear the press without ending the drag: the lifted tab stayed on screen
    // over its neighbours with nothing left to put it down.
    vi.useFakeTimers()
    const onReorder = vi.fn()
    await mount(onReorder)
    const first = document.querySelectorAll<HTMLElement>('[role="tab"]')[0]!
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown', 10))
      vi.advanceTimersByTime(400)
      window.dispatchEvent(pointer('pointermove', 260))
    })
    expect(first.className).toContain('Dragging')
    await act(async () => {
      first.dispatchEvent(pointer('pointerup', 260))
      await Promise.resolve()
    })
    expect(first.className).not.toContain('Dragging')
    expect(first.style.transform).toBe('')
    expect(onReorder).toHaveBeenCalledWith(0, 2)
    vi.useRealTimers()
  })
})
