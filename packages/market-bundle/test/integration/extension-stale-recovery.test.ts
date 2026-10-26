/**
 * A catalog change must never leave a session's tools denied forever.
 *
 * The reported symptom is a session losing tools after something happened in a
 * different session. A session is not ready for the whole attach window, and
 * invalidating during it left the agent stale with nothing scheduled, so the
 * loss was permanent for an idle session. These cases use real Agents on a real
 * AgentLoop and the real tool registry, so a denial is a missing tool rather
 * than a missing row.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import { ExtensionRuntime } from '../../../../packages/market-runtime/src/runtime/host/extension-runtime.js'
import { attachExtensionToolGates, type ExtensionToolGates } from '../../../../packages/market-runtime/src/runtime/host/extension-tool-gates.js'
import type { ExtensionResource } from '../../../../packages/market-contracts/src/contracts/extension-presets.js'
import { removeTempRoot } from './helpers/temp-root.js'

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

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

const RESOURCE = 'mcp:plugin:demo/suite/db'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-stale-'))
  cleanup.push(() => removeTempRoot(root))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new Adapter())

  let rows: ExtensionResource[] = [{ id: RESOURCE, face: 'mcp', name: 'db', source: 'demo', available: true, detail: { kind: 'mcp', entryId: 'plugin:demo/suite/db' } }]
  let failInventory = false
  const gates = new Map<Agent, ExtensionToolGates>()
  let publishFailure = false
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    // A fast schedule keeps the retry observable without waiting a minute.
    inventoryRetry: { baseMs: 10, maxMs: 40 },
    inventory: async () => {
      if (failInventory) throw new Error('inventory read failed')
      return rows
    },
    applySelection: async () => {},
    committed: agent => {
      if (publishFailure) throw new Error('publication failed')
      gates.get(agent)?.refresh()
    }
  })
  cleanup.push(() => runtime.dispose())
  await runtime.start()

  const tool = defineTool({
    name: 'demo_db_query',
    description: 'query the demo database',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'ok'
    }
  })
  ctx.tools.register(tool)

  /** Create one agent and wait for its session state to become ready. */
  const agent = async (name: string): Promise<Agent> => {
    const created = await ctx.agentLoop.create(SessionId(name), { provider: 'mock', model: 'test' }, { cwd: join(root, name) })
    await vi.waitFor(() => expect(runtime.state.status(created).ready).toBe(true))
    const gate = await new Promise<ExtensionToolGates>((resolve, reject) => {
      void created.ctx.inject(['tools'], () => {
        try {
          resolve(
            attachExtensionToolGates(
              created,
              { mcpTools: () => [{ name: tool.name, definition: tool, scope: undefined, resourceId: RESOURCE }], lspProviders: () => [], ownsLspTool: () => false },
              runtime
            )
          )
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
    cleanup.push(() => gate.dispose())
    gates.set(created, gate)
    return created
  }

  /** Grant the one resource, the way a preset selection does. */
  let granted = 0
  const grant = async (target: Agent): Promise<void> => {
    // Preset names are unique per library, and one case may grant twice.
    const name = 'grant-' + target.id + '-' + String(granted++)
    const window = await runtime.window(target.id)
    await runtime.create(target.id, window.library.revision, { name, enabledIds: [RESOURCE] })
    const preset = (await runtime.window(target.id)).library.presets.find(row => row.name === name)
    if (preset === undefined) throw new Error('preset was not created')
    await runtime.select(target.id, (await runtime.window(target.id)).state.revision, preset.id)
  }

  return {
    ctx,
    runtime,
    agent,
    grant,
    /** Grant again with the publication port failing, leaving the session not ready. */
    grantWithFailedPublication: async (target: Agent) => {
      publishFailure = true
      try {
        await grant(target)
      } finally {
        publishFailure = false
      }
    },
    tool,
    setRows: (next: ExtensionResource[]) => {
      rows = next
    },
    failInventory: (next: boolean) => {
      failInventory = next
    }
  }
}

/** Whether one agent's model is offered the tool. */
const sees = (ctx: Context, agent: Agent, name: string): boolean => ctx.tools.schemas(agent).some(schema => schema.name === name)

it('does not lose tools when a catalog change lands while a session is still attaching', async () => {
  const { ctx, runtime, tool } = await setup()

  // The attach window is the real shape of startup: the agent exists, its
  // session state is not ready yet, and a catalog change lands.
  const creating = ctx.agentLoop.create(SessionId('starting'), { provider: 'mock', model: 'test' }, { cwd: '/tmp/dsh-stale-starting' })
  runtime.invalidate()
  const started = await creating
  await vi.waitFor(() => expect(runtime.state.status(started).ready).toBe(true))

  // The retry must close the window without another catalog event.
  await vi.waitFor(() => expect(runtime.allows(started, RESOURCE)).toBe(true), { timeout: 5_000 })
  void ctx.tools.schemas(started)
  expect(runtime.denialReason(started)).toBeUndefined()
  expect(sees(ctx, started, tool.name)).toBe(true)
})

it('retries after a failed inventory read instead of staying denied forever', async () => {
  const { ctx, runtime, agent, grant, tool, failInventory } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true))

  failInventory(true)
  runtime.invalidate()
  await runtime.refreshAll()
  // Authorization fails closed immediately. The visible list follows the gate's
  // next refresh, so this case asserts the authorization and the healing, not
  // the instant the deny lands in the registry.
  expect(runtime.allows(alpha, RESOURCE)).toBe(false)
  // The status surface can now name the transient cause.
  expect(runtime.denialReason(alpha)).toBe('extension-inventory-pending')

  // The read works again. No catalog event follows, so only the retry can heal it.
  failInventory(false)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true), { timeout: 5_000 })
  await vi.waitFor(() => expect(sees(ctx, alpha, tool.name)).toBe(true), { timeout: 5_000 })
  expect(runtime.denialReason(alpha)).toBeUndefined()
})

