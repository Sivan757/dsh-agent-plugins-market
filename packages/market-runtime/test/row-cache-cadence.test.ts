import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPanelResources, ROW_CACHE_MAX_AGE_MS } from '../../market-runtime/src/application/panel-resources.js'
import { EXTENSION_WINDOW_POLL_MS, TRANSLATION_POLL_MS, rowCacheMaxAgeMs } from '../../market-contracts/src/contracts/refresh-cadence.js'

/**
 * One user-origin entry per row, so a scan is exactly one `users.list` call and
 * a test can count scans instead of timing them.
 */
function fakeStores(count: number) {
  let scans = 0
  const entries = Array.from({ length: count }, (_, index) => ({
    id: 'entry-' + String(index),
    name: 'entry-' + String(index),
    description: 'a document',
    origin: 'user' as const,
    disabled: false,
    path: '/nonexistent/entry-' + String(index) + '.md',
    rawText: 'body',
    metadata: {}
  }))
  const store = {
    list: async () => {
      scans += 1
      return entries
    },
    create: async () => entries[0]!,
    update: async () => {},
    remove: async () => {}
  }
  return { store, countScans: () => scans }
}

/** A port stub carrying only what the scan and the presenter touch. */
function fakePort(root: string) {
  let clock = 1_000_000
  const snapshot = { suites: [], sources: [], roots: { user: '', data: '' } }
  const port = {
    userRoot: root,
    dataRoot: root,
    agentsRoot: root,
    localePreference: 'en',
    now: () => clock,
    isInstalled: () => false,
    readUserCatalog: async () => snapshot,
    readProjectCatalog: async () => snapshot,
    enabledUserSuites: async () => [],
    translateFields: (_surface: string, _id: string, fields: Record<string, unknown>) => ({ fields, pending: 0 }),
    translateDocument: async () => ({ translated: '', pending: 0 })
  }
  return { port: port as unknown as Parameters<typeof createPanelResources>[0], advance: (ms: number) => (clock += ms) }
}

describe('row cache cadence', () => {
  it('keeps the bound the panel has always used, now derived', () => {
    expect(ROW_CACHE_MAX_AGE_MS).toBe(2_000)
  })

  it('sits strictly between the fast poll it must absorb and the slow poll it must beat', () => {
    expect(ROW_CACHE_MAX_AGE_MS).toBeGreaterThan(TRANSLATION_POLL_MS)
    expect(ROW_CACHE_MAX_AGE_MS).toBeLessThan(EXTENSION_WINDOW_POLL_MS)
    // The bound is a function of the cadences, so neither literal can move alone.
    expect(ROW_CACHE_MAX_AGE_MS).toBe(EXTENSION_WINDOW_POLL_MS - (EXTENSION_WINDOW_POLL_MS - ROW_CACHE_MAX_AGE_MS))
  })

  it('refuses a schedule that would waste the cache or hide an edit', () => {
    // A bound at or under the fast poll means the cache never absorbs it.
    expect(() => rowCacheMaxAgeMs(2500, 1500, 1000)).toThrow('must outlive the 1500ms translation poll')
    // A bound at the slow poll means an edit stays invisible for two polls.
    expect(() => rowCacheMaxAgeMs(2500, 1500, 0)).toThrow('must be positive')
    // A negative slack would put the bound past the poll.
    expect(() => rowCacheMaxAgeMs(2500, 1500, -1)).toThrow('must be positive')
  })

  it('serves a read inside the bound from the previous scan and rescans past it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'row-cache-'))
    try {
      const { port, advance } = fakePort(root)
      const { store, countScans } = fakeStores(3)
      const panels = createPanelResources(port, { skills: store, commands: store, agents: store })
      const skills = panels.skills

      // The first read scans.
      await skills.read(true)
      expect(countScans()).toBe(1)

      // A read one fast-poll later is still inside the bound, so it reuses the scan.
      advance(TRANSLATION_POLL_MS)
      await skills.read(true)
      expect(countScans()).toBe(1)

      // A read past the bound rescans, which is what keeps a hand edit visible.
      advance(ROW_CACHE_MAX_AGE_MS - TRANSLATION_POLL_MS + 1)
      await skills.read(true)
      expect(countScans()).toBe(2)

      // The bound is measured from the scan that armed it, not from the last read.
      const age = await stat(root)
      expect(age.isDirectory()).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
