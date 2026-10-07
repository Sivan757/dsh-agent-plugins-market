/**
 * The Team coordination briefing is resolved per assembly, never per creation.
 *
 * One section answers one question for one scope: which Team identity does this
 * exact live Agent hold? Agent Teams is the only authority consulted, so a
 * missing scope, a forged Agent identity, and a subagent started outside Team
 * creation all read as no Team, while a genuine Lead and a genuine member read
 * their own instructions. Because the section is one dynamic provider rather
 * than composition attached to each Agent as it appears, an Agent that already
 * existed before the mount, a member created after it, and a member that
 * activation-carried compaction notices all render the same text once. None of
 * that needs a role catalogue, a session query, or a tool lookup, so these
 * cases mount the real Agent loop, Team service, and prompt registry with no
 * catalogue at all.
 *
 * A member is resident only while its activation runs, so its briefing is read
 * from the request the model actually received. The Lead is resident, so its
 * briefing is read from the same `assemble()` call the loop makes before every
 * step (agent-loop renders `assembleContextFor(agent)`).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { mountTeamCoordination } from '../packages/market-runtime/src/runtime/agents/team-coordination.js'

/** The section this plugin owns; a second one would mean a duplicate contribution. */
const SECTION = 'market:team-coordination'
/** The scoped host section this plugin's briefing must follow. */
const HOST_POLICY = 'team:policy'
/** The heading every coordination briefing starts with. */
const TITLE = 'Team coordination'
/** The provider name the in-process spawn backend registers by default. */
const SPAWN_PROVIDER = 'spawn'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

/** A model that answers every turn immediately, so members settle without a held stream. */
class QuietAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'market-team-coordination-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn)
  await ctx.plugin(TeamService)
  const adapter = new QuietAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'parent' })
  return { ctx, lead, adapter }
}

/** The prompt one exact Agent's assembly renders through the real registry. */
async function promptFor(ctx: Context, agent: Agent): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)))
}

/** The assembled contributions this plugin registered for one scope. */
async function coordinationSections(ctx: Context, agent: Agent) {
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
  return assembly.sections.filter(section => section.name === SECTION)
}

/** The first line of a section, which identifies it inside a rendered prompt. */
function firstLine(text: string): string {
  return text.split('\n')[0] ?? ''
}

/** How many times a phrase renders in one prompt. */
function copies(prompt: string, phrase: string): number {
  return prompt.split(phrase).length - 1
}

