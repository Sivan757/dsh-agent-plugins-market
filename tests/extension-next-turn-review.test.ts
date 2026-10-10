/**
 * Contract for the public compare-and-swap token.
 *
 * The token a caller compares against is `selectionRevision`, durable and
 * independent of the sequential binding journal: a promoted request carries its own
 * `requestRevision`, so two requests before one boundary still hand the client a
 * token the promotion publishes, while `read().revision` stays the plain
 * sequential count. A fork drops an inherited request and starts its own token at 1.
 * Fixture: real AgentLoop, real session log, one holdable model response.
 */
import { mkdtemp, rm } from 'node:fs/promises'
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
import { captureExtensionSelection, type ExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { ExtensionSessionState, EXTENSION_INTENT_SOURCE } from '../packages/market-runtime/src/runtime/host/extension-session-state.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
/** One model response that can be held open, so a turn stays live. */
class HoldableAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  holdCall: number | undefined
  private release: (() => void) | undefined
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  resume(): void {
    const release = this.release
    this.release = undefined
    release?.()
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.holdCall === this.requests.length) {
      const gate = Promise.withResolvers<void>()
      this.release = () => gate.resolve()
      const aborted = new Promise<void>(resolve => {
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
        if (options.signal?.aborted === true) resolve()
      })
      await Promise.race([gate.promise, aborted])
    }
    options.signal?.throwIfAborted()
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
const userMessage = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const selection = (...ids: string[]) => captureExtensionSelection(null, ids)

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-next-turn-review-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new HoldableAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const applies: string[] = []
  const initialSelection = vi.fn(async () => selection('skills:initial'))
  const applySelection = vi.fn(async (_agent: Agent, next: ExtensionSelection) => {
    applies.push(next.enabledIds.join(','))
  })
  const service = new ExtensionSessionState(ctx, { initialSelection, applySelection })
  cleanups.push(() => service.dispose())
  await service.start()
  adapter.requests.length = 0
  const create = async (id: string): Promise<Agent> => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' })
  const reload = async (): Promise<ExtensionSessionState> => {
    const next = new ExtensionSessionState(ctx, { initialSelection, applySelection })
    cleanups.push(() => next.dispose())
    await next.start()
    return next
  }
  return { ctx, service, adapter, applies, initialSelection, applySelection, create, reload }
}

it('keeps the public token across a reload while the journal revision stays sequential', async () => {
  const h = await setup()
  const agent = await h.create('token-reload')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))

  expect(h.service.selectionRevision(agent)).toBe(1)
  const first = await h.service.requestSelection(agent, 1, selection('skills:one'))
  const second = await h.service.requestSelection(agent, first.revision, selection('skills:two'))
  expect(first).toEqual({ applied: false, revision: 2 })
  expect(second).toEqual({ applied: false, revision: 3 })

  h.adapter.resume()
  await agent.whenIdle()
  await vi.waitFor(() => expect(h.service.intended(agent)).toBeUndefined())
  await vi.waitFor(() => expect(h.service.read(agent)?.selection.enabledIds).toEqual(['skills:two']))
  // The journal stays sequential on purpose; the token is the public face.
  expect(h.service.read(agent)?.revision).toBe(2)
  expect(h.service.selectionRevision(agent)).toBe(3)

  const reloaded = await h.reload()
  await vi.waitFor(() => expect(reloaded.read(agent)?.selection.enabledIds).toEqual(['skills:two']))
  expect(reloaded.read(agent)?.revision).toBe(2)
  expect(reloaded.selectionRevision(agent)).toBe(3)

  await expect(reloaded.requestSelection(agent, 3, selection('skills:three'))).resolves.toEqual({ applied: true, revision: 4 })
  expect(reloaded.selectionRevision(agent)).toBe(4)
  expect(reloaded.read(agent)?.revision).toBe(3)
  await expect(reloaded.requestSelection(agent, 3, selection('skills:stale'))).rejects.toMatchObject({ code: 'extension-session-conflict' })
  expect(reloaded.read(agent)?.selection.enabledIds).toEqual(['skills:three'])
})

it('keeps a failed promotion recoverable from the durable request', async () => {
  const h = await setup()
  const agent = await h.create('failed-promotion')
  h.adapter.holdCall = 1
  agent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  await h.service.requestSelection(agent, 1, selection('skills:next'))
  // The promotion's effect fails once. The request is already durable, so the
  // failure denies the session instead of losing the request.
  h.applySelection.mockRejectedValueOnce(new Error('apply failed'))
  h.adapter.resume()
  await agent.whenIdle()
  await vi.waitFor(() => expect(h.service.status(agent).error).toBeDefined())
  expect(h.service.status(agent).ready).toBe(false)
  // The request survives in the log, which is what makes the failure recoverable.
  expect(
    agent.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === EXTENSION_INTENT_SOURCE))
  ).toBe(true)

  // A promotion that died between its durable request and its committed twin
  // leaves the documented incomplete state: deny and wait for explicit recovery,
  // never publish the request as if the boundary had succeeded.
  const reloaded = await h.reload()
  await vi.waitFor(() => expect(reloaded.status(agent).error).toBe('extension-session-incomplete'))
  expect(reloaded.status(agent).ready).toBe(false)
  expect(reloaded.status(agent).recoverable).toBe(true)
})

it('drops an inherited request and resets the token to 1 for a fork', async () => {
  const h = await setup()
  const parent = await h.create('token-parent')
  h.adapter.holdCall = 1
  parent.followup(userMessage('held request'))
  await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
  const first = await h.service.requestSelection(parent, 1, selection('skills:one'))
  await h.service.requestSelection(parent, first.revision, selection('skills:two'))
  h.adapter.resume()
  await parent.whenIdle()
  // The getter answers with the pending token before the promotion lands, so the
  // wait belongs on the effective selection and the journal revision.
  await vi.waitFor(() => expect(h.service.read(parent)?.selection.enabledIds).toEqual(['skills:two']))
  expect(h.service.read(parent)?.revision).toBe(2)
  expect(h.service.selectionRevision(parent)).toBe(3)
  expect(
    parent.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === EXTENSION_INTENT_SOURCE))
  ).toBe(true)

  const events = parent.session.snapshotEvents()
  const child = (
    await h.ctx.agents.create({
      sessionId: SessionId('token-child'),
      meta: { parentSession: parent.id, isSeeded: true, cwd: parent.session.header.cwd },
      seed: buildForkSeed(events, events.at(-1)!.seq),
      inheritedEventCount: SessionLogOffset(events.length),
      agentOptions: { provider: 'mock', model: 'test' }
    })
  ).agent
  await child.whenIdle()
  // The inherited request belongs to the parent: the child keeps the committed
  // selection and answers to its own token.
  expect(h.service.intended(child)).toBeUndefined()
  expect(h.service.read(child)?.revision).toBe(1)
  expect(h.service.selectionRevision(child)).toBe(1)
  await expect(h.service.requestSelection(child, 3, selection('skills:inherited-token'))).rejects.toMatchObject({ code: 'extension-session-conflict' })
  await expect(h.service.requestSelection(child, 1, selection('skills:child'))).resolves.toEqual({ applied: true, revision: 2 })
  expect(h.service.selectionRevision(child)).toBe(2)
})
