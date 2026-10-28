/**
 * Two sessions in one workspace must share one scan of that workspace's files.
 *
 * The regression this counts: project readers were keyed by agent, so each
 * session got its own panel stores, its own row cache, and its own scan. The
 * test counts scans through the real panel store rather than inspecting a key
 * type, because the cost is the scan and not the map.
 *
 * A scan stamps every row it produced, which is one `stat` per row, so the
 * wrapped `stat` below is an exact scan counter. Documents carry their content
 * inline, so nothing else in the store reaches the filesystem.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stats = vi.hoisted(() => ({ count: 0 }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      stats.count += 1
      return actual.stat(...args)
    }
  }
})

const { createProjectReaderCache } = await import('../../src/application/project-readers.js')
const { createProjectExtensionResources } = await import('../../src/application/extension-project.js')
// The store-port type the factory accepts, imported as a type only.
type PanelUsers = Parameters<typeof createProjectExtensionResources>[1]

const DOC = '---\nname: one\ndescription: a skill\ndisable-model-invocation: true\n---\nBody text.'

/** Two real skill documents, so a scan reads them and stamps their rows. */
async function fakeCatalog(root: string) {
  const skills = [
    { name: 'one', file: join(root, 'one.md') },
    { name: 'two', file: join(root, 'two.md') }
  ]
  for (const skill of skills) await writeFile(skill.file, DOC, 'utf8')
  const snapshot = {
    sources: [],
    suites: [
      {
        sourceId: 'demo',
        id: 'suite',
        root,
        manifest: { name: 'suite', version: '1.0.0' },
        enabled: true,
        activeSurfaces: { skills: true },
        skills
      }
    ],
    roots: { user: '', data: '' }
  }
  const port = {
    userRoot: root,
    dataRoot: root,
    agentsRoot: root,
    localePreference: 'en',
    now: () => Date.now(),
    isInstalled: () => true,
    readUserCatalog: async () => snapshot,
    readProjectCatalog: async () => snapshot,
    enabledUserSuites: async () => [],
    translateFields: (_surface: string, _id: string, fields: Record<string, unknown>) => ({ fields, pending: 0 }),
    translateDocument: async () => ({ translated: '', pending: 0 })
  }
  return port as unknown as Parameters<typeof createProjectExtensionResources>[0]
}

/**
 * An empty user-panel store: the project dimension is the scan under test.
 *
 * The write methods are never called here, so they throw rather than answer a
 * value the test would have to keep in step with the wire type.
 */
function emptyUsers(): PanelUsers {
  const unused = async (): Promise<never> => {
    throw new Error('the project-dimension scan must not write a user entry')
  }
  const store = { list: async () => [], create: unused, update: unused, remove: unused }
  return { skills: store, commands: store, agents: store }
}

describe('project readers by workspace', () => {
  it('hands two sessions in one workspace the same reader, so they scan once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'project-readers-'))
    try {
      const catalog = await fakeCatalog(root)
      const readers = createProjectReaderCache(workspace => createProjectExtensionResources(catalog, emptyUsers(), workspace))

      // Two sessions, one workspace: the shape that used to scan twice.
      const first = readers.reader('/work/shared')
      const second = readers.reader('/work/shared')
      expect(second).toBe(first)
      expect(readers.size).toBe(1)

      stats.count = 0
      const read = await first.panels.skills.read(true)
      const afterFirst = stats.count
      // One scan stamped both rows once. Every row is one `stat`, so the count is
      // the row count of one scan, and a second scan doubles it.
      expect(read.entries).toHaveLength(2)
      expect(afterFirst).toBe(2)

      // The second session's handle is the same store, so its read is the same
      // scan's answer, not a second pass over the files.
      await second.panels.skills.read(true)
      expect(stats.count).toBe(afterFirst)

      // A different workspace is a different reader and its own scan.
      const elsewhere = readers.reader('/work/other')
      expect(elsewhere).not.toBe(first)
      await elsewhere.panels.skills.read(true)
      expect(stats.count).toBe(afterFirst * 2)
      expect(readers.size).toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a shared workspace while another session still uses it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'project-readers-'))
    try {
      const catalog = await fakeCatalog(root)
      const readers = createProjectReaderCache(workspace => createProjectExtensionResources(catalog, emptyUsers(), workspace))
      const shared = readers.reader('/work/shared')
      stats.count = 0
      await shared.panels.skills.read(true)
      expect(stats.count).toBe(2)

      // One of two sessions leaves. The workspace is still in use, so the next
      // read is still the cached answer rather than a second scan.
      readers.release('/work/shared', true)
      expect(readers.size).toBe(1)
      await readers.reader('/work/shared').panels.skills.read(true)
      expect(stats.count).toBe(2)

      // The last session leaves. The reader goes, and a later session opening
      // the same workspace scans again, which is correct for a workspace nobody
      // was reading.
      readers.release('/work/shared', false)
      expect(readers.size).toBe(0)
      await readers.reader('/work/shared').panels.skills.read(true)
      expect(stats.count).toBe(4)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('builds a reader only when a workspace is first read', () => {
    let built = 0
    const readers = createProjectReaderCache(workspace => {
      built += 1
      return { workspace }
    })
    expect(built).toBe(0)
    readers.reader('/work/a')
    expect(built).toBe(1)
    readers.reader('/work/a')
    expect(built).toBe(1)
    readers.release('/work/a', false)
    readers.reader('/work/a')
    expect(built).toBe(2)
    expect(readers.size).toBe(1)
  })
})
