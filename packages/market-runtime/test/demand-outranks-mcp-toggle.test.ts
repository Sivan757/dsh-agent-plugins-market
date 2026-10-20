/**
 * A session's preset selection outranks the MCP panel's per-server switch.
 *
 * The shared reconciler merges session demand into the mount overrides and
 * forces `enabled: true` for every demanded server
 * (`reconciler.ts`, the override provider installed in the constructor), and
 * the LSP mount takes the same rule (`lsp-mounts.ts`: a disabled provider
 * still mounts while a session demands it). This test pins that deliberate
 * ordering so a later change cannot "fix" the red orphaned status by silently
 * unmounting a demanded server.
 *
 * Because the mount outlives `enabled: false`, the MCP status builder — which
 * reads the stored override only — computes `disabled && tools.length > 0` and
 * reports `orphaned` / `orphaned-tools` ("MCP tools remain after this plugin
 * surface was disabled"). Execution is still denied by the tool gate, so the
 * defect is the reported state, not an escaped call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeReconciler } from '../../../packages/market-runtime/src/runtime/core/reconciler.js'
import { McpMountRegistry } from '../../../packages/market-mcp/src/runtime/mcp/mcp-mounts.js'
import { LspMountRegistry } from '../../../packages/market-lsp/src/runtime/lsp/lsp-mounts.js'
import { CommandMountRegistry } from '../../../packages/market-runtime/src/runtime/surfaces/commands-mounts.js'
import { HooksMountRegistry } from '../../../packages/market-runtime/src/runtime/surfaces/hooks-mounts.js'
import { toMcpMounts } from '../../../packages/market-mcp/src/application/mcp/mcp-config.js'
import { effectiveSurfaces, type Suite } from '../../../packages/market-contracts/src/model/types.js'
import type { McpSuiteOverrides } from '../../../packages/market-mcp/src/application/mcp/mcp-overrides.js'
import { createRuntimeMounts } from '../../../packages/market-bundle/src/runtime-adapters.js'

afterEach(() => vi.restoreAllMocks())

const USER_MCP_KEY = '@user-mcp/user-mcp'

/** The user's own `~/.agents/mcp.json` suite, as the status surface sees it. */
function userMcpSuite(): Suite {
  return {
    sourceId: '@user-mcp',
    id: 'user-mcp',
    root: '/suite',
    dimension: 'user',
    enabled: false,
    activeSurfaces: effectiveSurfaces(undefined),
    manifest: { id: 'user-mcp', name: 'User MCP', layout: 'agent-plugin-v1', path: '/suite/plugin.json' },
    skills: [],
    resources: { commands: [], agents: [] },
    errors: [],
    surfaces: { skills: 0, commands: 0, agents: 0, hooks: 0, mcp: 1, lsp: 0 },
    mcp: { schema: 'test', servers: { kuboard: { type: 'streamable-http', url: 'https://example.test/mcp' } } }
  }
}

function setup() {
  let overrides: () => Promise<Map<string, McpSuiteOverrides>> = async () => new Map()
  let mounted: Suite[] = []
  vi.spyOn(McpMountRegistry.prototype, 'reconcile').mockImplementation(async rows => {
    mounted = structuredClone(rows)
    // Read the provider here: this is where a real mount pass resolves its overrides.
    await overrides()
    return []
  })
  vi.spyOn(McpMountRegistry.prototype, 'setOverridesProvider').mockImplementation(provider => {
    overrides = provider
  })
  vi.spyOn(McpMountRegistry.prototype, 'serverOwner').mockImplementation(name => {
    for (const row of mounted) for (const key of Object.keys(row.mcp?.servers ?? {})) if (key === name) return { suiteId: row.sourceId + '/' + row.id, serverKey: key }
    return undefined
  })
  vi.spyOn(McpMountRegistry.prototype, 'disposeAll').mockResolvedValue()
  vi.spyOn(LspMountRegistry.prototype, 'reconcile').mockResolvedValue([])
  vi.spyOn(LspMountRegistry.prototype, 'disposeAll').mockResolvedValue()
  vi.spyOn(CommandMountRegistry.prototype, 'reconcile').mockResolvedValue([])
  vi.spyOn(CommandMountRegistry.prototype, 'disposeAll').mockImplementation(() => {})
  vi.spyOn(HooksMountRegistry.prototype, 'reconcile').mockResolvedValue([])
  vi.spyOn(HooksMountRegistry.prototype, 'disposeAll').mockResolvedValue()
  const reconciler = new RuntimeReconciler({ logger: { warn: () => {} } } as never, '/data', createRuntimeMounts({ logger: { warn: () => {} } } as never, '/data'))
  // The panel switch, as set-mcp-server-enabled persists it.
  reconciler.setMcpOverridesProvider(async () => new Map([[USER_MCP_KEY, { kuboard: { enabled: false } }]]))
  return { reconciler, overrides: () => overrides() }
}
const candidates = (row: Suite) => [{ suite: row, validSurfaces: effectiveSurfaces(undefined) }]

describe('session demand versus the MCP panel switch', () => {
  it('keeps a demanded server mounted while its stored override says enabled: false', async () => {
    const f = setup()
    const row = userMcpSuite()
    await f.reconciler.refreshCatalog(candidates(row), [row])
    const receipt = await f.reconciler.stageSessionDemand({}, [row])
    receipt.commit()
    await f.reconciler.reconcile([])

    const merged = (await f.overrides()).get(USER_MCP_KEY)
    expect(merged!['kuboard']!.enabled).toBe(true)
    // The mounted request is what the status surface then reports tools for.
    expect((await toMcpMounts(row, '/data', merged)).mounts.map(mount => mount.serverKey)).toEqual(['kuboard'])
    await f.reconciler.dispose()
  })

  it('mounts nothing for the same override when no session demands the server', async () => {
    const f = setup()
    const row = userMcpSuite()
    await f.reconciler.refreshCatalog(candidates(row), [row])
    await f.reconciler.reconcile([])

    const merged = (await f.overrides()).get(USER_MCP_KEY)
    expect(merged!['kuboard']!.enabled).toBe(false)
    expect((await toMcpMounts(row, '/data', merged)).mounts).toEqual([])
    // Nothing is demanded, so the status surface has nothing to name and keeps
    // reporting a leftover-tools orphan for a server that really did stay live.
    expect(f.reconciler.demandedMcpMounts()).toEqual([])
    await f.reconciler.dispose()
  })

  it('publishes the demanded pairs the status surface reads, in suite-then-server order', async () => {
    // buildMcpStatus needs this list to tell "the preset keeps it mounted" from
    // "a teardown left registrations behind". It must read the state the mount
    // pass used, so it is taken from the same reconcile pass, and it must be
    // gone once the demand is released.
    const f = setup()
    const row = userMcpSuite()
    await f.reconciler.refreshCatalog(candidates(row), [row])
    const owner = {}
    const receipt = await f.reconciler.stageSessionDemand(owner, [row])
    receipt.commit()
    await f.reconciler.reconcile([])
    expect(f.reconciler.demandedMcpMounts()).toEqual([{ suiteId: USER_MCP_KEY, serverKey: 'kuboard' }])

    await f.reconciler.releaseSessionDemand(owner)
    expect(f.reconciler.demandedMcpMounts()).toEqual([])
    await f.reconciler.dispose()
  })
})
