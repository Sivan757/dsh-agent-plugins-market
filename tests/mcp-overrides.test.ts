import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { toMcpMounts } from '../src/runtime/mcp-config.js'
import { applyOverride, loadSuiteOverrides, sanitizeOverrides, saveSuiteOverrides } from '../src/runtime/mcp-overrides.js'
import type { McpServerStreamableHttp, Suite } from '../src/model/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'v1-suite')

const httpServer: McpServerStreamableHttp = { type: 'streamable-http', url: 'https://source.example/mcp', headers: { authorization: 'Bearer source' } }

function httpSuite(): Suite {
  return {
    sourceId: 'demo',
    id: 'suite',
    root: '/tmp/suite',
    manifest: { layout: 'agent-plugin-v1', path: '/tmp/suite/plugin.json', id: 'suite', name: 'suite' },
    skills: [],
    mcp: { schema: 'x', servers: { docs: httpServer } },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    errors: []
  }
}

describe('mcp-overrides sanitize + persist', () => {
  it('keeps only recognized fields with valid shapes', () => {
    const sanitized = sanitizeOverrides({
      docs: { enabled: false, url: 'https://override.example/mcp', junk: 'dropped', headers: { a: 'b', bad: 3 }, args: ['x', 4] }
    })
    expect(sanitized['docs']).toEqual({ enabled: false, url: 'https://override.example/mcp', headers: { a: 'b' } })
  })

  it('round-trips through disk and clears when the object empties', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'dsh-mcpov-'))
    await saveSuiteOverrides(dataRoot, 'suite', { docs: { url: 'https://override.example/mcp' } })
    expect(await loadSuiteOverrides(dataRoot, 'suite')).toEqual({ docs: { url: 'https://override.example/mcp' } })
    await saveSuiteOverrides(dataRoot, 'suite', {})
    expect(await loadSuiteOverrides(dataRoot, 'suite')).toEqual({})
  })
})

describe('applyOverride', () => {
  it('replaces whole fields without merging keys', () => {
    const merged = applyOverride(httpServer, { headers: { 'x-other': '1' } }) as McpServerStreamableHttp
    expect(merged.headers).toEqual({ 'x-other': '1' })
  })

  it('passes the server through untouched without an override', () => {
    expect(applyOverride(httpServer, undefined)).toBe(httpServer)
  })
})

describe('toMcpMounts with overrides', () => {
  it('omits disabled servers entirely', () => {
    const suite = httpSuite()
    const result = toMcpMounts(suite, '/data', { docs: { enabled: false } })
    expect(result.mounts).toEqual([])
    expect(result.failures).toEqual([])
  })

  it('applies url/header overrides; ${ENV} refs resolve at mount time', () => {
    const suite = httpSuite()
    process.env.DSH_MCP_OVERRIDE_TEST_TOKEN = 'secret-value'
    try {
      const result = toMcpMounts(suite, '/data', { docs: { url: 'https://override.example/mcp', headers: { authorization: 'Bearer ${DSH_MCP_OVERRIDE_TEST_TOKEN}' } } })
      expect(result.mounts).toHaveLength(1)
      const config = result.mounts[0]!.config as McpServerStreamableHttp
      expect(config.url).toBe('https://override.example/mcp')
      // The secret never needs to persist: the override stores only the
      // reference, resolved in memory when the mount config is built.
      expect(config.headers?.authorization).toBe('Bearer secret-value')
    } finally {
      delete process.env.DSH_MCP_OVERRIDE_TEST_TOKEN
    }
  })
})

describe('Catalog.setMcpOverride', () => {
  async function installedCatalog(): Promise<Catalog> {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-mcpov-cat-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    const checkout = join(userRoot, '.sources', 'demo')
    await mkdir(checkout, { recursive: true })
    await cp(fixture, checkout, { recursive: true })
    await manager.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    await manager.install('demo', 'v1-suite')
    return manager
  }

  it('persists an override and reports it in suite detail', async () => {
    const manager = await installedCatalog()

    await manager.setMcpOverride('demo', 'v1-suite', Object.keys((await manager.suiteDetail('demo', 'v1-suite')).mcpServers)[0] ?? 'none', null).catch(() => {})
    const detailBefore = await manager.suiteDetail('demo', 'v1-suite')
    const serverKey = detailBefore.mcpServers[0]?.key
    if (serverKey === undefined) throw new Error('fixture has no MCP server')

    await manager.setMcpOverride('demo', 'v1-suite', serverKey, { url: 'http://127.0.0.1:9/mcp' })
    const after = await manager.suiteDetail('demo', 'v1-suite')
    expect(after.mcpOverrides?.[serverKey]).toEqual({ url: 'http://127.0.0.1:9/mcp' })

    // mcpOverrides query returns the same record.
    expect(await manager.mcpOverrides('v1-suite')).toEqual({ [serverKey]: { url: 'http://127.0.0.1:9/mcp' } })
  })

  it('clears an override with null and rejects unknown servers', async () => {
    const manager = await installedCatalog()
    const detail = await manager.suiteDetail('demo', 'v1-suite')
    const serverKey = detail.mcpServers[0]?.key
    if (serverKey === undefined) throw new Error('fixture has no MCP server')

    await manager.setMcpOverride('demo', 'v1-suite', serverKey, { enabled: false })
    await manager.setMcpOverride('demo', 'v1-suite', serverKey, null)
    expect(await manager.mcpOverrides('v1-suite')).toEqual({})

    await expect(manager.setMcpOverride('demo', 'v1-suite', 'nope', { enabled: false })).rejects.toThrow('is not defined by suite')
    await expect(manager.setMcpOverride('demo', 'ghost-suite', serverKey, null)).rejects.toThrow('not found in source')
  })
})