/** System-role text one recorded request carried to the model. */
function systemTextOf(request: GenerateOptions): string {
  const messages = request.messages as ReadonlyArray<{ role?: unknown; content?: unknown }>
  const lines: string[] = []
  for (const message of messages) {
    if (message.role !== 'system') continue
    const blocks = Array.isArray(message.content) ? (message.content as readonly unknown[]) : []
    for (const block of blocks) {
      if (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string') lines.push((block as { text: string }).text)
    }
  }
  return lines.join('\n')
}

/** The system prompt the model received for one agent session's request. */
function recordedSystemText(adapter: QuietAdapter, sessionId: SessionId): string {
  const request = adapter.requests.find(candidate => candidate.sessionId === sessionId)
  if (request === undefined) throw new Error(`no recorded request for ${sessionId}`)
  return systemTextOf(request)
}

/** Create one native Team member and wait for the end of its first turn. */
async function spawnMember(ctx: Context, lead: Agent, name: string) {
  const ended = Promise.withResolvers<void>()
  const off = ctx.on('subagent/end', () => ended.resolve())
  try {
    const result = await ctx.agentTeams.spawnTeammate(lead, {
      name,
      description: `${name} description`,
      prompt: [{ type: 'text', text: `Work as ${name}.` }],
      context: 'fresh',
      provider: SPAWN_PROVIDER,
      signal: new AbortController().signal
    })
    await ended.promise
    return result.member
  } finally {
    off()
  }
}

/** Start one continuable child outside Team creation and wait for its first turn. */
async function startPlainSubagent(ctx: Context, parent: Agent): Promise<SessionId> {
  const ended = Promise.withResolvers<void>()
  const off = ctx.on('subagent/end', () => ended.resolve())
  try {
    const started = await ctx.subagents.startContinuable({
      provider: SPAWN_PROVIDER,
      label: 'plain subagent',
      request: { parent, prompt: [{ type: 'text', text: 'Work outside the Team.' }] },
      signal: new AbortController().signal
    })
    await ended.promise
    return started.childId
  } finally {
    off()
  }
}

describe('team coordination section', () => {
  it('briefs a Team Lead with the lead-only coordination duties', async () => {
    const { ctx, lead } = await setup()
    cleanups.push(mountTeamCoordination(ctx))
    const prompt = await promptFor(ctx, lead)
    expect(prompt).toContain(TITLE)
    expect(prompt).toContain('You are the Team Lead')
    expect(prompt).toContain('clarification')
    expect(prompt).toContain('Delegate')
    expect(prompt).toContain('Follow the host Team authorization')
    expect(prompt).toContain('Do not poll')
    expect(await coordinationSections(ctx, lead)).toHaveLength(1)
  })

  it('briefs a native Team member by name with the lead target and no lead duties', async () => {
    // No role catalogue exists in this context: the member is created by the
    // native Team API and still receives the coordination briefing.
    const { ctx, lead, adapter } = await setup()
    cleanups.push(mountTeamCoordination(ctx))
    const member = await spawnMember(ctx, lead, 'native-worker')
    const system = recordedSystemText(adapter, member.id)
    expect(copies(system, TITLE)).toBe(1)
    expect(system).toContain(`You are teammate ${JSON.stringify('native-worker')}`)
    expect(system).toContain('Your Team Lead is addressed as "lead".')
    expect(system).toContain('send_message({ target: "lead", message: "..." })')
    expect(system).toContain('Follow the host Team authorization')
    expect(system).toContain('Do not poll')
    expect(system).not.toContain('You are the Team Lead')
    expect(system).not.toContain('Delegate')
  })

  it('briefs an Agent that already existed before the mount without re-creating it', async () => {
    const { ctx, lead } = await setup()
    expect(await promptFor(ctx, lead)).not.toContain(TITLE)
    cleanups.push(mountTeamCoordination(ctx))
    expect(await promptFor(ctx, lead)).toContain('You are the Team Lead')
  })

  it('renders its briefing after the host Team policy', async () => {
    // The host tool plugin owns the scoped `team:policy` section this briefing follows.
    const { ctx, lead, adapter } = await setup()
    await ctx.plugin(TeamTools)
    cleanups.push(mountTeamCoordination(ctx))
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(lead))
    const host = assembly.sections.findIndex(section => section.name === HOST_POLICY)
    const ours = assembly.sections.findIndex(section => section.name === SECTION)
    expect(host).toBeGreaterThanOrEqual(0)
    expect(ours).toBeGreaterThan(host)
    const policyText = assembly.sections[host]?.text ?? ''
    const briefingText = assembly.sections[ours]?.text ?? ''
    expect(policyText).not.toBe('')
    expect(briefingText).not.toBe('')
    const rendered = renderPrompt(assembly)
    expect(rendered.indexOf(firstLine(policyText))).toBeLessThan(rendered.indexOf(firstLine(briefingText)))

    // A member's own request carries the host policy first as well.
    const member = await spawnMember(ctx, lead, 'ordered-member')
    const system = recordedSystemText(adapter, member.id)
    expect(system.indexOf(firstLine(policyText))).toBeLessThan(system.indexOf(firstLine(briefingText)))
  })

  it('stays empty without a scope, for a forged identity, and for a non-Team subagent', async () => {
    const { ctx, lead, adapter } = await setup()
    cleanups.push(mountTeamCoordination(ctx))

    // An assembly without a scope carries no identity to brief.
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(TITLE)

    // A copy that borrows a live Lead's id is not the registered Agent.
    const forged = Object.create(lead) as Agent
    expect(forged.id).toBe(lead.id)
    expect(await promptFor(ctx, forged)).not.toContain(TITLE)

    // A continuable child of the same Lead, started outside Team creation, stays a subagent.
    const childId = await startPlainSubagent(ctx, lead)
    expect(ctx.agentTeams.listMembers(lead).map(row => row.name)).toEqual(['lead'])
    expect(recordedSystemText(adapter, childId)).not.toContain(TITLE)
  })

  it('keeps one section across repeated compact notifications', async () => {
    const { ctx, lead, adapter } = await setup()
    cleanups.push(mountTeamCoordination(ctx))
    const before = await promptFor(ctx, lead)
    expect(copies(before, TITLE)).toBe(1)
    await agentEvents(ctx, lead).serial('agent/created', { source: 'compact' })
    await agentEvents(ctx, lead).serial('agent/created', { source: 'compact' })
    expect(await promptFor(ctx, lead)).toBe(before)
    expect(await coordinationSections(ctx, lead)).toHaveLength(1)

    // A member activation that carries compact notices still renders one section.
    const off = ctx.on('agent/created', async ({ agent, source }) => {
      if (source !== 'startup' || agent.session.header.parentSession !== lead.id) return
      await agentEvents(ctx, agent).serial('agent/created', { source: 'compact' })
      await agentEvents(ctx, agent).serial('agent/created', { source: 'compact' })
    })
    try {
      const member = await spawnMember(ctx, lead, 'compact-member')
      const system = recordedSystemText(adapter, member.id)
      expect(copies(system, TITLE)).toBe(1)
      expect(system).toContain(`You are teammate ${JSON.stringify('compact-member')}`)
      expect(system).not.toContain('You are the Team Lead')
    } finally {
      off()
    }
  })

  it('drops the section once the mount is disposed', async () => {
    const { ctx, lead } = await setup()
    const dispose = mountTeamCoordination(ctx)
    expect(await promptFor(ctx, lead)).toContain(TITLE)
    dispose()
    expect(await promptFor(ctx, lead)).not.toContain(TITLE)
    expect(await coordinationSections(ctx, lead)).toHaveLength(0)
  })

  it('never leaks one Team member into another Lead scope', async () => {
    const { ctx, lead, adapter } = await setup()
    cleanups.push(mountTeamCoordination(ctx))
    const otherLead = await ctx.agentLoop.create(SessionId('other-lead'), { provider: 'mock', model: 'parent' })
    const alpha = await spawnMember(ctx, lead, 'alpha')
    const beta = await spawnMember(ctx, otherLead, 'beta')
    const [leadPrompt, otherPrompt] = await Promise.all([promptFor(ctx, lead), promptFor(ctx, otherLead)])
    const alphaSystem = recordedSystemText(adapter, alpha.id)
    const betaSystem = recordedSystemText(adapter, beta.id)
    expect(leadPrompt).toContain('You are the Team Lead')
    expect(otherPrompt).toContain('You are the Team Lead')
    expect(alphaSystem).toContain(`You are teammate ${JSON.stringify('alpha')}`)
    expect(betaSystem).toContain(`You are teammate ${JSON.stringify('beta')}`)
    expect(leadPrompt).not.toContain('beta')
    expect(otherPrompt).not.toContain('alpha')
    expect(alphaSystem).not.toContain('beta')
    expect(betaSystem).not.toContain('alpha')
  })
})
