/**
 * One session's apply must not change what another session may mount.
 *
 * The reported symptom is a session losing a tool after a preset switch
 * elsewhere. The preset apply publishes the declaration read it just made; when
 * that read is partial, publishing it as process-wide authority unmounts every
 * other session's servers. These cases drive the real reconciler and the real
 * MCP mount registry against a loopback MCP server, so a lost mount is a lost
 * server rather than a missing row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RuntimeReconciler } from '../../../../packages/market-runtime/src/runtime/core/reconciler.js'
import { createRuntimeMounts } from '../../../../packages/market-bundle/src/runtime-adapters.js'
import { effectiveSurfaces, type Suite } from '../../../../packages/market-contracts/src/model/types.js'
import type { ExtensionSuiteCandidate } from '../../../../packages/market-runtime/src/index.js'
import { readExtensionSuiteDeclarations } from '../../../../packages/market-runtime/src/index.js'
import { startFakeStreamableMcpServer, type FakeStreamableMcpServer } from './helpers/fake-streamable-mcp.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import { ExtensionRuntime } from '../../../../packages/market-runtime/src/runtime/host/extension-runtime.js'

class Query extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
class Adapter extends LlmAdapter {
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTempRoot } from './helpers/temp-root.js'

/** The servers a case starts, closed after it. */
const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

function suite(id: string, url: string): Suite {
  return {
    sourceId: 'demo',
    id,
    root: '/tmp/demo/' + id,
    manifest: { layout: 'agent-plugin-v1', path: '/tmp/demo/' + id + '/plugin.json', id, name: id },
    skills: [],
    mcp: { schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', servers: { db: { type: 'streamable-http', url, headers: {} } } },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    activeSurfaces: effectiveSurfaces(undefined),
    installedAt: new Date(0).toISOString(),
    errors: []
  }
}

/** The candidate view the production declaration reader produces for a suite. */
async function candidates(rows: readonly Suite[]): Promise<ExtensionSuiteCandidate[]> {
  const declarations = await readExtensionSuiteDeclarations([...rows])
  if (declarations.length === 0) throw new Error('expected declarations')
  return declarations
}

async function harness() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'preset-isolation-'))
  cleanup.push(() => removeTempRoot(dataRoot))
  const server: FakeStreamableMcpServer = await startFakeStreamableMcpServer({})
  cleanup.push(() => server.close())
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  const runtime = new RuntimeReconciler(ctx, dataRoot, createRuntimeMounts(ctx, dataRoot))
  cleanup.push(() => runtime.dispose())
  const alpha = suite('alpha', server.url)
  const beta = suite('beta', server.url)
  return {
    ctx,
    runtime,
    alpha,
    beta,
    global: [alpha, beta],
    live: () =>
      runtime
        .demandedMcpMounts()
        .map(row => row.suiteId)
        .sort()
  }
}

describe('cross-session mount isolation', () => {
  it('keeps a session mounts when another session applies with a partial declaration read', async () => {
    const { runtime, alpha, beta, global, live } = await harness()
    const ownerA = {}
    const ownerB = {}

    // Both sessions hold their own selection, seeded by the catalog owner.
    runtime.setCatalogAuthority(await candidates(global), global)
    ;(await runtime.stageSessionDemand(ownerA, [alpha])).commit()
    ;(await runtime.stageSessionDemand(ownerB, [beta])).commit()
    await runtime.reconcile(global)
    expect(live()).toEqual(['demo/alpha', 'demo/beta'])

    // Session A applies again. The read it carries is missing beta, which is
    // what a declaration read that raced a source update looks like. A session
    // apply may seed authority but never replace it.
    runtime.ensureCatalogAuthority(await candidates([alpha]), global)
    ;(await runtime.stageSessionDemand(ownerA, [alpha])).commit()
    await runtime.reconcile(global)

    expect(live()).toEqual(['demo/alpha', 'demo/beta'])
    expect(runtime.demandedMcpMounts()).toContainEqual({ suiteId: 'demo/beta', serverKey: 'db' })
  })

  it('still lets the catalog pipeline replace authority', async () => {
    const { runtime, alpha, beta, global, live } = await harness()
    const ownerA = {}
    const ownerB = {}
    runtime.setCatalogAuthority(await candidates(global), global)
    ;(await runtime.stageSessionDemand(ownerA, [alpha])).commit()
    ;(await runtime.stageSessionDemand(ownerB, [beta])).commit()
    await runtime.reconcile(global)
    expect(live()).toEqual(['demo/alpha', 'demo/beta'])

    // An uninstall really does remove the suite. The catalog pass is the owner
    // of that fact, so it must still be able to narrow authority.
    await runtime.refreshCatalog(await candidates([alpha]), [alpha])
    expect(live()).toEqual(['demo/alpha'])
  })

  it('never narrows another session when a session applies before any catalog pass', async () => {
    const { runtime, alpha, beta, global, live } = await harness()
    const ownerA = {}
    const ownerB = {}

    // The first session to apply seeds authority. A partial seed must not be
    // able to hide a suite the other session is about to select.
    runtime.ensureCatalogAuthority(await candidates([alpha]), global)
    ;(await runtime.stageSessionDemand(ownerA, [alpha])).commit()
    await runtime.reconcile(global)

    // The catalog owner publishes the full view; beta then mounts.
    runtime.setCatalogAuthority(await candidates(global), global)
    ;(await runtime.stageSessionDemand(ownerB, [beta])).commit()
    await runtime.reconcile(global)

    expect(live()).toEqual(['demo/alpha', 'demo/beta'])
    expect(runtime.demandedMcpMounts()).toContainEqual({ suiteId: 'demo/beta', serverKey: 'db' })
  })

  it('fails loudly when a session read disagrees with authority the catalog already published', async () => {
    const { runtime, alpha, beta, live } = await harness()

    // The catalog owner published a view without beta, which is what an
    // uninstall looks like. Seeding is then a no-op, so the session's own read
    // is not consulted: it must be refused rather than silently mount nothing.
    runtime.setCatalogAuthority(await candidates([alpha]), [alpha])

    await expect(runtime.stageSessionDemand({}, [beta])).rejects.toThrow('extension-shared-demand-unavailable')
    expect(live()).toEqual([])
  })
})
/**
 * The owner-facing promise, through the live session service.
 *
 * Two real sessions on one process. Session A applies with a declaration read
 * that omits B's suite. B must keep its mount and its authorization, because
 * the read belongs to A.
 */
