/**
 * The hook event list has three owners: the runtime's point list, the shared
 * support table in market-contracts, and the catalog validator that derives its
 * admitted events from that table. This file holds the first two together, so
 * an event cannot be added to one and silently forgotten in the other.
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { HOOK_EVENT_HOST_SUPPORT } from '../../market-contracts/src/contracts/extension-presets.js'
import { HOOK_RUNTIME_POINTS } from '../src/runtime/surfaces/extension-hooks.js'

const COVERAGE_PAGE = new URL('../../../docs/reference/hooks-event-coverage.md', import.meta.url)

describe('hook event coverage', () => {
  it('runs exactly the events the support table does not call registered-only', () => {
    const supported = Object.entries(HOOK_EVENT_HOST_SUPPORT)
      .filter(([, support]) => support !== 'registered-only')
      .map(([event]) => event)
      .sort()
    expect([...HOOK_RUNTIME_POINTS].sort()).toEqual(supported)
  })

  it('names every event it does not run on the coverage page', async () => {
    const page = await readFile(COVERAGE_PAGE, 'utf8')
    // A registered-only event has no interception point. Its absence from the
    // runtime is only honest while the page states the gap, so each unreachable
    // event has to appear there by name.
    const unreachable = Object.keys(HOOK_EVENT_HOST_SUPPORT).filter(event => HOOK_EVENT_HOST_SUPPORT[event] === 'registered-only')
    expect(unreachable.length).toBeGreaterThan(0)
    for (const event of unreachable) expect(page).toContain(event)
  })

  it('keeps every point distinct and absent from the unreachable set', () => {
    expect(new Set(HOOK_RUNTIME_POINTS).size).toBe(HOOK_RUNTIME_POINTS.length)
    for (const point of HOOK_RUNTIME_POINTS) expect(HOOK_EVENT_HOST_SUPPORT[point]).not.toBe('registered-only')
  })
})
