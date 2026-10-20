/** A role revoked while its model route validates must not spawn a child. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team'
import { LlmAdapter, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { executeAgentRole, type AgentRoleHost, type AgentRoleParent } from '../../../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import { mountTeammateRoleTool } from '../../../packages/market-runtime/src/runtime/agents/teammate-role-tool.js'
import type { AgentRoleEntry } from '../../../packages/market-runtime/src/application/agent-roles.js'
import type { RoleChildComposition } from '../../../packages/market-runtime/src/runtime/agents/role-composition.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
}
class QuietAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

/** One reviewable card; the frontmatter declares the route the executor should apply. */
const card = (name = 'reviewer'): AgentRoleEntry => ({
  name,
  path: '/unused/' + name + '.md',
  description: 'Review',
  disabled: false,
  rawText: '---\nprovider: mock\nmodel: card-model\n---\nCARD_PERSONA'
})
const parent = { session: { requestHeader: () => ({ config: { provider: 'mock', model: 'parent-model' } }), header: { cwd: '/workspace' } } } as unknown as AgentRoleParent
/** The composition the section channel needs; the older line never calls it. */
const composition = (): RoleChildComposition => ({ requirePersistence: () => {}, reserve: () => {}, release: () => {}, abandon: async () => {} })

function host(entered: () => void, release: Promise<void>) {
  const spawns: Array<Record<string, unknown>> = []
  const fake: AgentRoleHost = {
    tools: { register: () => () => {} },
    llm: {
      resolveCallConfig: async () => {
        entered()
        await release
        return {}
      }
    },
    subagents: {
      startContinuable: async spec => {
        spawns.push({ ...spec })
        return { childId: 'child-1', messageId: 'message-1' }
      },
      start: async (provider, request) => {
        spawns.push({ provider, request })
        return { id: 'run-1', result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }
      }
    },
    roleComposition: composition()
  }
  return { fake, spawns }
}

describe('a role revoked during model route validation never spawns', () => {
  it('spawns nothing when the role is removed while its route resolves', async () => {
    const roles: AgentRoleEntry[] = [card()]
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const { fake, spawns } = host(() => entered.resolve(), release.promise)
    const running = executeAgentRole(fake, async () => roles, 'reviewer', 'Review it', parent, {}, 'continuable', new AbortController().signal)
    await entered.promise
    // The catalog changes under the held lookup, exactly as a global disable does.
    roles.length = 0
    release.resolve()
    await expect(running).rejects.toThrow('is unavailable')
    expect(spawns).toHaveLength(0)
  })

  it('spawns nothing when the role is disabled while its route resolves', async () => {
    const roles: AgentRoleEntry[] = [card()]
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const { fake, spawns } = host(() => entered.resolve(), release.promise)
    const running = executeAgentRole(fake, async () => roles, 'reviewer', 'Review it', parent, {}, 'foreground', new AbortController().signal)
    await entered.promise
    roles[0] = { ...card(), disabled: true }
    release.resolve()
    await expect(running).rejects.toThrow('is disabled')
    expect(spawns).toHaveLength(0)
  })

  it('spawns exactly one child with the card route when the role still stands', async () => {
    const roles: AgentRoleEntry[] = [card()]
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const { fake, spawns } = host(() => entered.resolve(), release.promise)
    const running = executeAgentRole(fake, async () => roles, 'reviewer', 'Review it', parent, {}, 'continuable', new AbortController().signal)
    await entered.promise
    release.resolve()
    await expect(running).resolves.toEqual({ kind: 'continuable', subagentId: 'child-1' })
    expect(spawns).toHaveLength(1)
    const started = spawns[0] as { provider: string; label: string; request: { persona: string; maxDepth: number; agentOptions?: { provider?: string; model?: string } } }
    expect(started.provider).toBe('spawn')
    expect(started.label).toBe('reviewer')
    expect(started.request.persona).toContain('CARD_PERSONA')
    expect(started.request.agentOptions).toMatchObject({ provider: 'mock', model: 'card-model' })
  })

  it('drops the request persona on the activation line, the same call site that keeps it on the deferring line', async () => {
    const roles: AgentRoleEntry[] = [card()]
    const spawns: Array<Record<string, unknown>> = []
    const activationHost: AgentRoleHost = {
      tools: { register: () => () => {} },
      llm: { resolveCallConfig: async () => ({}) },
      subagents: {
        startActivation: async spec => {
          spawns.push({ ...spec })
          // The composed channel publishes the reserved identity.
          return { childId: spec.childId ?? 'host-generated', result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }
        }
      },
      roleComposition: composition()
    }
    const outcome = await executeAgentRole(activationHost, async () => roles, 'reviewer', 'Review it', parent, {}, 'continuable', new AbortController().signal)
    const started = spawns[0] as { label: string; request: Record<string, unknown>; childId?: string }
    // The host publishes the identity this call reserved.
    expect(outcome).toEqual({ kind: 'continuable', subagentId: started.childId })
    expect(started.label).toBe('reviewer')
    // The card body travels as the child's own prompt section on this line,
    // never as the removed request field.
    expect(started.request).not.toHaveProperty('persona')
  })

  it('keeps the teammate path closed when the role is revoked mid-validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-role-final-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    // 0.2.1 mounts the subagent service behind the working-directory service.
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(Persistence, { root })
    await ctx.plugin(TestQuery)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Subagents)
    await ctx.plugin(Spawn)
    await ctx.plugin(TeamService)
    await ctx.plugin(TeamTools)
    ctx.llm.registerAdapter(['mock'], new QuietAdapter())
    const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'parent' })
    const roles: AgentRoleEntry[] = [card()]
    const dispose = await mountTeammateRoleTool(ctx, async () => roles)
    cleanups.push(dispose)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const service = ctx.llm as unknown as { resolveCallConfig: (...args: unknown[]) => Promise<unknown> }
    const original = service.resolveCallConfig
    service.resolveCallConfig = async (...args: unknown[]) => {
      entered.resolve()
      await release.promise
      return original.apply(service, args)
    }
    const running = ctx.tools.execute({
      name: 'spawn_teammate_role',
      arguments: { agent: 'reviewer', name: 'revoked-member', description: 'Review', prompt: 'Review it', provider: 'mock', model: 'override-model' },
      agent: lead,
      callId: ToolCallId('spawn_teammate_role'),
      signal: new AbortController().signal
    })
    await entered.promise
    roles.length = 0
    release.resolve()
    const result = await running
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected a refusal')
    expect(result.error.message).toContain('is unavailable')
    // No member was created, and the native Team tools keep their own behavior.
    expect(ctx.agentTeams.listMembers(lead).map(member => member.name)).toEqual(['lead'])
    expect(ctx.tools.get('spawn_teammate', lead)).toBeDefined()
  })
})
