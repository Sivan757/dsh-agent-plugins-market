/**
 * The extension window's `started` answer must not depend on how it is computed.
 *
 * The wire field means "this session carries authored progress": a started turn,
 * or a user/inbox message this plugin did not author. The reference below states
 * that definition independently of the production reader, and every case drives
 * the real `ExtensionRuntime.window()` and asserts the two agree. A projection,
 * a cache or a narrower read may replace the current full-log scan only while
 * these cases keep passing.
 *
 * @module tests/extension-window-progress
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { Session } from '@deepseek-ai/dsh-session'
import { ExtensionRuntime } from '../packages/market-runtime/src/runtime/host/extension-runtime.js'
import { EXTENSION_PROGRESS_KEY, ExtensionProgressReader, eventCarriesProgress, scanExtensionProgress } from '../packages/market-runtime/src/runtime/host/extension-progress.js'
import { EXTENSION_SESSION_SOURCE } from '../packages/market-runtime/src/runtime/host/extension-session-state.js'
import type { ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'

/** The definition the wire field has always carried, written out independently. */
export function referenceStarted(events: readonly SessionEvent[]): boolean {
  return events.some(event => {
    if (event.type === 'turn/start') return true
    const messages = event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
    return messages.some(message => message.source.kind !== EXTENSION_SESSION_SOURCE && !('form' in message.source))
  })
}

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}

class MockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Wait, briefly and boundedly, for an asynchronous lifecycle callback to settle. */
async function settle(until: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !until(); attempt++) await new Promise(resolve => setTimeout(resolve, 1))
}

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-window-progress-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter())
  const resources: ExtensionResource[] = [
    { id: 'skills:one', face: 'skills', name: 'One', source: 'suite', available: true, detail: { kind: 'panel', panel: 'skills', entryId: 'one' } }
  ]
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    inventory: async () => resources,
    applySelection: vi.fn(async () => {})
  })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const create = async (id: string, cwd = root) => await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd }, agentOptions: { provider: 'mock', model: 'test' } })
  return { root, ctx, runtime, create }
}

/** Assert the wire answer and the reference definition agree for one live agent. */
async function expectAgreement(runtime: ExtensionRuntime, agent: { id: string; session: { snapshotEvents(): readonly SessionEvent[] } }): Promise<boolean> {
  const seen = (await runtime.window(agent.id)).started
  expect(seen).toBe(referenceStarted(agent.session.snapshotEvents()))
  return seen
}

