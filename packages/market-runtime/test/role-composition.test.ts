/**
 * Real-host composition tests for one role child's instructions.
 *
 * The 0.2.1 line dropped the request `persona` field, so the plugin composes
 * the card body as the child's own persona section. These tests mount the
 * published host packages and drive `subagent_role` end to end; a hand-written
 * subagent fixture cannot show whether the instructions reached the model.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import { mountAgentRoleTool } from '../../../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import { ROLE_CHILD_SOURCE } from '../../../packages/market-runtime/src/runtime/agents/role-composition.js'
import type { AgentRoleEntry } from '../../../packages/market-runtime/src/application/agent-roles.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
}

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
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
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

const card = (): AgentRoleEntry => ({
  name: 'reviewer',
  path: '/unused/reviewer.md',
  description: 'Review',
  disabled: false,
  rawText: '---\nprovider: mock\nmodel: role-model\n---\nCARD_PERSONA'
})

/**
 * Mount the published host services, the persistence store, and the role tool.
 * `persistence: false` leaves the session store without a durability listener,
 * which is the shape a host that cannot commit the role binding has.
 */
async function setup(options: { persistence?: boolean; query?: boolean; savedRoot?: string } = {}) {
  const root = options.savedRoot ?? (await mkdtemp(join(tmpdir(), 'market-role-child-')))
  if (options.savedRoot === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  // 0.2.1 mounts the subagent service behind the working-directory service.
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  if (options.persistence !== false) await ctx.plugin(Persistence, { root })
  if (options.query !== false) await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead =
    options.savedRoot === undefined
      ? await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'parent' })
      : (await ctx.agents.resume({ resumeSessionId: SessionId('lead') })).agent
  const roles: AgentRoleEntry[] = [card()]
  cleanups.push(mountAgentRoleTool(ctx, async () => roles))
  return { ctx, lead, adapter, root }
}

/** Drive the registered role tool exactly as the model would. */
function invoke(ctx: Context, lead: unknown, args: Record<string, unknown>) {
  return ctx.tools.execute({
    name: 'subagent_role',
    arguments: { agent: 'reviewer', prompt: 'Review the diff.', ...args },
    agent: lead as never,
    callId: ToolCallId('subagent_role'),
    signal: new AbortController().signal
  })
}

/** Count the plugin-owned binding messages one session recorded. */
function bindingCount(events: readonly SessionEvent[]): number {
  return events.filter(event => event.type === 'user/message' && (event.data as { source?: { kind?: string } }).source?.kind === ROLE_CHILD_SOURCE).length
}

/** The system content of one recorded model request. */
function systemOf(request: GenerateOptions | undefined): string {
  return JSON.stringify(request?.messages.filter(message => message.role === 'system'))
}

describe('role composition primitives', () => {
  it('mints one fresh durable SessionId per role child', async () => {
    const { mintRoleChildId } = await import('../../../packages/market-runtime/src/runtime/agents/role-composition.js')
    const first = mintRoleChildId()
    const second = mintRoleChildId()
    expect(typeof first).toBe('string')
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(first).not.toBe(second)
  })
})

