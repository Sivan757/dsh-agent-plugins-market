import { describe, expect, it } from 'vitest'
import { deriveServerName, toMcpMounts } from '../src/runtime/mcp-config.js'
import type { Suite } from '../src/model/types.js'

function suite(overrides: Partial<Suite> = {}): Suite {
  return {
    sourceId: 'demo',
    id: 'my-suite',
    root: '/tmp/my-suite',
    manifest: { layout: 'agent-plugin-v1', path: '/tmp/my-suite/plugin.json', id: 'my-suite', name: 'My Suite' },
    skills: [],
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    errors: [],
    mcp: {
      schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      servers: {
        db: { type: 'stdio', command: './bin/db', args: ['--root', '${PLUGIN_ROOT}'], env: { CACHE: '${PLUGIN_DATA}/cache' }, cwd: './data' },
        web: { type: 'streamable-http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${MCP_TOKEN}' } },
        legacy: { type: 'sse', url: 'https://example.com/sse' }
      }
    },
    ...overrides
  }
}

/** A resolver that satisfies every reference, for tests of the mapping itself. */
const alwaysResolves = { resolve: async () => ({ value: 'resolved' }) } as const

describe('mcp-config: suite mcp.json → bridge rows', () => {
  it('maps stdio, streamable-http, and legacy SSE servers', async () => {
    const { mounts, failures } = await toMcpMounts(suite(), '/tmp/data', {}, alwaysResolves)
    expect(mounts.map(mount => mount.config.serverName)).toEqual(['my-suite__db', 'my-suite__web', 'my-suite__legacy'])
    expect(failures).toEqual([])
    const db = mounts[0]!.config as Record<string, unknown>
    expect(db['transport']).toBe('stdio')
    expect(db['command']).toBe('/tmp/my-suite/bin/db')
    expect(db['args']).toEqual(['--root', '/tmp/my-suite'])
    expect(db['env']).toEqual({ CACHE: '/tmp/data/my-suite/cache' })
    expect(db['cwd']).toBe('/tmp/my-suite/data')
    const web = mounts[1]!.config as Record<string, unknown>
    expect(web['transport']).toBe('streamable-http')
    expect(web['headers']).toEqual({ Authorization: 'Bearer resolved' })
    const legacy = mounts[2]!.config as Record<string, unknown>
    expect(legacy['transport']).toBe('sse')
    expect(legacy['url']).toBe('https://example.com/sse')
  })
})

describe('mcp-config: credential references', () => {
  it('resolves env and header placeholders through the credential resolver', async () => {
    const result = await toMcpMounts(
      suite(),
      '/tmp/data',
      {},
      {
        resolve: async ref => (ref === 'MCP_TOKEN' ? { value: 'resolved-secret', source: 'file' } : undefined)
      }
    )
    const web = result.mounts.find(mount => mount.serverKey === 'web')!.config as Record<string, unknown>
    expect((web['headers'] as Record<string, string>)['Authorization']).toBe('Bearer resolved-secret')
    expect(result.failures).toEqual([])
  })

  it('reports missing credential references before a mount can start', async () => {
    const result = await toMcpMounts(suite(), '/tmp/data', {}, { resolve: async () => undefined })
    expect(result.mounts.some(mount => mount.serverKey === 'web')).toBe(false)
    expect(result.failures).toContainEqual({
      serverKey: 'web',
      code: 'missing-credential',
      credentialRefs: ['MCP_TOKEN'],
      reason: 'missing credential reference MCP_TOKEN'
    })
  })

  it('resolves credential placeholders inside a streamable-http url', async () => {
    const target = suite()
    target.mcp!.servers.web = { type: 'streamable-http', url: 'https://example.com/mcp?key=${MCP_TOKEN}' }
    const result = await toMcpMounts(target, '/tmp/data', {}, { resolve: async ref => (ref === 'MCP_TOKEN' ? { value: 'abc123' } : undefined) })
    const web = result.mounts.find(mount => mount.serverKey === 'web')!.config as Record<string, unknown>
    expect(web['url']).toBe('https://example.com/mcp?key=abc123')
  })

  it('honors an explicit non-empty fallback but still fails closed on an empty one', async () => {
    const target = suite()
    // Isolate to the stdio server: the shared fixture's http server carries an
    // unsatisfied ${MCP_TOKEN}, which is meant to fail closed here.
    target.mcp!.servers = {
      db: { type: 'stdio', command: 'db', args: ['--root', '${MISSING:-/default}'] }
    }
    const resolved = await toMcpMounts(target, '/tmp/data', {}, { resolve: async () => undefined })
    const db = resolved.mounts.find(mount => mount.serverKey === 'db')!.config as Record<string, unknown>
    expect(db['args']).toEqual(['--root', '/default'])
    expect(resolved.failures).toEqual([])

    // `${REF:-}` supplies an empty fallback, so an unresolved value stays empty
    // and is reported missing rather than silently passing an empty flag.
    target.mcp!.servers = { db: { type: 'stdio', command: 'db', args: ['--tag', '${ALSO_MISSING:-}'] } }
    const emptyFallback = await toMcpMounts(target, '/tmp/data', {}, { resolve: async () => undefined })
    expect(emptyFallback.mounts).toEqual([])
    expect(emptyFallback.failures).toContainEqual({
      serverKey: 'db',
      code: 'missing-credential',
      credentialRefs: ['ALSO_MISSING'],
      reason: 'missing credential reference ALSO_MISSING'
    })
  })

  it('fails closed when a reference has neither a value nor a fallback', async () => {
    const target = suite()
    target.mcp!.servers = { db: { type: 'stdio', command: 'db', args: ['--root', '${NOPE}'] } }
    const result = await toMcpMounts(target, '/tmp/data', {}, { resolve: async () => undefined })
    expect(result.mounts).toEqual([])
    expect(result.failures).toEqual([{ serverKey: 'db', code: 'missing-credential', credentialRefs: ['NOPE'], reason: 'missing credential reference NOPE' }])
  })

  it('deduplicates repeated references so one credential is fetched once', async () => {
    const target = suite()
    target.mcp!.servers = { db: { type: 'stdio', command: 'db', args: ['${T}', '${T}'] } }
    let lookups = 0
    const result = await toMcpMounts(
      target,
      '/tmp/data',
      {},
      {
        resolve: async ref => {
          if (ref !== 'T') return undefined
          lookups++
          return { value: 'v' }
        }
      }
    )
    const db = result.mounts[0]!.config as Record<string, unknown>
    expect(db['args']).toEqual(['v', 'v'])
    expect(lookups).toBe(1)
  })
})

describe('mcp-config: serverName derivation', () => {
  it('joins sanitized ids with __', () => {
    expect(deriveServerName('my-suite', 'db')).toBe('my-suite__db')
    expect(deriveServerName('My Suite!', 'DB 1')).toBe('My_Suite__DB_1')
  })

  it('truncates over-budget names with a deterministic hash suffix', () => {
    const long = deriveServerName('a'.repeat(40), 'b'.repeat(40))
    expect(long.length).toBe(32)
    expect(long.endsWith('-')).toBe(false)
    expect(deriveServerName('a'.repeat(40), 'b'.repeat(40))).toBe(long)
  })
})
