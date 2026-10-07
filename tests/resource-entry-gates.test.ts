/**
 * The per-workspace entry filters keep the six surfaces orthogonal, the same
 * property the surface switches carry: denying one MCP server reconciles only
 * that server away while the same suite keeps its language server, and denying
 * a market row (the whole suite, in this workspace) removes every mount it
 * contributed.
 *
 * Each case drives the real reconciler and asserts on the resulting mount
 * state, not on the arguments the branches happened to receive.
 */
import { describe, expect, it } from 'vitest'
import { RuntimeReconciler } from '../packages/market-runtime/src/runtime/core/reconciler.js'
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
  live(): string[]
  released(): string[]
}

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

describe('per-entry filters keep the surfaces orthogonal', () => {
  it('mounts everything when no filter denies an entry', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/entry-gates', createRuntimeMounts(recording.ctx as never, '/tmp/entry-gates'))
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript', 'mcp:alpha__db'])
    await reconciler.dispose()
  })

  it('denying one MCP server unmounts only that server', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/entry-gates', createRuntimeMounts(recording.ctx as never, '/tmp/entry-gates'))
    reconciler.setMcpEntryFilter(() => ({ allows: (face, entryId) => !(face === 'mcp' && entryId === 'mcp:alpha__db') }))
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript'])
    await reconciler.dispose()
  })

  it('denying one LSP server keeps the same suite MCP server mounted', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/entry-gates', createRuntimeMounts(recording.ctx as never, '/tmp/entry-gates'))
    reconciler.lsp.setEntryFilter(() => ({ allows: (face, entryId) => !(face === 'lsp' && entryId === 'lsp:demo/alpha/typescript') }))
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['mcp:alpha__db'])
    await reconciler.dispose()
  })

  it('a deny landing later releases the live mount through the ordinary reconcile', async () => {
    const recording = recordingCtx()
    const reconciler = new RuntimeReconciler(recording.ctx as never, '/tmp/entry-gates', createRuntimeMounts(recording.ctx as never, '/tmp/entry-gates'))
    let denyDb = false
    reconciler.setMcpEntryFilter(() => ({ allows: (face, entryId) => !(face === 'mcp' && entryId === 'mcp:alpha__db' && denyDb) }))
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript', 'mcp:alpha__db'])
    denyDb = true
    await reconciler.reconcile([dualSuite('alpha')])
    expect(recording.live()).toEqual(['lsp:demo/alpha/typescript'])
    expect(recording.released()).toEqual(['mcp:alpha__db'])
    await reconciler.dispose()
  })
})
