import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { ExtensionRuntime } from '../../../../packages/market-runtime/src/runtime/host/extension-runtime.js'
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
  const root = await mkdtemp(join(tmpdir(), 'extension-window-activation-'))
  cleanups.push(() => removeTempRoot(root))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new Adapter())
  const runtime = new ExtensionRuntime(ctx, { dataRoot: root, inventory: async () => [], applySelection: async () => {} })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const createAgent = (sessionId: SessionId) => ctx.agentLoop.create(sessionId, { provider: 'mock', model: 'test' }, { cwd: root })
  return { ctx, runtime, createAgent }
}

it('activates a persisted session instead of reporting it not ready', async () => {
  // A composer control has to answer while the conversation is open. The panel used
  // to wait for someone else to start a turn; it now asks the host's own seam, the
  // one every agent-bound read and write goes through.
  const { ctx, runtime, createAgent } = await setup()
  const resolveAgent = vi.fn(async (sessionId: SessionId) => ({ agent: await createAgent(sessionId) }))
  ctx.provide('sessionController', { resolveAgent } as never)
  const window = await runtime.window('cold-session')
  expect(window.sessionId).toBe('cold-session')
  expect(window.status?.ready).toBe(true)
  expect(resolveAgent).toHaveBeenCalledTimes(1)
})

it('shares one activation between concurrent reads of the same session', async () => {
  const { ctx, runtime, createAgent } = await setup()
  const entered = gate<void>()
  const release = gate<void>()
  let created: Awaited<ReturnType<typeof createAgent>> | undefined
  const resolveAgent = vi.fn(async (sessionId: SessionId) => {
    entered.resolve()
    await release.promise
    created ??= await createAgent(sessionId)
    return { agent: created }
  })
  ctx.provide('sessionController', { resolveAgent } as never)
  const first = runtime.window('shared-session')
  const second = runtime.window('shared-session')
  await entered.promise
  release.resolve()
  const [one, two] = await Promise.all([first, second])
  expect(resolveAgent).toHaveBeenCalledTimes(1)
  expect(one.sessionId).toBe('shared-session')
  expect(two.sessionId).toBe('shared-session')
})

it('reports the activation failure and re-asks once per retry window', async () => {
  const { ctx, runtime } = await setup()
  const resolveAgent = vi.fn(async () => ({ error: { code: 'session/writer-held', message: 'another process owns it' } }))
  ctx.provide('sessionController', { resolveAgent } as never)
  await expect(runtime.window('held-session')).rejects.toMatchObject({ code: 'session/writer-held' })
  await expect(runtime.window('held-session')).rejects.toMatchObject({ code: 'session/writer-held' })
  expect(resolveAgent).toHaveBeenCalledTimes(1)
})

it('keeps the not-found answer when the host composes no activation seam', async () => {
  const { runtime } = await setup()
  await expect(runtime.window('cold-session')).rejects.toMatchObject({ code: 'extension-session-not-found' })
})
