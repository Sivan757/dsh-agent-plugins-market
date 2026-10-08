/**
 * Next-user-turn selection changes.
 *
 * A selection requested while a turn owns the session is durable intent only: the
 * committed selection keeps authorizing until a safe boundary promotes it, so the
 * active turn's tools and grants never change under it. The boundary is the clean
 * stop of that turn, with the idle transition as the fallback for a turn that never
 * stops cleanly. Real AgentLoop, real session log, one holdable model response.
 */
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
import { captureExtensionSelection, type ExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { ExtensionSessionState, EXTENSION_INTENT_SOURCE } from '../packages/market-runtime/src/runtime/host/extension-session-state.js'
import { ExtensionRuntime } from '../packages/market-runtime/src/runtime/host/extension-runtime.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
/** One model response that can be held open, and aborts with the caller's signal. */
class HoldableAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  /** 1-based call index to hold open, so a turn can be observed while it runs. */
  holdCall: number | undefined
  /** 1-based call index that answers with an unknown tool, so the turn reaches a second step. */
  toolCallOn: number | undefined
  /** Ordered evidence hook: one entry per model request. */
  onRequest: (() => void) | undefined
  private release: (() => void) | undefined
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  /** Let the held response finish. */
  resume(): void {
    const release = this.release
    this.release = undefined
    release?.()
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.onRequest?.()
    const call = this.requests.length
    if (this.holdCall === call) {
      const gate = Promise.withResolvers<void>()
      this.release = () => gate.resolve()
      const signal = options.signal
      const aborted = new Promise<void>(resolve => {
        signal?.addEventListener('abort', () => resolve(), { once: true })
        if (signal?.aborted === true) resolve()
      })
      await Promise.race([gate.promise, aborted])
    }
    signalCheck(options)
    if (this.toolCallOn === call) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('probe-call'), name: 'market_probe_missing_tool', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('probe-call'), name: 'market_probe_missing_tool', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
/** An aborted call yields nothing, so a cancelled turn cannot look completed. */
const signalCheck = (options: GenerateOptions): void => {
  options.signal?.throwIfAborted()
}
const userMessage = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const selection = (...ids: string[]) => captureExtensionSelection(null, ids)

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-next-turn-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new HoldableAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  /** Ordered evidence: one entry per applied selection and per model request. */
  const events: string[] = []
  adapter.onRequest = () => events.push('request')
  // Record boundary ordering independently of the selection service.
  ctx.on('agent/turn-stopping', event => {
    events.push('turn-stopping:' + (event.agent?.id ?? 'none'))
  })
  ctx.on('agent/status', event => {
    events.push('status:' + String(event.status) + ':' + (event.agent?.id ?? 'none'))
  })
  /** The same probes on an agent-scoped context, the registration ExtensionHooks uses. */
  const probeAgentScope = (agent: Agent): void => {
    agent.ctx.on('agent/turn-stopping', () => {
      events.push('scoped-turn-stopping')
    })
    agent.ctx.on('agent/status', event => {
      events.push('scoped-status:' + String(event.status))
    })
  }
  const applies: string[] = []
  const initialSelection = vi.fn(async () => selection('skills:initial'))
  const applySelection = vi.fn(async (_agent: Agent, next: ExtensionSelection) => {
    applies.push(next.enabledIds.join(','))
    events.push('apply:' + next.enabledIds.join(','))
  })
  const service = new ExtensionSessionState(ctx, { initialSelection, applySelection })
  cleanups.push(() => service.dispose())
  await service.start()
  adapter.requests.length = 0
  const create = async (id: string): Promise<Agent> => {
    const agent = await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' })
    events.length = 0
    probeAgentScope(agent)
    return agent
  }
  return { ctx, root, service, adapter, applies, events, initialSelection, applySelection, create }
}

it('keeps the committed grants through a held turn and promotes at the next user request', async () => {
  const h = await setup()
  const agent = await h.create('next-turn')
  expect(h.applies).toEqual(['skills:initial'])
  h.adapter.holdCall = 1
  agent.followup(userMessage('first request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  const outcome = await h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:next'))
  expect(outcome).toEqual({ applied: false, revision: 2 })
  // Intent only: nothing staged, nothing swapped while the turn is live.
  expect(h.applies).toEqual(['skills:initial'])
  expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:initial'])
  expect(h.service.intended(agent)).toEqual({ selection: selection('skills:next'), revision: 2 })
  // A second user request queues behind the held response.
  agent.followup(userMessage('second request'))
  h.adapter.resume()
  await agent.whenIdle()
  // Persisted intent is not pending input, so the clean-stop boundary remains available.
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:next']))
  await vi.waitFor(() => expect(h.service.intended(agent)).toBeUndefined())
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(2))
  expect(h.applies).toEqual(['skills:initial', 'skills:next'])
  const promoted = h.events.indexOf('apply:skills:next')
  // The active turn ran on the old grants; only the queued request ran on the new ones.
  expect(h.events.indexOf('request')).toBeLessThan(promoted)
  expect(h.events.lastIndexOf('request')).toBeGreaterThan(promoted)
  const log = agent.session.snapshotEvents()
  expect(log.filter(event => event.type === 'turn/end').map(event => String(event.data.reason.kind))).toEqual(['completed', 'completed'])
  expect(log.filter(event => event.type === 'turn/start')).toHaveLength(2)
  expect(h.events).toContain('scoped-turn-stopping')
  expect(log.filter(event => event.type === 'step/start')).toHaveLength(2)
})

