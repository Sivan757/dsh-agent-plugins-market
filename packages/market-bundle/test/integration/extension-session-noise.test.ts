/**
 * The durable selection envelope never becomes model text.
 *
 * Each transaction writes the same envelope twice — a pending intent and its
 * committed acknowledgement — through the model-facing injection channel, and
 * the envelope's payload lives in `source.binding`. The claimed copy is
 * dropped before the step commits, so the request carries the user's turn and
 * no placeholder line, while the inbox splice stays the durable record every
 * recovery path reads. These cases drive the real loop with a recording
 * adapter and then restart, fork, compact, or replay a log written the old way.
 */
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, SessionLogOffset, buildForkSeed } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { captureExtensionSelection } from '../../../../packages/market-contracts/src/contracts/extension-presets.js'
import {
  EXTENSION_INTENT_SOURCE,
  EXTENSION_SESSION_SOURCE,
  EXTENSION_SESSION_WAKE_SOURCE,
  ExtensionSessionState
} from '../../../../packages/market-runtime/src/runtime/host/extension-session-state.js'
import { removeTempRoot } from './helpers/temp-root.js'

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
/** The placeholder line both transaction phases carried before this change. */
const PLACEHOLDER = 'Session extension selection metadata.'
const userMessage = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
/** Every text block the model actually received, across all recorded requests. */
const requestText = (adapter: RecordingAdapter): string => JSON.stringify(adapter.requests.map(request => request.messages))
/**
 * Every durable message the three bookkeeping sources left behind.
 *
 * They exist to record an event and are removed before a request, so the safest
 * shape is a message a model could read as nothing at all: an empty block list.
 * A sentence here would be text a model acts on if the filter ever missed.
 */
function bookkeepingMessages(agent: Agent): Array<{ kind: string; blocks: number }> {
  const seen: Array<{ kind: string; blocks: number }> = []
  const wanted = new Set<string>([EXTENSION_SESSION_SOURCE, EXTENSION_SESSION_WAKE_SOURCE, EXTENSION_INTENT_SOURCE])
  for (const event of agent.session.snapshotEvents()) {
    // Every injection and steer reaches the durable log as an inbox splice; a
    // committed one also lands on the surface. Both carry the same content, so
    // both are inspected.
    const inserted = event.type === 'agent/inbox/spliced' ? event.data.inserted : event.type === 'user/message' ? [event.data] : []
    for (const message of inserted) {
      const kind = message.source.kind
      if (!wanted.has(kind)) continue
      seen.push({ kind, blocks: message.content.length })
    }
  }
  return seen
}

/** The durable envelopes carried by inbox splices, in log order. */
function splicedBindings(agent: Agent): Array<{ ownerId: string; revision: number; phase: string }> {
  const bindings: Array<{ ownerId: string; revision: number; phase: string }> = []
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'agent/inbox/spliced') continue
    for (const message of event.data.inserted) {
      if (message.source.kind !== EXTENSION_SESSION_SOURCE) continue
      bindings.push({ ownerId: message.source.binding.ownerId, revision: message.source.binding.revision, phase: message.source.binding.phase })
    }
  }
  return bindings
}
/** Envelope copies already committed to the model-visible surface. */
function surfaceCopies(agent: Agent): number {
  return agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === EXTENSION_SESSION_SOURCE).length
}
async function setup(savedRoot?: string) {
  const root = savedRoot ?? (await mkdtemp(join(tmpdir(), 'extension-noise-')))
  if (!savedRoot) cleanups.push(() => removeTempRoot(root))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const initialSelection = vi.fn(async () => captureExtensionSelection(null, ['skills:global']))
  const applySelection = vi.fn(async () => {})
  const service = new ExtensionSessionState(ctx, { initialSelection, applySelection })
  cleanups.push(() => service.dispose())
  const create = (id: string) => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' })
  return { root, ctx, service, adapter, initialSelection, applySelection, create }
}
/** Snapshot a flushed session root so a later host replays what a crash left behind. */
async function crashCopy(root: string): Promise<string> {
  const holder = await mkdtemp(join(tmpdir(), 'extension-noise-copy-'))
  cleanups.push(() => removeTempRoot(holder))
  const copy = join(holder, 'session-root')
  await cp(root, copy, { recursive: true })
  return copy
}

it('runs the user turn without carrying either transaction envelope into the request', async () => {
  const f = await setup()
  await f.service.start()
  const agent = await f.create('noise')
  expect(splicedBindings(agent)).toEqual([
    { ownerId: 'noise', revision: 1, phase: 'pending' },
    { ownerId: 'noise', revision: 1, phase: 'committed' }
  ])
  agent.followup(userMessage('Review the diff.'))
  await agent.whenIdle()
  expect(f.adapter.requests.length).toBeGreaterThan(0)
  const seen = requestText(f.adapter)
  expect(seen).toContain('Review the diff.')
  expect(seen).not.toContain(PLACEHOLDER)
  expect(surfaceCopies(agent)).toBe(0)
  expect(f.service.read(agent)?.revision).toBe(1)
})

