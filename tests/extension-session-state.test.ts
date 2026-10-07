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
import { captureExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
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
  const initialSelection = vi.fn(async () => captureExtensionSelection(null, ['skills:global']))
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