it('promotes an interrupted turn from idle without forcing a stop', async () => {
  const h = await setup()
  const agent = await h.create('cancelled-turn')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  await h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:next'))
  // The host cancels; this service never cancels to force a boundary.
  agent.cancel({ kind: 'user' })
  await agent.whenIdle()
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:next']))
  expect(h.applies).toEqual(['skills:initial', 'skills:next'])
  expect(h.service.intended(agent)).toBeUndefined()
})

it('replays a pending request from the log after a reload', async () => {
  const h = await setup()
  const agent = await h.create('reload-intent')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  await h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:next'))
  // The request is durable before it is acknowledged.
  expect(
    agent.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === EXTENSION_INTENT_SOURCE))
  ).toBe(true)
  await h.service.dispose()
  const next = new ExtensionSessionState(h.ctx, { initialSelection: h.initialSelection, applySelection: h.applySelection })
  cleanups.push(() => next.dispose())
  await next.start()
  h.adapter.resume()
  await agent.whenIdle()
  // The reloaded service restores the request from the log and promotes it at idle.
  await vi.waitFor(() => expect(next.read(agent)?.selection.enabledIds).toEqual(['skills:next']))
  expect(h.initialSelection).toHaveBeenCalledTimes(1)
})

it('keeps the latest request under revision CAS and opens no extra model request', async () => {
  const h = await setup()
  const agent = await h.create('cas-latest')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  const first = await h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:first'))
  const second = await h.service.requestSelection(agent, first.revision, selection('skills:second'))
  // Each request carries its own revision: the second supersedes the first.
  expect(second).toEqual({ applied: false, revision: 3 })
  expect(h.service.intended(agent)).toEqual({ selection: selection('skills:second'), revision: 3 })
  await expect(h.service.requestSelection(agent, 0, selection('skills:stale'))).rejects.toMatchObject({ code: 'extension-session-conflict' })
  expect(h.service.intended(agent)?.selection.enabledIds).toEqual(['skills:second'])
  h.adapter.resume()
  await agent.whenIdle()
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:second']))
  // Promoting intent never spends a model request of its own.
  expect(h.adapter.requests).toHaveLength(1)
})

