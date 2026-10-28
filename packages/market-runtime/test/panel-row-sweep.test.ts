import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPanelResources } from '../../market-runtime/src/application/panel-resources.js'
import { ROW_CACHE_MAX_AGE_MS, ROW_SWEEP_MAX_AGE_MS, EXTENSION_WINDOW_POLL_MS } from '../../market-contracts/src/contracts/refresh-cadence.js'

/**
 * One user document on disk, so a sweep and a scan read the same file.
 * The store counts `list` calls, which is what a scan costs: the panel reuses the
 * scan's rows only by not asking the store again.
 */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'panel-sweep-'))
  const file = join(root, 'alpha.md')
  await writeFile(file, '---\nname: alpha\ndescription: first\n---\nbody\n')
  let scans = 0
  const describeOf = (text: string): string => /description:\s*(.*)/.exec(text)?.[1]?.trim() ?? ''
  const store = {
    list: async () => {
      scans += 1
      const text = await readFile(file, 'utf8')
      return [{ id: 'alpha', name: 'alpha', description: describeOf(text), origin: 'user' as const, disabled: false, path: file, rawText: text, metadata: {} }]
    },
    create: async () => {
      throw new Error('unused')
    },
    update: async () => {},
    remove: async () => {}
  }
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
  const panels = createPanelResources(port as unknown as Parameters<typeof createPanelResources>[0], { skills: store, commands: store, agents: store })
  return {
    panel: panels.skills,
    file,
    countScans: () => scans,
    advance: (ms: number) => {
      clock += ms
    },
    dispose: async () => {
      await rm(root, { recursive: true, force: true })
    }
  }
}

describe('panel row sweep', () => {
  it('keeps a scan past its stat-free bound when every document is provably unchanged', async () => {
    const h = await harness()
    try {
      expect((await h.panel.read()).entries[0]?.description).toBe('first')
      expect(h.countScans()).toBe(1)
      // One window poll later the stat-free bound has expired; the sweep answers instead.
      h.advance(EXTENSION_WINDOW_POLL_MS)
      expect((await h.panel.read()).entries[0]?.description).toBe('first')
      expect(h.countScans()).toBe(1)
      h.advance(EXTENSION_WINDOW_POLL_MS)
      expect((await h.panel.read()).entries[0]?.description).toBe('first')
      expect(h.countScans()).toBe(1)
    } finally {
      await h.dispose()
    }
  })

  it('rescans when a document edit moves its signature, so a hand edit is still visible', async () => {
    const h = await harness()
    try {
      await h.panel.read()
      expect(h.countScans()).toBe(1)
      await writeFile(h.file, '---\nname: alpha\ndescription: edited\n---\nbody\n')
      h.advance(EXTENSION_WINDOW_POLL_MS)
      expect((await h.panel.read()).entries[0]?.description).toBe('edited')
      expect(h.countScans()).toBe(2)
    } finally {
      await h.dispose()
    }
  })

  it('rescans past the sweep bound, which is how a file added or removed by hand is noticed', async () => {
    const h = await harness()
    try {
      await h.panel.read()
      expect(h.countScans()).toBe(1)
      // A sweep cannot count a document it never knew about, so the multiple is
      // the only bound on structure changes and it must force a real scan.
      h.advance(ROW_SWEEP_MAX_AGE_MS + 1)
      await h.panel.read()
      expect(h.countScans()).toBe(2)
      expect(ROW_SWEEP_MAX_AGE_MS).toBeGreaterThan(ROW_CACHE_MAX_AGE_MS)
    } finally {
      await h.dispose()
    }
  })
})