it('still denies a resource that the catalog really withdrew', async () => {
  const { ctx, runtime, agent, grant, tool, setRows } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true))

  // The suite is uninstalled: the row is gone from the catalog, not merely
  // unreadable. Fail-closed must still mean denied, and the retry must not
  // resurrect it.
  setRows([])
  runtime.invalidate()
  await runtime.refreshAll()

  expect(runtime.allows(alpha, RESOURCE)).toBe(false)
  expect(runtime.denialReason(alpha)).toBeUndefined()
  // Give the retry window a chance: a withdrawn resource stays gone.
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(runtime.allows(alpha, RESOURCE)).toBe(false)
  expect(sees(ctx, alpha, tool.name)).toBe(false)
})

it('does not strand a session that recovers from not ready', async () => {
  const { runtime, agent } = await setup()
  const alpha = await agent('alpha')

  runtime.invalidate()
  await runtime.refreshAll()
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true), { timeout: 5_000 })

  // Recovery from the not-ready branch replays a selection without reading the
  // inventory. It must still leave the agent refreshed rather than stale.
  const status = runtime.state.status(alpha)
  expect(status.ready).toBe(true)
  expect(runtime.denialReason(alpha)).toBeUndefined()
})
it('keeps retrying on a slow ceiling instead of giving up permanently', async () => {
  const { runtime, agent, grant, failInventory } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true))

  // The inventory stays unreadable for longer than any bounded budget would
  // allow. A schedule that gave up would leave the session denied for good.
  failInventory(true)
  runtime.invalidate()
  await runtime.refreshAll()
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(runtime.allows(alpha, RESOURCE)).toBe(false)

  // The read works again, and no catalog event follows: only the retry can heal it.
  failInventory(false)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true), { timeout: 5_000 })
})

