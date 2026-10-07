import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
}
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { TeammateRoleRuntime, TEAM_ROLE_SOURCE } from '../src/runtime/agents/teammate-role-runtime.js'
import { mountUnlessAgentTeams } from '../src/runtime/agents/agent-teams-seat.js'
import { mountAgentRoleTool } from '../src/runtime/agents/agent-role-router.js'
import { mountTeammateRoleTool } from '../src/runtime/agents/teammate-role-tool.js'
import { mountTeamCoordination } from '../src/runtime/agents/team-coordination.js'
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team'

class RecordingAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  readonly started = Promise.withResolvers<void>()
  hang = false
  aborted = false
  /** Emit a tool call once a held stream is released, so one turn spans two model steps. */
  toolCallAfterHold = false
  private releaseHeld?: () => void
  /** Release the held stream without aborting its turn. */
  release(): void {
    this.releaseHeld?.()
  }
  override resolveModel(provider: string, model: string) {
    // An explicit effort only survives preflight when the route advertises it.
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: 'max' as never, name: 'Max' }], defaultEffort: 'max' as never }
    })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.hang) {
      this.started.resolve()
      await new Promise<void>(resolve => {
        if (options.signal?.aborted) {
          resolve()
          return
        }
        this.releaseHeld = resolve
        options.signal?.addEventListener(
          'abort',
          () => {
            this.aborted = true
            resolve()
          },
          { once: true }
        )
      })
      this.releaseHeld = undefined
      options.signal?.throwIfAborted()
      if (this.toolCallAfterHold) {
        // An unknown tool keeps the same activation alive into a second model step.
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: ToolCallId('held-call'), name: 'market_probe_missing_tool', argumentsDelta: '{}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('held-call'), name: 'market_probe_missing_tool', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
/**
 * Teardown runs in reverse registration order, so every push must be safe to undo
 * before anything registered earlier. setup() registers root removal first and the
 * context last, which is what keeps the runtime alive until the context is gone.
 */
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})
async function setup(withTeam = true, savedRoot?: string) {
  const root = savedRoot ?? (await mkdtemp(join(tmpdir(), 'market-role-team-')))
  if (savedRoot === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn)
  const teamFiber = withTeam ? await ctx.plugin(TeamService) : undefined
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead =
    savedRoot === undefined
      ? await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'parent' })
      : (await ctx.agents.resume({ resumeSessionId: SessionId('lead') })).agent
  const runtime = withTeam ? new TeammateRoleRuntime(ctx) : undefined
  cleanups.push(() => runtime?.dispose())
  return { ctx, lead, runtime: runtime!, adapter, teamFiber, root }
}
/** Model-visible text of every plugin-owned role snapshot recorded in one session. */
function bindingText(events: readonly unknown[]): string {
  return events
    .filter((event): event is { type: string; data: unknown } => typeof event === 'object' && event !== null && (event as { type?: unknown }).type === 'user/message')
    .map(event => event.data as { source?: { kind?: string }; content?: unknown })
    .filter(message => message.source?.kind === TEAM_ROLE_SOURCE)
    .map(message =>
      (Array.isArray(message.content) ? message.content : [])
        .map(block => (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
        .join('\n')
    )
    .join('\n')
}
/** Tool-schema names one recorded request actually carried to the model. */
function requestToolNames(adapter: RecordingAdapter, sessionId: SessionId): string[] {
  const request = adapter.requests.find(candidate => candidate.sessionId === sessionId)
  if (request === undefined) throw new Error(`no recorded request for ${sessionId}`)
  return (request.tools ?? []).map(tool => tool.name)
}
describe('role teammates on published Agent Teams', () => {
  it('rejects a malformed owned role binding before a resumed member makes a request', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    const done = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => done.resolve())
    await runtime.spawn(
      lead,
      { name: 'corrupt', description: 'test', prompt: 'test' },
      { roleId: 'r', persona: 'r', route: { provider: 'mock', model: 'r' } },
      new AbortController().signal
    )
    await done.promise
    const member = ctx.agentTeams.listMembers(lead).find(member => member.name === 'corrupt')!
    const off = ctx.on(
      'agent/created',
      ({ agent }): undefined => {
        if (agent.id !== member.id) return
        agent.inject(
          createUserMessage({
            source: {
              kind: TEAM_ROLE_SOURCE,
              form: 'context',
              binding: { version: 1, childId: 'other-child', roleId: 'r', persona: 'bad', route: { provider: 'mock', model: 'bad' } }
            },
            content: [{ type: 'text', text: 'invalid binding test' }]
          })
        )
      },
      { prepend: true }
    )
    cleanups.push(() => {
      off()
    })
    const failure = await ctx.subagents.sendMessage(lead, member.id, [{ type: 'text', text: 'resume' }], { signal: new AbortController().signal }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).cause)).toContain('multiple role bindings')
    expect(adapter.requests.some(request => request.model === 'bad')).toBe(false)
  })

  it('drains live role work before removing its scoped composition', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    adapter.hang = true
    const creating = runtime.spawn(
      lead,
      { name: 'working', description: 'work', prompt: 'task' },
      { roleId: 'r', persona: 'r', route: { provider: 'mock', model: 'r' } },
      new AbortController().signal
    )
    await adapter.started.promise
    await creating
    await runtime.dispose()
    expect(adapter.aborted).toBe(true)
    expect(ctx.agents.list()).toEqual([lead])
    expect(() =>
      runtime.spawn(
        lead,
        { name: 'later', description: 'later', prompt: 'later' },
        { roleId: 'r', persona: 'r', route: { provider: 'mock', model: 'r' } },
        new AbortController().signal
      )
    ).toThrow()
  })

  it('recovers original role instructions and route after the whole host context restarts', async () => {
    const first = await setup()
    const done = Promise.withResolvers<void>()
    first.ctx.once('subagent/end', () => done.resolve())
    await first.runtime.spawn(
      first.lead,
      { name: 'durable', description: 'durable', prompt: 'task' },
      { roleId: 'role', persona: 'DURABLE_ROLE', route: { provider: 'mock', model: 'durable-model' } },
      new AbortController().signal
    )
    await done.promise
    await first.lead.whenIdle()
    const memberId = first.ctx.agentTeams.listMembers(first.lead).find(member => member.name === 'durable')!.id
    await first.runtime.dispose()
    await first.ctx.fiber.dispose()
    const second = await setup(true, first.root)
    // A brand-new Context has no live member: this resume must read the persisted log.
    expect(second.ctx.agents.get(memberId)).toBeUndefined()
    const resumed = Promise.withResolvers<void>()
    second.ctx.once('subagent/end', () => resumed.resolve())
    expect(
      (await second.ctx.agentTeams.sendMessage(second.lead, { target: 'durable', content: [{ type: 'text', text: 'resume task' }], signal: new AbortController().signal })).status
    ).toBe('accepted')
    await resumed.promise
    const request = second.adapter.requests.find(request => request.model === 'durable-model')
    expect(JSON.stringify(request)).toContain('DURABLE_ROLE')
  })

  it('keeps existing composition across compact notifications without duplicate registration', async () => {
    const { ctx, lead, runtime } = await setup()
    const entered = Promise.withResolvers<import('@deepseek-ai/dsh-agent').Agent>()
    const release = Promise.withResolvers<void>()
    const off = ctx.on('agent/created', async ({ agent, source }) => {
      if (source !== 'startup' || agent.session.header.parentSession !== lead.id) return
      entered.resolve(agent)
      await release.promise
    })
    cleanups.push(() => {
      off()
      release.resolve()
    })
    const creation = runtime.spawn(
      lead,
      { name: 'compact', description: 'compact', prompt: 'task' },
      { roleId: 'r', persona: 'COMPACT_ROLE', route: { provider: 'mock', model: 'r' } },
      new AbortController().signal
    )
    const child = await entered.promise
    await agentEvents(ctx, child).serial('agent/created', { source: 'compact' })
    release.resolve()
    expect((await creation).target).toBe('compact')
  })

  it('switches role tools for late Team arrival and restores standalone on removal', async () => {
    const { ctx, lead } = await setup(false)
    const list = async () => []
    cleanups.push(mountUnlessAgentTeams(ctx, () => mountAgentRoleTool(ctx, list)))
    const injected = ctx.inject(['agentTeams', 'tools', 'llm', 'subagents', 'agents', 'sessions', 'sessionQuery', 'systemPrompt'], host => {
      host.effect(() => mountTeammateRoleTool(host, list))
    })
    expect(ctx.tools.get('subagent_role', lead)).toBeDefined()
    const team = await ctx.plugin(TeamService)
    await injected
    expect(ctx.tools.get('subagent_role', lead)).toBeUndefined()
    expect(ctx.tools.get('spawn_teammate_role', lead)).toHaveProperty(
      'parameters.properties.agent.description',
      'Exact role name listed in the current "subagent-catalog" message.'
    )
    await team.dispose()
    expect(ctx.tools.get('spawn_teammate_role', lead)).toBeUndefined()
    expect(ctx.tools.get('subagent_role', lead)).toBeDefined()
  })

  it('rolls back cancellation during initialization without calling the model', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const controller = new AbortController()
    const off = ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.parentSession !== lead.id) return
      entered.resolve()
      await release.promise
    })
    cleanups.push(() => {
      off()
      release.resolve()
    })
    const creation = runtime.spawn(
      lead,
      { name: 'cancelled', description: 'cancel', prompt: 'task' },
      { roleId: 'r', persona: 'r', route: { provider: 'mock', model: 'r' } },
      controller.signal
    )
    const rejection = expect(creation).rejects.toThrow()
    await entered.promise
    controller.abort()
    release.resolve()
    await rejection
    expect(adapter.requests.filter(request => request.model === 'r')).toHaveLength(0)
    expect(ctx.agentTeams.listMembers(lead).find(member => member.name === 'cancelled')?.status).toBe('failed')
    expect(ctx.agents.list()).toEqual([lead])
  })

  it('isolates parallel role creations and freezes each creation snapshot', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    const admitted = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let count = 0
    const off = ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.parentSession !== lead.id) return
      if (++count === 2) admitted.resolve()
      await release.promise
    })
    cleanups.push(() => {
      off()
      release.resolve()
    })
    const one = { roleId: 'same-role', persona: 'PERSONA_ONE', route: { provider: 'mock', model: 'model-one' } }
    const two = { roleId: 'same-role', persona: 'PERSONA_TWO', route: { provider: 'mock', model: 'model-two' } }
    const ended = Promise.withResolvers<void>()
    let ends = 0
    ctx.on('subagent/end', () => {
      if (++ends === 2) ended.resolve()
    })
    const first = runtime.spawn(lead, { name: 'one', description: 'one', prompt: 'one' }, one, new AbortController().signal)
    const second = runtime.spawn(lead, { name: 'two', description: 'two', prompt: 'two' }, two, new AbortController().signal)
    await admitted.promise
    one.persona = 'MUTATED'
    one.route.model = 'mutated'
    release.resolve()
    await Promise.all([first, second])
    await ended.promise
    const firstRequest = adapter.requests.find(request => request.model === 'model-one')
    const secondRequest = adapter.requests.find(request => request.model === 'model-two')
    expect(JSON.stringify(firstRequest)).toContain('PERSONA_ONE')
    expect(JSON.stringify(firstRequest)).not.toContain('PERSONA_TWO')
    expect(JSON.stringify(secondRequest)).toContain('PERSONA_TWO')
    expect(JSON.stringify(secondRequest)).not.toContain('PERSONA_ONE')
    expect(ctx.agentTeams.listMembers(lead).map(member => member.name)).toEqual(['lead', 'one', 'two'])
  })

  it('exposes a role tool whose target works with native Team tools', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    await runtime.dispose()
    await ctx.plugin(TeamTools)
    const dispose = await mountTeammateRoleTool(ctx, async () => [
      { name: 'reviewer', path: '/unused', description: 'Review', disabled: false, rawText: '---\nprovider: mock\nmodel: card-model\n---\nCARD_PERSONA' }
    ])
    cleanups.push(dispose)
    const execute = (name: string, args: unknown) => ctx.tools.execute({ name, arguments: args, agent: lead, callId: ToolCallId(name), signal: new AbortController().signal })
    const ended = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => ended.resolve())
    const result = await execute('spawn_teammate_role', {
      agent: 'reviewer',
      name: 'code-reviewer',
      description: 'Review',
      prompt: 'Review changes',
      provider: 'mock',
      model: 'override-model',
      reasoning_effort: 'max'
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toMatchObject({ target: 'code-reviewer', provider: 'mock', model: 'override-model', reasoningEffort: 'max' })
    await ended.promise
    expect(JSON.stringify(adapter.requests.find(request => request.model === 'override-model')?.messages.filter(message => message.role === 'system'))).toContain('CARD_PERSONA')
    const memberId = ctx.agentTeams.listMembers(lead).find(member => member.name === 'code-reviewer')!.id
    const memberRequests = () => adapter.requests.filter(request => request.sessionId === memberId)
    expect(memberRequests()[0]?.reasoningEffort).toBe('max')
    const roster = await execute('list_agents', {})
    expect(roster.isError).toBe(false)
    expect(JSON.stringify(roster.value)).toContain('code-reviewer')
    const again = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => again.resolve())
    const sent = await execute('send_message', { target: 'code-reviewer', message: 'Review again' })
    expect(sent.isError).toBe(false)
    await again.promise
    expect(memberRequests()).toHaveLength(2)
    await dispose()
    expect(ctx.tools.get('spawn_teammate_role', lead)).toBeUndefined()
    expect(ctx.tools.get('spawn_teammate', lead)).toBeDefined()
  })

  it('rejects direct provider use and aborted creation without a Team member', async () => {
    const { ctx, lead, runtime } = await setup()
    const signal = new AbortController()
    signal.abort()
    expect(() =>
      runtime.spawn(lead, { name: 'aborted', description: 'test', prompt: 'test' }, { roleId: 'x', persona: 'x', route: { provider: 'mock', model: 'x' } }, signal.signal)
    ).toThrow()
    await expect(
      ctx.subagents.startContinuable({
        provider: 'market-role-team',
        label: 'bypass',
        request: { parent: lead, prompt: [{ type: 'text', text: 'bypass' }] },
        signal: new AbortController().signal
      })
    ).rejects.toThrow('no matching role binding')
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1)
  })

  it('refuses a non-Lead caller and an empty prompt before creating a member', async () => {
    const { ctx, lead, runtime } = await setup()
    const member = Promise.withResolvers<import('@deepseek-ai/dsh-agent').Agent>()
    const done = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => done.resolve())
    await runtime.spawn(
      lead,
      { name: 'worker', description: 'work', prompt: 'task' },
      { roleId: 'r', persona: 'r', route: { provider: 'mock', model: 'r' } },
      new AbortController().signal
    )
    await done.promise
    const child = await ctx.agentTeams.sendMessage(lead, { target: 'worker', content: [{ type: 'text', text: 'wake' }], signal: new AbortController().signal })
    expect(child.status).toBe('accepted')
    const childAgent = ctx.agentTeams.listMembers(lead).find(candidate => candidate.name === 'worker')!
    const agent = ctx.agents.get(childAgent.id)
    if (agent === undefined) throw new Error('expected the worker to be resident for the permission probe')
    member.resolve(agent)
    const teammate = await member.promise
    // The Lead-only rule is enforced before any role work starts.
    await expect(
      runtime.spawn(
        teammate,
        { name: 'escalation', description: 'no', prompt: 'no' },
        { roleId: 'r', persona: 'r', route: { provider: 'mock', model: 'r' } },
        new AbortController().signal
      )
    ).rejects.toThrow('only the Team Lead can create role teammates')
    await expect(
      runtime.spawn(
        lead,
        { name: 'blank', description: 'blank', prompt: '   ' },
        { roleId: 'r', persona: 'r', route: { provider: 'mock', model: 'r' } },
        new AbortController().signal
      )
    ).rejects.toThrow('non-empty prompt')
    expect(ctx.agentTeams.listMembers(lead).map(candidate => candidate.name)).toEqual(['lead', 'worker'])
  })

  it('ignores a role binding inherited through a seeded fork prefix', async () => {
    // A forked child inherits its parent's events, including a role binding whose
    // recorded childId is the parent. Only the child-owned suffix may be read.
    const { ctx, lead, runtime } = await setup()
    const done = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => done.resolve())
    await runtime.spawn(
      lead,
      { name: 'origin', description: 'origin', prompt: 'task' },
      { roleId: 'r', persona: 'ORIGIN_PERSONA', route: { provider: 'mock', model: 'origin-model' } },
      new AbortController().signal
    )
    await done.promise
    await lead.whenIdle()
    const originId = ctx.agentTeams.listMembers(lead).find(candidate => candidate.name === 'origin')!.id
    const snapshot = await ctx.sessionQuery.readSession(originId)
    const handle = await ctx.agents.create({
      sessionId: SessionId('seeded-fork'),
      parentAgent: lead,
      seed: snapshot.events,
      inheritedEventCount: SessionLogOffset(snapshot.events.length),
      meta: { parentSession: lead.id, isSeeded: true, origin: 'subagent' }
    })
    cleanups.push(() => handle.dispose())
    // The inherited binding belongs to 'origin' and must not be adopted or rejected.
    expect(handle.agent.id).toBe('seeded-fork')
    expect(ctx.agents.get(handle.agent.id)).toBe(handle.agent)
  })

  it('composes an already-live role member when the runtime is replaced', async () => {
    // A member that became live while no runtime was listening can only be composed
    // by restore(): its creation announcement already fired and will not repeat.
    const { ctx, lead, runtime, adapter } = await setup()
    const done = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => done.resolve())
    await runtime.spawn(
      lead,
      { name: 'restored', description: 'restore', prompt: 'task' },
      { roleId: 'r', persona: 'RESTORED_PERSONA', route: { provider: 'mock', model: 'restored-model' } },
      new AbortController().signal
    )
    await done.promise
    const memberId = ctx.agentTeams.listMembers(lead).find(candidate => candidate.name === 'restored')!.id
    await runtime.dispose()
    // Revive the member with no runtime listening, and hold it inside its FIRST
    // activation: a later activation would announce itself and hide a dead restore().
    adapter.hang = true
    adapter.toolCallAfterHold = true
    const held = ctx.agentTeams.sendMessage(lead, { target: 'restored', content: [{ type: 'text', text: 'hold' }], signal: new AbortController().signal })
    await adapter.started.promise
    expect(ctx.agents.get(memberId)).toBeDefined()
    const replacement = new TeammateRoleRuntime(ctx)
    cleanups.push(() => replacement.dispose())
    await replacement.restore()
    const settled = Promise.withResolvers<void>()
    ctx.on('subagent/end', () => settled.resolve())
    // Release into the same activation's second step; only restore() can have composed it.
    adapter.hang = false
    adapter.release()
    await held.catch(() => undefined)
    await settled.promise
    const requests = adapter.requests.filter(request => request.sessionId === memberId)
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(requests.at(-1)?.messages.filter(message => message.role === 'system'))).toContain('RESTORED_PERSONA')
  })

  it('restores a role snapshot after the plugin runtime is replaced', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    const done = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => done.resolve())
    await runtime.spawn(
      lead,
      { name: 'persisted', description: 'Persisted', prompt: 'task' },
      { roleId: 'old-role', persona: 'ORIGINAL_PERSONA', route: { provider: 'mock', model: 'original-model' } },
      new AbortController().signal
    )
    await done.promise
    await runtime.dispose()
    const replacement = new TeammateRoleRuntime(ctx)
    cleanups.push(() => replacement.dispose())
    await replacement.restore()
    const memberId = ctx.agentTeams.listMembers(lead).find(member => member.name === 'persisted')!.id
    const memberRequests = () => adapter.requests.filter(request => request.sessionId === memberId)
    const resumed = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => resumed.resolve())
    expect((await ctx.agentTeams.sendMessage(lead, { target: 'persisted', content: [{ type: 'text', text: 'follow up' }], signal: new AbortController().signal })).status).toBe(
      'accepted'
    )
    await resumed.promise
    expect(memberRequests()).toHaveLength(2)
    expect(JSON.stringify(memberRequests()[1])).toContain('ORIGINAL_PERSONA')
  })

  it('applies the role before the first request and returns a native Team member', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    const settled = Promise.withResolvers<void>()
    ctx.on('subagent/end', () => settled.resolve())
    const result = await runtime.spawn(
      lead,
      { name: 'reviewer', description: 'Review', prompt: 'Review the diff.' },
      { roleId: 'reviewer', persona: 'ROLE_PERSONA literal {{braces}}', route: { provider: 'mock', model: 'review-model' } },
      new AbortController().signal
    )
    const row = ctx.agentTeams.listMembers(lead).find(member => member.name === result.target)
    expect(row).toBeDefined()
    await settled.promise
    expect(adapter.requests[0]?.model).toBe('review-model')
    expect(JSON.stringify(adapter.requests[0]?.messages.filter(message => message.role === 'system'))).toContain('ROLE_PERSONA literal {{braces}}')
    expect(lead.options.model).toBe('parent')
    expect(result.target).toBe('reviewer')
    const continued = Promise.withResolvers<void>()
    ctx.on('subagent/end', () => continued.resolve())
    await lead.whenIdle()
    const stored = await ctx.sessionQuery.readSession(row!.id)
    expect(JSON.stringify(stored.events)).toContain(TEAM_ROLE_SOURCE)
    expect(
      (await ctx.agentTeams.sendMessage(lead, { target: result.target, content: [{ type: 'text', text: 'Review again.' }], signal: new AbortController().signal })).status
    ).toBe('accepted')
    await continued.promise
    const memberRequests = adapter.requests.filter(request => request.sessionId === row!.id)
    expect(memberRequests.at(-1)?.model).toBe('review-model')
    expect(JSON.stringify(memberRequests.at(-1)?.messages.filter(message => message.role === 'system'))).toContain('ROLE_PERSONA literal {{braces}}')
  })

  it('introduces the member identity and the readable role name to the created teammate', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    cleanups.push(mountTeamCoordination(ctx))
    const done = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => done.resolve())
    const opaqueRoleId = JSON.stringify(['source', 'suite', 'agents', 'reviewer'])
    const result = await runtime.spawn(
      lead,
      { name: 'identity-member', description: 'Identity', prompt: 'Review the diff.', agent: 'suite/reviewer' },
      { roleId: opaqueRoleId, persona: 'IDENTITY_PERSONA', route: { provider: 'mock', model: 'identity-model' } },
      new AbortController().signal
    )
    await done.promise
    const row = ctx.agentTeams.listMembers(lead).find(member => member.name === result.target)
    expect(row).toBeDefined()
    const stored = await ctx.sessionQuery.readSession(row!.id)
    const identity = bindingText(stored.events)
    expect(identity).toContain('You are teammate "identity-member"')
    expect(identity).toContain('Your Team Lead is addressed as "lead".')
    expect(identity).toContain('send_message({ target: "lead"')
    expect(identity).toContain('Your role is suite/reviewer')
    expect(identity).not.toContain(opaqueRoleId)
    const systemForMember = () =>
      JSON.stringify(
        adapter.requests
          .filter(request => request.sessionId === row!.id)
          .at(-1)
          ?.messages.filter(message => message.role === 'system')
      )
    expect(systemForMember()).toContain('Team coordination')
    expect(systemForMember()).toContain('IDENTITY_PERSONA')
    expect(systemForMember()).toContain('identity-member')
    expect(systemForMember()).not.toContain('You are the Team Lead')
    const resumed = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => resumed.resolve())
    expect((await ctx.agentTeams.sendMessage(lead, { target: result.target, content: [{ type: 'text', text: 'Again.' }], signal: new AbortController().signal })).status).toBe(
      'accepted'
    )
    await resumed.promise
    const restored = await ctx.sessionQuery.readSession(row!.id)
    expect(bindingText(restored.events)).toBe(identity)
    expect(systemForMember()).toContain('Team coordination')
    expect(systemForMember()).toContain('identity-member')
    expect(systemForMember()).not.toContain('You are the Team Lead')
  })

  it('never renders the encoded role id when the creating call supplies no catalog name', async () => {
    const { ctx, lead, runtime } = await setup()
    const done = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => done.resolve())
    const opaqueRoleId = JSON.stringify(['source', 'suite', 'agents', 'reviewer'])
    const result = await runtime.spawn(
      lead,
      { name: 'derived-member', description: 'Derived', prompt: 'Review the diff.' },
      { roleId: opaqueRoleId, persona: 'DERIVED_PERSONA', route: { provider: 'mock', model: 'derived-model' } },
      new AbortController().signal
    )
    await done.promise
    const row = ctx.agentTeams.listMembers(lead).find(member => member.name === result.target)
    expect(row).toBeDefined()
    const stored = await ctx.sessionQuery.readSession(row!.id)
    const identity = bindingText(stored.events)
    expect(identity).toContain('You are teammate "derived-member"')
    expect(identity).not.toContain('Your role is')
    expect(identity).not.toContain(opaqueRoleId)
  })

  it('shows the enhanced creation tool only to the Team Lead in the model schema', async () => {
    const { ctx, lead, runtime, adapter } = await setup()
    await runtime.dispose()
    const dispose = await mountTeammateRoleTool(ctx, async () => [
      { name: 'reviewer', path: '/unused', description: 'Review', disabled: false, rawText: '---\nprovider: mock\nmodel: card-model\n---\nCARD_PERSONA' }
    ])
    cleanups.push(dispose)
    const NAME = 'spawn_teammate_role'
    // Registered after the mount, so each creation has already been scoped by the visibility rule.
    const createdSchemas = new Map<string, string[]>()
    ctx.on('agent/created', ({ agent }) => {
      createdSchemas.set(
        agent.id,
        ctx.tools.schemas(agent).map(schema => schema.name)
      )
      return undefined
    })
    expect(ctx.tools.schemas(lead).map(schema => schema.name)).toContain(NAME)

    // A native member is a child scope of the Lead, so an inherited registration would leak here.
    const nativeEnded = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => nativeEnded.resolve())
    const native = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'native-mate',
      description: 'native',
      prompt: [{ type: 'text', text: 'Work.' }],
      context: 'fresh',
      provider: 'spawn',
      signal: new AbortController().signal
    })
    await nativeEnded.promise
    expect(createdSchemas.get(native.member.id)).toBeDefined()
    expect(createdSchemas.get(native.member.id)).not.toContain(NAME)
    expect(requestToolNames(adapter, native.member.id)).not.toContain(NAME)

    const roleEnded = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => roleEnded.resolve())
    const created = await ctx.tools.execute({
      name: NAME,
      arguments: { agent: 'reviewer', name: 'role-mate', description: 'role', prompt: 'Work.' },
      agent: lead,
      callId: ToolCallId(NAME),
      signal: new AbortController().signal
    })
    expect(created.isError).toBe(false)
    if (created.isError) throw new Error(created.error.message)
    await roleEnded.promise
    const createdTarget = (created.value as unknown as { target: string }).target
    const roleMember = ctx.agentTeams.listMembers(lead).find(row => row.name === createdTarget)!
    expect(createdSchemas.get(roleMember.id)).toBeDefined()
    expect(createdSchemas.get(roleMember.id)).not.toContain(NAME)
    expect(requestToolNames(adapter, roleMember.id)).not.toContain(NAME)

    const plainEnded = Promise.withResolvers<void>()
    ctx.once('subagent/end', () => plainEnded.resolve())
    const plain = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'plain',
      request: { parent: lead, prompt: [{ type: 'text', text: 'Outside the Team.' }] },
      signal: new AbortController().signal
    })
    await plainEnded.promise
    expect(createdSchemas.get(plain.childId)).toBeDefined()
    expect(createdSchemas.get(plain.childId)).not.toContain(NAME)
    expect(requestToolNames(adapter, plain.childId)).not.toContain(NAME)

    await dispose()
    expect(ctx.tools.schemas(lead).map(schema => schema.name)).not.toContain(NAME)
  })
})
