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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { PERSONA_PREFIX_SECTION, type SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import { mountAgentRoleTool } from '../../../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import { ROLE_ABANDON_DEADLINE_MS, ROLE_CHILD_SOURCE, RoleComposition } from '../../../packages/market-runtime/src/runtime/agents/role-composition.js'
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
  /** Hold the first stream open, so a child stays live while the test releases it. */
  hold = false
  private releaseHeld?: () => void
  /** Release a held stream. */
  release(): void {
    this.releaseHeld?.()
  }
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.hold) {
      await new Promise<void>(resolve => {
        this.releaseHeld = resolve
      })
      this.releaseHeld = undefined
    }
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

const card = (body = 'CARD_PERSONA'): AgentRoleEntry => ({
  name: 'reviewer',
  path: '/unused/reviewer.md',
  description: 'Review',
  disabled: false,
  rawText: '---\nprovider: mock\nmodel: role-model\n---\n' + body
})

/**
 * Mount the published host services, the persistence store, and the role tool.
 * `persistence: false` leaves the session store without a durability listener,
 * which is the shape a host that cannot commit the role binding has.
 */
async function setup(options: { persistence?: boolean; query?: boolean; savedRoot?: string; body?: string } = {}) {
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
  const roles: AgentRoleEntry[] = [card(options.body)]
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
    // The binding notice states what directs the child, not how we persist it: a
    // resume-mechanics sentence is text the child cannot act on.
    const notice = JSON.stringify(first?.messages.filter(message => message.role === 'user'))
    expect(notice).toContain('You are the role child')
    expect(notice).toContain('Messages from the agent that launched you')
    expect(notice).not.toContain('delegation snapshot')
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

  it('releases a live child through the seam drain member when an identity cannot be composed', async () => {
    const { ctx, lead, adapter } = await setup()
    adapter.hold = true
    const result = await invoke(ctx, lead, {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    const childId = (result.value as { subagentId: string }).subagentId
    // The continuable call returns once the child starts, so the child is live and
    // mid-turn here. abandon is the release path a mismatched identity takes, so it
    // must genuinely free the child rather than only drop a reservation.
    expect(ctx.agents.get(SessionId(childId))).toBeDefined()
    await new RoleComposition(ctx).abandon(childId)
    expect(ctx.agents.get(SessionId(childId))).toBeUndefined()
    adapter.release()
  })

  it('bounds the release so a stalled host drain cannot delay the refusal', async () => {
    // The refusal path awaits abandon() before it surfaces, so an unbounded drain
    // would hang the error the caller needs. The bound is the composition's own,
    // armed through the host deadline primitive the rest of the plugin uses.
    const warn = vi.fn()
    const child = { id: 'stalled-child', session: { header: { parentSession: 'parent-1' } } }
    const parent = { id: 'parent-1' }
    const services: Record<string, unknown> = {
      subagents: { drainChildren: () => new Promise<void>(() => {}) },
      agents: { get: (id: string) => (id === 'parent-1' ? parent : id === 'stalled-child' ? child : undefined) }
    }
    const composition = new RoleComposition({ get: (name: string) => services[name], logger: { warn } } as unknown as Context)
    vi.useFakeTimers()
    try {
      let released = false
      const running = composition.abandon('stalled-child').then(() => {
        released = true
      })
      // Let the stage past the bound run; a stalled drain must not keep it pending.
      await vi.advanceTimersByTimeAsync(ROLE_ABANDON_DEADLINE_MS + 1)
      await Promise.resolve()
      await Promise.resolve()
      expect(released).toBe(true)
      await expect(running).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not release within'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('places the card body in the host persona-prefix slot, not somewhere else', async () => {
    // The implementation claims the host's own DEPLOYMENT_PERSONA_PREFIX position.
    // Order is load-bearing: a wrong getSectionOrder argument still renders the card
    // body somewhere in the prompt, so only a placement assertion catches it. Two
    // probe sections bracket the slot by one order unit on each side, which pins the
    // registration to that exact position instead of merely "somewhere after identity".
    const { ctx, lead, adapter } = await setup()
    const off = ctx.on(
      'agent/created',
      ({ agent }): undefined => {
        if (agent.session.header.parentSession !== lead.id) return undefined
        const prompt = agent.ctx.get('systemPrompt') as SystemPrompt
        const slot = prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')
        prompt.section({ name: 'probe:below-persona', order: slot - 1, text: 'PROBE_BELOW' })
        prompt.section({ name: 'probe:above-persona', order: slot + 1, text: 'PROBE_ABOVE' })
        return undefined
      },
      { prepend: true }
    )
    try {
      adapter.hold = true
      const result = await invoke(ctx, lead, {})
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error(result.error.message)
      const childId = (result.value as { subagentId: string }).subagentId
      const child = ctx.agents.get(SessionId(childId))
      expect(child).toBeDefined()
      const prompt = (child as unknown as { ctx: { get(name: string): unknown } }).ctx.get('systemPrompt') as SystemPrompt
      const assembly = await prompt.assemble(assembleContextFor(child as never))
      const names = assembly.sections.map(section => section.name)
      const personaIndex = names.indexOf(PERSONA_PREFIX_SECTION)
      expect(personaIndex, names.join(' -> ')).toBeGreaterThan(-1)
      // The card body sits strictly between the two probes, so the registered order
      // is inside (slot - 1, slot + 1).
      expect(personaIndex).toBe(names.indexOf('probe:below-persona') + 1)
      expect(personaIndex).toBe(names.indexOf('probe:above-persona') - 1)
      // And the slot itself is the host's persona-prefix position: after identity,
      // before the next central allocation.
      expect(prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')).toBeLessThan(prompt.getSectionOrder('PLAN_POLICY'))
      expect(prompt.getSectionOrder('HARNESS_IDENTITY')).toBeLessThan(prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'))
      const persona = assembly.sections[personaIndex]
      expect(persona?.text).toBe('CARD_PERSONA')
      // interpolate false keeps a card body with template braces literal.
      expect(persona?.interpolate).toBe(false)
      adapter.release()
    } finally {
      off()
    }
  })

  it('keeps an upgraded child running when the host already re-applied its persona', async () => {
    // Cross-line resume: a child created on the 0.2.0 line carries a descriptor
    // persona the host re-applies as a child-scope section on resume. On 0.2.1 the
    // plugin also wants that slot. Refusing here would break the upgrade path for a
    // child whose instructions are already in place, so the plugin recognises the
    // host's copy and adds nothing.
    const { ctx, lead, adapter } = await setup()
    const off = ctx.on(
      'agent/created',
      ({ agent }): undefined => {
        if (agent.session.header.parentSession !== lead.id) return undefined
        ;(agent.ctx.get('systemPrompt') as SystemPrompt).section({ name: PERSONA_PREFIX_SECTION, order: 0, text: 'CARD_PERSONA' })
        return undefined
      },
      { prepend: true }
    )
    try {
      const ended = Promise.withResolvers<void>()
      ctx.once('subagent/end', () => ended.resolve())
      const result = await invoke(ctx, lead, {})
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error(result.error.message)
      const childId = (result.value as { subagentId: string }).subagentId
      await ended.promise
      // The child ran with its instructions still applied, from the host's copy.
      expect(systemOf(adapter.requests.find(request => request.sessionId === childId))).toContain('CARD_PERSONA')
    } finally {
      off()
    }
  })

  it('refuses when the host persona slot holds different instructions', async () => {
    const { ctx, lead } = await setup()
    const off = ctx.on(
      'agent/created',
      ({ agent }): undefined => {
        if (agent.session.header.parentSession !== lead.id) return undefined
        ;(agent.ctx.get('systemPrompt') as SystemPrompt).section({ name: PERSONA_PREFIX_SECTION, order: 0, text: 'SOMEONE_ELSES_PERSONA' })
        return undefined
      },
      { prepend: true }
    )
    try {
      const failed = await invoke(ctx, lead, {})
      expect(failed.isError).toBe(true)
      if (!failed.isError) throw new Error('expected a refusal')
      expect(failed.error.message).toContain('agent "reviewer" cannot run without its role instructions')
      expect(failed.error.message).toContain('already carries different instructions')
    } finally {
      off()
    }
  })

  it('keeps the host copy only when it preserves a brace-bearing card body literally', async () => {
    // The host's descriptor re-application and this module can hold the same raw
    // text while meaning different things: the plugin writes interpolate: false so a
    // card body containing {{braces}} stays literal, and the host writes no flag at
    // all. This case is the keep path the fix must not break: a host copy that also
    // preserves the text literally is accepted, and the child's own request carries
    // the braces unsubstituted.
    const body = 'CARD_PERSONA {{role_note}}'
    const { ctx, lead, adapter } = await setup({ body })
    const off = ctx.on(
      'agent/created',
      ({ agent }): undefined => {
        if (agent.session.header.parentSession !== lead.id) return undefined
        ;(agent.ctx.get('systemPrompt') as SystemPrompt).section({ name: PERSONA_PREFIX_SECTION, order: 0, text: body, interpolate: false })
        return undefined
      },
      { prepend: true }
    )
    try {
      const ended = Promise.withResolvers<void>()
      ctx.once('subagent/end', () => ended.resolve())
      const result = await invoke(ctx, lead, {})
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error(result.error.message)
      const childId = (result.value as { subagentId: string }).subagentId
      await ended.promise
      const system = systemOf(adapter.requests.find(request => request.sessionId === childId))
      // A literal brace body survives only because the flag is false.
      expect(system).toContain('{{role_note}}')
    } finally {
      off()
    }
  })

  it('refuses a host copy that would interpolate a brace-bearing card body', async () => {
    // Same raw text, no interpolate flag, which is exactly how the host re-applies a
    // descriptor persona. Keeping it would silently substitute a registered variable
    // or make the render throw with no model turn, so this must refuse instead.
    const body = 'CARD_PERSONA {{role_note}}'
    const { ctx, lead, adapter } = await setup({ body })
    const off = ctx.on(
      'agent/created',
      ({ agent }): undefined => {
        if (agent.session.header.parentSession !== lead.id) return undefined
        ;(agent.ctx.get('systemPrompt') as SystemPrompt).section({ name: PERSONA_PREFIX_SECTION, order: 0, text: body })
        return undefined
      },
      { prepend: true }
    )
    try {
      const failed = await invoke(ctx, lead, {})
      expect(failed.isError).toBe(true)
      if (!failed.isError) throw new Error('expected a refusal')
      expect(failed.error.message).toContain('agent "reviewer" cannot run without its role instructions')
      expect(failed.error.message).toContain('without preserving its template text')
      expect(adapter.requests).toHaveLength(0)
    } finally {
      off()
    }
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
