/**
 * Removing a user-owned MCP server: the declaration file loses exactly that
 * key, the override record and OAuth grant that outlived it are dropped, and a
 * suite-declared server is refused because its `mcp.json` is source-owned.
 */
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../../../../packages/market-bundle/src/application/catalog.js'
import { loadUserMcpSuite, userMcpPath } from '../../../../packages/market-mcp/src/application/mcp/mcp-direct-config.js'
import { loadSuiteOverrides, saveSuiteOverrides, suiteOverridePath } from '../../../../packages/market-mcp/src/application/mcp/mcp-overrides.js'
import { toMcpMounts } from '../../../../packages/market-mcp/src/application/mcp/mcp-config.js'
import type { CatalogPortsOverride } from '../../../../packages/market-contracts/src/ports/ports.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'v1-suite')

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup(ports: CatalogPortsOverride = {}): Promise<{ root: string; agentsRoot: string; catalog: Catalog }> {
  const root = await mkdtemp(join(tmpdir(), 'mcp-remove-'))
  roots.push(root)
  const agentsRoot = join(root, 'agents')
  const catalog = new Catalog({ userRoot: root, dataRoot: root, agentsRoot, onChanged: () => {}, ports })
  await catalog.load()
  return { root, agentsRoot, catalog }
}

/** One installed source suite whose `mcp.json` declares two servers. */
async function installedCatalog(ports: CatalogPortsOverride = {}): Promise<{ root: string; catalog: Catalog; suiteRoot: string }> {
  const { root, catalog } = await setup(ports)
  const suiteRoot = join(root, '.sources', 'demo')
  await mkdir(suiteRoot, { recursive: true })
  await cp(fixture, suiteRoot, { recursive: true })
  await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
  await catalog.install('demo', 'v1-suite')
  return { root, catalog, suiteRoot }
}

describe('removing a user-owned MCP server', () => {
  it('drops exactly that declaration, its override record, and its OAuth grant', async () => {
    const deleted: string[] = []
    const { root, agentsRoot, catalog } = await setup({
      credentialsStore: {
        deleteGrantRecord: async serverName => {
          deleted.push(serverName)
        }
      }
    })
    await catalog.addMcpServer('kuboard', { type: 'stdio', command: 'npx' }, { toolCallTimeoutMs: 120_000 })
    await catalog.addMcpServer('other', { type: 'stdio', command: 'node' })
    await saveSuiteOverrides(root, '@user-mcp/user-mcp', {
      kuboard: { enabled: false, toolCallTimeoutMs: 120_000, config: { type: 'stdio', command: 'npx' } },
      other: { enabled: true }
    })

    await catalog.removeMcpServer('@user-mcp/user-mcp', 'kuboard')

    // The untouched declaration keeps its own text; only the removed key is gone.
    const written = JSON.parse(await readFile(userMcpPath(agentsRoot), 'utf8')) as { $schema?: string; mcpServers?: Record<string, unknown> }
    expect(written.mcpServers).toEqual({ other: { type: 'stdio', command: 'node' } })
    expect(written.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
    const suite = await loadUserMcpSuite(agentsRoot)
    expect(suite.errors).toEqual([])
    expect(Object.keys(suite.mcp.servers)).toEqual(['other'])
    // A leftover record would hand the removed server's edited config and policy
    // to the next declaration of the same name.
    expect(await loadSuiteOverrides(root, '@user-mcp/user-mcp')).toEqual({ other: { enabled: true } })
    // The user declaration mounts under its bare key, so that is the folded name
    // the grant record is stored under.
    expect(deleted).toEqual(['kuboard'])
    // Nothing is left for the reconciler to mount.
    const mounts = await toMcpMounts(suite, root, await loadSuiteOverrides(root, '@user-mcp/user-mcp'))
    expect(mounts.mounts.map(mount => mount.config.serverName)).toEqual(['other'])
  })

  it('leaves a valid, empty declaration when the last server is removed', async () => {
    const { agentsRoot, catalog } = await setup()
    await catalog.addMcpServer('only', { type: 'stdio', command: 'node' })
    await catalog.removeMcpServer('@user-mcp/user-mcp', 'only')
    const suite = await loadUserMcpSuite(agentsRoot)
    expect(suite.mcp.servers).toEqual({})
    expect(suite.errors).toEqual([])
    // The empty table is what the MCP panel renders as "no servers", not a
    // rejected document the next scan would report as an error.
    expect(JSON.parse(await readFile(userMcpPath(agentsRoot), 'utf8'))).toMatchObject({ mcpServers: {} })
  })

  it('refuses an undeclared server without writing anything', async () => {
    const { root, agentsRoot, catalog } = await setup()
    await catalog.addMcpServer('kept', { type: 'stdio', command: 'node' })
    const before = await readFile(userMcpPath(agentsRoot), 'utf8')
    await expect(catalog.removeMcpServer('@user-mcp/user-mcp', 'absent')).rejects.toThrow('MCP server "absent" is not declared')
    expect(await readFile(userMcpPath(agentsRoot), 'utf8')).toBe(before)
    expect(await loadSuiteOverrides(root, '@user-mcp/user-mcp')).toEqual({})
  })

  it('removes a declaration together with a stale override for a server it no longer holds', async () => {
    const { root, agentsRoot, catalog } = await setup()
    await catalog.addMcpServer('one', { type: 'stdio', command: 'node' })
    await saveSuiteOverrides(root, '@user-mcp/user-mcp', { one: { enabled: false }, ghost: { enabled: false } })
    await catalog.removeMcpServer('@user-mcp/user-mcp', 'one')
    expect(JSON.parse(await readFile(userMcpPath(agentsRoot), 'utf8'))).toMatchObject({ mcpServers: {} })
    // Only the removed key's record goes; any other record stays as it was.
    expect(await loadSuiteOverrides(root, '@user-mcp/user-mcp')).toEqual({ ghost: { enabled: false } })
  })
})

describe('refusing a suite-owned MCP server', () => {
  it('refuses every server a source suite declares and names the disable path', async () => {
    const { root, catalog, suiteRoot } = await installedCatalog()
    const before = await readFile(join(suiteRoot, 'mcp.json'), 'utf8')
    const error = await catalog.removeMcpServer('demo/v1-suite', 'toolbox').then(
      () => undefined,
      (reason: unknown) => reason as Error
    )
    expect(error?.message).toBe('server "toolbox" belongs to suite "demo/v1-suite"; disable it instead of removing it')
    // A source-owned declaration stays untouched: the next refresh re-reads it,
    // so deleting from it would undo itself.
    expect(await readFile(join(suiteRoot, 'mcp.json'), 'utf8')).toBe(before)
    await expect(catalog.removeMcpServer('demo/v1-suite', 'remote')).rejects.toThrow('belongs to suite')
    expect(await loadSuiteOverrides(root, 'demo/v1-suite')).toEqual({})
    expect(await readFile(suiteOverridePath(root, 'demo/v1-suite'), 'utf8').catch(() => 'absent')).toBe('absent')
  })

  it('refuses an unqualified suite id before reading any declaration', async () => {
    const { catalog } = await setup()
    await expect(catalog.removeMcpServer('user-mcp', 'kuboard')).rejects.toThrow('invalid suite id')
  })
})
