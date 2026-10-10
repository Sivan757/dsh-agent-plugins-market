import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ExtensionRuntime } from '../packages/market-runtime/src/runtime/host/extension-runtime.js'
import { attachExtensionToolGates, type ExtensionToolGates } from '../packages/market-runtime/src/runtime/host/extension-tool-gates.js'
import type { ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'
class Query extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
class Adapter extends LlmAdapter {
  onRequest: (options: GenerateOptions) => void = () => {}
  hold?: Promise<void>
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.onRequest(_options)
    await this.hold
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
const id = 'mcp:plugin:source/suite/db'
const row: ExtensionResource = { id, face: 'mcp', name: 'db', source: 'source', available: true, detail: { kind: 'mcp', entryId: 'plugin:source/suite/db' } }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-maintenance-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  let rows = [row]
  const apply = vi.fn(async () => {})
  const publish = vi.fn((_agent: Agent) => {})
  const runtime = new ExtensionRuntime(ctx, { dataRoot: root, inventory: async () => rows, applySelection: apply, committed: publish })
  cleanup.push(() => runtime.dispose())
  await runtime.start()
  const agent = await ctx.agentLoop.create(SessionId('a'), { provider: 'mock', model: 'test' }, { cwd: root })
  return {
    root,
    ctx,
    agent,
    runtime,
    adapter,
    apply,
    publish,
    setRows: (value: ExtensionResource[]) => {
      rows = value
    }
  }
}
let presetSequence = 0
/**
 * Grant exactly these ids the way the product does now: write a named preset into
 * the workspace library, then select it. The library revision and the session
 * state revision are separate counters, so each is read immediately before the
 * call that consumes it — creating a preset never advances session state.
 */
async function applyPreset(runtime: ExtensionRuntime, sessionId: string, enabledIds: string[]): Promise<void> {
  const name = 'maintenance-preset-' + presetSequence++
  await runtime.create(sessionId, (await runtime.window(sessionId)).library.revision, { name, enabledIds })
  const preset = (await runtime.window(sessionId)).library.presets.find(row => row.name === name)
  if (preset === undefined) throw new Error('preset was not created')
  await runtime.select(sessionId, (await runtime.window(sessionId)).state.revision, preset.id)
}
it('releases applied epochs when an agent is disposed', async () => {
  const { ctx, runtime, agent } = await setup()
  const epochs = (runtime as unknown as { appliedEpochs: Map<Agent, number> }).appliedEpochs
  expect(epochs.has(agent)).toBe(true)
  ctx.emit('agent/disposed', { agent })
  expect(epochs.has(agent)).toBe(false)
})

it('releases applied epochs when the runtime is disposed', async () => {
  const { runtime, agent } = await setup()
  const epochs = (runtime as unknown as { appliedEpochs: Map<Agent, number> }).appliedEpochs
  expect(epochs.has(agent)).toBe(true)
  await runtime.dispose()
  expect(epochs.size).toBe(0)
})

it('publishes the newly enabled inherited schema before queued Send opens its first request', async () => {
  const { ctx, agent, runtime, adapter, apply, publish } = await setup()
  const definition = defineTool({
    name: 'owned_query',
    description: 'query',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'ok'
    }
  })
  ctx.tools.register(definition)
  let gate: ExtensionToolGates | undefined
  await agent.ctx.inject(['tools'], () => {
    gate = attachExtensionToolGates(
      agent,
      { mcpTools: () => [{ name: definition.name, definition, scope: undefined, resourceId: id }], lspProviders: () => [], ownsLspTool: () => false },
      runtime
    )
  })
  cleanup.push(async () => gate?.dispose())
  publish.mockImplementation(() => gate!.refresh())
  await applyPreset(runtime, agent.id, [])
  expect(ctx.tools.schemas(agent).map(tool => tool.name)).not.toContain(definition.name)
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  apply.mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
  })
  const seen: string[][] = []
  adapter.onRequest = () => {
    seen.push(ctx.tools.schemas(agent).map(tool => tool.name))
  }
  const changing = applyPreset(runtime, agent.id, [id])
  await entered.promise
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'send after enable' }] }))
  expect(seen).toEqual([])
  release.resolve()
  await changing
  await agent.whenIdle()
  expect(seen).toHaveLength(1)
  expect(seen[0]).toContain(definition.name)
})
it('keeps the session ready during registration rebuilding and coalesces a newer catalog epoch', async () => {
  const { agent, runtime, apply, setRows } = await setup()
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  apply.mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
  })
  runtime.invalidate()
  const refresh = runtime.refreshAll()
  await entered.promise
  expect((await runtime.window(agent.id)).status?.ready).toBe(true)
  expect(runtime.allows(agent, id)).toBe(true)
  setRows([{ ...row, available: false }])
  runtime.invalidate()
  await runtime.refreshAll()
  release.resolve()
  await refresh
  expect(apply).toHaveBeenCalledTimes(3)
  expect(runtime.ready(agent)).toBe(true)
  expect(runtime.allows(agent, id)).toBe(false)
})
it('keeps publication failures denied and restores the saved selection by explicit recovery', async () => {
  const { agent, runtime, publish } = await setup()
  publish.mockImplementationOnce(() => {
    throw new Error('publication failed')
  })
  await expect(applyPreset(runtime, agent.id, [])).rejects.toThrow('publication failed')
  expect(runtime.ready(agent)).toBe(false)
  expect(runtime.state.status(agent).recoverable).toBe(true)
  await runtime.recover(agent.id, 2)
  expect(runtime.ready(agent)).toBe(true)
  expect(runtime.state.read(agent)?.selection.enabledIds).toEqual([])
})
it('an explicit session change can finish rebuilding a globally invalidated epoch', async () => {
  const { agent, runtime } = await setup()
  runtime.invalidate()
  await applyPreset(runtime, agent.id, [id])
  expect(runtime.ready(agent)).toBe(true)
  expect(runtime.allows(agent, id)).toBe(true)
})