/** A runtime alone, for the route-level selection rules. Its agents carry a workspace. */
async function runtimeSetup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-next-turn-runtime-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new HoldableAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const runtime = new ExtensionRuntime(ctx, { dataRoot: root, inventory: async () => [], applySelection: async () => {}, committed: () => {} })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const create = (id: string): Promise<Agent> => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' }, { cwd: root })
  return { ctx, root, runtime, adapter, create }
}

/** Write one named preset and select it, the way the product does. */
async function selectPreset(h: { runtime: ExtensionRuntime }, sessionId: string, name: string, enabledIds: string[]): Promise<string> {
  await h.runtime.create(sessionId, (await h.runtime.window(sessionId)).library.revision, { name, enabledIds })
  const window = await h.runtime.window(sessionId)
  const preset = window.library.presets.find(row => row.name === name)
  if (preset === undefined) throw new Error('preset was not created')
  await h.runtime.select(sessionId, window.state.revision, preset.id)
  return preset.id
}

it('follows two updates of the selected preset while a turn owns the session', async () => {
  const h = await runtimeSetup()
  const agent = await h.create('update-twice')
  const presetId = await selectPreset(h, 'update-twice', 'edited', ['skills:one'])
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  const first = await h.runtime.window('update-twice')
  await h.runtime.update('update-twice', first.library.revision, presetId, { name: 'edited once', enabledIds: ['skills:one'] })
  const second = await h.runtime.window('update-twice')
  expect(second.intendedRevision).toBeDefined()
  await h.runtime.update('update-twice', second.library.revision, presetId, { name: 'edited twice', enabledIds: ['skills:two'] })
  const third = await h.runtime.window('update-twice')
  // The second edit is a newer request for the same session, not a conflict, so the
  // base it compares against is the pending one rather than the committed revision.
  expect(third.intendedRevision).toBeGreaterThan(second.intendedRevision!)
  expect(third.intendedSelection?.presetName).toBe('edited twice')
  expect(third.intendedSelection?.enabledIds).toEqual(['skills:two'])
  h.adapter.resume()
  await agent.whenIdle()
  await vi.waitFor(async () => expect((await h.runtime.window('update-twice')).state.selection.enabledIds).toEqual(['skills:two']))
})

it('follows an update to the preset a pending request names and leaves other sessions alone', async () => {
  const h = await runtimeSetup()
  const agent = await h.create('pending-edit')
  await h.create('detached')
  await selectPreset(h, 'pending-edit', 'kept', ['skills:kept'])
  const other = await selectPreset(h, 'detached', 'other', ['skills:other'])
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  const requested = await selectPreset(h, 'pending-edit', 'requested', ['skills:requested'])
  const before = await h.runtime.window('pending-edit')
  expect(before.intendedSelection?.presetId).toBe(requested)
  await h.runtime.update('pending-edit', before.library.revision, requested, { name: 'requested renamed', enabledIds: ['skills:requested-2'] })
  const after = await h.runtime.window('pending-edit')
  // The edit lands on the pending request, which the committed selection would hide.
  expect(after.intendedSelection?.presetName).toBe('requested renamed')
  expect(after.intendedSelection?.enabledIds).toEqual(['skills:requested-2'])
  expect(after.state.selection.presetName).toBe('kept')
  // The other session keeps its own preset and its own revision.
  const untouched = await h.runtime.window('detached')
  expect(untouched.state.selection.presetId).toBe(other)
  expect(untouched.intendedSelection).toBeUndefined()
})

it('does not revive a request that a later commit superseded', async () => {
  const h = await setup()
  const agent = await h.create('superseded-request')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  await h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:next'))
  h.adapter.resume()
  await agent.whenIdle()
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:next']))
  // The request was written before the commit that applied it, so a reload drops it
  // rather than promoting it again over the committed selection.
  await h.service.dispose()
  const next = new ExtensionSessionState(h.ctx, { initialSelection: h.initialSelection, applySelection: h.applySelection })
  cleanups.push(() => next.dispose())
  await next.start()
  await vi.waitFor(() => expect(next.status(agent).ready).toBe(true))
  expect(next.read(agent)?.selection.enabledIds).toEqual(['skills:next'])
  expect(next.intended(agent)).toBeUndefined()
})

