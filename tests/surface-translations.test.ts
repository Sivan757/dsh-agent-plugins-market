/**
 * The non-market surfaces resolve their translations through the catalog: the
 * MCP and LSP status builders and the three panel stores each ask it for a
 * field set, and a deployment with no provider chain serves upstream text.
 */
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { createPanelResources, pluginResourceId } from '../src/application/panel-resources.js'
import { createUserPanelStores } from '../src/runtime/panels/user-panels.js'
import { resetCircuitBreaker, type TranslationProvider } from '../src/application/translation/chain.js'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')
const roots: string[] = []

afterEach(async () => {
  resetCircuitBreaker()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A provider that prefixes every text, so a translation is unmistakable. */
function prefixProvider(): TranslationProvider {
  return {
    id: 'microsoft',
    available: () => true,
    translate: async ({ texts }) => texts.map(text => 'ZH:' + text)
  }
}

/**
 * One installed suite fixture, optionally with the suite's MCP declaration
 * replaced by a single stdio server.
 */
async function seededCatalog(options: { provider?: TranslationProvider; mcp?: unknown } = {}): Promise<{ catalog: Catalog; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'market-surface-i18n-'))
  roots.push(root)
  const source = join(root, '.sources', 'active')
  await mkdir(source, { recursive: true })
  await cp(fixture, source, { recursive: true })
  // A portable suite's `mcp.json` is strict: the `$schema` is what selects the
  // ruleset, so the fixture's own declaration is replaced wholesale.
  if (options.mcp !== undefined) {
    await writeFile(join(source, 'mcp.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', ...options.mcp }))
  }
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: [{ id: 'active', url: source, local: true }],
      installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    })
  )
  const catalog = new Catalog({
    userRoot: root,
    dataRoot: join(root, 'data'),
    agentsRoot: join(root, 'agents'),
    onChanged: () => {},
    ports: {
      localePreference: () => 'zh',
      ...(options.provider === undefined ? {} : { translationProviders: [options.provider], translationProviderIdentity: () => 'test-chain' })
    }
  })
  await catalog.load()
  return { catalog, root }
}

describe('MCP status translations', () => {
  it('leaves the service name alone: a name is an identity, not prose', async () => {
    const { catalog } = await seededCatalog({
      provider: prefixProvider(),
      mcp: { mcpServers: { toolbox: { type: 'stdio', command: './bin/toolbox' } } }
    })
    catalog.mcpDiagnostics = []
    const before = await catalog.mcpStatus()
    const entryBefore = before.entries[0]
    if (entryBefore === undefined) throw new Error('expected the fixture MCP server row')
    expect(entryBefore.name).toBe('v1-suite__toolbox')

    await catalog.settleDescriptions(5_000)
    const after = await catalog.mcpStatus()
    const entry = after.entries[0]
    if (entry === undefined) throw new Error('expected the fixture MCP server row')
    // Settling the queue changes nothing about the name: it was never queued.
    expect(entry.name).toBe('v1-suite__toolbox')
  })

  it('keys each tool description by server and tool, so two servers never share one entry', async () => {
    const seen: string[] = []
    const provider: TranslationProvider = {
      id: 'microsoft',
      available: () => true,
      translate: async ({ texts }) => {
        seen.push(...texts)
        return texts.map(text => 'ZH:' + text)
      }
    }
    const { catalog } = await seededCatalog({
      provider,
      mcp: { mcpServers: { toolbox: { type: 'stdio', command: './bin/toolbox' } } }
    })
    // The observed registry is a port seam: the catalog reads it per status call.
    ;(catalog as unknown as { ports: { mcpToolSnapshot: () => unknown[] } }).ports.mcpToolSnapshot = () => [
      { name: 'mcp__v1-suite__toolbox__read_file', description: 'Read a file' }
    ]
    await catalog.mcpStatus()
    await catalog.settleDescriptions(5_000)
    const entry = (await catalog.mcpStatus()).entries[0]
    const tool = entry?.tools[0]
    expect(tool?.name).toBe('read_file')
    expect(tool?.description).toBe('Read a file')
    expect(tool?.translatedDescription).toBe('ZH:Read a file')
    expect(seen).toContain('Read a file')
  })

  it('serves upstream names when the deployment has no provider chain', async () => {
    const { catalog } = await seededCatalog({ mcp: { mcpServers: { toolbox: { type: 'stdio', command: './bin/toolbox' } } } })
    const entry = (await catalog.mcpStatus()).entries[0]
    expect(entry?.name).toBe('v1-suite__toolbox')
  })
})

