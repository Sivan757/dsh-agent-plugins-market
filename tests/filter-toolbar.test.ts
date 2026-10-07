// @vitest-environment jsdom

import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SearchFilterToolbar, type SearchFilterToolbarView } from '../packages/market-ui/src/ui/SearchFilterToolbar.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe('SearchFilterToolbar', () => {
  it('uses one accessible control row and switches presentation modes', () => {
    let filter: string | undefined
    function Harness() {
      const [view, setView] = useState<SearchFilterToolbarView>('grid')
      return h(
        'div',
        {},
        h(SearchFilterToolbar, {
          search: '',
          searchLabel: 'Search services',
          searchPlaceholder: 'Search services',
          onSearchChange: () => {},
          filters: [
            { id: 'all', label: 'All', count: 3, active: filter === undefined, onSelect: () => {} },
            {
              id: 'plugin',
              label: 'Plugin',
              count: 2,
              active: filter === 'plugin',
              onSelect: () => {
                filter = 'plugin'
              }
            }
          ],
          filterId: 'test-filter',
          filterLabel: 'Filter services',
          view,
          toGridLabel: 'Switch to grid',
          toListLabel: 'Switch to list',
          onViewChange: setView
        }),
        // The caller owns the panel the tablist names, deriving its id from the
        // same base it handed the toolbar.
        h('div', { role: 'tabpanel', id: `test-filter-${filter ?? 'all'}-panel` }, 'panel'),
        h('output', { 'data-view': view }, view)
      )
    }

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(h(Harness)))

    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Search services')
    // The filter segment is the host's controlled tablist, named by the panel.
    const tablist = host.querySelector('[role="tablist"]')
    expect(tablist?.getAttribute('aria-label')).toBe('Filter services')
    // The selected tab names the caller's panel, and that panel exists: the
    // aria-controls reference resolves instead of dangling.
    const selectedTab = host.querySelector('[role="tab"][aria-selected="true"]')
    expect(selectedTab?.getAttribute('aria-controls')).toBe('test-filter-all-panel')
    expect(host.querySelector('#test-filter-all-panel')).not.toBeNull()
    // Two filter segments plus the single view button, all keyboard-reachable.
    expect(host.querySelectorAll('[role="tab"]').length).toBe(2)
    expect(host.querySelectorAll('button[aria-label]').length).toBe(1)
    // The view control reports the mode in force: the grid glyph is showing,
    // so its name offers the list, and it is pressed.
    expect(host.querySelector('button[aria-label="Switch to list"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Switch to list"]')?.getAttribute('aria-pressed')).toBe('true')
    // The drawn glyph has to paint: an unfilled shape with no stroke of its own
    // renders as an empty pill, which is what this control had shipped as.
    const gridGlyph = host.querySelector<SVGSVGElement>('button[aria-label="Switch to list"] svg')!
    expect(gridGlyph.getAttribute('fill')).toBe('none')
    expect(gridGlyph.getAttribute('stroke')).toBe('currentColor')
    expect(Number(gridGlyph.getAttribute('stroke-width'))).toBeGreaterThan(0)
    expect(gridGlyph.querySelectorAll('rect').length).toBe(4)
    // The selected segment is the only tab stop and its label carries the count.
    const selected = host.querySelector('[role="tab"][aria-selected="true"]')
    expect(selected?.getAttribute('tabindex')).toBe('0')
    expect(selected?.textContent).toBe('All 3')

    act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Switch to list"]')!.click())

    expect(host.querySelector('output')?.getAttribute('data-view')).toBe('list')
    // Now the list glyph shows, so the same single control offers the grid.
    expect(host.querySelector('button[aria-label="Switch to grid"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Switch to list"]')).toBeNull()
    // The mode's other glyph rides the same paint, so the control never flips
    // between a visible and an empty button.
    const listGlyph = host.querySelector<SVGSVGElement>('button[aria-label="Switch to grid"] svg')!
    expect(listGlyph.getAttribute('stroke')).toBe('currentColor')
    expect(listGlyph.querySelectorAll('path').length).toBeGreaterThan(0)
  })
})
