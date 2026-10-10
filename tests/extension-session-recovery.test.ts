import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, SessionLogOffset, buildForkSeed } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { captureExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { ExtensionSessionState, EXTENSION_SESSION_SOURCE, EXTENSION_SESSION_WAKE_SOURCE } from '../packages/market-runtime/src/runtime/host/extension-session-state.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A foreign producer's model-facing context, the shape another plugin injects. */
    'foreign-context-fixture': { kind: 'foreign-context-fixture'; form: 'instructions' }
    /** A foreign producer that declares no context form at all: the opaque default. */
    'foreign-formless-fixture': { kind: 'foreign-formless-fixture' }
  }
}
class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
class RecordingAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
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
async function setup(savedRoot?: string, eligible?: (agent: Agent) => boolean) {
  const root = savedRoot ?? (await mkdtemp(join(tmpdir(), 'extension-recovery-')))
  if (!savedRoot) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const initialSelection = vi.fn(async () => captureExtensionSelection(null, ['skills:initial']))
  const applySelection = vi.fn(async () => {})
  const service = new ExtensionSessionState(ctx, { initialSelection, applySelection, ...(eligible === undefined ? {} : { eligible }) })
  cleanups.push(() => service.dispose())
  await service.start()
  const create = (id: string) => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' })
  const createAt = (id: string, cwd: string) => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' }, { cwd })
  return { root, ctx, service, adapter, initialSelection, applySelection, create, createAt }
}
/**
 * Snapshot a flushed session root so a later host replays the log a process crash
 * would have left behind: the fixture is copied before the owning host performs
 * its orderly cleanup, which durably cancels pending input on its own.
 */
async function crashCopy(root: string): Promise<string> {
  const holder = await mkdtemp(join(tmpdir(), 'extension-crash-'))
  cleanups.push(() => rm(holder, { recursive: true, force: true }))
  const copy = join(holder, 'session-root')
  await cp(root, copy, { recursive: true })
  return copy
}
const userMessage = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const queuedUsers = (agent: Agent) => [...agent.inbox.nextStep, ...agent.inbox.nextTurn].filter(message => message.source.kind === 'user')

it('keeps queued input through failed maintenance and restores its original ids from a crash copy', async () => {
  const first = await setup()
  const agent = await first.create('queued-recovery')
  const committed = captureExtensionSelection(null, ['skills:committed'])
  await first.service.change(agent, 1, committed)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  first.applySelection.mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
    throw new Error('apply failed')
  })
  const changing = first.service.change(agent, 2, captureExtensionSelection(null, ['skills:failed']))
  const failed = expect(changing).rejects.toThrow('apply failed')
  await entered.promise
  const queued = [userMessage('queued during maintenance'), userMessage('later send'), userMessage('third send')]
  try {
    agent.followup(queued[0]!)
  } finally {
    release.resolve()
  }
  await failed
  await agent.whenIdle()
  expect(queuedUsers(agent)).toEqual(queued.slice(0, 1))
  for (const message of queued.slice(1)) {
    agent.followup(message)
    await agent.whenIdle()
  }
  expect(first.adapter.requests).toHaveLength(0)
  expect(queuedUsers(agent)).toEqual(queued)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(2)
  expect(first.service.status(agent)).toMatchObject({ ready: false, recoverable: true, revision: 3, selection: committed })
  await first.ctx.sessions.flush(agent.session)
  const crashed = await crashCopy(first.root)
  await first.service.dispose()
  await first.ctx.fiber.dispose()

  const second = await setup(crashed)
  second.initialSelection.mockResolvedValue(captureExtensionSelection(null, ['skills:changed-default']))
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(second.service.status(resumed)).toMatchObject({ ready: false, recoverable: true, revision: 3, selection: committed })
  expect(queuedUsers(resumed)).toEqual(queued)
  expect(second.adapter.requests).toHaveLength(0)
  expect(second.applySelection).not.toHaveBeenCalled()
  const afterRestart = userMessage('send after restart')
  resumed.followup(afterRestart)
  await resumed.whenIdle()
  expect(queuedUsers(resumed)).toEqual([...queued, afterRestart])
  expect(second.adapter.requests).toHaveLength(0)
  await expect(second.service.recover(resumed, 2)).rejects.toMatchObject({ code: 'extension-session-conflict' })
  expect(await second.service.recover(resumed, 3)).toEqual({ revision: 4, selection: committed })
  expect(second.initialSelection).not.toHaveBeenCalled()
  // The successful recovery wakes the driver for what this guard parked: no extra
  // send is needed, and each parked message enters exactly one request.
  await resumed.whenIdle()
  expect(queuedUsers(resumed)).toEqual([])
  expect(second.adapter.requests.length).toBeGreaterThan(0)
  const consumed = resumed.session.snapshotEvents().flatMap(event => (event.type === 'user/message' && event.data.source.kind === 'user' ? [event.data] : []))
  expect(consumed).toEqual([...queued, afterRestart])
  expect(new Set(consumed.map(message => message.id)).size).toBe(queued.length + 1)
  // The wake marker is plugin metadata and never becomes a request message.
  expect(resumed.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'market-extension-wake')).toBe(false)
  await second.service.dispose()
  await second.ctx.fiber.dispose()
  const third = await setup(crashed)
  const recovered = (await third.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(third.service.read(recovered)).toEqual({ revision: 4, selection: committed })
  expect(third.initialSelection).not.toHaveBeenCalled()
})

