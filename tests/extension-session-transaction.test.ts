/**
 * The apply/commit/rollback lease an adapter can hold over one selection change.
 *
 * Disk writes and resource effects share no transaction, so the state machine hands
 * the adapter a receipt: it publishes with `commit()` only once the committed
 * binding is durable, and unwinds with `rollback()` on any earlier failure. An
 * adapter that returns nothing keeps owning its own rollback, which is why a failed
 * `applySelection` must not produce a rollback call here.
 *
 * Both halves run against the real service and a real session log; only the
 * adapter's own effect is a double.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { captureExtensionSelection, type ExtensionSelection } from '../src/contracts/extension-presets.js'
import { ExtensionSessionState, type ExtensionApplyReceipt, type ExtensionSessionStatePorts } from '../src/runtime/host/extension-session-state.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
class NullAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
/** Snapshot a flushed session root so a later host replays it as a committed binding. */
async function crashCopy(root: string): Promise<string> {
  const copy = await mkdtemp(join(tmpdir(), 'extension-transaction-crash-'))
  cleanups.push(() => rm(copy, { recursive: true, force: true }))
  await cp(root, copy, { recursive: true })
  return copy
}

/** One receipt double, with the two calls counted separately. */
function receipt(): ExtensionApplyReceipt & { commits: number; rollbacks: number } {
  const record = {
    commits: 0,
    rollbacks: 0,
    commit(): void {
      record.commits += 1
    },
    async rollback(): Promise<void> {
      record.rollbacks += 1
    }
  }
  return record
}

async function setup(savedRoot?: string) {
  const root = savedRoot ?? (await mkdtemp(join(tmpdir(), 'extension-transaction-')))
  if (!savedRoot) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new NullAdapter())
  const initialSelection = vi.fn(async (): Promise<ExtensionSelection> => captureExtensionSelection(null, ['skills:initial']))
  const applySelection = vi.fn(async (): Promise<void | ExtensionApplyReceipt> => {})
  return { root, ctx, initialSelection, applySelection }
}
/** The two ports a transaction test varies; everything else keeps its production default. */
interface FixturePorts {
  initialSelection: ExtensionSessionStatePorts['initialSelection']
  applySelection: ExtensionSessionStatePorts['applySelection']
}
function makeService(ctx: Context, ports: FixturePorts, committed?: ExtensionSessionStatePorts['committed']) {
  const service = new ExtensionSessionState(ctx, { ...ports, ...(committed === undefined ? {} : { committed }) })
  cleanups.push(() => service.dispose())
  return service
}

