import { describe, expect, it } from 'vitest'
import { buildMcpStatus } from '../src/application/mcp/mcp-status.js'
import { inspectToolRegistry } from '../src/runtime/host/tool-registry-observer.js'
import { effectiveSurfaces, type Suite } from '../src/model/types.js'

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
    activeSurfaces: effectiveSurfaces(undefined),
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
        { name: 'mcp__codex__app__read_file', description: 'Read a file' },
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

  it('flags the remote servers that authorize without declaring it', () => {
    // The redacted configuration shows only what the suite declared, so a
    // remote server whose suite omits `auth` still reads as auth-free while the
    // bridge starts OAuth on the server's 401 challenge.
    const payload = buildMcpStatus([suite()], [], [])
    expect(payload.entries.find(entry => entry.serverKey === 'docs')?.oauthDefault).toBe(true)
    expect(payload.entries.find(entry => entry.serverKey === 'app')?.oauthDefault).toBeUndefined()
    const declared = buildMcpStatus(
      [suite({ mcp: { schema: 'native-client', servers: { docs: { type: 'streamable-http', url: 'https://example.test/mcp', auth: { enabled: true } } } } })],
      [],
      []
    )
    expect(declared.entries[0]?.oauthDefault).toBeUndefined()
  })

  it('reads MCP tools through the tools service listing API, carrying their input schema', () => {
    const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    const runtime = {
      schemas: () => [
        { name: 'mcp__codex__docs__read_file', description: 'Read a file', parameters: schema },
        { name: 'bash', description: 'Shell' }
      ]
    }
    expect(inspectToolRegistry(runtime)).toEqual([{ name: 'mcp__codex__docs__read_file', description: 'Read a file', parameters: schema }])
  })

  it('carries a tool schema into the status entry and drops one too large to transport', () => {
    const schema = { type: 'object', properties: { path: { type: 'string' } } }
    const huge = { type: 'object', properties: { blob: { type: 'string', description: 'x'.repeat(21_000) } } }
    const entry = buildMcpStatus(
      [suite()],
      [],
      [
        { name: 'mcp__codex__docs__read_file', description: 'Read a file', parameters: schema },
        { name: 'mcp__codex__docs__write_file', description: 'Write a file', parameters: huge }
      ]
    ).entries.find(candidate => candidate.serverKey === 'docs')
    if (entry === undefined) throw new Error('expected the docs server row')
    expect(entry.tools).toEqual([
      { name: 'read_file', description: 'Read a file', parameters: schema },
      { name: 'write_file', description: 'Write a file' }
    ])
  })

  it('reports no MCP tools when the listing is absent or fails', () => {
    expect(inspectToolRegistry(undefined)).toEqual([])
    expect(inspectToolRegistry({})).toEqual([])
    expect(
      inspectToolRegistry({
        schemas: () => {
          throw new Error('unavailable')
        }
      })
    ).toEqual([])
  })

  it('omits MCP servers from uninstalled or disabled suites', () => {
    const disabled = suite({ enabled: false })
    const uninstalled = suite({ installedAt: undefined })
    expect(buildMcpStatus([disabled, uninstalled], [], []).entries).toEqual([])
  })

  it('distinguishes a zero-tool server from a mount failure', () => {
    const healthy = buildMcpStatus([suite({ mcp: { schema: 'native-client', servers: { app: { type: 'stdio', command: 'node' } } } })], [], [])
    // No tool observed and no diagnostic: a legitimate zero-tool server is
    // reported as degraded but never retryable.
    expect(healthy.entries[0]?.state).toBe('degraded')
    expect(healthy.entries[0]?.tools).toEqual([])
    expect(healthy.entries[0]?.advertisedTools).toBe(false)
    expect(healthy.entries[0]?.retryable).toBe(false)

    const broken = buildMcpStatus([suite()], [{ suiteId: 'codex-plugin/codex', serverKey: 'app', code: 'mount-failed', reason: 'mount failed: connection refused' }], [])
    const app = broken.entries.find(entry => entry.serverKey === 'app')!
    expect(app.state).toBe('failed')
    expect(app.reason).toBe('mount failed: connection refused')
    expect(app.retryable).toBe(true)
  })

  it('labels observed tools from a disabled or uninstalled suite as orphaned', () => {
    const payload = buildMcpStatus([suite({ enabled: false, installedAt: undefined })], [], [{ name: 'mcp__codex__app__read_file', description: 'Read a file' }])
    const orphaned = payload.entries.find(entry => entry.name === 'codex__app')!
    expect(orphaned.kind).toBe('plugin')
    expect(orphaned.state).toBe('orphaned')
    expect(orphaned.reason).toContain('disabled or uninstalled')
    // The panel localizes each of these notes by its code.
    expect(orphaned.code).toBe('orphaned-tools')
    expect(payload.totals.orphaned).toBe(1)
  })

  it('keeps an override-disabled server on the inventory as disabled', () => {
    // The panel shows what a suite ships next to how the user changed it, so
    // the declaration survives an override that turns the mount off.
    const overrides = new Map([['codex-plugin/codex', { app: { enabled: false } }]])
    const payload = buildMcpStatus([suite()], [], [], overrides)
    const app = payload.entries.find(entry => entry.serverKey === 'app')!
    expect(app.state).toBe('disabled')
    expect(app.reason).toBe('disabled by override')
    expect(app.code).toBe('disabled-override')
    // The server beside it is untouched: one override must not hide the other.
    const docs = payload.entries.find(entry => entry.serverKey === 'docs')!
    expect(docs.state).toBe('degraded')
    expect(payload.totals).toMatchObject({ all: 2, disabled: 1 })
  })

  it('reports the suite and user tool lists behind the checkbox states', () => {
    // A denied tool leaves the live registry, so the stored lists are what let
    // the panel keep it on screen and switchable.
    const declared = suite({
      manifest: {
        layout: 'agent-plugin-v1',
        path: '/tmp/codex/plugin.json',
        id: 'codex',
        name: 'codex',
        harness: { schemaVersion: '1.0.0', mcpServers: { app: { enabledTools: ['alpha', 'beta'], disabledTools: ['gamma'] } } }
      }
    })
    const overrides = new Map([['codex-plugin/codex', { app: { disabledTools: ['delta'] } }]])
    const payload = buildMcpStatus([declared], [], [], overrides)
    const app = payload.entries.find(entry => entry.serverKey === 'app')!
    expect(app.suiteEnabledTools).toEqual(['alpha', 'beta'])
    expect(app.suiteDisabledTools).toEqual(['gamma'])
    expect(app.userDisabledTools).toEqual(['delta'])
    // The effective configuration unions the two deny lists for the mount.
    expect(app.config).toMatchObject({ enabledTools: ['alpha', 'beta'], disabledTools: ['gamma', 'delta'] })
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
    // Same suite/server pair across sources derives ONE serverName by
    // design, so the single live namespace serves both rows.
    const observed = [{ name: 'mcp__codex__app__probe', description: 'probe' }]
    const payload = buildMcpStatus(
      [a, b],
      [
        { suiteId: 'source-a/codex', serverKey: 'app', reason: 'connection refused', code: 'mount-failed' },
        {
          suiteId: 'source-b/codex',
          serverKey: 'app',
          reason: 'server "codex__app" is already mounted from source-a/codex — this suite\'s copy is redundant and was skipped',
          code: 'duplicate-mount'
        }
      ],
      observed
    )
    const pluginRows = payload.entries.filter(entry => entry.kind === 'plugin' && entry.serverKey === 'app')
    expect(pluginRows).toHaveLength(2)
    // Both rows share the one derived name; identity stays in sourceId/suiteId.
    expect(pluginRows.map(row => row.name).sort()).toEqual(['codex__app', 'codex__app'])
    // The diagnostic lands on source-a's row only.
    const rowA = pluginRows.find(row => row.suiteId === 'source-a/codex')!
    const rowB = pluginRows.find(row => row.suiteId === 'source-b/codex')!
    expect(rowA.state).toBe('failed')
    expect(rowA.reason).toBe('connection refused')
    // source-b's copy is skipped as a duplicate: informational foreign state.
    expect(rowB.state).toBe('foreign')
    // The one live namespace's tools appear on the connected row.
    expect(rowA.tools.map(tool => tool.name)).toEqual(['probe'])
    expect(rowB.tools.map(tool => tool.name)).toEqual(['probe'])
  })
})