describe('extension window progress', () => {
  it('reports an initialized empty session as not started', async () => {
    const { runtime, create } = await setup()
    const { agent } = await create('blank')
    expect(agent.session.snapshotEvents().length).toBeGreaterThan(0)
    expect(await expectAgreement(runtime, agent)).toBe(false)
  })

  it('ignores the extension selection envelopes this plugin writes itself', async () => {
    const { runtime, create } = await setup()
    const { agent } = await create('metadata')
    const library = (await runtime.window(agent.id)).library
    await runtime.create(agent.id, library.revision, { name: 'progress-preset', enabledIds: ['skills:one'] })
    const preset = (await runtime.window(agent.id)).library.presets.find(row => row.name === 'progress-preset')
    if (preset === undefined) throw new Error('preset was not created')
    await runtime.select(agent.id, (await runtime.window(agent.id)).state.revision, preset.id)
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced' || event.type === 'user/message')).toBe(true)
    expect(await expectAgreement(runtime, agent)).toBe(false)
  })

  it('reports started when an authored prompt is queued before any turn starts', async () => {
    const { runtime, create } = await setup()
    const { agent } = await create('queued')
    const release = Promise.withResolvers<void>()
    const maintenance = agent.runMaintenance(() => release.promise)
    try {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
      expect(agent.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(false)
      expect(await expectAgreement(runtime, agent)).toBe(true)
    } finally {
      agent.cancel({ kind: 'disposed' }, { keepInbox: true })
      release.resolve()
      await maintenance.catch(() => {})
      await agent.whenIdle()
    }
  })

  it('stays started after the queued turn has run', async () => {
    const { runtime, create } = await setup()
    const { agent } = await create('ran')
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(true)
    expect(await expectAgreement(runtime, agent)).toBe(true)
  })

  it('gives the same answer after the session is resumed', async () => {
    const { root, ctx, runtime, create } = await setup()
    const handle = await create('resumed')
    const agent = handle.agent
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
    await agent.whenIdle()
    expect(await expectAgreement(runtime, agent)).toBe(true)
    await handle.dispose()
    await ctx.agents.resume({ resumeSessionId: SessionId('resumed'), agentOptions: { provider: 'mock', model: 'test' } })
    const resumed = ctx.agents.get(SessionId('resumed'))
    expect(resumed).toBeDefined()
    expect(resumed!.session.header.cwd ?? root).toBe(root)
    expect(await expectAgreement(runtime, resumed!)).toBe(true)
  })

  it('gives the same answer for a forked session that inherits an authored prefix', async () => {
    const { root, ctx, runtime, create } = await setup()
    const { agent: parent } = await create('forksource')
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
    await parent.whenIdle()
    const inherited = parent.session.snapshotEvents()
    expect(referenceStarted(inherited)).toBe(true)
    const child = (
      await ctx.agents.create({
        sessionId: SessionId('forkchild'),
        meta: { cwd: root, parentSession: SessionId('forksource'), isSeeded: true },
        inheritedEventCount: SessionLogOffset(inherited.length),
        seed: inherited,
        agentOptions: { provider: 'mock', model: 'test' }
      })
    ).agent
    expect(await expectAgreement(runtime, child)).toBe(true)
  })
})

describe('extension progress reader', () => {
  it('uses the log scan only when the host publishes no projection registry', async () => {
    const bare = new Context()
    cleanups.push(() => bare.fiber.dispose())
    const reader = new ExtensionProgressReader(bare)
    expect(reader.registered).toBe(false)
    const blank = Session.create(SessionId('fallback-blank'))
    blank.append('hook/invoked', { turn: 1, point: 'Stop', dialect: 'claude-code', handlerId: 'a' })
    expect(reader.read(blank)).toBe(false)
    expect(scanExtensionProgress(blank)).toBe(false)
    const authored = { snapshotEvents: () => [{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }] } as unknown as Session
    expect(reader.read(authored)).toBe(true)
    await reader.dispose()
  })

  it('folds once and stops reading the log on later window reads', async () => {
    const { runtime, create } = await setup()
    const { agent } = await create('folded')
    const reference = referenceStarted(agent.session.snapshotEvents())
    const scan = vi.spyOn(agent.session, 'snapshotEvents')
    expect((await runtime.window(agent.id)).started).toBe(reference)
    // The first read materializes the cell: at most one fold over the log.
    const afterFirst = scan.mock.calls.length
    expect(afterFirst).toBeLessThanOrEqual(1)
    for (let i = 0; i < 5; i++) expect((await runtime.window(agent.id)).started).toBe(reference)
    expect(scan.mock.calls.length).toBe(afterFirst)
    scan.mockRestore()
  })

  it('unregisters the projection when the runtime is disposed and registers it again on a new runtime', async () => {
    const { ctx, runtime, create, root } = await setup()
    const { agent } = await create('lifetime')
    expect(ctx.sessionProjections.stateOf(agent.session, EXTENSION_PROGRESS_KEY)).toEqual({ started: false })
    await runtime.dispose()
    expect(ctx.sessionProjections.stateOf(agent.session, EXTENSION_PROGRESS_KEY)).toBeUndefined()
    const second = new ExtensionRuntime(ctx, {
      dataRoot: root,
      inventory: async () => [],
      applySelection: vi.fn(async () => {})
    })
    cleanups.push(() => second.dispose())
    await second.start()
    expect(ctx.sessionProjections.stateOf(agent.session, EXTENSION_PROGRESS_KEY)).toEqual({ started: false })
    expect(await expectAgreement(second, agent)).toBe(false)
  })

  it('keeps reporting started after pending input is cleared', async () => {
    const { runtime, create } = await setup()
    const { agent } = await create('cleared')
    const release = Promise.withResolvers<void>()
    const maintenance = agent.runMaintenance(() => release.promise)
    try {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
      expect(await expectAgreement(runtime, agent)).toBe(true)
      agent.inbox.clear()
      expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn]).toHaveLength(0)
      expect(await expectAgreement(runtime, agent)).toBe(true)
    } finally {
      agent.cancel({ kind: 'disposed' }, { keepInbox: true })
      release.resolve()
      await maintenance.catch(() => {})
      await agent.whenIdle()
    }
  })

  it('folds the same definition the log scan uses', () => {
    const events = [
      { type: 'hook/invoked', seq: 0, time: 0, data: { turn: 1, point: 'Stop', dialect: 'claude-code', handlerId: 'a' } },
      { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }
    ] as unknown as readonly SessionEvent[]
    let state = { started: false }
    for (const event of events) state = { started: state.started || eventCarriesProgress(event) }
    expect(state.started).toBe(true)
  })
})

describe('extension progress reader lifecycle', () => {
  it('does not register when the registry arrives after the reader is disposed', async () => {
    const bare = new Context()
    cleanups.push(() => bare.fiber.dispose())
    const reader = new ExtensionProgressReader(bare)
    await reader.ready
    expect(reader.registered).toBe(false)
    await reader.dispose()
    await bare.plugin(SessionProjection)
    expect(reader.registered).toBe(false)
    expect(bare.get('sessionProjections')).toBeDefined()
    expect(bare.sessionProjections.stateOf(Session.create(SessionId('late-registry')), EXTENSION_PROGRESS_KEY)).toBeUndefined()
  })

  it('registers again when the registry is re-provisioned while the reader lives, and unregisters the live one', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    const first = await ctx.plugin(SessionProjection)
    const reader = new ExtensionProgressReader(ctx)
    await reader.ready
    expect(reader.registered).toBe(true)
    const session = Session.create(SessionId('cycled'))
    expect(ctx.sessionProjections.stateOf(session, EXTENSION_PROGRESS_KEY)).toEqual({ started: false })
    await first.dispose()
    expect(reader.registered).toBe(false)
    await ctx.plugin(SessionProjection)
    await settle(() => reader.registered)
    expect(reader.registered).toBe(true)
    expect(ctx.sessionProjections.stateOf(session, EXTENSION_PROGRESS_KEY)).toEqual({ started: false })
    await reader.dispose()
    expect(reader.registered).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, EXTENSION_PROGRESS_KEY)).toBeUndefined()
  })

  it('keeps answering from the log after disposal', async () => {
    const bare = new Context()
    cleanups.push(() => bare.fiber.dispose())
    const reader = new ExtensionProgressReader(bare)
    await reader.ready
    await reader.dispose()
    const session = Session.create(SessionId('after-disposal'))
    session.append('hook/invoked', { turn: 1, point: 'Stop', dialect: 'claude-code', handlerId: 'a' })
    expect(reader.read(session)).toBe(false)
  })
})
