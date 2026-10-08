/**
 * The suite query module over its read port.
 *
 * The three reads moved off the catalog facade keep their exact behavior: which
 * snapshot answers when a caller names a workspace, the error a miss raises, the
 * authored text a document read returns, the identity and frontmatter handling a
 * translation is keyed with, and the merge a detail read performs. Driving the
 * module through a hand-built port also pins the property the facade depends on:
 * every dependency is read per call, so a caller that replaces one of its own
 * methods — the localization callbacks, the snapshot reads — is the one this
 * module calls.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuiteQueries, type SuiteQueryPorts } from '../packages/market-bundle/src/application/suite-queries.js'
import type { CatalogSnapshot } from '../packages/market-catalog/src/index.js'
import { discoverSuitesInSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import type { Suite } from '../packages/market-contracts/src/model/types.js'
import type { LocalizeDocument, LocalizeFields } from '../packages/market-contracts/src/ports/ports.js'
import { pluginResourceId } from '../packages/market-runtime/src/index.js'
import { required } from './helpers/fixture.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A discovered command suite whose single command carries frontmatter. */
async function commandSuite(): Promise<Suite> {
  const root = await mkdtemp(join(tmpdir(), 'suite-queries-'))
  roots.push(root)
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await mkdir(join(root, 'commands'), { recursive: true })
  await writeFile(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo-suite', description: 'Demo' }))
  await writeFile(join(root, 'commands', 'ship.md'), '---\ndescription: Ship it\n---\n\nShip the release.\n')
  const suites = await discoverSuitesInSource(root, 'demo', 'user')
  return withDefaultSurfaces(required(suites[0], 'the demo suite to be discovered'))
}

function snapshotOf(suite: Suite): CatalogSnapshot {
  return { revision: 1, sources: [], suites: [suite], enabledSuites: [suite] }
}

/** A port whose every read is a spy; cases override the ones they assert on. */
function portOf(suite: Suite, overrides: Partial<SuiteQueryPorts> = {}): SuiteQueryPorts {
  return {
    readUserCatalog: vi.fn(async () => snapshotOf(suite)),
    readProjectCatalog: vi.fn(async () => snapshotOf(suite)),
    installed: vi.fn(() => undefined),
    dataRoot: vi.fn(() => join(suite.root, 'data')),
    mcpDiagnostics: vi.fn(() => []),
    localePreference: vi.fn(() => 'zh'),
    translateFields: vi.fn((): ReturnType<LocalizeFields> => ({ fields: {}, pending: 0 })),
    translateDocument: vi.fn((): ReturnType<LocalizeDocument> => ({ text: '', pending: 0 })),
    ...overrides
  }
}

describe('suite queries over the read port', () => {
  it('translates a document by the identity the panel keys it with, with frontmatter stripped', async () => {
    const suite = await commandSuite()
    const seen: unknown[] = []
    const translateDocument = vi.fn((...args: Parameters<LocalizeDocument>): ReturnType<LocalizeDocument> => {
      seen.push(args)
      return { text: '译文', pending: 1 }
    })
    const queries = new SuiteQueries(portOf(suite, { translateDocument }))

    const answer = await queries.suiteDocumentTranslation('demo', suite.id, 'commands', 'ship')

    const [kind, id, text, locale] = seen[0] as [string, string, string, string]
    // The id is the panel's own key, so one document stays one cache entry.
    expect(id).toBe(pluginResourceId('demo', suite.id, 'commands', 'ship'))
    expect(kind).toBe('commands')
    expect(locale).toBe('zh')
    // A provider never sees YAML: the authored body travels without it.
    expect(text).not.toContain('description: Ship it')
    expect(text).toContain('Ship the release.')
    expect(answer).toEqual({ text: '译文', pending: 1 })
  })

  it('reads a document whole from the checkout, and a miss fails before any provider call', async () => {
    const suite = await commandSuite()
    const translateDocument = vi.fn((): ReturnType<LocalizeDocument> => ({ text: 'x', pending: 0 }))
    const queries = new SuiteQueries(portOf(suite, { translateDocument }))

    const document = await queries.suiteDocument('demo', suite.id, 'commands', 'ship')
    const authored = required(suite.resources?.commands?.[0], 'the discovered command resource')
    expect(document).toEqual({ name: 'ship', content: await readFile(authored.file, 'utf8') })

    await expect(queries.suiteDocumentTranslation('other', 'missing', 'commands', 'ship')).rejects.toThrow('suite "missing" not found in source "other"')
    expect(translateDocument).not.toHaveBeenCalled()
  })

  it('answers from the snapshot the caller names', async () => {
    const suite = await commandSuite()
    const readUserCatalog = vi.fn(async () => snapshotOf(suite))
    const readProjectCatalog = vi.fn(async () => snapshotOf(suite))
    const queries = new SuiteQueries(portOf(suite, { readUserCatalog, readProjectCatalog }))

    expect((await queries.suiteDetail('demo', suite.id)).sourceId).toBe('demo')
    expect(readUserCatalog).toHaveBeenCalledTimes(1)
    expect(readProjectCatalog).not.toHaveBeenCalled()

    await queries.suiteDetail('demo', suite.id, '/ws')
    expect(readProjectCatalog).toHaveBeenCalledWith('/ws')
    expect(readUserCatalog).toHaveBeenCalledTimes(1)
  })

  it('merges the detail translation, reports pending only when outstanding, and reads the port per call', async () => {
    const suite = await commandSuite()
    const translateFields = vi.fn((): ReturnType<LocalizeFields> => ({ fields: { translatedDescription: '演示' }, pending: 0 }))
    const port = portOf(suite, { translateFields })
    const queries = new SuiteQueries(port)

    const settled = await queries.suiteDetail('demo', suite.id)
    expect(settled.translatedDescription).toBe('演示')
    expect(settled).not.toHaveProperty('translationPending')
    // The detail modal localizes the same fields the card does.
    expect(translateFields).toHaveBeenCalledWith('market', 'demo/' + suite.id, { name: 'demo-suite', description: 'Demo' }, 'zh')

    // A caller that replaces its callback between reads is still the one called.
    const replaced = vi.fn((): ReturnType<LocalizeFields> => ({ fields: {}, pending: 2 }))
    port.translateFields = replaced
    const queued = await queries.suiteDetail('demo', suite.id)
    expect(queued.translationPending).toBe(2)
    expect(replaced).toHaveBeenCalledTimes(1)
  })
})
