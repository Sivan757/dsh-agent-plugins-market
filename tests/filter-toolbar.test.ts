// @vitest-environment jsdom

import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SearchFilterToolbar, type SearchFilterToolbarView } from '../src/client/ui/SearchFilterToolbar.js'

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
            { id: 'all', label: 'All', count: 3, active: true, onSelect: () => {} },
            { id: 'plugin', label: 'Plugin', count: 2, active: false, onSelect: () => {} }
          ],
          view,
          toGridLabel: 'Switch to grid',
          toListLabel: 'Switch to list',
          onViewChange: setView
        }),
        h('output', { 'data-view': view }, view)
      )
    }

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(h(Harness)))

    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Search services')
    // Two filter segments plus the single view button, all named.
    expect(host.querySelectorAll('button[aria-label]').length).toBe(3)
    // The view control reports the mode in force: the grid glyph is showing,
    // so its name offers the list, and it is pressed.
    expect(host.querySelector('button[aria-label="Switch to list"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Switch to list"]')?.getAttribute('aria-pressed')).toBe('true')
    // The accessible name carries the count so the filter reads unambiguously.
    expect(host.querySelector('button[aria-label="All 3"]')?.getAttribute('aria-pressed')).toBe('true')

    act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Switch to list"]')!.click())

    expect(host.querySelector('output')?.getAttribute('data-view')).toBe('list')
    // Now the list glyph shows, so the same single control offers the grid.
    expect(host.querySelector('button[aria-label="Switch to grid"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Switch to list"]')).toBeNull()
  })
})
