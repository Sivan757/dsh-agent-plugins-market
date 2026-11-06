// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * The source chip carries two facts a reader must be able to get at: the
 * source's name and the source's own controls. This file pins the geometry
 * that keeps them apart — jsdom has no layout, so the shapes the stylesheet
 * promises are asserted on the stylesheet itself — and the DOM that keeps a
 * click on the name a selection.
 */
const overviewPayload = vi.hoisted(() => ({
  sources: [
    {
      id: 'skills',
      displayName: 'jeecgboot/skills',
      url: 'https://example.com/jeecgboot/skills.git',
      branch: null,
      local: false,
      cloned: true,
      lockCommit: 'f0e9fdf066c1',
      suiteIds: ['demo-suite']
    },
    {
      id: 'zeta',
      url: 'https://example.com/zeta.git',
      branch: null,
      local: false,
      cloned: true,
      lockCommit: 'f0e9fdf066c1',
      suiteIds: []
    }
  ],
  suites: [
    {
      sourceId: 'skills',
      suiteId: 'demo-suite',
      name: 'Demo Suite',
      description: 'A demo suite for rendering tests',
      version: '1.0.0',
      layout: 'agent-plugin-v1',
      dimension: 'user',
      installed: false,
      enabled: false,
      remoteUrl: undefined,
      keywords: ['demo'],
      surfaces: { skills: 2, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
      errors: [],
      mcpErrors: []
    }
  ],
  totals: { all: 2, installed: 0 }
}))

vi.mock('../../../packages/market-ui/src/api.js', () => ({
  fetchOverview: vi.fn().mockResolvedValue(overviewPayload),
  fetchSourceProgress: vi.fn().mockResolvedValue({ step: undefined, error: undefined }),
  fetchSuiteDetail: vi.fn(),
  fetchMcpStatus: vi.fn(),
  fetchSuiteDocument: vi.fn(),
  postAction: vi.fn().mockResolvedValue({})
}))

vi.mock('../../../packages/market-ui/src/features/market/market-resource.js', () => ({
  peekOverview: vi.fn(() => ({ initial: overviewPayload, cached: true })),
  loadOverview: vi.fn(() => ({
    initial: overviewPayload,
    revalidating: false,
    promise: Promise.resolve(overviewPayload)
  })),
  invalidateOverview: vi.fn(),
  startDescriptionRefresh: vi.fn(() => ({ stop: () => {} })),
  startSourceProgressPolling: vi.fn(() => ({ stop: () => {} }))
}))

import { MarketSection } from '../../../packages/market-ui/src/features/market/MarketSection.js'
import { SourceTab } from '../../../packages/market-ui/src/ui/SourceTab.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

// A permissive translate that returns the key — enough to render labels.
const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
})

/** Mount one chip and hand back its DOM. */
function mountChip(props: { label: string; onSelect: () => void; onEdit?: () => void; onDelete?: () => void }): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      h(SourceTab, {
        t,
        label: props.label,
        onSelect: props.onSelect,
        ...(props.onEdit === undefined ? {} : { onEdit: props.onEdit }),
        ...(props.onDelete === undefined ? {} : { onDelete: props.onDelete })
      })
    )
  })
  return host
}

/** The declarations of the rule the selector opens. */
function ruleFor(css: string, selector: string): string {
  const at = css.indexOf(selector + ' {')
  if (at < 0) return ''
  return css.slice(at, css.indexOf('}', at))
}

describe('the source chip', () => {
  it('keeps the name out of the controls’ way and clickable', () => {
    const onSelect = vi.fn()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const el = mountChip({ label: 'skills 1', onSelect, onEdit, onDelete })

    // The name and the controls are siblings: the name is never a child of
    // the control plate, so no control can stand between the reader and the
    // name it is trying to click.
    const name = el.querySelector('button')
    const controls = el.querySelector('[class*=srcTabControls]')
    expect(name).not.toBeNull()
    expect(controls).not.toBeNull()
    expect(controls!.contains(name)).toBe(false)
    expect(name!.textContent).toBe('skills 1')

    // A click on the name selects the source, once.
    act(() => {
      name!.click()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)

    // A click on the chip's own area selects it too: the chip is the target,
    // not only the run of characters that spell the name.
    act(() => {
      ;(name!.parentElement as HTMLElement).click()
    })
    expect(onSelect).toHaveBeenCalledTimes(2)

    // The controls keep their clicks: an edit does not select the source.
    const edit = controls!.querySelector('button')
    expect(edit).not.toBeNull()
    act(() => {
      edit!.click()
    })
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('keeps the controls an inert overlay over the name’s own room', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('packages/market-ui/src/ui/source-strip.module.css', 'utf8')

    // The controls are the published plate again: an overlay over the chip’s
    // trailing edge, with the internal mask (the opaque plate and the spread
    // shadow that feathers its edge). The chip does not grow when they open.
    const plate = ruleFor(css, '.srcTabControls')
    expect(plate).toMatch(/position: absolute/)
    expect(plate).toMatch(/right: 0/)
    expect(plate).toMatch(/background: inherit/)
    expect(plate).toMatch(/box-shadow: 0 0 6px 6px/)
    expect(plate).toMatch(/opacity: 0/)
    expect(plate).toMatch(/pointer-events: none/)

    // An invisible control must never take a click meant for the name: the
    // buttons are inert until the plate is open. `opacity: 0` does not stop a
    // hit test, so the plate being invisible is not enough.
    expect(ruleFor(css, '.srcTabControls > button')).toMatch(/pointer-events: none/)

    // Hover reveals the plate; keyboard focus keeps it too, but only for
    // focus-visible — a mouse click’s plain focus would otherwise pin the
    // plate open on the chip the reader just picked.
    const open = ruleFor(css, '.srcTabOn:has(:focus-visible) .srcTabControls')
    expect(open).toMatch(/opacity: 1/)
    expect(ruleFor(css, '.srcTabOn:has(:focus-visible) .srcTabControls > button')).toMatch(/pointer-events: auto/)
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/:focus-within/)

    // The room is on the chip, not on the label. The label carries the 220px
    // text budget, and padding it would ellipsize the longest names 47px
    // earlier than the published build, where they read in full.
    expect(ruleFor(css, '.srcTabOn:has(.srcTabControls)')).toMatch(/padding-right: calc\(10px \+ var\(--src-tab-controls-room\)\)/)
    expect(css).not.toMatch(/\.srcTabMain[^{]*\{[^}]*padding-right/)

    // The room is a measured number: the plate covers 41px of the content box
    // and the mask's feather reaches 6px further left.
    const room = /--src-tab-controls-room: (\d+)px/.exec(css)
    expect(room).not.toBeNull()
    expect(Number(room![1])).toBeGreaterThanOrEqual(47)

    // A chip without controls keeps the symmetric padding: the room is added
    // on top of it, not in place of it.
    expect(css).toMatch(/\.srcTab,\s*\.srcTabOn \{[^}]*padding: 0 10px/)
  })

  it('names the source the way a reader recognizes it', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(h(MarketSection, { t, mode: 'settings' }))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const chips = [...host.querySelectorAll('button')].map(button => button.textContent ?? '').filter(text => text.includes('jeecgboot/skills') || text.startsWith('zeta'))
    // The qualified name leads the chip, and a source without one keeps its id.
    expect(chips).toContain('jeecgboot/skills 1')
    expect(chips).toContain('zeta 0')
  })
})