describe('LSP status translations', () => {
  it('leaves the server key alone: it is the only text an LSP row carries, and it is a key', async () => {
    const { catalog } = await seededCatalog({ provider: prefixProvider() })
    await catalog.lspStatus()
    await catalog.settleDescriptions(5_000)
    const entry = (await catalog.lspStatus()).entries[0]
    expect(entry?.serverKey).toBe('typescript')
  })

  it('serves the upstream key when the deployment has no provider chain', async () => {
    const { catalog } = await seededCatalog()
    const entry = (await catalog.lspStatus()).entries[0]
    expect(entry?.serverKey).toBe('typescript')
  })
})

describe('panel entry translations', () => {
  it('translates the description of every installed resource and leaves its name', async () => {
    const { catalog, root } = await seededCatalog({ provider: prefixProvider() })
    const panels = createPanelResources(catalog, createUserPanelStores(root))
    const before = (await panels.skills.list()).find(entry => entry.origin === 'plugin')
    expect(before?.name).toBe('greet')
    expect(before?.translatedDescription).toBeUndefined()

    await catalog.settleDescriptions(5_000)
    const after = (await panels.skills.list()).find(entry => entry.origin === 'plugin')
    expect(after?.name).toBe('greet')
    expect(after?.description).toBe('Greet the user and resolve bundled resources.')
    expect(after?.translatedDescription).toBe('ZH:Greet the user and resolve bundled resources.')
  })

  it('covers all three panel kinds, each on its own surface', async () => {
    const { catalog, root } = await seededCatalog({ provider: prefixProvider() })
    const panels = createPanelResources(catalog, createUserPanelStores(root))
    // Read every panel once so all three kinds queue their fields, then settle
    // and re-read: an entry left untranslated would mean a surface was missed.
    await Promise.all([panels.skills.list(), panels.commands.list(), panels.agents.list()])
    await catalog.settleDescriptions(5_000)
    const commands = (await panels.commands.list()).find(entry => entry.origin === 'plugin')
    expect(commands?.name).toBe('deploy')
    expect(commands?.translatedDescription).toBe('ZH:Deploy the fixture')
    const agents = (await panels.agents.list()).find(entry => entry.origin === 'plugin')
    expect(agents?.name).toBe('reviewer')
    expect(agents?.translatedDescription).toBe('ZH:Review code changes')
  })

  it('translates the user-authored entries of a panel beside the plugin ones', async () => {
    const { catalog, root } = await seededCatalog({ provider: prefixProvider() })
    const users = createUserPanelStores(root)
    await users.skills.create('mine', '---\ndescription: My own skill\n---\nBody')
    const panels = createPanelResources(catalog, users)
    await panels.skills.list()
    await catalog.settleDescriptions(5_000)
    const row = (await panels.skills.list()).find(entry => entry.origin === 'user')
    expect(row?.name).toBe('mine')
    expect(row?.translatedDescription).toBe('ZH:My own skill')
  })

  it('leaves entries untranslated when the deployment has no provider chain', async () => {
    const { catalog, root } = await seededCatalog()
    const panels = createPanelResources(catalog, createUserPanelStores(root))
    const entry = (await panels.skills.list()).find(row => row.origin === 'plugin')
    expect(entry?.translatedDescription).toBeUndefined()
  })

  it('pays once for a description two entries carry and renders it on both', async () => {
    const seen: string[] = []
    const provider: TranslationProvider = {
      id: 'microsoft',
      available: () => true,
      translate: async ({ texts }) => {
        seen.push(...texts)
        return texts.map(text => 'ZH:' + text)
      }
    }
    const { catalog, root } = await seededCatalog({ provider })
    const users = createUserPanelStores(root)
    // Two entries, two identities, one description: the source text is what a
    // translation is for, so the second entry is answered from the first's.
    await users.skills.create('one', '---\ndescription: Shared description\n---\nBody one')
    await users.skills.create('two', '---\ndescription: Shared description\n---\nBody two')
    const panels = createPanelResources(catalog, users)
    await panels.skills.list()
    await catalog.settleDescriptions(5_000)
    const rows = await panels.skills.list()
    expect(rows.find(entry => entry.name === 'one')?.translatedDescription).toBe('ZH:Shared description')
    expect(rows.find(entry => entry.name === 'two')?.translatedDescription).toBe('ZH:Shared description')
    expect(seen.filter(text => text === 'Shared description')).toHaveLength(1)
  })
})

