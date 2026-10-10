/**
 * The six per-workspace switches are orthogonal.
 *
 * The reconciler fans one suite snapshot out to the MCP and LSP mount
 * branches, so the switch for one surface must be answered inside its own
 * branch. Filtering the shared snapshot instead — which is what an earlier
 * shape did — made the two interfere: turning MCP off unmounted the same
 * suites' language servers, and turning LSP off left suite LSP mounts live.
 *
 * Each case drives the real reconciler and asserts on the resulting mount
 * state — what is live and what was released — rather than on the arguments
 * the branches happened to receive.
 */
import { describe, expect, it } from 'vitest'
import { RuntimeReconciler } from '../packages/market-runtime/src/runtime/core/reconciler.js'
import type { RuntimeSurfaceGates } from '../packages/market-runtime/src/runtime/core/reconciler.js'
import { effectiveSurfaces, type Suite } from '../packages/market-contracts/src/model/types.js'
import { createRuntimeMounts } from '../packages/market-bundle/src/runtime-adapters.js'

/** A suite declaring one MCP server and one LSP server. */
function dualSuite(id: string): Suite {
  return {
    sourceId: 'demo',
    id,
    root: `/tmp/${id}`,
    manifest: { layout: 'agent-plugin-v1', path: `/tmp/${id}/plugin.json`, id, name: id },
    skills: [],
    mcp: { schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', servers: { db: { type: 'stdio', command: 'tool' } } },
    lsp: {
      servers: {
        typescript: { key: 'typescript', command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } }
      }
    },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 1 },
    dimension: 'user',
    enabled: true,
    activeSurfaces: effectiveSurfaces(undefined),
    errors: []
  }
}

interface Recording {
  ctx: Record<string, unknown>
  /** Mount keys currently live, sorted; the two branches run concurrently. */
  live(): string[]
  /** Every mount key released so far. */
  released(): string[]
}

/**
 * A ctx recording every plugin mount and release, shared by both registries.
 * MCP mounts carry a `serverName`; LSP provider mounts carry `servers`. The
 * capability seam LSP mounts alongside them carries neither, so it never counts
 * as a mounted server.
 */
function recordingCtx(): Recording {
  const live = new Set<string>()
  const released: string[] = []
  const ctx: Record<string, unknown> = {
    logger: { warn: () => {} },
    get: () => undefined,
    plugin: (plugin: unknown, config: Record<string, unknown>) => {
      const serverName = config['serverName']
      const servers = config['servers']
      const key = typeof serverName === 'string' ? `mcp:${serverName}` : typeof servers === 'object' && servers !== null ? `lsp:${Object.keys(servers).join(',')}` : undefined
      if (key !== undefined) live.add(key)
      return {
        await: async () => {},
        dispose: async () => {
          if (key !== undefined) {
            live.delete(key)
            released.push(key)
          }
        }
      }
    }
  }
  return { ctx, live: () => [...live].sort(), released: () => released }
}

function gates(overrides: Partial<Record<'commands' | 'mcp' | 'lsp', boolean>> = {}): RuntimeSurfaceGates {
  return { allows: surface => overrides[surface] ?? true }
}

describe('per-surface gates keep MCP and LSP orthogonal', () => {
  it('mounts both surfaces when every switch is on', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/gates-data', createRuntimeMounts(recording.ctx as never, '/tmp/gates-data'))
    reconciler.setSurfaceGates(gates())
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript', 'mcp:alpha__db'])
    await reconciler.dispose()
  })

  it('zeroes the MCP mounts while the same suites keep their language servers', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/gates-data', createRuntimeMounts(recording.ctx as never, '/tmp/gates-data'))
    reconciler.setSurfaceGates(gates({ mcp: false }))
    await reconciler.reconcile([dualSuite('alpha')])
    // The suite list is unchanged; only the MCP branch reconciled to nothing.
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript'])
    await reconciler.dispose()
  })

  it('zeroes the suite LSP mounts while MCP keeps mounting', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/gates-data', createRuntimeMounts(recording.ctx as never, '/tmp/gates-data'))
    reconciler.setSurfaceGates(gates({ lsp: false }))
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['mcp:alpha__db'])
    await reconciler.dispose()
  })

  it('releases the switched-off surface on a flip while the sibling stays live', async () => {
    const recording = recordingCtx()
    let mcpOn = true
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/gates-data', createRuntimeMounts(recording.ctx as never, '/tmp/gates-data'))
    reconciler.setSurfaceGates({ allows: surface => (surface === 'mcp' ? mcpOn : true) })
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript', 'mcp:alpha__db'])

    // The gate is read per pass, so the flip takes effect through the ordinary
    // reconcile path: MCP unmounts to empty and LSP is never touched.
    mcpOn = false
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript'])
    expect(recording.released()).toEqual(['mcp:alpha__db'])
    await reconciler.dispose()
  })

  it('mounts every surface when no gates were installed', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/gates-data', createRuntimeMounts(recording.ctx as never, '/tmp/gates-data'))
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript', 'mcp:alpha__db'])
    await reconciler.dispose()
  })
})
