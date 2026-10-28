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

/** Give every tab a 100px box so midpoints land at 50, 150 and 250. */
function layoutTabs(): void {
  for (const [index, tab] of [...document.querySelectorAll<HTMLElement>('[role="tab"]')].entries()) {
    tab.getBoundingClientRect = () => ({ left: index * 100, width: 100, right: index * 100 + 100, top: 0, bottom: 20, height: 20, x: index * 100, y: 0, toJSON: () => ({}) })
  }
}

function pointer(type: string, clientX: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 })
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
  it('commits a move when a press travels past the drag threshold', async () => {
    const onReorder = vi.fn()
    await mount(onReorder)
    const first = document.querySelectorAll<HTMLElement>('[role="tab"]')[0]!
    await act(async () => {
      first.dispatchEvent(pointer('pointerdown', 10))
      first.dispatchEvent(pointer('pointermove', 40))
      window.dispatchEvent(pointer('pointermove', 260))
      window.dispatchEvent(pointer('pointerup', 260))
      await Promise.resolve()
    })
    expect(onReorder).toHaveBeenCalledWith(0, 2)
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
})
