import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { captureExtensionSelection, type ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { ExtensionRuntime } from '../packages/market-runtime/src/runtime/host/extension-runtime.js'
import { EXTENSION_SESSION_SOURCE } from '../packages/market-runtime/src/runtime/host/extension-session-state.js'

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
function gate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-window-consistency-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new Adapter())
  const inventory = vi.fn(async (): Promise<ExtensionResource[]> => [])
  const runtime = new ExtensionRuntime(ctx, { dataRoot: root, inventory, applySelection: async () => {} })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const agent = await ctx.agentLoop.create(SessionId('window-consistency'), { provider: 'mock', model: 'test' }, { cwd: root })
  return { ctx, runtime, agent, inventory }
}

it('reads the current selection when a commit completes during the inventory read', async () => {
  const { runtime, agent, inventory } = await setup()
  const before = runtime.state.read(agent)!
  const entered = gate<void>()
  const inventoryResult = gate<ExtensionResource[]>()
  inventory.mockImplementationOnce(() => {
    entered.resolve()
    return inventoryResult.promise
  })
  const read = runtime.window(agent.id)
  cleanups.push(async () => {
    inventoryResult.resolve([])
    await read
  })
  await entered.promise
  const next = captureExtensionSelection(null, ['skills:new'])
  await runtime.state.requestSelection(agent, before.revision, next)
  inventoryResult.resolve([])
  const value = await read
  expect(value.status?.ready).toBe(true)
  expect(value.state).toEqual({ revision: before.revision + 1, selection: next })
  expect(value.selectionRevision).toBe(before.revision + 1)
  expect(value.intendedSelection).toBeUndefined()
})

it.each([true, false])('waits for a committed binding flush and reports its settled outcome (success=%s)', async succeeds => {
  const { ctx, runtime, agent, inventory } = await setup()
  const before = runtime.state.read(agent)!
  const entered = gate<void>()
  const flushResult = gate<boolean>()
  const original = ctx.sessions.flush.bind(ctx.sessions)
  let calls = 0
  const flush = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async session => {
    calls += 1
    if (calls !== 2) return original(session)
    entered.resolve()
    return flushResult.promise
  })
  cleanups.push(() => flush.mockRestore())
  const next = captureExtensionSelection(null, ['skills:after-flush'])
  const write = runtime.state.requestSelection(agent, before.revision, next).then(
    () => undefined,
    error => error as Error
  )
  cleanups.push(async () => {
    flushResult.resolve(succeeds)
    await write
  })
  await entered.promise
  expect(
    agent.session
      .snapshotEvents()
      .some(
        event =>
          event.type === 'agent/inbox/spliced' &&
          event.data.inserted.some(
            message => message.source.kind === EXTENSION_SESSION_SOURCE && message.source.binding.phase === 'committed' && message.source.binding.revision === before.revision + 1
          )
      )
  ).toBe(true)
  expect(runtime.state.status(agent).ready).toBe(false)
  const inventoryRead = gate<void>()
  inventory.mockImplementationOnce(async () => {
    inventoryRead.resolve()
    return []
  })
  let returned = false
  const read = runtime.window(agent.id).then(value => {
    returned = true
    return value
  })
  await inventoryRead.promise
  expect(returned).toBe(false)
  flushResult.resolve(succeeds)
  const [value, failure] = await Promise.all([read, write])
  expect(value.selectionRevision).toBe(runtime.state.selectionRevision(agent))
  expect(value.intendedSelection).toBeUndefined()
  if (succeeds) {
    expect(failure).toBeUndefined()
    expect(value.status?.ready).toBe(true)
    expect(value.state).toEqual({ revision: before.revision + 1, selection: next })
  } else {
    expect(failure).toMatchObject({ code: 'extension-session-persistence-unavailable' })
    expect(value.status).toMatchObject({ ready: false, recoverable: true, error: 'extension-session-persistence-unavailable' })
  }
})