it('resumes an orderly shutdown without inventing input the host canceled at disposal', async () => {
  const first = await setup()
  const agent = await first.create('orderly-cancel')
  first.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(first.service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('apply failed')
  const queued = userMessage('queued before orderly shutdown')
  agent.followup(queued)
  await agent.whenIdle()
  expect(queuedUsers(agent)).toEqual([queued])
  await first.ctx.sessions.flush(agent.session)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(first.root)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(queuedUsers(resumed)).toEqual([])
  expect(second.adapter.requests).toHaveLength(0)
  const status = second.service.status(resumed)
  expect(status).toMatchObject({ ready: false, recoverable: true })
  await second.service.recover(resumed, status.revision)
  expect(second.service.status(resumed).ready).toBe(true)
  expect(queuedUsers(resumed)).toEqual([])
})

it('keeps metadata a forked child inherited readable after its own send', async () => {
  const first = await setup()
  const parent = await first.create('fork-parent')
  const inherited = captureExtensionSelection(null, ['skills:inherited'])
  await first.service.change(parent, 1, inherited)
  const events = parent.session.snapshotEvents()
  const child = (
    await first.ctx.agents.create({
      sessionId: SessionId('fork-child'),
      meta: { parentSession: parent.id, isSeeded: true, cwd: parent.session.header.cwd },
      seed: buildForkSeed(events, events.at(-1)!.seq),
      inheritedEventCount: SessionLogOffset(events.length),
      agentOptions: { provider: 'mock', model: 'test' }
    })
  ).agent
  expect(first.initialSelection).toHaveBeenCalledTimes(1)
  expect(first.service.read(child)).toEqual({ revision: 1, selection: inherited })
  const send = userMessage('child send')
  child.followup(send)
  await child.whenIdle()
  expect(first.adapter.requests).toHaveLength(1)
  expect(first.service.read(child)).toEqual({ revision: 1, selection: inherited })
  expect(first.service.read(parent)).toEqual({ revision: 2, selection: inherited })
  await first.ctx.sessions.flush(child.session)
  const crashed = await crashCopy(first.root)
  await first.service.dispose()
  await first.ctx.fiber.dispose()

  const second = await setup(crashed)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: child.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(second.service.read(resumed)).toEqual({ revision: 1, selection: inherited })
  expect(second.adapter.requests).toHaveLength(0)
  expect(second.initialSelection).not.toHaveBeenCalled()
})

it('retries the original initial snapshot after cold restart instead of reading a changed default', async () => {
  const first = await setup()
  first.applySelection.mockRejectedValueOnce(new Error('initial apply failed'))
  const agent = await first.create('initial-failed')
  expect(first.service.status(agent)).toMatchObject({ ready: false, recoverable: true, revision: 1, selection: captureExtensionSelection(null, ['skills:initial']) })
  await expect(first.service.initialize(agent)).rejects.toThrow()
  expect(first.initialSelection).toHaveBeenCalledTimes(1)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(first.root)
  second.initialSelection.mockResolvedValue(captureExtensionSelection(null, ['skills:new-default']))
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  await second.service.recover(resumed, 1)
  expect(second.service.read(resumed)).toEqual({ revision: 2, selection: captureExtensionSelection(null, ['skills:initial']) })
  expect(second.initialSelection).not.toHaveBeenCalled()
})

it('wakes restored input a host reload persisted, with no new send', async () => {
  const first = await setup()
  const agent = await first.create('restart-wake')
  const committed = captureExtensionSelection(null, ['skills:committed'])
  await first.service.change(agent, 1, committed)
  first.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(first.service.change(agent, 2, captureExtensionSelection(null, ['skills:failed']))).rejects.toThrow('apply failed')
  const queued = userMessage('queued before the reload')
  agent.followup(queued)
  await agent.whenIdle()
  expect(queuedUsers(agent)).toEqual([queued])
  await first.ctx.sessions.flush(agent.session)
  const crashed = await crashCopy(first.root)
  await first.service.dispose()
  await first.ctx.fiber.dispose()

  const second = await setup(crashed)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(queuedUsers(resumed)).toEqual([queued])
  expect(second.adapter.requests).toHaveLength(0)
  const status = second.service.status(resumed)
  expect(status).toMatchObject({ ready: false, recoverable: true })
  expect(await second.service.recover(resumed, status.revision)).toMatchObject({ revision: status.revision + 1 })
  // The queue came from the log, not from this instance's memory: the recovery
  // itself must wake it, with no further send.
  await resumed.whenIdle()
  expect(queuedUsers(resumed)).toEqual([])
  expect(second.adapter.requests.length).toBeGreaterThan(0)
  const consumed = resumed.session.snapshotEvents().flatMap(event => (event.type === 'user/message' && event.data.source.kind === 'user' ? [event.data] : []))
  expect(consumed.map(message => message.id)).toEqual([queued.id])
})

it('does not wake a formless foreign context message', async () => {
  const first = await setup()
  const agent = await first.create('foreign-formless-only')
  first.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(first.service.change(agent, 1, captureExtensionSelection(null, ['skills:failed']))).rejects.toThrow('apply failed')
  // An absent form is the opaque default, not evidence that a human authored this.
  agent.inject(createUserMessage({ source: { kind: 'foreign-formless-fixture' }, content: [{ type: 'text', text: 'foreign context' }] }))
  await agent.whenIdle()
  const turns = agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length
  await first.service.recover(agent, first.service.status(agent).revision)
  await agent.whenIdle()
  expect(first.service.status(agent).ready).toBe(true)
  expect(first.adapter.requests).toHaveLength(0)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(turns)
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === EXTENSION_SESSION_WAKE_SOURCE)).toBe(false)
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'foreign-formless-fixture')).toBe(true)
})

