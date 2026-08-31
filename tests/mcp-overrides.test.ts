import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { toMcpMounts } from '../src/runtime/mcp-config.js'
import { applyOverride, loadSuiteOverrides, mergeOverridePatch, sanitizeOverridePatch, sanitizeOverrides, saveSuiteOverrides } from '../src/runtime/mcp-overrides.js'
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

describe('sanitizeOverridePatch credential safety', () => {
  it('rejects literal sensitive values but accepts credential references', () => {
    expect(sanitizeOverridePatch({ headers: { Authorization: 'Bearer literal-secret' } })).toBeUndefined()
    expect(sanitizeOverridePatch({ headers: { Authorization: 'Bearer ${MCP_TOKEN}' } })).toEqual({ headers: { Authorization: 'Bearer ${MCP_TOKEN}' } })
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

  it('carries an auth block onto the streamable-http server', () => {
    const merged = applyOverride(httpServer, { auth: { enabled: true, scope: 'repo' } }) as McpServerStreamableHttp
    expect(merged.auth).toEqual({ enabled: true, scope: 'repo' })
  })

  it('lets an override disable a source-declared auth flow', () => {
    const source: McpServerStreamableHttp = { ...httpServer, auth: { enabled: true } }
    const merged = applyOverride(source, { auth: { enabled: false } }) as McpServerStreamableHttp
    expect(merged.auth).toEqual({ enabled: false })
  })
})

describe('toMcpMounts with overrides', () => {
  it('omits disabled servers entirely', async () => {
    const suite = httpSuite()
    const result = await toMcpMounts(suite, '/data', { docs: { enabled: false } })
    expect(result.mounts).toEqual([])
    expect(result.failures).toEqual([])
  })

  it('applies url/header overrides; ${ENV} refs resolve at mount time', async () => {
    const suite = httpSuite()
    process.env.DSH_MCP_OVERRIDE_TEST_TOKEN = 'secret-value'
    try {
      // Mirrors the host fallback resolver, which reads the ambient env when
      // the profile has no credentials service.
      const resolver = {
        resolve: async (ref: string) => {
          const value = process.env[ref]
          return value === undefined || value === '' ? undefined : { value, source: 'env' }
        }
      }
      const result = await toMcpMounts(
        suite,
        '/data',
        { docs: { url: 'https://override.example/mcp', headers: { authorization: 'Bearer ${DSH_MCP_OVERRIDE_TEST_TOKEN}' } } },
        resolver
      )
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

describe('sanitizeOverrides auth', () => {
  it('keeps a well-formed auth block and drops malformed ones', () => {
    expect(sanitizeOverrides({ docs: { auth: { enabled: true, scope: 'a' } } })).toEqual({ docs: { auth: { enabled: true, scope: 'a' } } })
    expect(sanitizeOverrides({ docs: { auth: { enabled: true } } })).toEqual({ docs: { auth: { enabled: true } } })
    expect(sanitizeOverrides({ docs: { auth: { scope: 'a' } } })).toEqual({})
    expect(sanitizeOverrides({ docs: { auth: 'yes' } })).toEqual({})
  })
})

describe('toMcpMounts with source-declared auth', () => {
  it('forwards auth into the dsh-mcp-client mount config', async () => {
    const suite = httpSuite()
    suite.mcp!.servers.docs = { ...httpServer, auth: { enabled: true, scope: 'user' } }
    const dataRoot = await mkdtemp(join(tmpdir(), 'mcp-auth-'))
    const { mounts } = await toMcpMounts(suite, dataRoot, new Map(), async () => ({ value: '', missing: [] }))
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.config).toMatchObject({ transport: 'streamable-http', auth: { enabled: true, scope: 'user' } })
  })

  it('forwards auth from a disk override through to the mount config', async () => {
    // Regression: redaction erased the whole `auth` object as secret-shaped,
    // so an override-enabled OAuth flow never reached the mount.
    const suite = httpSuite()
    const dataRoot = await mkdtemp(join(tmpdir(), 'mcp-auth-override-'))
    await saveSuiteOverrides(dataRoot, suite.id, { docs: { auth: { enabled: true } } })
    const overrides = await loadSuiteOverrides(dataRoot, suite.id)
    const { mounts } = await toMcpMounts(suite, dataRoot, overrides, async () => ({ value: '', missing: [] }))
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.config).toMatchObject({ auth: { enabled: true } })
  })
})

describe('mergeOverridePatch', () => {
  it('keeps stored sensitive values the client patch could not see', () => {
    const merged = mergeOverridePatch({ headers: { authorization: 'Bearer ${TOKEN}' } }, { url: 'https://override.example/mcp' })
    expect(merged).toMatchObject({ url: 'https://override.example/mcp', headers: { authorization: 'Bearer ${TOKEN}' } })
  })

  it('lets an explicit patch value replace a stored one', () => {
    const merged = mergeOverridePatch({ headers: { authorization: 'Bearer ${OLD}' } }, { headers: { authorization: 'Bearer ${NEW}' } })
    expect(merged.headers).toEqual({ authorization: 'Bearer ${NEW}' })
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
    expect(after.mcpOverrides?.[serverKey]).toEqual({ enabled: true, url: 'http://127.0.0.1:9/mcp' })

    // mcpOverrides query returns the same record.
    expect(await manager.mcpOverrides('v1-suite')).toEqual({ [serverKey]: { enabled: true, url: 'http://127.0.0.1:9/mcp' } })
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
