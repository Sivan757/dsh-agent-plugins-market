/**
 * Tests for the MCP backend switch: persistence under the data root, the
 * mount registry's dispatch between the built-in bridge and the host
 * `dsh-mcp-client`, and the per-server diagnostics when the host backend is
 * selected but unusable (package missing, legacy SSE transport).
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { marketSettingsPath, MCP_SETTINGS_NAMESPACE, MarketSettingsSchema, probeHostMcpClient, readMcpBackend } from '../src/runtime/mcp-backend.js'
import { McpMountRegistry } from '../src/runtime/mcp-mounts.js'
import type { Suite } from '../src/model/types.js'

// The hoisted switch lets one mock serve both the available and the missing
// host-client scenarios.
const hostClientState = vi.hoisted(() => ({ mode: 'available' as 'available' | 'missing' }))

vi.mock('@deepseek-ai/dsh-mcp-client', () => {
  if (hostClientState.mode === 'missing') throw new Error('Cannot find package')
  return {
    name: 'mcp-client',
    inject: ['tools'],
    Config: {},
    apply: async () => {}
  }
})

function suite(id: string, serverKey: string, transport: 'stdio' | 'sse' = 'stdio'): Suite {
  return {
    sourceId: 'demo',
    id,
    root: `/tmp/${id}`,
    manifest: { layout: 'agent-plugin-v1', path: `/tmp/${id}/plugin.json`, id, name: id },
    skills: [],
    mcp: {
      schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      servers: { [serverKey]: transport === 'stdio' ? { type: 'stdio', command: 'tool' } : { type: 'sse', url: 'https://example.com/sse' } }
    },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    errors: []
  }
}

function fakeContext(): { ctx: Record<string, unknown>; mounted: Array<{ module: unknown; config: Record<string, unknown> }> } {
  const mounted: Array<{ module: unknown; config: Record<string, unknown> }> = []
  const ctx: Record<string, unknown> = {
    plugin: (module: unknown, config: Record<string, unknown>) => {
      mounted.push({ module, config })
      return { await: async () => {}, dispose: async () => {} }
    },
    logger: { warn: () => {} }
  }
  return { ctx, mounted }
}

describe('MCP backend persistence', () => {
  it('reads the legacy settings.json choice and defaults to builtin', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'mcp-backend-'))
    try {
      // No settings file: the default.
      expect(await readMcpBackend(dataRoot)).toBe('builtin')
      // The one-time migration source: a legacy host choice reads back.
      await writeFile(marketSettingsPath(dataRoot), JSON.stringify({ mcpBackend: 'host' }), 'utf8')
      expect(await readMcpBackend(dataRoot)).toBe('host')
      // An invalid persisted value reads as the default, never throws.
      await writeFile(marketSettingsPath(dataRoot), JSON.stringify({ mcpBackend: 'bogus' }), 'utf8')
      expect(await readMcpBackend(dataRoot)).toBe('builtin')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  it('exposes the settings namespace and schema the plugin-config tab pairs by', async () => {
    expect(MCP_SETTINGS_NAMESPACE).toBe('dsh-agent-plugins-market')
    // The schemastery schema resolves a missing section to both defaults.
    const resolved = MarketSettingsSchema(undefined) as { mcpEnhanced?: boolean; downloadRegion?: string }
    expect(resolved.mcpEnhanced).toBe(true)
    expect(resolved.downloadRegion).toBe('auto')
    const off = MarketSettingsSchema({ mcpEnhanced: false, downloadRegion: 'china' }) as { mcpEnhanced?: boolean; downloadRegion?: string }
    expect(off.mcpEnhanced).toBe(false)
    expect(off.downloadRegion).toBe('china')
  })

  it('probes the host client with a boolean availability and optional version', async () => {
    const probe = await probeHostMcpClient()
    expect(typeof probe.available).toBe('boolean')
    if (probe.available) expect(probe.version).toMatch(/\d/)
  })
})

describe('MCP backend dispatch at mount time', () => {
  it('mounts through the built-in bridge by default', async () => {
    vi.resetModules()
    hostClientState.mode = 'available'
    const { ctx, mounted } = fakeContext()
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    await registry.reconcile([suite('alpha', 'db')])
    expect(mounted).toHaveLength(1)
    // The bridge module's plugin name marks the built-in backend.
    expect((mounted[0]!.module as { name?: string }).name).toBe('market-mcp-client')
    expect(mounted[0]!.config['transport']).toBe('stdio')
    await registry.disposeAll()
  })

  it('mounts through the host client in compat mode', async () => {
    vi.resetModules()
    hostClientState.mode = 'available'
    const { ctx, mounted } = fakeContext()
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    registry.setBackendProvider(async () => 'host')
    await registry.reconcile([suite('alpha', 'db')])
    expect(mounted).toHaveLength(1)
    expect((mounted[0]!.module as { name?: string }).name).toBe('mcp-client')
    await registry.disposeAll()
  })

  it('reports a per-server diagnostic when the host client cannot resolve', async () => {
    // Re-register the mock as a throwing factory for imports made after this
    // point, then restore the hoisted available-mode factory afterwards.
    vi.resetModules()
    vi.doMock('@deepseek-ai/dsh-mcp-client', () => {
      throw new Error('Cannot find package')
    })
    hostClientState.mode = 'missing'
    const { ctx, mounted } = fakeContext()
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    registry.setBackendProvider(async () => 'host')
    const diagnostics = await registry.reconcile([suite('alpha', 'db')])
    expect(mounted).toHaveLength(0)
    expect(diagnostics).toContainEqual({
      suiteId: 'alpha',
      serverKey: 'db',
      code: 'mount-failed',
      reason: expect.stringContaining('not installed in this profile')
    })
    vi.doUnmock('@deepseek-ai/dsh-mcp-client')
    vi.resetModules()
  })

  it('refuses legacy SSE servers in host mode with a pointing diagnostic', async () => {
    vi.resetModules()
    hostClientState.mode = 'available'
    const { ctx, mounted } = fakeContext()
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    registry.setBackendProvider(async () => 'host')
    const diagnostics = await registry.reconcile([suite('alpha', 'web', 'sse')])
    expect(mounted).toHaveLength(0)
    expect(diagnostics).toContainEqual({
      suiteId: 'alpha',
      serverKey: 'web',
      code: 'mount-failed',
      reason: expect.stringContaining('does not support the legacy SSE transport')
    })
  })
})
