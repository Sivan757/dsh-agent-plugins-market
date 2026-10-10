/**
 * One operation resolves the host locale once.
 *
 * The host answers `locale.preference` by projecting every active profile
 * entry's live configuration, so a surface that resolves it per entity makes a
 * read's cost scale with its entity count instead of its work. Every surface
 * that walks entities takes the locale resolved once for the whole read: the
 * panel list, the MCP status inventory including each observed tool, the LSP
 * inventory, the `/` menu faces, and the single-suite detail.
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { createPanelResources } from '../packages/market-runtime/src/application/panel-resources.js'
import { createUserPanelStores } from '../packages/market-runtime/src/runtime/panels/user-panels.js'
import { resetCircuitBreaker, type TranslationProvider } from '../packages/market-translation/src/application/translation/chain.js'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')
const roots: string[] = []

afterEach(async () => {
  resetCircuitBreaker()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A provider that prefixes every text, so a translation is unmistakable. */
function prefixProvider(): TranslationProvider {
  return { id: 'microsoft', available: () => true, translate: async ({ texts }) => texts.map(text => 'ZH:' + text) }
}

interface Seeded {
  catalog: Catalog
  /** The user-dimension root the fixture was seeded under. */
  root: string
  /** Host locale resolutions since the last {@link Seeded.reset}. */
  reads: () => number
  reset: () => void
}

/** One installed suite fixture with configurable MCP servers, tools and LSP servers. */
async function seeded(options: { mcpServers: number; toolsPerServer: number; lspServers: number }): Promise<Seeded> {
  const root = await mkdtemp(join(tmpdir(), 'market-locale-once-'))
  roots.push(root)
  const source = join(root, '.sources', 'active')
  await mkdir(source, { recursive: true })
  await cp(fixture, source, { recursive: true })
  const mcpServers = Object.fromEntries(Array.from({ length: options.mcpServers }, (_, i) => [`toolbox-${i}`, { type: 'stdio', command: './bin/toolbox' }]))
  await writeFile(join(source, 'mcp.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers }))
  await writeFile(
    join(source, 'com.deepseek.harness', 'lsp.json'),
    JSON.stringify({
      lspServers: Object.fromEntries(
        Array.from({ length: options.lspServers }, (_, i) => [`server-${i}`, { command: `lang-server-${i}`, extensionToLanguage: { [`.lang${i}`]: `lang${i}` } }])
      )
    })
  )
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: [{ id: 'active', url: source, local: true }],
      installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    })
  )
  let reads = 0
  const catalog = new Catalog({
    userRoot: root,
    dataRoot: join(root, 'data'),
    agentsRoot: join(root, 'agents'),
    onChanged: () => {},
    ports: {
      // Counted instead of resolved: the assertion is how many times one
      // operation asked the host, not what the host answered.
      localePreference: () => {
        reads += 1
        return 'zh'
      },
      translationProviders: [prefixProvider()],
      translationProviderIdentity: () => 'test-chain',
      translationEnabled: () => true
    }
  })
  await catalog.load()
  const observed = Array.from({ length: options.mcpServers }, (_, server) =>
    Array.from({ length: options.toolsPerServer }, (_, tool) => ({ name: `mcp__v1-suite__toolbox-${server}__tool-${tool}`, description: `tool ${tool} of server ${server}` }))
  ).flat()
  // The observed registry is a port seam: the catalog reads it per status call.
  ;(catalog as unknown as { ports: { mcpToolSnapshot: () => unknown[] } }).ports.mcpToolSnapshot = () => observed
  return {
    catalog,
    root,
    reads: () => reads,
    reset: () => {
      reads = 0
    }
  }
}

describe('one operation resolves the host locale once', () => {
  it('resolves it once for a multi-server, multi-tool MCP status build', async () => {
    const { catalog, reads, reset } = await seeded({ mcpServers: 3, toolsPerServer: 12, lspServers: 1 })
    reset()
    const status = await catalog.mcpStatus()
    // 3 servers + 36 observed tools: every row and every tool is localized, and
    // one read serves them all.
    expect(status.entries).toHaveLength(3)
    expect(status.entries.flatMap(entry => entry.tools)).toHaveLength(36)
    expect(reads()).toBe(1)
  })

  it('resolves it once for a multi-server LSP status build', async () => {
    const { catalog, reads, reset } = await seeded({ mcpServers: 0, toolsPerServer: 0, lspServers: 4 })
    reset()
    const status = await catalog.lspStatus()
    expect(status.entries).toHaveLength(4)
    expect(reads()).toBe(1)
  })

  it('resolves it once for a multi-row menu-face read', async () => {
    const { catalog, reads, reset } = await seeded({ mcpServers: 0, toolsPerServer: 0, lspServers: 0 })
    ;(catalog as unknown as { ports: { menuRowIdentities: () => Promise<unknown[]> } }).ports.menuRowIdentities = async () =>
      Array.from({ length: 20 }, (_, i) => ({ source: 'commands', name: `row-${i}`, id: `row-${i}`, authoredName: `row-${i}`, authoredDescription: `row description ${i}` }))
    // The first read queues the twenty descriptions; the settled read serves
    // them, which is the read whose cost this asserts.
    await catalog.menuRowFaces()
    await catalog.settleDescriptions(5_000)
    reset()
    const faces = await catalog.menuRowFaces()
    expect(faces).toHaveLength(20)
    expect(reads()).toBe(1)
  })

  it('resolves it once for a multi-row panel read', async () => {
    const { catalog, root, reads, reset } = await seeded({ mcpServers: 0, toolsPerServer: 0, lspServers: 0 })
    const users = createUserPanelStores(join(root, 'agents'))
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) await users.skills.create(name, `---\ndescription: ${name} description\n---\nBody`)
    const panels = createPanelResources(catalog, users)
    reset()
    const read = await panels.skills.read(true)
    expect(read.entries.filter(entry => entry.origin === 'user')).toHaveLength(4)
    expect(reads()).toBe(1)
  })

  it('resolves it once for one suite detail', async () => {
    const { catalog, reads, reset } = await seeded({ mcpServers: 1, toolsPerServer: 1, lspServers: 1 })
    reset()
    const detail = await catalog.suiteDetail('active', 'v1-suite')
    expect(detail.name).toBe('v1-suite')
    expect(reads()).toBe(1)
  })
})
