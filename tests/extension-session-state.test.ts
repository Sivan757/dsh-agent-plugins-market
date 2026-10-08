import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, SessionLogOffset, buildForkSeed } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { captureExtensionSelection, type ExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { ExtensionSessionState, EXTENSION_SESSION_SOURCE } from '../packages/market-runtime/src/runtime/host/extension-session-state.js'
class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})
async function setup(savedRoot?: string) {
  const root = savedRoot ?? (await mkdtemp(join(tmpdir(), 'extension-session-')))
  if (!savedRoot) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  // Typed parameters keep mock.calls readable, so a case can compare the arguments
  // two capture attempts received without casting the call tuple back to unknown[].
  const initialSelection = vi.fn<(agent: unknown, source?: string) => Promise<ExtensionSelection>>(async () => captureExtensionSelection(null, ['skills:global']))
  const applySelection = vi.fn(async () => {})
  const service = new ExtensionSessionState(ctx, { initialSelection, applySelection })
  cleanups.push(() => service.dispose())
  await service.start()
  return { ctx, service, root, initialSelection, applySelection }
}
it('persists detached choices across a cold host restart without waking the model', async () => {
  const first = await setup()
  const agent = await first.ctx.agentLoop.create(SessionId('one'), { provider: 'mock', model: 'test' })
  expect(first.service.read(agent)?.revision).toBe(1)
  const choice = captureExtensionSelection({ id: 'preset', name: 'Name', revision: 2, enabledIds: ['skills:chosen'] }, [])
  await first.service.change(agent, 1, choice)
  choice.enabledIds.push('skills:later')
  expect(agent.status).toBe('idle')
  expect(agent.session.snapshotEvents().some(event => event.type === 'turn/start' || event.type === 'step/start')).toBe(false)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(first.root)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id })).agent
  expect(second.service.read(resumed)).toEqual({ revision: 2, selection: { ...choice, enabledIds: ['skills:chosen'] } })
  expect(second.initialSelection).not.toHaveBeenCalled()
  expect(resumed.status).toBe('idle')
})
it('isolates agents and rejects stale revisions and active maintenance', async () => {
  const { ctx, service } = await setup()
  const a = await ctx.agentLoop.create(SessionId('a'), { provider: 'mock', model: 'test' })
  const b = await ctx.agentLoop.create(SessionId('b'), { provider: 'mock', model: 'test' })
  expect(a.session.header.cwd).toBe(b.session.header.cwd)
  await service.change(a, 1, captureExtensionSelection(null, []))
  expect(service.read(b)?.selection.enabledIds).toEqual(['skills:global'])
  await expect(service.change(a, 1, captureExtensionSelection(null, []))).rejects.toMatchObject({ code: 'extension-session-conflict' })
  const held = Promise.withResolvers<void>()
  const maintenance = a.runMaintenance(() => held.promise)
  await expect(service.change(a, 2, captureExtensionSelection(null, []))).rejects.toMatchObject({ code: 'extension-session-busy' })
  held.resolve()
  await maintenance
})
it('rebinds the latest inherited snapshot and retains it on clear and compact', async () => {
  const { ctx, service, initialSelection, root } = await setup()
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'test' })
  await service.change(parent, 1, captureExtensionSelection(null, ['skills:inherited']))
  const events = parent.session.snapshotEvents()
  const child = (
    await ctx.agents.create({
      sessionId: SessionId('child'),
      meta: { parentSession: parent.id, isSeeded: true, cwd: parent.session.header.cwd },
      seed: buildForkSeed(events, events.at(-1)!.seq),
      inheritedEventCount: SessionLogOffset(events.length),
      agentOptions: { provider: 'mock', model: 'test' }
    })
  ).agent
  expect(service.read(child)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:inherited']) })
  expect(initialSelection).toHaveBeenCalledTimes(1)
  await service.initialize(child, 'clear')
  await service.initialize(child, 'compact')
  expect(service.read(child)?.revision).toBe(1)
  await service.change(child, 1, captureExtensionSelection(null, []))
  expect(service.read(parent)?.selection.enabledIds).toEqual(['skills:inherited'])
  await service.dispose()
  await ctx.fiber.dispose()
  const restarted = await setup(root)
  const resumed = (await restarted.ctx.agents.resume({ resumeSessionId: child.id })).agent
  expect(restarted.service.read(resumed)).toEqual({ revision: 2, selection: captureExtensionSelection(null, []) })
})
it('retains corrupt sessions as unavailable on cold restart', async () => {
  const first = await setup()
  const agent = await first.ctx.agentLoop.create(SessionId('corrupt'), { provider: 'mock', model: 'test' })
  agent.inject(
    createUserMessage({
      source: {
        kind: EXTENSION_SESSION_SOURCE,
        form: 'context',
        binding: { version: 1, ownerId: 'wrong-owner', revision: 2, phase: 'pending', selection: captureExtensionSelection(null, []) }
      },
      content: [{ type: 'text', text: 'metadata' }]
    })
  )
  await first.ctx.sessions.flush(agent.session)
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(first.root)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id })).agent
  expect(() => second.service.read(resumed)).toThrow('extension-session-not-ready')
  expect(second.applySelection).not.toHaveBeenCalled()
})
it('fails closed on apply failure and keeps unfinished transactions unavailable after restart', async () => {
  const first = await setup()
  const agent = await first.ctx.agentLoop.create(SessionId('failed'), { provider: 'mock', model: 'test' })
  first.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  await expect(first.service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('apply failed')
  expect(() => first.service.read(agent)).toThrow('extension-session-not-ready')
  await first.service.dispose()
  await first.ctx.fiber.dispose()
  const second = await setup(first.root)
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id })).agent
  expect(() => second.service.read(resumed)).toThrow('extension-session-not-ready')
  expect(second.applySelection).not.toHaveBeenCalled()
})
it('reports legacy for existing history and awaits readiness before publishing a snapshot', async () => {
  const { ctx, service } = await setup()
  await service.dispose()
  const agent = await ctx.agentLoop.create(SessionId('legacy'), { provider: 'mock', model: 'test' })
  agent.inject(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'old history' }] }))
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const initialSelection = vi.fn(async () => {
    entered.resolve()
    await release.promise
    return captureExtensionSelection(null, ['skills:old'])
  })
  const next = new ExtensionSessionState(ctx, { initialSelection, applySelection: async () => {} })
  cleanups.push(() => next.dispose())
  const starting = next.start()
  await entered.promise
  expect(() => next.read(agent)).toThrow('extension-session-not-ready')
  release.resolve()
  await starting
  expect(initialSelection).toHaveBeenCalledWith(agent, 'legacy')
  expect(next.read(agent)?.selection.enabledIds).toEqual(['skills:old'])
})
it('does not acknowledge failed durability or expose the partially applied choice', async () => {
  const { ctx, service, applySelection } = await setup()
  const agent = await ctx.agentLoop.create(SessionId('flush'), { provider: 'mock', model: 'test' })
  const flush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValueOnce(false)
  await expect(service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('extension-session-persistence-unavailable')
  expect(() => service.read(agent)).toThrow('extension-session-not-ready')
  expect(applySelection).toHaveBeenCalledTimes(1)
  flush.mockRestore()
})
it('attaches a busy agent once its running maintenance ends', async () => {
  const { ctx, applySelection, initialSelection } = await setup()
  const agent = await ctx.agentLoop.create(SessionId('busy-attach'), { provider: 'mock', model: 'test' })
  const held = Promise.withResolvers<void>()
  const maintenance = agent.runMaintenance(() => held.promise)
  const next = new ExtensionSessionState(ctx, { applySelection, initialSelection })
  cleanups.push(() => next.dispose())
  await next.start()
  expect(next.status(agent)).toMatchObject({ ready: false, error: 'extension-session-busy' })
  expect(() => next.read(agent)).toThrow('extension-session-not-ready')
  held.resolve()
  await maintenance
  await vi.waitFor(() => expect(next.status(agent).ready).toBe(true))
  expect(next.read(agent)?.revision).toBe(1)
  expect(initialSelection).toHaveBeenCalledTimes(1)
})
it('retries the initial capture only when an explicit recovery follows its failure', async () => {
  const first = await setup()
  first.initialSelection.mockRejectedValueOnce(new Error('capture failed'))
  const agent = await first.ctx.agentLoop.create(SessionId('capture-recovery'), { provider: 'mock', model: 'test' })
  await agent.whenIdle()
  // The capture failed before it recorded anything, so the session is denied and
  // the recorded error is the only thing an explicit recovery may act on.
  expect(first.service.status(agent)).toMatchObject({ ready: false, recoverable: true, revision: 0, error: 'extension-session-apply-failed' })
  expect(() => first.service.read(agent)).toThrow('extension-session-not-ready')
  // Nothing retries on its own, however long the session stays idle.
  expect(first.initialSelection).toHaveBeenCalledTimes(1)
  await agent.whenIdle()
  expect(first.initialSelection).toHaveBeenCalledTimes(1)
  expect(await first.service.recover(agent, 0)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:global']) })
  expect(first.service.status(agent)).toMatchObject({ ready: true, revision: 1 })
  expect(first.initialSelection).toHaveBeenCalledTimes(2)
})
it('replays the original capture classification when parked input made the log nonempty', async () => {
  const first = await setup()
  first.initialSelection.mockRejectedValueOnce(new Error('capture failed'))
  const agent = await first.ctx.agentLoop.create(SessionId('capture-source'), { provider: 'mock', model: 'test' })
  await agent.whenIdle()
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued while denied' }] }))
  await agent.whenIdle()
  expect(await first.service.recover(agent, 0)).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:global']) })
  // The parked message made the log nonempty; the retry must still classify this
  // session exactly as the failed attempt did, never as pre-existing history.
  expect(first.initialSelection.mock.calls[1]?.[1]).toBe(first.initialSelection.mock.calls[0]?.[1])
  expect(first.initialSelection.mock.calls[1]?.[1]).not.toBe('legacy')
})
it('wakes input stranded during a busy attach once its retry restores readiness', async () => {
  const first = await setup()
  const agent = await first.ctx.agentLoop.create(SessionId('busy-stranded'), { provider: 'mock', model: 'test' })
  await first.service.dispose()
  // The hold owns the agent, so the next service attaches through its busy retry.
  const held = Promise.withResolvers<void>()
  const maintenance = agent.runMaintenance(() => held.promise)
  const next = new ExtensionSessionState(first.ctx, { initialSelection: first.initialSelection, applySelection: first.applySelection })
  cleanups.push(() => next.dispose())
  await next.start()
  expect(next.status(agent)).toMatchObject({ ready: false, error: 'extension-session-busy' })
  // Input sent while the agent is busy latches and is claimed by the first step
  // after the hold, which this still-unavailable service parks.
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'stranded while busy' }] }))
  held.resolve()
  await maintenance
  await vi.waitFor(() => expect(next.status(agent).ready).toBe(true))
  await agent.whenIdle()
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn]).toEqual([])
})
it('does not advertise recovery for a busy attach that never attempted a capture', async () => {
  const first = await setup()
  const agent = await first.ctx.agentLoop.create(SessionId('busy-not-capture'), { provider: 'mock', model: 'test' })
  expect(first.initialSelection).toHaveBeenCalledTimes(1)
  await first.service.dispose()
  const held = Promise.withResolvers<void>()
  const maintenance = agent.runMaintenance(() => held.promise)
  const next = new ExtensionSessionState(first.ctx, { initialSelection: first.initialSelection, applySelection: first.applySelection })
  cleanups.push(() => next.dispose())
  // Release the hold before any teardown: a failed assertion must not leave the
  // agent with an active maintenance for the context's disposal to wait on.
  cleanups.push(() => {
    held.resolve()
  })
  await next.start()
  expect(next.status(agent)).toMatchObject({ ready: false, error: 'extension-session-busy' })
  // No capture was ever attempted by this service, so there is no capture to retry:
  // the automatic attach retry owns this state and an explicit recovery must not
  // claim it, nor reach a capture that would have no checkpoint to record into.
  expect(next.status(agent).recoverable).toBe(false)
  held.resolve()
  await maintenance
  await vi.waitFor(() => expect(next.status(agent).ready).toBe(true))
  // The retry replays the durable record; nothing recaptures.
  expect(first.initialSelection).toHaveBeenCalledTimes(1)
})
it('keeps a retried capture unavailable until its commit is durable', async () => {
  const first = await setup()
  first.initialSelection.mockRejectedValueOnce(new Error('capture failed'))
  const agent = await first.ctx.agentLoop.create(SessionId('capture-durable'), { provider: 'mock', model: 'test' })
  await agent.whenIdle()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  first.applySelection.mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
  })
  const recovering = first.service.recover(agent, 0)
  await entered.promise
  // The retry is mid-flight, so the session stays denied and unreadable.
  expect(first.service.status(agent).ready).toBe(false)
  expect(() => first.service.read(agent)).toThrow('extension-session-not-ready')
  release.resolve()
  expect(await recovering).toEqual({ revision: 1, selection: captureExtensionSelection(null, ['skills:global']) })
  expect(first.service.status(agent)).toMatchObject({ ready: true, revision: 1 })
})
it('keeps a retried capture failure recorded without looping', async () => {
  const first = await setup()
  first.initialSelection.mockRejectedValue(new Error('capture failed again'))
  const agent = await first.ctx.agentLoop.create(SessionId('capture-fails-again'), { provider: 'mock', model: 'test' })
  await agent.whenIdle()
  await expect(first.service.recover(agent, 0)).rejects.toThrow('capture failed again')
  expect(first.initialSelection).toHaveBeenCalledTimes(2)
  await agent.whenIdle()
  // The retry is caller-driven: a repeated failure never schedules another attempt.
  expect(first.initialSelection).toHaveBeenCalledTimes(2)
  expect(first.service.status(agent)).toMatchObject({ ready: false, recoverable: true, error: 'extension-session-apply-failed' })
})