it('does not manufacture work when only foreign context is queued', async () => {
  const first = await setup()
  const agent = await first.create('foreign-context-only')
  first.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(first.service.change(agent, 1, captureExtensionSelection(null, ['skills:failed']))).rejects.toThrow('apply failed')
  // Another plugin's model-facing context, with no authored request behind it.
  agent.inject(createUserMessage({ source: { kind: 'foreign-context-fixture', form: 'instructions' }, content: [{ type: 'text', text: 'foreign instructions' }] }))
  await agent.whenIdle()
  const turns = agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length
  await first.service.recover(agent, first.service.status(agent).revision)
  await agent.whenIdle()
  expect(first.service.status(agent).ready).toBe(true)
  // Producer-declared context is not authored input: the recovery must not wake it.
  expect(first.adapter.requests).toHaveLength(0)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(turns)
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === EXTENSION_SESSION_WAKE_SOURCE)).toBe(false)
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'foreign-context-fixture')).toBe(true)
})

it('does not wake when the busy retry leaves the session unavailable', async () => {
  const first = await setup()
  const agent = await first.create('busy-retry-fails')
  await first.service.change(agent, 1, captureExtensionSelection(null, ['skills:committed']))
  await first.service.dispose()
  // The hold owns the agent, so the next service attaches through its busy retry.
  const held = Promise.withResolvers<void>()
  const maintenance = agent.runMaintenance(() => held.promise)
  const next = new ExtensionSessionState(first.ctx, { initialSelection: first.initialSelection, applySelection: first.applySelection })
  cleanups.push(() => next.dispose())
  cleanups.push(() => {
    held.resolve()
  })
  await next.start()
  expect(next.status(agent)).toMatchObject({ ready: false, error: 'extension-session-busy' })
  // One genuine user request, parked because the session is unavailable.
  const queued = userMessage('explicit user request')
  agent.followup(queued)
  // The replay the retry performs fails, so readiness never returns.
  first.applySelection.mockRejectedValueOnce(new Error('retry apply failed'))
  held.resolve()
  await maintenance
  await vi.waitFor(() => expect(next.status(agent).error).toBe('extension-session-apply-failed'))
  await agent.whenIdle()
  // No wake may ride along: no wake marker is queued, the user's own request is
  // still parked unattempted, no second turn opens, and no model is reached.
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === EXTENSION_SESSION_WAKE_SOURCE)).toBe(false)
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user')).toBe(true)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(first.adapter.requests).toHaveLength(0)
  expect(next.status(agent).ready).toBe(false)
})

