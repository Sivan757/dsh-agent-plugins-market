import { describe, expect, it } from 'vitest'
import { buildMcpStatus, inspectToolRegistry } from '../src/runtime/mcp-status.js'
import type { Suite } from '../src/model/types.js'

function suite(overrides: Partial<Suite> = {}): Suite {
  return {
    sourceId: 'codex-plugin',
    id: 'codex',
    root: '/tmp/codex',
    manifest: { layout: 'codex', path: '/tmp/codex/.codex-plugin/plugin.json', id: 'codex', name: 'codex' },
    skills: [],
    mcp: {
      schema: 'native-client',
      servers: {
        app: { type: 'stdio', command: 'node', args: ['server.mjs', '--token', 'secret'], env: { API_TOKEN: 'secret' } },
        docs: { type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer secret' } }
      }
    },
    surfaces: { skills: 0, mcp: 2, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    installedAt: new Date().toISOString(),
    errors: [],
    ...overrides
  }
}

describe('MCP status aggregation', () => {
  it('reports plugin servers, redacts secrets, and observes direct servers', () => {
    const payload = buildMcpStatus(
      [suite()],
      [{ suiteId: 'codex-plugin/codex', serverKey: 'docs', reason: 'connection refused' }],
      [
        { name: 'mcp__codex-plugin_codex__app__read_file', description: 'Read a file' },
        { name: 'mcp__filesystem__read_file', description: 'Read a file' }
      ]
    )
    expect(payload.totals).toMatchObject({ all: 3, connected: 2, failed: 1 })
    const app = payload.entries.find(entry => entry.serverKey === 'app')!
    expect(app.state).toBe('connected')
    expect(app.tools.map(tool => tool.name)).toEqual(['read_file'])
    expect(app.config).toMatchObject({ env: { API_TOKEN: '[redacted]' } })
    expect(app.endpoint).not.toContain('secret')
    const docs = payload.entries.find(entry => entry.serverKey === 'docs')!
    expect(docs.state).toBe('failed')
    expect(docs.reason).toBe('connection refused')
    const direct = payload.entries.find(entry => entry.kind === 'direct')!
    expect(direct.name).toBe('filesystem')
    expect(direct.tools[0]?.name).toBe('read_file')
  })

  it('reads MCP tools from the optional tool-layer snapshot adapter', () => {
    const runtime = {
      layers: {
        merge: (_scope: undefined, pick: (layer: { tools: { entries: () => Array<[string, unknown]> } }) => unknown) =>
          pick({
            tools: {
              entries: () => [
                ['mcp__filesystem__read_file', { description: 'Read a file' }],
                ['bash', { description: 'Shell' }]
              ]
            }
          })
      }
    }
    expect(inspectToolRegistry(runtime)).toEqual([{ name: 'mcp__filesystem__read_file', description: 'Read a file' }])
  })

  it('omits MCP servers from uninstalled or disabled suites', () => {
    const disabled = suite({ enabled: false })
    const uninstalled = suite({ installedAt: undefined })
    expect(buildMcpStatus([disabled, uninstalled], [], []).entries).toEqual([])
  })

  it('reports enabled plugin servers with no observed tools as degraded', () => {
    const payload = buildMcpStatus([suite({ mcp: { schema: 'native-client', servers: { app: { type: 'stdio', command: 'node' } } } })], [], [])
    expect(payload.entries[0]?.state).toBe('degraded')
    expect(payload.entries[0]?.tools).toEqual([])
  })

  it('distinguishes a zero-tool server from a mount failure', () => {
    const healthy = buildMcpStatus([suite({ mcp: { schema: 'native-client', servers: { app: { type: 'stdio', command: 'node' } } } })], [], [])
    // No tool observed and no diagnostic: a legitimate zero-tool server is
    // reported as degraded but never retryable.
    expect(healthy.entries[0]?.state).toBe('degraded')
    expect(healthy.entries[0]?.advertisedTools).toBe(false)
    expect(healthy.entries[0]?.retryable).toBe(false)

    const broken = buildMcpStatus([suite()], [{ suiteId: 'codex-plugin/codex', serverKey: 'app', code: 'mount-failed', reason: 'mount failed: connection refused' }], [])
    const app = broken.entries.find(entry => entry.serverKey === 'app')!
    expect(app.state).toBe('failed')
    expect(app.reason).toBe('mount failed: connection refused')
    expect(app.retryable).toBe(true)
  })

  it('labels observed tools from a disabled or uninstalled suite as orphaned', () => {
    const payload = buildMcpStatus([suite({ enabled: false, installedAt: undefined })], [], [{ name: 'mcp__codex-plugin_codex__app__read_file', description: 'Read a file' }])
    const orphaned = payload.entries.find(entry => entry.name === 'codex-plugin_codex__app')!
    expect(orphaned.kind).toBe('plugin')
    expect(orphaned.state).toBe('orphaned')
    expect(orphaned.reason).toContain('disabled or uninstalled')
    expect(payload.totals.orphaned).toBe(1)
  })

  it('reports missing credential references without exposing values', () => {
    const payload = buildMcpStatus(
      [suite()],
      [{ suiteId: 'codex-plugin/codex', serverKey: 'app', code: 'missing-credential', credentialRefs: ['API_TOKEN'], reason: 'missing credential reference API_TOKEN' }],
      []
    )
    const app = payload.entries.find(entry => entry.serverKey === 'app')!
    expect(app.state).toBe('needs-credentials')
    expect(app.credentialRefs).toEqual(['API_TOKEN'])
    expect(app.config).toMatchObject({ env: { API_TOKEN: '[redacted]' } })
    expect(payload.totals.needsCredentials).toBe(1)
  })
})

describe('MCP status: cross-source suite collisions', () => {
  it('keeps two sources with the same suite id distinct in names, keys, and diagnostics', () => {
    // Regression: status keyed by the bare suite id, so a mounted
    // source-a/same row showed as degraded while source-b's server looked
    // like the only plugin row.
    const a = suite({ sourceId: 'source-a' })
    const b = suite({ sourceId: 'source-b' })
    const observed = [
      { name: 'mcp__source-a_codex__app__probe', description: 'probe' },
      { name: 'mcp__source-b_codex__app__probe', description: 'probe' }
    ]
    const payload = buildMcpStatus([a, b], [{ suiteId: 'source-a/codex', serverKey: 'app', reason: 'connection refused', code: 'mount-failed' }], observed)
    const pluginRows = payload.entries.filter(entry => entry.kind === 'plugin' && entry.serverKey === 'app')
    expect(pluginRows).toHaveLength(2)
    // Each row carries its own sourceId and a distinct derived name.
    expect(pluginRows.map(row => row.name).sort()).toEqual(['source-a_codex__app', 'source-b_codex__app'])
    // The diagnostic lands on source-a's row only.
    const rowA = pluginRows.find(row => row.suiteId === 'source-a/codex')!
    const rowB = pluginRows.find(row => row.suiteId === 'source-b/codex')!
    expect(rowA.state).toBe('failed')
    expect(rowA.reason).toBe('connection refused')
    expect(rowB.state).toBe('connected')
    // Both servers' observed tools are attributed to their own row.
    expect(rowA.tools.map(tool => tool.name)).toEqual(['probe'])
    expect(rowB.tools.map(tool => tool.name)).toEqual(['probe'])
  })
})
