// @vitest-environment jsdom

/**
 * One disclosure per row.
 *
 * A row with a header action used to render two focusable toggles with the same
 * state: the name band and a chevron named after the row. A reader heard the row
 * twice, with the same action and the same expanded state, and neither button
 * said which body it controlled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { DetailRow } from '../src/ui/DetailRows.js'

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

async function mount(open: boolean, onToggle: () => void): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      h(DetailRow, {
        name: 'SKILL.md',
        summary: '12 rows',
        open,
        onToggle,
        headerActions: h('button', { type: 'button' }, 'copy'),
        children: h('p', null, 'the body')
      })
    )
  })
}

describe('detail row disclosure', () => {
  it('is one control, not two with the same state', async () => {
    const onToggle = vi.fn()
    await mount(false, onToggle)
    const toggles = [...host!.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
    expect(toggles).toHaveLength(1)
    expect(toggles[0]?.textContent).toContain('SKILL.md')
    // The trailing chevron is still a pointer target, and it is not a second stop.
    expect(host!.querySelectorAll('button[aria-label="SKILL.md"]')).toHaveLength(0)
    await act(async () => toggles[0]?.click())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('points at the body it opened', async () => {
    await mount(true, () => {})
    const toggle = host!.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')!
    const controls = toggle.getAttribute('aria-controls')
    expect(controls).not.toBeNull()
    const body = host!.querySelector<HTMLElement>('#' + CSS.escape(controls!))
    expect(body?.textContent).toContain('the body')
  })
})