it('recovers the committed choice from the inbox splice alone after a cold restart', async () => {
  const first = await setup()
  await first.service.start()
  const agent = await first.create('cold')
  agent.followup(userMessage('First turn.'))
  await agent.whenIdle()
  await first.ctx.sessions.flush(agent.session)
  const root = await crashCopy(first.root)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(root)
  await second.service.start()
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  expect(second.service.read(resumed)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:global']) })
  expect(second.initialSelection).not.toHaveBeenCalled()
  resumed.followup(userMessage('Turn after restart.'))
  await resumed.whenIdle()
  expect(requestText(second.adapter)).toContain('Turn after restart.')
  expect(requestText(second.adapter)).not.toContain(PLACEHOLDER)
  expect(surfaceCopies(resumed)).toBe(0)
})

it('replays the splice for a forked child and for a reloaded plugin instance', async () => {
  const f = await setup()
  await f.service.start()
  const parent = await f.create('parent')
  await f.service.change(parent, 1, captureExtensionSelection(null, ['skills:chosen']))
  parent.followup(userMessage('Parent turn.'))
  await parent.whenIdle()
  expect(surfaceCopies(parent)).toBe(0)
  const events = parent.session.snapshotEvents()
  const child = (
    await f.ctx.agents.create({
      sessionId: SessionId('forked'),
      meta: { parentSession: parent.id, isSeeded: true, cwd: parent.session.header.cwd },
      seed: buildForkSeed(events, events.at(-1)!.seq),
      inheritedEventCount: SessionLogOffset(events.length),
      agentOptions: { provider: 'mock', model: 'test' }
    })
  ).agent
  expect(f.service.read(child)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:chosen']) })
  child.followup(userMessage('Child turn.'))
  await child.whenIdle()
  expect(requestText(f.adapter)).toContain('Child turn.')
  expect(requestText(f.adapter)).not.toContain(PLACEHOLDER)
  expect(surfaceCopies(child)).toBe(0)
  // Only the two start sources a clear or compaction announces re-run initialization
  // here; the surface rewrite a real host clear performs is not simulated.
  await agentEvents(f.ctx, child).serial('agent/created', { source: 'compact' })
  await f.service.initialize(child, 'clear')
  expect(f.service.read(child)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:chosen']) })
  // A reloaded plugin instance replays both live logs after the old one is gone.
  await f.service.dispose()
  const replacement = new ExtensionSessionState(f.ctx, { initialSelection: f.initialSelection, applySelection: f.applySelection })
  cleanups.push(() => replacement.dispose())
  await replacement.start()
  expect(replacement.read(parent)).toEqual({ revision: 2, selection: captureExtensionSelection(null, ['skills:chosen']) })
  expect(replacement.read(child)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:chosen']) })
})

it('keeps an interrupted pending transaction unavailable and unacknowledged', async () => {
  const first = await setup()
  await first.service.start()
  const agent = await first.create('pending')
  first.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(first.service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('apply failed')
  expect(() => first.service.read(agent)).toThrow('extension-session-not-ready')
  await first.ctx.sessions.flush(agent.session)
  const root = await crashCopy(first.root)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(root)
  await second.service.start()
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id })).agent
  expect(() => second.service.read(resumed)).toThrow('extension-session-not-ready')
  expect(second.applySelection).not.toHaveBeenCalled()
})

it('still replays a log that holds both old surface copies and their splices', async () => {
  const first = await setup()
  await first.service.start()
  const agent = await first.create('legacy-copies')
  const choice = captureExtensionSelection(null, ['skills:legacy'])
  await first.service.change(agent, 1, choice)
  // Rewrite the log the way the previous release did: the claimed envelope was
  // appended to the surface as well, so one identity appears twice.
  for (const message of [...agent.inbox.nextStep]) {
    if (message.source.kind !== EXTENSION_SESSION_SOURCE) continue
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  }
  await first.ctx.sessions.flush(agent.session)
  const root = await crashCopy(first.root)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(root)
  await second.service.start()
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id })).agent
  expect(second.service.read(resumed)).toEqual({ revision: 2, selection: choice })
  expect(second.initialSelection).not.toHaveBeenCalled()
})

it('parks a user turn instead of discarding it while the session is unavailable', async () => {
  const f = await setup()
  await f.service.start()
  const agent = await f.create('unavailable')
  f.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(f.service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('apply failed')
  expect(() => f.service.read(agent)).toThrow('extension-session-not-ready')
  agent.followup(userMessage('Keep this turn.'))
  await agent.whenIdle()
  // The reject path still parks the claimed batch: nothing was answered or dropped.
  expect(agent.inbox.nextStep.concat(agent.inbox.nextTurn).map(message => message.source.kind)).toContain('user')
  expect(f.adapter.requests).toHaveLength(0)
})

it('gives every bookkeeping message no content a model could read', async () => {
  const f = await setup()
  await f.service.start()
  const agent = await f.create('bookkeeping')
  agent.followup(userMessage('Review the diff.'))
  await agent.whenIdle()
  const messages = bookkeepingMessages(agent)
  // The selection envelope was recorded, so the durable evidence survives.
  expect(messages.length).toBeGreaterThan(0)
  expect(messages.every(entry => entry.kind === EXTENSION_SESSION_SOURCE)).toBe(true)
  // And none of them carries a block, so no sentence can reach a request.
  expect(messages.every(entry => entry.blocks === 0)).toBe(true)
  const seen = requestText(f.adapter)
  expect(seen).toContain('Review the diff.')
  for (const sentence of ['Session extension selection metadata.', 'Session extension selection request.', 'Session extension readiness restored.']) {
    expect(seen).not.toContain(sentence)
  }
})
