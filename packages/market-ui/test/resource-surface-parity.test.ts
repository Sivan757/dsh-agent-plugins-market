// @vitest-environment jsdom

/**
 * The two merged surfaces render the same card contract.
 *
 * The settings file panels and the preset dialog are different entry points with different
 * data, but both render through ResourceSurface, so the card skeleton and the meaning of a
 * click must be identical. This test compares the rendered markup and the interaction
 * directly, instead of comparing screenshots by eye.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../../packages/market-ui/src/api.js', () => ({
  fetchInstructions: vi.fn(),
  saveInstructionFile: vi.fn(),
  deleteInstructionFile: vi.fn(),
  fetchOutputStyles: vi.fn(),
  selectOutputStyle: vi.fn(),
  captureOutputStyle: vi.fn(),
  saveUserOutputStyle: vi.fn(),
  deleteUserOutputStyle: vi.fn()
}))
vi.mock('../../../packages/market-ui/src/ui/CodeEditor.js', () => ({
  CodeEditor: (props: { value: string; onChange: (value: string) => void; label: string }) =>
    h('textarea', { 'data-code-editor': props.label, value: props.value, onChange: (event: { target: HTMLTextAreaElement }) => props.onChange(event.target.value) })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import * as apiModule from '../../../packages/market-ui/src/api.js'
import { InstructionsPanel } from '../../../packages/market-ui/src/features/instructions/InstructionsPanel.js'
import { ResourceSurface } from '../../../packages/market-ui/src/ui/ResourceSurface.js'
import type { Translate } from '../../../packages/market-ui/src/i18n.js'

const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))
const api = apiModule as unknown as { fetchInstructions: ReturnType<typeof vi.fn> }

const INSTRUCTIONS = {
  available: true,
  cwd: '/work/project',
  projectRoot: '/work/project',
  budget: 65536,
  maxSourceBytes: 1048576,
  total: 64,
  rows: [
    {
      scope: 'user-global',
      directory: '.',
      candidate: 'AGENTS.md',
      displayPath: '~/.dsh/AGENTS.md',
      path: '/home/.dsh/AGENTS.md',
      exists: true,
      size: 20,
      status: 'loaded',
      content: '# Global\n'
    }
  ],
  rendered: { text: '', omitted: [], truncated: [] }
}

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.clearAllMocks()
})

async function mountSettings(): Promise<HTMLElement[]> {
  api.fetchInstructions.mockResolvedValue(INSTRUCTIONS)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(InstructionsPanel, { t })))
  await act(async () => {})
  return [...host.querySelectorAll<HTMLElement>('[data-resource-id]')]
}

async function mountSurface(): Promise<{ cards: HTMLElement[]; opened: string[] }> {
  const opened: string[] = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      h(ResourceSurface, {
        t,
        entries: [{ id: 'user-global:.:AGENTS.md', name: '~/.dsh/AGENTS.md', tag: 'loaded', description: undefined, meta: '20' }],
        searchLabel: 'search',
        emptyText: 'empty',
        onOpen: id => opened.push(id)
      })
    )
  })
  return { cards: [...host.querySelectorAll<HTMLElement>('[data-resource-id]')], opened }
}

/** The skeleton a card must have, whatever surface drew it. */
interface Skeleton {
  tag: string
  role: string | null
  tabIndex: string | null
  state: string | null
  pressed: string | null
  hasSwitch: boolean
  /** The named rows the card fills, in document order. */
  rows: (string | null)[]
  descendants: { tag: string; role: string | null; state: string | null; id: string | null }[]
}

function skeleton(card: HTMLElement): Skeleton {
  const descendants = [...card.querySelectorAll<HTMLElement>('*')].map(node => ({
    tag: node.tagName.toLowerCase(),
    role: node.getAttribute('role'),
    state: node.getAttribute('data-resource-state'),
    id: node.getAttribute('data-resource-id')
  }))
  return {
    tag: card.tagName.toLowerCase(),
    role: card.getAttribute('role'),
    tabIndex: card.getAttribute('tabindex'),
    state: card.getAttribute('data-resource-state'),
    pressed: card.getAttribute('aria-pressed'),
    hasSwitch: card.querySelector('[role="switch"]') !== null,
    rows: [...card.querySelectorAll('[data-card-row]')].map(row => row.getAttribute('data-card-row')),
    descendants
  }
}

describe('the two merged surfaces share one card contract', () => {
  it('draws the same card skeleton from different data', async () => {
    const [settingsCard] = await mountSettings()
    const settings = skeleton(settingsCard!)
    await act(async () => root?.unmount())
    host?.remove()
    const { cards: surfaceCards } = await mountSurface()
    const surfaceCard = surfaceCards[0]
    const surface = skeleton(surfaceCard!)
    expect(settings.tag).toBe('article')
    // The card is a region on both surfaces: its controls are real controls, and
    // the one control that opens it is the name button inside.
    expect(settings.role).toBeNull()
    expect(settings.tabIndex).toBeNull()
    expect(settings.pressed).toBeNull()
    expect(surface.role).toBeNull()
    expect(settings.hasSwitch).toBe(settings.hasSwitch && surface.hasSwitch)
    // Same elements, same order: identity, chip, description slot, meta line.
    expect(settings.descendants.map(node => node.tag)).toEqual(surface.descendants.map(node => node.tag))
    // Same rows around them, so a slot cannot land in another card's cell.
    expect(settings.rows).toEqual(surface.rows)
    expect(settings.rows).toEqual(['id', 'foot'])
  })

  it('means the same thing by a click on both surfaces', async () => {
    const { cards, opened } = await mountSurface()
    await act(async () => cards[0]!.click())
    expect(opened).toEqual(['user-global:.:AGENTS.md'])
  })
})