it('continues queued input after a global revoke without another Send and denies only unavailable capabilities', async () => {
  const { ctx, agent, runtime, adapter, publish, setRows } = await setup()
  const retainedId = 'mcp:plugin:source/suite/retained'
  const retainedRow = { ...row, id: retainedId, name: 'retained' }
  setRows([row, retainedRow])
  await applyPreset(runtime, agent.id, [id, retainedId])
  const execute = vi.fn(async () => 'called')
  const owned = defineTool({
    name: 'owned_revoke',
    description: 'owned',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute
  })
  const native = defineTool({
    name: 'native_keep',
    description: 'native',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'native'
    }
  })
  const retained = defineTool({
    name: 'owned_keep',
    description: 'retained owned capability',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'retained'
    }
  })
  ctx.tools.register(owned)
  ctx.tools.register(native)
  ctx.tools.register(retained)
  let gate: ExtensionToolGates | undefined
  await agent.ctx.inject(['tools'], () => {
    gate = attachExtensionToolGates(
      agent,
      {
        mcpTools: () => [
          { name: owned.name, definition: owned, scope: undefined, resourceId: id },
          { name: retained.name, definition: retained, scope: undefined, resourceId: retainedId }
        ],
        lspProviders: () => [],
        ownsLspTool: () => false
      },
      runtime
    )
  })
  cleanup.push(async () => gate?.dispose())
  publish.mockImplementation(() => gate!.refresh())
  ctx.systemPrompt.tools(context => ({ schemas: ctx.tools.schemas(context.scope) }))
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  cleanup.push(async () => {
    release.resolve()
    await agent.whenIdle()
  })
  adapter.hold = release.promise
  const requests: GenerateOptions[] = []
  adapter.onRequest = options => {
    requests.push(options)
    entered.resolve()
  }
  const first = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'held-first' }] })
  const second = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued-second' }] })
  agent.followup(first)
  await entered.promise
  setRows([{ ...row, available: false }, retainedRow])
  runtime.invalidate()
  const refresh = runtime.refreshAll()
  await refresh
  expect(runtime.ready(agent)).toBe(true)
  expect((await runtime.window(agent.id)).status?.ready).toBe(true)
  const denied = await ctx.tools.execute({ callId: ToolCallId('revoked'), name: owned.name, arguments: {}, agent, signal: new AbortController().signal })
  expect(denied).not.toMatchObject({ result: 'called' })
  expect(execute).not.toHaveBeenCalled()
  expect(runtime.allows(agent, retainedId)).toBe(true)
  agent.followup(second)
  release.resolve()
  await agent.whenIdle()
  expect(requests).toHaveLength(2)
  expect(requests[0]!.tools?.map(tool => tool.name)).toContain(owned.name)
  expect(requests[1]!.tools?.map(tool => tool.name)).not.toContain(owned.name)
  expect(requests[1]!.tools?.map(tool => tool.name)).toContain(native.name)
  expect(requests[1]!.tools?.map(tool => tool.name)).toContain(retained.name)
  for (const message of [first, second]) {
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === message.id)).toHaveLength(1)
    expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].filter(pending => pending.id === message.id)).toHaveLength(0)
  }
})