describe('two live sessions', () => {
  it('keeps the other session mount and authorization when one applies with a partial read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preset-two-sessions-'))
    cleanup.push(() => removeTempRoot(root))
    const server = await startFakeStreamableMcpServer({})
    cleanup.push(() => server.close())
    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Persistence, { root: join(root, 'sessions') })
    await ctx.plugin(Query)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], new Adapter())

    const dataRoot = join(root, 'data')
    const reconciler = new RuntimeReconciler(ctx, dataRoot, createRuntimeMounts(ctx, dataRoot))
    cleanup.push(() => reconciler.dispose())
    const alpha = suite('alpha', server.url)
    const beta = suite('beta', server.url)
    const all = await candidates([alpha, beta])
    reconciler.setCatalogAuthority(all, [alpha, beta])

    // The declaration read each session publishes. Session A's is partial, which
    // is what a read that raced a source update produces.
    const published = new Map<string, readonly ExtensionSuiteCandidate[]>()
    const rows = ['alpha', 'beta'].map(name => ({
      id: 'mcp:plugin:demo/' + name + '/db',
      face: 'mcp' as const,
      name,
      source: 'demo',
      available: true,
      detail: { kind: 'mcp' as const, entryId: 'plugin:demo/' + name + '/db' }
    }))
    const runtime = new ExtensionRuntime(ctx, {
      dataRoot,
      inventory: async () => rows,
      applySelection: async (agent, selection) => {
        const only = published.get(agent.id)
        if (only !== undefined) reconciler.ensureCatalogAuthority(only, [alpha, beta])
        const receipt = await reconciler.stageSessionDemand(agent, selection.enabledIds.includes('mcp:plugin:demo/beta/db') ? [beta] : [alpha])
        receipt.commit()
      },
      committed: () => {}
    })
    cleanup.push(() => runtime.dispose())
    await runtime.start()

    const session = async (name: string): Promise<Agent> => {
      const created = await ctx.agentLoop.create(SessionId(name), { provider: 'mock', model: 'test' }, { cwd: join(root, name) })
      await vi.waitFor(() => expect(runtime.state.status(created).ready).toBe(true))
      return created
    }
    let sequence = 0
    const select = async (target: Agent, ids: string[]): Promise<void> => {
      // Preset names are unique per library, and one session may select twice.
      const name = 'only-' + target.id + '-' + String(sequence++)
      const window = await runtime.window(target.id)
      await runtime.create(target.id, window.library.revision, { name, enabledIds: ids })
      const preset = (await runtime.window(target.id)).library.presets.find(row => row.name === name)
      if (preset === undefined) throw new Error('preset was not created')
      await runtime.select(target.id, (await runtime.window(target.id)).state.revision, preset.id)
    }

    const a = await session('alpha')
    const b = await session('beta')
    await select(a, ['mcp:plugin:demo/alpha/db'])
    await select(b, ['mcp:plugin:demo/beta/db'])
    await reconciler.reconcile([alpha, beta])
    expect(
      reconciler
        .demandedMcpMounts()
        .map(row => row.suiteId)
        .sort()
    ).toEqual(['demo/alpha', 'demo/beta'])
    expect(runtime.allows(b, 'mcp:plugin:demo/beta/db')).toBe(true)

    // Session A applies again carrying a read that omits beta.
    published.set(
      a.id,
      all.filter(row => row.suite.id === 'alpha')
    )
    await select(a, ['mcp:plugin:demo/alpha/db'])
    await reconciler.reconcile([alpha, beta])

    // B keeps its server AND its authorization.
    expect(
      reconciler
        .demandedMcpMounts()
        .map(row => row.suiteId)
        .sort()
    ).toEqual(['demo/alpha', 'demo/beta'])
    expect(runtime.allows(b, 'mcp:plugin:demo/beta/db')).toBe(true)
  })
})