it('tells the model the capability is pending, not withdrawn', async () => {
  const { ctx, runtime, agent, grant, failInventory, tool } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true))

  // A pending read and a withdrawn resource deny identically, so the reason is
  // the only place the model can learn the difference. Ask the real registry.
  failInventory(true)
  runtime.invalidate()
  await runtime.refreshAll()
  const pending = await ctx.tools
    .execute({ name: tool.name, arguments: {}, callId: 'probe' as never, agent: alpha, signal: new AbortController().signal })
    .catch((error: unknown) => String(error))
  expect(JSON.stringify(pending)).toContain('extension-inventory-pending')

  failInventory(false)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true), { timeout: 5_000 })
})

it('names the pending catalog read in the model-facing denial', async () => {
  const { runtime, agent, grant, failInventory } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true))

  failInventory(true)
  runtime.invalidate()
  await runtime.refreshAll()
  const pending = runtime.denialReason(alpha)
  expect(pending).toBe('extension-inventory-pending')
  // The window payload publishes it, so the panel can name the state.
  failInventory(false)
  await vi.waitFor(() => expect(runtime.denialReason(alpha)).toBeUndefined(), { timeout: 5_000 })
})

it('publishes the pending state on the session window and clears it when the read lands', async () => {
  const { runtime, agent, grant, failInventory } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)

  failInventory(true)
  runtime.invalidate()
  await runtime.refreshAll()
  // The panel must still answer while the read fails, and say why the session's
  // tools are hidden rather than reporting a dead panel.
  const unsettled = await runtime.window(alpha.id)
  expect(unsettled.status?.ready).toBe(true)
  expect(unsettled.status?.inventoryPending).toBe(true)

  failInventory(false)
  const settled = await runtime.window(alpha.id)
  expect(settled.status?.inventoryPending).toBeUndefined()
  expect(runtime.allows(alpha, RESOURCE)).toBe(true)
})

it('arms a retry when recovery itself cannot complete, so the next attempt can succeed', async () => {
  const { runtime, agent, grant, grantWithFailedPublication, failInventory } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true))

  // A publication failure leaves the session not ready with a durable selection.
  // Then the catalog read fails too, so recovery cannot restore it either.
  await expect(grantWithFailedPublication(alpha)).rejects.toThrow('publication failed')
  failInventory(true)
  const status = runtime.state.status(alpha)
  expect(status.ready).toBe(false)
  expect(status.recoverable).toBe(true)
  await expect(runtime.recover(alpha.id, status.revision)).rejects.toThrow()

  // The in-between state the fix forbids: work outstanding, nobody scheduled.
  // A retry must be armed, or the session would sit denied with nothing to wake it.
  const internals = runtime as unknown as { retries: Map<Agent, unknown>; dirty: Set<Agent> }
  expect(internals.dirty.has(alpha)).toBe(true)
  expect(internals.retries.has(alpha)).toBe(true)

  // The read works again, and the next explicit recovery restores the capability.
  failInventory(false)
  await runtime.recover(alpha.id, runtime.state.status(alpha).revision)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true), { timeout: 5_000 })
  expect(runtime.state.status(alpha).ready).toBe(true)
})

it('reports a session that is ready but still denied instead of pretending it is usable', async () => {
  const { runtime, agent, grant, failInventory } = await setup()
  const alpha = await agent('alpha')
  await grant(alpha)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true))

  // A pending read leaves the session ready in the state machine but authorizing
  // nothing. That is why recover documents that resolving restores the selection,
  // not the capabilities: a caller checks allows() or denialReason() first.
  failInventory(true)
  runtime.invalidate()
  await runtime.refreshAll()
  expect(runtime.state.status(alpha).ready).toBe(true)
  expect(runtime.allows(alpha, RESOURCE)).toBe(false)
  expect(runtime.denialReason(alpha)).toBe('extension-inventory-pending')

  failInventory(false)
  await vi.waitFor(() => expect(runtime.allows(alpha, RESOURCE)).toBe(true), { timeout: 5_000 })
})