it('serializes concurrent requests so one base cannot lose the other update', async () => {
  const h = await setup()
  const agent = await h.create('concurrent-requests')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  const base = h.service.read(agent)!.revision
  // Two callers name the same base at the same time. One keeps it, the other loses.
  const settled = await Promise.allSettled([
    h.service.requestSelection(agent, base, selection('skills:first')),
    h.service.requestSelection(agent, base, selection('skills:second'))
  ])
  const [first, second] = settled
  expect(first.status).toBe('fulfilled')
  expect(second.status).toBe('rejected')
  expect(first.status === 'fulfilled' ? first.value : undefined).toEqual({ applied: false, revision: base + 1 })
  const code = second.status === 'rejected' ? (second.reason as { code?: string }).code : undefined
  expect(code).toBe('extension-session-conflict')
  expect(h.service.intended(agent)).toEqual({ selection: selection('skills:first'), revision: base + 1 })
  // The loser wrote nothing: exactly one durable request exists.
  expect(
    agent.session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === EXTENSION_INTENT_SOURCE))
  ).toHaveLength(1)
  h.adapter.resume()
  await agent.whenIdle()
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:first']))
})

it('promotes a request whose agent went idle while the write was in flight', async () => {
  const h = await setup()
  const agent = await h.create('idle-during-persist')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  // The turn finishes before the durable write settles, so the idle transition
  // passes while the request is still being recorded.
  const pending = h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:next'))
  h.adapter.resume()
  await agent.whenIdle()
  expect((await pending).applied).toBe(false)
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:next']))
  expect(h.service.intended(agent)).toBeUndefined()
})

it('denies the session when a promotion fails and never retries by itself', async () => {
  const h = await setup()
  const agent = await h.create('promotion-failure')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  await h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:next'))
  h.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  h.adapter.resume()
  await agent.whenIdle()
  await vi.waitFor(() => expect(h.service.status(agent).ready).toBe(false))
  expect(h.service.status(agent).error).toBe('extension-session-apply-failed')
  // One capture at creation plus one failed promotion, and no further attempt.
  expect(h.applySelection).toHaveBeenCalledTimes(2)
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(h.applySelection).toHaveBeenCalledTimes(2)
})

it('does not block a running turn when a steer arrives with a request pending', async () => {
  const h = await setup()
  const agent = await h.create('mid-turn-steer')
  // The first response is a tool call and it is held, so the steer arrives while the
  // turn is still on its first model request and a tool continuation follows.
  h.adapter.toolCallOn = 1
  h.adapter.holdCall = 1
  agent.followup(userMessage('first request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  agent.steer(userMessage('mid-turn steer'))
  await h.service.requestSelection(agent, h.service.read(agent)!.revision, selection('skills:next'))
  expect(h.service.intended(agent)?.selection.enabledIds).toEqual(['skills:next'])
  h.adapter.resume()
  await agent.whenIdle()
  // The steered step is mid-turn work: the turn reaches a clean end, never blocked.
  const ends = agent.session
    .snapshotEvents()
    .filter(event => event.type === 'turn/end')
    .map(event => String(event.data.reason.kind))
  expect(ends).toEqual(['completed'])
  // The whole turn, the steered tool-continuation step included, ran on the committed
  // selection: the tool call and the step that carried the steer.
  expect(h.events.filter(entry => entry === 'request')).toHaveLength(2)
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:next']))
  // The request became effective only after the turn's last step.
  expect(h.events.indexOf('apply:skills:next')).toBeGreaterThan(h.events.lastIndexOf('request'))
})
