/**
 * The one selection closure both paths build.
 *
 * A preset is a selection, and a selection is not a bag of ids: a suite carries the rows
 * under it, a row under a suite carries the suite, and an output style is one choice. The
 * manager's switches and the AI suggestion both name rows, so both have to ask one function.
 *
 * The question this file answers is what that function guarantees: every row a selection
 * names reads back as selected, through the same rule the manager draws its rows with.
 */
import { describe, expect, it } from 'vitest'

import type { ExtensionResource } from '../../market-contracts/src/contracts/extension-presets.js'
import { canonicalPresetSelection, resourceSelected } from '../../market-ui/src/features/extension-presets/resource.js'

const suite: ExtensionResource = {
  id: 'market:src/one',
  face: 'market',
  name: 'One',
  source: 'src',
  available: true,
  detail: { kind: 'suite', sourceId: 'src', suiteId: 'one' }
}
const child: ExtensionResource = {
  id: 'skills:src/one/review',
  face: 'skills',
  name: 'Review',
  source: 'src',
  available: true,
  suiteResourceId: suite.id,
  detail: { kind: 'panel', panel: 'skills', entryId: 'src/one/review' }
}
const sibling: ExtensionResource = { ...child, id: 'skills:src/one/test', name: 'Test', detail: { kind: 'panel', panel: 'skills', entryId: 'src/one/test' } }
const standing: ExtensionResource = {
  id: 'skills:user/mine',
  face: 'skills',
  name: 'Mine',
  source: 'user',
  available: true,
  detail: { kind: 'panel', panel: 'skills', entryId: 'user/mine' }
}
const style: ExtensionResource = {
  id: 'outputStyles:brief',
  face: 'outputStyles',
  name: 'Brief',
  source: 'user',
  available: true,
  detail: { kind: 'outputStyle', entryId: 'brief' }
}
const rows = [suite, child, sibling, standing, style]

describe('the canonical preset selection', () => {
  it('carries the suite that owns a named row', () => {
    // A row under a suite decides on its own id alone; the manager counts it as selected only
    // when the suite is selected too. A selection that names the row and not the suite is
    // stored and reads back as nothing.
    const ids = canonicalPresetSelection(rows, [], [{ id: child.id, enabled: true }])
    expect(ids).toContain(child.id)
    expect(ids).toContain(suite.id)
    expect(resourceSelected(child, ids)).toBe(true)
  })

  it('carries the rows under a named suite', () => {
    // A suite row and the rows under it move together, or the suite is on and its contents
    // are off.
    const ids = canonicalPresetSelection(rows, [], [{ id: suite.id, enabled: true }])
    expect(ids).toContain(child.id)
    expect(ids).toContain(sibling.id)
    expect(resourceSelected(child, ids)).toBe(true)
    expect(resourceSelected(sibling, ids)).toBe(true)
  })

  it('leaves a row that stands on its own alone', () => {
    const ids = canonicalPresetSelection(rows, [], [{ id: standing.id, enabled: true }])
    expect(ids).toEqual([standing.id])
  })

  it('lets one output style at a time', () => {
    const other: ExtensionResource = { ...style, id: 'outputStyles:long', name: 'Long', detail: { kind: 'outputStyle', entryId: 'long' } }
    const ids = canonicalPresetSelection([...rows, other], [style.id], [{ id: other.id, enabled: true }])
    expect(ids).toContain(other.id)
    expect(ids).not.toContain(style.id)
  })

  it('does not carry a row the manager cannot switch', () => {
    const globalOnly: ExtensionResource = { ...standing, id: 'mcp:direct', control: 'global-only' }
    const unavailable: ExtensionResource = { ...standing, id: 'skills:src/gone', available: false }
    const ids = canonicalPresetSelection(
      [...rows, globalOnly, unavailable],
      [],
      [
        { id: globalOnly.id, enabled: true },
        { id: unavailable.id, enabled: true }
      ]
    )
    expect(ids).toEqual([])
  })

  it('turns one row off without touching the rest', () => {
    const on = canonicalPresetSelection(rows, [], [{ id: suite.id, enabled: true }])
    const off = canonicalPresetSelection(rows, on, [{ id: child.id, enabled: false }])
    expect(off).not.toContain(child.id)
    expect(off).toContain(sibling.id)
    expect(off).toContain(suite.id)
  })
})