describe('one role child receives its card body from the plugin composition', () => {
  it('puts the card body in the child first system prompt on the installed 0.2.1 host', async () => {
    const { ctx, lead, adapter } = await setup()
    const ended = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => ended.resolve())
    const result = await invoke(ctx, lead, {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    const value = result.value as { kind: string; subagentId: string }
    expect(value.kind).toBe('continuable')
    await ended.promise
    // The child's FIRST request is the one that must carry the role instructions.
    const first = adapter.requests.find(request => request.sessionId === value.subagentId)
    expect(first).toBeDefined()
    expect(systemOf(first)).toContain('CARD_PERSONA')
    const stored = await ctx.sessionQuery.readSession(SessionId(value.subagentId))
    expect(bindingCount(stored.events)).toBe(1)
  })

  it('fails closed when the role section cannot be installed and leaves no reservation behind', async () => {
    const { ctx, lead, adapter } = await setup()
    // Registering the persona section in the child's OWN scope collides with the
    // plugin's registration, which lands in the same layer, so the install must
    // throw instead of silently replacing it. A preset's persona sits one layer
    // up and is shadowed rather than collided with.
    const off = ctx.on(
      'agent/created',
      ({ agent }) => {
        if (agent.session.header.parentSession !== lead.id) return undefined
        ;(agent.ctx.get('systemPrompt') as { section(section: unknown): () => void }).section({
          name: PERSONA_PREFIX_SECTION,
          order: 0,
          text: 'PREEMPTIVE'
        })
        return undefined
      },
      { prepend: true }
    )
    const failed = await invoke(ctx, lead, {})
    expect(failed.isError).toBe(true)
    if (!failed.isError) throw new Error('expected a refusal')
    expect(failed.error.message).toContain('agent "reviewer" cannot run without its role instructions')
    expect(adapter.requests).toHaveLength(0)
    off()
    // A second call with the same role proves the reservation map is clean.
    const ended = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => ended.resolve())
    const result = await invoke(ctx, lead, {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    const value = result.value as { subagentId: string }
    await ended.promise
    expect(systemOf(adapter.requests.find(request => request.sessionId === value.subagentId))).toContain('CARD_PERSONA')
  })

  it('rejects a call whose binding cannot be persisted, naming the role', async () => {
    const { ctx, lead, adapter } = await setup({ persistence: false })
    const failed = await invoke(ctx, lead, { run_in_background: false })
    expect(failed.isError).toBe(true)
    if (!failed.isError) throw new Error('expected a refusal')
    expect(failed.error.message).toContain('agent "reviewer" cannot run without its role instructions')
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.agents.list()).toEqual([lead])
  })

  it('rejects a call before creating a child when the persistence service is absent', async () => {
    const { ctx, lead } = await setup({ query: false })
    const failed = await invoke(ctx, lead, {})
    expect(failed.isError).toBe(true)
    if (!failed.isError) throw new Error('expected a refusal')
    expect(failed.error.message).toContain('agent "reviewer" cannot run without its role instructions')
    expect(ctx.agents.list()).toEqual([lead])
  })

  it('fails the creation when the role binding cannot be recorded, naming the role', async () => {
    const { ctx, lead, adapter } = await setup()
    // A host-side listener that refuses the injected record is the shape of a
    // session that cannot accept the binding: the child must not run.
    const off = ctx.on(
      'agent/created',
      ({ agent }) => {
        if (agent.session.header.parentSession !== lead.id) return undefined
        agent.inject = () => {
          throw new Error('the session refused the injected context')
        }
        return undefined
      },
      { prepend: true }
    )
    const failed = await invoke(ctx, lead, {})
    expect(failed.isError).toBe(true)
    if (!failed.isError) throw new Error('expected a refusal')
    expect(failed.error.message).toContain('agent "reviewer" cannot run without its role instructions')
    expect(adapter.requests).toHaveLength(0)
    off()
  })

  it('restores the card body from the durable binding after a full context restart', async () => {
    const first = await setup()
    const done = Promise.withResolvers<void>()
    first.ctx.once('subagent/end', () => done.resolve())
    const result = await invoke(first.ctx, first.lead, {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    const childId = (result.value as { subagentId: string }).subagentId
    await done.promise
    await first.lead.whenIdle()
    const stored = await first.ctx.sessionQuery.readSession(SessionId(childId))
    expect(bindingCount(stored.events)).toBe(1)
    await first.ctx.fiber.dispose()

    const second = await setup({ savedRoot: first.root })
    expect(second.ctx.agents.get(SessionId(childId))).toBeUndefined()
    const resumed = Promise.withResolvers<void>()
    second.ctx.once('subagent/end', () => resumed.resolve())
    await second.ctx.subagents.sendMessage(second.lead, SessionId(childId), [{ type: 'text', text: 'Review again.' }], {
      signal: new AbortController().signal
    })
    await resumed.promise
    expect(systemOf(second.adapter.requests.find(request => request.sessionId === childId))).toContain('CARD_PERSONA')
    // A resume rebuilds the section from the record; it never appends a second one.
    const after = await second.ctx.sessionQuery.readSession(SessionId(childId))
    expect(bindingCount(after.events)).toBe(1)
  })
})