it('rolls back the applied effect when the committed binding cannot be flushed', async () => {
  const { ctx, initialSelection, applySelection } = await setup()
  // One receipt per transaction: the initial attach takes its own, so the failure
  // under test is observed on the change's lease alone.
  const leases: Array<ReturnType<typeof receipt>> = []
  applySelection.mockImplementation(async () => {
    const lease = receipt()
    leases.push(lease)
    return lease
  })
  const service = makeService(ctx, { initialSelection, applySelection })
  await service.start()
  const agent = await ctx.agentLoop.create(SessionId('flush-failure'), { provider: 'mock', model: 'test' })
  await vi.waitFor(() => expect(service.status(agent).ready).toBe(true))
  // The pending binding flushes; the committed one does not reach disk.
  const flush = vi.spyOn(ctx.sessions, 'flush')
  flush.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  await expect(service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('extension-session-persistence-unavailable')
  const lease = leases.at(-1)!
  // The effect is undone exactly once, and the session stays fail-closed.
  expect(lease.rollbacks).toBe(1)
  expect(lease.commits).toBe(0)
  expect(service.status(agent).ready).toBe(false)
  expect(service.status(agent).recoverable).toBe(true)
})

it('does not roll back an apply that failed before handing back a receipt', async () => {
  const { ctx, initialSelection, applySelection } = await setup()
  const lease = receipt()
  // The adapter rejects instead of returning: no receipt exists, so unwinding is its
  // own responsibility and this service must not call a rollback it never received.
  applySelection.mockImplementationOnce(async () => lease).mockRejectedValueOnce(new Error('apply failed'))
  const service = makeService(ctx, { initialSelection, applySelection })
  await service.start()
  const agent = await ctx.agentLoop.create(SessionId('apply-failure'), { provider: 'mock', model: 'test' })
  await vi.waitFor(() => expect(service.status(agent).ready).toBe(true))
  const before = lease.rollbacks
  await expect(service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('apply failed')
  expect(lease.rollbacks).toBe(before)
  expect(service.status(agent).ready).toBe(false)
})

it('publishes the receipt once, after durability and before this service republishes state', async () => {
  const { ctx, initialSelection, applySelection } = await setup()
  const leases: Array<ReturnType<typeof receipt>> = []
  const order: string[] = []
  applySelection.mockImplementation(async () => {
    const lease = receipt()
    leases.push(lease)
    order.push('apply')
    return lease
  })
  const committed = vi.fn(() => {
    order.push('committed-callback')
    const current = leases.at(-1)!
    expect(current.commits, 'the effect must be published before the ready callback').toBe(1)
    expect(current.rollbacks).toBe(0)
  })
  const service = makeService(ctx, { initialSelection, applySelection }, committed)
  await service.start()
  const agent = await ctx.agentLoop.create(SessionId('success'), { provider: 'mock', model: 'test' })
  await vi.waitFor(() => expect(service.status(agent).ready).toBe(true))
  await service.change(agent, 1, captureExtensionSelection(null, ['skills:kept']))
  const lease = leases.at(-1)!
  expect(lease.commits).toBe(1)
  expect(lease.rollbacks).toBe(0)
  expect(order).toEqual(['apply', 'committed-callback', 'apply', 'committed-callback'])
  expect(service.read(agent)?.selection.enabledIds).toEqual(['skills:kept'])
})

it('publishes, and never unwinds, a replayed committed selection on restore', async () => {
  // A real committed binding: the session commits through the ordinary path, then the
  // log is replayed by a fresh service, which is the restore branch.
  const first = await setup()
  const agent = await first.ctx.agentLoop.create(SessionId('restore-ok'), { provider: 'mock', model: 'test' })
  first.applySelection.mockImplementation(async () => receipt())
  const service = makeService(first.ctx, { initialSelection: first.initialSelection, applySelection: first.applySelection })
  await service.start()
  await vi.waitFor(() => expect(service.status(agent).ready).toBe(true))
  await service.change(agent, 1, captureExtensionSelection(null, ['skills:committed']))
  await first.ctx.sessions.flush(agent.session)
  const crashed = await crashCopy(first.root)
  await service.dispose()
  await first.ctx.fiber.dispose()

  const second = await setup(crashed)
  const leases: Array<ReturnType<typeof receipt>> = []
  second.applySelection.mockImplementation(async () => {
    const lease = receipt()
    leases.push(lease)
    return lease
  })
  const restarted = makeService(second.ctx, { initialSelection: second.initialSelection, applySelection: second.applySelection })
  await restarted.start()
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  await vi.waitFor(() => expect(restarted.status(resumed).ready).toBe(true))
  // Restoring republishes the committed effect exactly once and never unwinds it.
  expect(leases).toHaveLength(1)
  expect(leases[0]!.commits).toBe(1)
  expect(leases[0]!.rollbacks).toBe(0)
  expect(restarted.read(resumed)?.selection.enabledIds).toEqual(['skills:committed'])
})

it('unwinds a replayed committed selection when the restore is interrupted', async () => {
  const first = await setup()
  const agent = await first.ctx.agentLoop.create(SessionId('restore-unwind'), { provider: 'mock', model: 'test' })
  first.applySelection.mockImplementation(async () => receipt())
  const service = makeService(first.ctx, { initialSelection: first.initialSelection, applySelection: first.applySelection })
  await service.start()
  await vi.waitFor(() => expect(service.status(agent).ready).toBe(true))
  await service.change(agent, 1, captureExtensionSelection(null, ['skills:committed']))
  await first.ctx.sessions.flush(agent.session)
  const crashed = await crashCopy(first.root)
  await service.dispose()
  await first.ctx.fiber.dispose()

  const second = await setup(crashed)
  const lease = receipt()
  // The restart order the product uses: the session is resumed first, then the service
  // attaches to the agents already present, so the restore runs inside the maintenance
  // transaction and its signal is the abortable one.
  const resumed = (await second.ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { provider: 'mock', model: 'test' } })).agent
  second.applySelection.mockImplementation(async (...args: unknown[]) => {
    // The restore applies its effect, then is interrupted before the replayed
    // selection is installed: what was applied must be undone.
    ;(args[0] as Agent).cancel({ kind: 'disposed' }, { keepInbox: true })
    return lease
  })
  const restarted = makeService(second.ctx, { initialSelection: second.initialSelection, applySelection: second.applySelection })
  await restarted.start()
  await vi.waitFor(() => expect(lease.rollbacks).toBe(1))
  expect(lease.commits).toBe(0)
  // Fail-closed: the interrupted restore authorizes nothing.
  expect(restarted.status(resumed).ready).toBe(false)
})

it('rolls back when the transaction is aborted after the effect was applied', async () => {
  const { ctx, initialSelection, applySelection } = await setup()
  const leases: Array<ReturnType<typeof receipt>> = []
  let attached = false
  applySelection.mockImplementation(async (...args: unknown[]) => {
    const lease = receipt()
    leases.push(lease)
    // The initial attach passes through untouched; the change under test is aborted
    // mid-transaction, after its effect was applied.
    if (attached) (args[0] as { cancel: (cause: unknown, options: unknown) => void }).cancel({ kind: 'disposed' }, { keepInbox: true })
    attached = true
    return lease
  })
  const service = makeService(ctx, { initialSelection, applySelection })
  await service.start()
  const agent = await ctx.agentLoop.create(SessionId('aborted'), { provider: 'mock', model: 'test' })
  await vi.waitFor(() => expect(service.status(agent).ready).toBe(true))
  await expect(service.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow()
  const lease = leases.at(-1)!
  expect(lease.rollbacks).toBe(1)
  expect(lease.commits).toBe(0)
})
