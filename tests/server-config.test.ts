import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { applyOverride, loadSuiteOverrides, saveSuiteOverrides, suiteOverridePath } from '../packages/market-mcp/src/application/mcp/mcp-overrides.js'
import { restoreRedactedConfig } from '../packages/market-bundle/src/application/server-config.js'
import { loadLspServers } from '../packages/market-lsp/src/application/lsp/lsp-direct-config.js'
import type { CatalogPortsOverride } from '../packages/market-contracts/src/ports/ports.js'
import { loadUserMcpSuite, userMcpPath } from '../packages/market-mcp/src/application/mcp/mcp-direct-config.js'
import { toMcpMounts } from '../packages/market-mcp/src/application/mcp/mcp-config.js'
import * as jsonFile from '../packages/market-catalog/src/application/json-file.js'

const roots: string[] = []
async function setup(ports: CatalogPortsOverride = {}) {
  const root = await mkdtemp(join(tmpdir(), 'server-config-'))
  roots.push(root)
  const agentsRoot = join(root, 'agents')
  const catalog = new Catalog({ userRoot: root, dataRoot: root, agentsRoot, onChanged: () => {}, ports })
  await catalog.load()
  return { root, agentsRoot, catalog }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('service configuration editing', () => {
  it('creates LSP servers independently, rejects duplicates and preserves corrupt existing data', async () => {
    const { agentsRoot, catalog } = await setup()
    await catalog.addLspServer('one', { command: 'one', extensionToLanguage: { '.one': 'one' } })
    await catalog.addLspServer('two', { command: 'two', extensionToLanguage: { '.two': 'two' } })
    expect(Object.keys((await loadLspServers(agentsRoot)).servers)).toEqual(['one', 'two'])
    await expect(catalog.addLspServer('one', { command: 'new', extensionToLanguage: { '.one': 'one' } })).rejects.toThrow('already exists')
    const path = join(agentsRoot, 'lsp.json')
    await writeFile(path, 'corrupt')
    await expect(catalog.addLspServer('three', { command: 'three', extensionToLanguage: { '.three': 'three' } })).rejects.toThrow('lsp.json')
    expect(await readFile(path, 'utf8')).toBe('corrupt')
  })
  it('persists plugin LSP edits outside the checkout and projects them into runtime discovery', async () => {
    const { root, catalog } = await setup()
    const checkout = join(root, '.sources', 'demo')
    await mkdir(checkout, { recursive: true })
    await cp(new URL('./fixtures/cc-marketplace/', import.meta.url), checkout, { recursive: true })
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    await catalog.install('demo', 'typescript-lsp')
    const manifest = join(checkout, '.claude-plugin', 'marketplace.json')
    const before = await readFile(manifest, 'utf8')
    const id = 'demo/typescript-lsp/typescript'
    const detail = await catalog.serverConfig('lsp', id)
    await catalog.saveServerConfig('lsp', id, { ...detail.config, command: 'replacement' })
    expect((await catalog.serverConfig('lsp', id)).config.command).toBe('replacement')
    const suite = (await catalog.enabledUserSuites()).find(candidate => candidate.id === 'typescript-lsp')
    const typescript = suite?.lsp?.servers['typescript']
    if (typescript === undefined) throw new Error('expected the saved command to reach the suite LSP table')
    expect(typescript.command).toBe('replacement')
    const statusEntry = (await catalog.lspStatus()).entries.find(entry => entry.id === id)
    if (statusEntry === undefined) throw new Error('expected the saved command to reach the LSP status entry')
    expect(statusEntry.command).toBe('replacement')
    expect(await readFile(manifest, 'utf8')).toBe(before)
  })

  it('roundtrips masked MCP secrets and replaces transport with validated configuration', async () => {
    const { root, catalog } = await setup()
    await catalog.addMcpServer('demo', { type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer private' } })
    const id = 'plugin:@user-mcp/user-mcp/demo'
    const detail = await catalog.serverConfig('mcp', id)
    expect(detail.config.headers).toEqual({ Authorization: '[redacted]' })
    await catalog.saveServerConfig('mcp', id, { ...detail.config, url: 'https://example.test/new' })
    const overrides = await loadSuiteOverrides(root, '@user-mcp/user-mcp')
    expect(overrides.demo?.config).toMatchObject({ headers: { Authorization: 'Bearer private' } })
    const path = suiteOverridePath(root, '@user-mcp/user-mcp')
    const before = await readFile(path, 'utf8')
    await expect(catalog.saveServerConfig('mcp', id, { type: 'stdio', command: 123 })).rejects.toThrow('invalid MCP')
    expect(await readFile(path, 'utf8')).toBe(before)
    await catalog.saveServerConfig('mcp', id, { type: 'stdio', command: 'node', args: ['--version'], env: {} })
    const replacement = (await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo
    expect(applyOverride({ type: 'streamable-http', url: 'https://example.test' }, replacement)).toEqual({ type: 'stdio', command: 'node', args: ['--version'], env: {} })
  })

  it('saves complete direct LSP config without parser identity, preserves nested secrets and rejects malformed edits', async () => {
    const { agentsRoot, catalog } = await setup()
    await catalog.setLspServers({ lspServers: { demo: { command: 'old', extensionToLanguage: { '.ts': 'typescript' }, configuration: { apiKey: 'secret', deep: [1, true] } } } })
    const detail = await catalog.serverConfig('lsp', 'direct/demo')
    expect(detail.config.configuration).toEqual({ apiKey: '[redacted]', deep: [1, true] })
    await catalog.saveServerConfig('lsp', 'direct/demo', { ...detail.config, command: 'new' })
    expect((await loadLspServers(agentsRoot)).servers.demo).toMatchObject({ command: 'new', configuration: { apiKey: 'secret', deep: [1, true] } })
    const before = await readFile(join(agentsRoot, 'lsp.json'), 'utf8')
    await expect(catalog.saveServerConfig('lsp', 'direct/demo', { command: 'broken', extensionToLanguage: {} })).rejects.toThrow('invalid LSP')
    expect(await readFile(join(agentsRoot, 'lsp.json'), 'utf8')).toBe(before)
  })

  it('rejects newly introduced masks and preserves redacted args and URL exactly', () => {
    expect(() => restoreRedactedConfig({ env: { API_KEY: '[redacted]' } }, {})).toThrow('masked values')
    const original = { args: ['--token', 'secret'], url: 'https://example.test?token=secret' }
    expect(restoreRedactedConfig({ args: ['--token', '[redacted]'], url: 'https://example.test?token=[redacted]' }, original)).toEqual(original)
  })
})

/** One direct user MCP server, the shape a first-party service takes. */
async function directServer(catalog: Catalog): Promise<string> {
  await catalog.addMcpServer('demo', { type: 'streamable-http', url: 'https://example.test/mcp' })
  return 'plugin:@user-mcp/user-mcp/demo'
}

describe('service creation policy', () => {
  it('returns creation defaults from the same policy resolver used for existing services', async () => {
    const { catalog } = await setup({ mcpBackend: async () => 'host' })
    const draft = await catalog.serverConfig('mcp', '', true)
    expect(draft).toMatchObject({ kind: 'mcp', id: '', key: '', editable: true, config: { type: 'stdio', command: '' }, backend: 'host' })
    const id = await directServer(catalog)
    expect(draft.policy).toEqual((await catalog.serverConfig('mcp', id)).policy)
    expect(await catalog.serverConfig('lsp', '', true)).toEqual({ kind: 'lsp', id: '', key: '', editable: true, config: { command: '', extensionToLanguage: {} } })
    await expect(catalog.serverConfig('mcp', '')).rejects.toThrow('not managed')
  })

  it('persists creation policy before publishing a mountable declaration', async () => {
    const { root, agentsRoot, catalog } = await setup()
    const config = { type: 'stdio', command: 'node' }
    const policy = { toolCallTimeoutMs: 123_000, startupTimeoutMs: 25_000, disabledTools: ['remove'], auth: { enabled: false } }
    const write = jsonFile.writeJsonDocument
    vi.spyOn(jsonFile, 'writeJsonDocument').mockImplementation(async (path, document) => {
      if (path === userMcpPath(agentsRoot)) {
        expect((await loadUserMcpSuite(agentsRoot)).mcp.servers).toEqual({})
        expect((await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo).toEqual(policy)
      }
      await write(path, document)
    })
    await catalog.addMcpServer('demo', config, policy)
    const suite = await loadUserMcpSuite(agentsRoot)
    expect(suite.mcp.servers.demo).toEqual(config)
    const overrides = await loadSuiteOverrides(root, '@user-mcp/user-mcp')
    const mounted = await toMcpMounts(suite, root, overrides)
    expect(mounted.mounts[0]?.config).toMatchObject({ toolCallTimeoutMs: 123_000, startupTimeoutMs: 25_000, disabledTools: ['remove'] })
    const reloaded = new Catalog({ userRoot: root, dataRoot: root, agentsRoot, onChanged: () => {} })
    await reloaded.load()
    expect((await reloaded.serverConfig('mcp', 'plugin:@user-mcp/user-mcp/demo')).policy?.startupTimeout.user).toBe(25_000)
  })

  it('rejects malformed policies and declarations without publishing a server', async () => {
    const { root, agentsRoot, catalog } = await setup()
    const config = { type: 'stdio', command: 'node' }
    await expect(catalog.addMcpServer('bad', config, { startupTimeoutMs: 0 })).rejects.toThrow('startup timeout')
    await expect(catalog.addMcpServer('bad', config, null)).rejects.toThrow('policy must be an object')
    await expect(catalog.addMcpServer('bad', { type: 'stdio' }, { toolCallTimeoutMs: 123_000 })).rejects.toThrow('invalid MCP')
    expect((await loadUserMcpSuite(agentsRoot)).mcp.servers).toEqual({})
    expect(await loadSuiteOverrides(root, '@user-mcp/user-mcp')).toEqual({})
  })

  it('keeps a duplicate declaration and its existing policy unchanged', async () => {
    const { root, agentsRoot, catalog } = await setup()
    await catalog.addMcpServer('demo', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 12_000 })
    const before = await readFile(userMcpPath(agentsRoot), 'utf8')
    await expect(catalog.addMcpServer('demo', { type: 'stdio', command: 'other' }, { toolCallTimeoutMs: 30_000 })).rejects.toThrow('already exists')
    expect(await readFile(userMcpPath(agentsRoot), 'utf8')).toBe(before)
    expect((await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo?.toolCallTimeoutMs).toBe(12_000)
  })

  it('clears orphan policy on creation without writing overrides unnecessarily', async () => {
    const { root, catalog } = await setup()
    const write = vi.spyOn(jsonFile, 'writeJsonDocument')
    await catalog.addMcpServer('fresh', { type: 'stdio', command: 'node' })
    expect(write.mock.calls.some(([path]) => path === suiteOverridePath(root, '@user-mcp/user-mcp'))).toBe(false)
    await saveSuiteOverrides(root, '@user-mcp/user-mcp', { orphan: { enabled: false, toolCallTimeoutMs: 12_000, config: { type: 'stdio', command: 'stale' } } })
    await catalog.addMcpServer('orphan', { type: 'stdio', command: 'node' })
    const created = await catalog.serverConfig('mcp', 'plugin:@user-mcp/user-mcp/orphan')
    expect(created.config.command).toBe('node')
    expect(created.policy?.toolCallTimeout.user).toBeNull()
    expect((await loadSuiteOverrides(root, '@user-mcp/user-mcp')).orphan).toBeUndefined()
  })

  it('enforces the host backend limits during creation', async () => {
    const { agentsRoot, catalog } = await setup({ mcpBackend: async () => 'host' })
    const config = { type: 'stdio', command: 'node' }
    await expect(catalog.addMcpServer('demo', config, { startupTimeoutMs: 25_000 })).rejects.toThrow('cannot enforce a startup timeout')
    await expect(catalog.addMcpServer('demo', config, { disabledTools: ['remove'] })).rejects.toThrow('cannot enforce tool filters')
    expect((await loadUserMcpSuite(agentsRoot)).mcp.servers).toEqual({})
    await catalog.addMcpServer('demo', config, { toolCallTimeoutMs: 123_000, startupTimeoutMs: null })
    expect((await catalog.serverConfig('mcp', 'plugin:@user-mcp/user-mcp/demo')).policy?.toolCallTimeout.user).toBe(123_000)
  })

  it('rejects a queued duplicate without changing the first successful policy', async () => {
    const { root, agentsRoot, catalog } = await setup()
    const outcomes = await Promise.allSettled([
      catalog.addMcpServer('demo', { type: 'stdio', command: 'first' }, { toolCallTimeoutMs: 12_000 }),
      catalog.addMcpServer('demo', { type: 'stdio', command: 'second' }, { toolCallTimeoutMs: 30_000 })
    ])
    expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((await loadUserMcpSuite(agentsRoot)).mcp.servers.demo).toMatchObject({ command: 'first' })
    expect((await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo?.toolCallTimeoutMs).toBe(12_000)
  })

  it('preserves publication and rollback errors when restoring policy also fails', async () => {
    const { root, agentsRoot, catalog } = await setup()
    const publicationError = new Error('publication failed')
    const rollbackError = new Error('rollback failed')
    const write = jsonFile.writeJsonDocument
    let published = false
    vi.spyOn(jsonFile, 'writeJsonDocument').mockImplementation(async (path, document) => {
      if (path === userMcpPath(agentsRoot)) {
        published = true
        throw publicationError
      }
      if (published && path === suiteOverridePath(root, '@user-mcp/user-mcp')) throw rollbackError
      await write(path, document)
    })
    const failure = await catalog.addMcpServer('demo', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 123_000 }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([publicationError, rollbackError])
    expect((failure as AggregateError).cause).toBe(rollbackError)
    expect((await loadUserMcpSuite(agentsRoot)).mcp.servers).toEqual({})
  })

  it.each(['policy', 'declaration'] as const)('leaves no new server after a %s write failure', async failure => {
    const { root, agentsRoot, catalog } = await setup()
    const before = { demo: { enabled: false, toolCallTimeoutMs: 12_000 }, other: { startupTimeoutMs: 5_000 } }
    await saveSuiteOverrides(root, '@user-mcp/user-mcp', before)
    const write = jsonFile.writeJsonDocument
    vi.spyOn(jsonFile, 'writeJsonDocument').mockImplementation(async (path, document) => {
      const failPath = failure === 'policy' ? suiteOverridePath(root, '@user-mcp/user-mcp') : userMcpPath(agentsRoot)
      if (path === failPath) throw new Error('injected write failure')
      await write(path, document)
    })
    await expect(catalog.addMcpServer('demo', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 123_000 })).rejects.toThrow('injected write failure')
    expect((await loadUserMcpSuite(agentsRoot)).mcp.servers).toEqual({})
    expect(await loadSuiteOverrides(root, '@user-mcp/user-mcp')).toEqual(before)
  })
})

describe('MCP service policy', () => {
  it('stores the timeouts outside the portable document and reports their source', async () => {
    const { root, catalog } = await setup()
    const id = await directServer(catalog)
    const before = await catalog.serverConfig('mcp', id)
    expect(before.backend).toBe('builtin')
    expect(before.policy?.toolCallTimeout).toEqual({ user: null, suite: null, effective: 60_000, source: 'default' })
    expect(before.policy?.startupTimeout).toEqual({ user: null, suite: null, effective: 10_000, source: 'default' })
    // The document the editor renders stays in the portable schema shape.
    expect(before.config).not.toHaveProperty('toolCallTimeoutMs')

    await catalog.saveServerConfig('mcp', id, { ...before.config, url: 'https://example.test/fresh' }, { toolCallTimeoutMs: 120_000, startupTimeoutMs: 30_000 })
    const stored = (await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo
    expect(stored).toMatchObject({ toolCallTimeoutMs: 120_000, startupTimeoutMs: 30_000, config: { type: 'streamable-http', url: 'https://example.test/fresh' } })
    expect(stored?.config).not.toHaveProperty('toolCallTimeoutMs')

    const after = await catalog.serverConfig('mcp', id)
    expect(after.policy?.toolCallTimeout).toEqual({ user: 120_000, suite: null, effective: 120_000, source: 'user' })
    expect(after.policy?.startupTimeout).toEqual({ user: 30_000, suite: null, effective: 30_000, source: 'user' })
  })

  it('keeps enablement, OAuth and tool denials while clearing connection leftovers', async () => {
    const { root, catalog } = await setup()
    const id = await directServer(catalog)
    await saveSuiteOverrides(root, '@user-mcp/user-mcp', {
      demo: {
        enabled: false,
        auth: { enabled: false },
        disabledTools: ['beta'],
        toolCallTimeoutMs: 5_000,
        url: 'https://stale.test/mcp',
        headers: { authorization: 'Bearer ${TOKEN}' },
        args: ['--old'],
        env: { A: 'b' }
      }
    })
    const detail = await catalog.serverConfig('mcp', id)
    // The editor document is the portable shape; the OAuth opt-out lives in the
    // override record, where a config save leaves it alone.
    const portable = { ...detail.config }
    delete portable['auth']
    await catalog.saveServerConfig('mcp', id, { ...portable, url: 'https://example.test/fresh' }, { startupTimeoutMs: 20_000 })
    const stored = (await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo
    expect(stored).toMatchObject({
      enabled: false,
      auth: { enabled: false },
      disabledTools: ['beta'],
      toolCallTimeoutMs: 5_000,
      startupTimeoutMs: 20_000,
      config: { type: 'streamable-http', url: 'https://example.test/fresh' }
    })
    expect(stored?.url).toBeUndefined()
    expect(stored?.headers).toBeUndefined()
    expect(stored?.args).toBeUndefined()
    expect(stored?.env).toBeUndefined()
  })

  it('clears a timeout back to inheritance with null', async () => {
    const { root, catalog } = await setup()
    const id = await directServer(catalog)
    const detail = await catalog.serverConfig('mcp', id)
    await catalog.saveServerConfig('mcp', id, detail.config, { toolCallTimeoutMs: 120_000, startupTimeoutMs: 30_000 })
    await catalog.saveServerConfig('mcp', id, detail.config, { toolCallTimeoutMs: null, startupTimeoutMs: null })
    const stored = (await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo
    expect(stored?.toolCallTimeoutMs).toBeUndefined()
    expect(stored?.startupTimeoutMs).toBeUndefined()
    const after = await catalog.serverConfig('mcp', id)
    expect(after.policy?.toolCallTimeout).toEqual({ user: null, suite: null, effective: 60_000, source: 'default' })
  })

  it('rejects an out-of-range timeout with a readable reason and writes nothing', async () => {
    const { root, catalog } = await setup()
    const id = await directServer(catalog)
    const detail = await catalog.serverConfig('mcp', id)
    await expect(catalog.saveServerConfig('mcp', id, detail.config, { toolCallTimeoutMs: 0 })).rejects.toThrow('tool call timeout')
    await expect(catalog.saveServerConfig('mcp', id, detail.config, { startupTimeoutMs: 2_147_483_648 })).rejects.toThrow('startup timeout')
    await expect(catalog.saveServerConfig('mcp', id, detail.config, { startupTimeoutMs: 1.5 })).rejects.toThrow('startup timeout')
    expect((await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo?.toolCallTimeoutMs).toBeUndefined()
  })

  it('writes and removes tool denials, dropping the field when nothing is denied', async () => {
    const { root, catalog } = await setup()
    await directServer(catalog)
    const overrides = async () => (await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo
    await catalog.setMcpServerToolEnabled('@user-mcp/user-mcp', 'demo', 'beta', false)
    expect((await overrides())?.disabledTools).toEqual(['beta'])
    await catalog.setMcpServerToolEnabled('@user-mcp/user-mcp', 'demo', 'alpha', false)
    expect((await overrides())?.disabledTools).toEqual(['beta', 'alpha'])
    await catalog.setMcpServerToolEnabled('@user-mcp/user-mcp', 'demo', 'beta', true)
    expect((await overrides())?.disabledTools).toEqual(['alpha'])
    await catalog.setMcpServerToolEnabled('@user-mcp/user-mcp', 'demo', 'alpha', true)
    expect(await overrides()).toBeUndefined()
  })

  it('refuses a startup timeout and a tool toggle on the host compatibility backend', async () => {
    const { root, catalog } = await setup({ mcpBackend: async () => 'host' })
    const id = await directServer(catalog)
    const detail = await catalog.serverConfig('mcp', id)
    expect(detail.backend).toBe('host')
    await expect(catalog.saveServerConfig('mcp', id, detail.config, { startupTimeoutMs: 20_000 })).rejects.toThrow('cannot enforce a startup timeout')
    await expect(catalog.setMcpServerToolEnabled('@user-mcp/user-mcp', 'demo', 'beta', false)).rejects.toThrow('cannot enforce tool filters')
    // The tool-call timeout stays available: the host client enforces it.
    await catalog.saveServerConfig('mcp', id, detail.config, { toolCallTimeoutMs: 120_000 })
    expect((await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo?.toolCallTimeoutMs).toBe(120_000)
  })

  it('refuses a startup timeout or deny list sent through the raw override patch', async () => {
    const { catalog } = await setup({ mcpBackend: async () => 'host' })
    await directServer(catalog)
    await expect(catalog.setMcpOverride('@user-mcp', 'user-mcp', 'demo', { startupTimeoutMs: 20_000 })).rejects.toThrow('cannot enforce a startup timeout')
    await expect(catalog.setMcpOverride('@user-mcp', 'user-mcp', 'demo', { disabledTools: ['beta'] })).rejects.toThrow('cannot enforce tool filters')
    // Enabling and disabling a server carries no tool policy, so it stays usable.
    await expect(catalog.setMcpServerEnabled('@user-mcp/user-mcp', 'demo', false)).resolves.toBeUndefined()
  })

  it('names the field a rejected configuration failed on', async () => {
    const { catalog } = await setup()
    const id = await directServer(catalog)
    // The schema rejects the value itself, so the reason can name its field.
    const error = await catalog.saveServerConfig('mcp', id, { type: 'streamable-http', url: 123 }).then(
      () => undefined,
      (reason: unknown) => reason as { fields: Array<{ field: string; message: string }> }
    )
    expect(error?.fields.some(entry => entry.field === 'url')).toBe(true)
  })

  it('stores a user-owned service with keys this client does not know', async () => {
    const { catalog } = await setup()
    const id = await directServer(catalog)
    await expect(catalog.saveServerConfig('mcp', id, { type: 'stdio', command: 'node', alwaysAllow: ['x'] })).resolves.toBeUndefined()
    expect((await catalog.serverConfig('mcp', id)).config).toMatchObject({ command: 'node', alwaysAllow: ['x'] })
  })

  it('reports the mount backend on the MCP status payload', async () => {
    const { catalog } = await setup({ mcpBackend: async () => 'host' })
    expect((await catalog.mcpStatus()).backend).toBe('host')
  })
})