it('opens no turn when a successful recovery has nothing parked', async () => {
  const first = await setup()
  const agent = await first.create('quiet-recovery')
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  first.applySelection.mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
    throw new Error('apply failed')
  })
  const changing = first.service.change(agent, 1, captureExtensionSelection(null, ['skills:failed']))
  const failed = expect(changing).rejects.toThrow('apply failed')
  await entered.promise
  release.resolve()
  await failed
  await agent.whenIdle()
  expect(first.adapter.requests).toHaveLength(0)
  const turns = agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length
  await first.service.recover(agent, first.service.status(agent).revision)
  await agent.whenIdle()
  expect(first.service.status(agent).ready).toBe(true)
  // Nothing was parked, so the recovery must not manufacture a turn or a request.
  expect(first.adapter.requests).toHaveLength(0)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(turns)
})

it('keeps a failed recovery recoverable and validates its next checkpoint on restart', async () => {
  const first = await setup()
  const agent = await first.create('retry-recovery')
  first.applySelection.mockRejectedValueOnce(new Error('failed change'))
  await expect(first.service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('failed change')
  first.applySelection.mockRejectedValueOnce(new Error('failed recovery'))
  await expect(first.service.recover(agent, 2)).rejects.toThrow('failed recovery')
  expect(first.service.status(agent)).toMatchObject({ ready: false, recoverable: true, revision: 3 })
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(first.root)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(second.service.status(resumed)).toMatchObject({ ready: false, recoverable: true, revision: 3 })
  await second.service.recover(resumed, 3)
  expect(second.service.read(resumed)).toEqual({ revision: 4, selection: captureExtensionSelection(null, ['skills:initial']) })
})

it('does not let one incomplete session prevent healthy sessions from attaching', async () => {
  const { ctx, service, create, applySelection, initialSelection } = await setup()
  const failed = await create('failed-attachment')
  const healthy = await create('healthy-attachment')
  applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(service.change(failed, 1, captureExtensionSelection(null, []))).rejects.toThrow()
  await service.dispose()
  const next = new ExtensionSessionState(ctx, { applySelection, initialSelection })
  cleanups.push(() => next.dispose())
  await expect(next.start()).resolves.toBeUndefined()
  expect(next.status(failed)).toMatchObject({ ready: false, recoverable: true })
  expect(next.status(healthy)).toMatchObject({ ready: true, revision: 1 })
  await next.recover(failed, 2)
  expect(next.status(failed).ready).toBe(true)
})

it('does not accept a recovery checkpoint that widens the committed selection', async () => {
  const first = await setup()
  const agent = await first.create('forged-recovery')
  first.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(first.service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow()
  const binding = {
    version: 1 as const,
    ownerId: agent.id,
    revision: 3,
    phase: 'pending' as const,
    selection: captureExtensionSelection(null, ['skills:arbitrary']),
    recoveryOf: { ownerId: agent.id, revision: 2 }
  }
  agent.inject(createUserMessage({ source: { kind: EXTENSION_SESSION_SOURCE, form: 'context', binding }, content: [{ type: 'text', text: 'metadata' }] }))
  await first.ctx.sessions.flush(agent.session)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(first.root)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(second.service.status(resumed)).toMatchObject({ ready: false, recoverable: false, error: 'extension-session-corrupt' })
  await expect(second.service.recover(resumed, second.service.status(resumed).revision)).rejects.toThrow('extension-session-corrupt')
  expect(second.applySelection).not.toHaveBeenCalled()
})
it('leaves an agent it does not govern to the host while a governed agent stays gated', async () => {
  const { service, applySelection, initialSelection, createAt, create, adapter } = await setup(undefined, agent => agent.session.header.cwd !== undefined)
  const ungoverned = await create('no-cwd-agent')
  const governed = await createAt('cwd-agent', process.cwd())
  // The ungoverned agent keeps the host's own lifecycle: no capture, no state seat.
  expect(initialSelection).toHaveBeenCalledTimes(1)
  expect(service.read(ungoverned)).toBeUndefined()
  expect(service.status(ungoverned)).toEqual({ ready: false, revision: 0, recoverable: false, error: 'extension-session-ineligible' })
  expect(service.read(governed)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:initial']) })
  // Its first send reaches the model instead of being rejected and cancelled.
  const greeting = userMessage('ungoverned send')
  ungoverned.followup(greeting)
  await ungoverned.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(ungoverned.status).toBe('idle')
  expect(queuedUsers(ungoverned)).toEqual([])
  expect(applySelection).toHaveBeenCalledTimes(1)
  // The governed agent in the same host still fails closed and keeps its input.
  applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(service.change(governed, 1, captureExtensionSelection(null, []))).rejects.toThrow('apply failed')
  expect(service.status(governed)).toMatchObject({ ready: false, recoverable: true, revision: 2 })
  const held = userMessage('governed send while unavailable')
  governed.followup(held)
  await governed.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(queuedUsers(governed)).toEqual([held])
})

it('keeps an undecidable eligibility on the fail-closed path', async () => {
  const { service, initialSelection, adapter, create } = await setup(undefined, () => {
    throw new Error('eligibility unavailable')
  })
  initialSelection.mockRejectedValueOnce(new Error('capture failed'))
  const agent = await create('undecidable-eligibility')
  expect(service.status(agent).error).not.toBe('extension-session-ineligible')
  const held = userMessage('send while capture is undecidable')
  agent.followup(held)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  expect(queuedUsers(agent)).toEqual([held])
  // Undecidable is governed, not ineligible: the seat is denied, never granted.
  expect(() => service.read(agent)).toThrow('extension-session-not-ready')
})
