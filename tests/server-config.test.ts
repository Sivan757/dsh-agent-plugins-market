import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { applyOverride, loadSuiteOverrides, saveSuiteOverrides, suiteOverridePath } from '../src/runtime/mcp-overrides.js'
import { restoreRedactedConfig } from '../src/runtime/server-config.js'
import { loadLspServers } from '../src/runtime/lsp-direct-config.js'
import type { CatalogPortsOverride } from '../src/application/ports.js'

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

  it('reports the mount backend on the MCP status payload', async () => {
    const { catalog } = await setup({ mcpBackend: async () => 'host' })
    expect((await catalog.mcpStatus()).backend).toBe('host')
  })
})
