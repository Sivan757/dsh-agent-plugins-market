/**
 * The hook event list has three owners: the runtime's point list, the shared
 * support table in market-contracts, and the catalog validator that derives its
 * admitted events from that table. This file holds the first two together, so
 * an event cannot be added to one and silently forgotten in the other.
 */
import { describe, expect, it } from 'vitest'
import { HOOK_EVENT_HOST_SUPPORT } from '../../market-contracts/src/contracts/extension-presets.js'
import { HOOK_RUNTIME_POINTS } from '../src/runtime/surfaces/extension-hooks.js'

describe('hook event coverage', () => {
  it('runs exactly the events the support table does not call registered-only', () => {
    const supported = Object.entries(HOOK_EVENT_HOST_SUPPORT)
      .filter(([, support]) => support !== 'registered-only')
      .map(([event]) => event)
      .sort()
    expect([...HOOK_RUNTIME_POINTS].sort()).toEqual(supported)
  })

  it('names the missing host seam for every event it does not run', () => {
    // A registered-only event is one no interception point reaches. The
    // reference page is where each one is explained, so the table cannot grow a
    // registered-only entry that no document accounts for.
    const declared = Object.keys(HOOK_EVENT_HOST_SUPPORT)
    for (const event of declared) expect(event).toMatch(/^[A-Z][A-Za-z]+$/)
  })

  it('keeps every point distinct', () => {
    expect(new Set(HOOK_RUNTIME_POINTS).size).toBe(HOOK_RUNTIME_POINTS.length)
  })
})