describe('market suite document translations', () => {
  it('covers all three document surfaces, each from its own file', async () => {
    const { catalog } = await seededCatalog({ provider: prefixProvider() })
    // Every surface is asked once so each queues its own document, then read
    // back settled: a surface left unread would still answer authored text.
    const ask = (kind: 'skills' | 'commands' | 'agents', name: string) => catalog.suiteDocumentTranslation('active', 'v1-suite', kind, name)
    await Promise.all([ask('skills', 'greet'), ask('commands', 'deploy'), ask('agents', 'reviewer')])
    expect(await catalog.settleDescriptions(5_000)).toBe(true)
    const [skill, command, agent] = await Promise.all([ask('skills', 'greet'), ask('commands', 'deploy'), ask('agents', 'reviewer')])
    expect(skill.pending).toBe(0)
    expect(skill.text).toContain('ZH:# Greet')
    // Frontmatter is metadata: the provider never sees it, so it is never
    // translated into YAML the file could no longer parse.
    expect(skill.text).not.toContain('description:')
    // The authored trailing newline survives assembly: nothing was invented.
    expect(command.text).toBe('ZH:Deploy the v1 fixture suite.\n')
    expect(agent.text).toBe('ZH:Review carefully.\n')
  })

  it('re-reads the file rather than translating whatever a caller last saw', async () => {
    const { catalog, root } = await seededCatalog({ provider: prefixProvider() })
    // The detail payload that put the authored text on screen is stale by the
    // time a reader asks for a translation; the answer follows the disk.
    await writeFile(join(root, '.sources', 'active', 'com.deepseek.harness', 'commands', 'deploy.md'), '---\ndescription: Deploy the fixture\n---\nRewritten command body')
    const first = await catalog.suiteDocumentTranslation('active', 'v1-suite', 'commands', 'deploy')
    // The queued chunk stands in as authored text — and that authored text is
    // the rewritten file, not the body the detail payload had carried.
    expect(first.text).toBe('Rewritten command body')
    expect(first.pending).toBe(1)
    expect(await catalog.settleDescriptions(5_000)).toBe(true)
    expect(await catalog.suiteDocumentTranslation('active', 'v1-suite', 'commands', 'deploy')).toEqual({ text: 'ZH:Rewritten command body', pending: 0 })
  })

  it('shares one cache entry with the user panel for the same document', async () => {
    let calls = 0
    const provider: TranslationProvider = {
      id: 'microsoft',
      available: () => true,
      translate: async ({ texts }) => {
        calls += 1
        return texts.map(text => 'ZH:' + text)
      }
    }
    const { catalog, root } = await seededCatalog({ provider })
    const panels = createPanelResources(catalog, createUserPanelStores(root))
    // The panel translates the suite's own file first, through the identity it
    // gives every suite-owned document.
    expect((await panels.commands.translateDocument(pluginResourceId('active', 'v1-suite', 'commands', 'deploy'))).pending).toBe(1)
    expect(await catalog.settleDescriptions(5_000)).toBe(true)
    expect(calls).toBe(1)
    // The market detail page asks for the same file through the suite identity:
    // one document is one cache entry, so no provider is paid twice.
    expect(await catalog.suiteDocumentTranslation('active', 'v1-suite', 'commands', 'deploy')).toEqual({ text: 'ZH:Deploy the v1 fixture suite.\n', pending: 0 })
    expect(calls).toBe(1)
  })

  it('answers a name the suite does not carry with a miss, not a lookup', async () => {
    const { catalog } = await seededCatalog({ provider: prefixProvider() })
    // A path-shaped name is a miss like any other: paths come from the suite's
    // own scan, never from the caller.
    await expect(catalog.suiteDocumentTranslation('active', 'v1-suite', 'commands', '../../etc/passwd')).rejects.toThrow(/no commands document named/)
    await expect(catalog.suiteDocumentTranslation('active', 'v1-suite', 'agents', 'deploy')).rejects.toThrow(/no agents document named/)
    await expect(catalog.suiteDocumentTranslation('active', 'missing-suite', 'commands', 'deploy')).rejects.toThrow(/not found in source/)
  })
})
