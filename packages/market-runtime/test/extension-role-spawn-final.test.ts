/** A role revoked while its model route validates must not spawn a child. */
import { describe, expect, it } from 'vitest'
import { executeAgentRole, type AgentRoleHost, type AgentRoleParent } from '../../../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import type { AgentRoleEntry } from '../../../packages/market-runtime/src/application/agent-roles.js'
import type { RoleChildComposition } from '../../../packages/market-runtime/src/runtime/agents/role-composition.js'

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
    const started = spawns[0] as Record<string, unknown> & { label: string; childId?: string }
    // The host publishes the identity this call reserved.
    expect(outcome).toEqual({ kind: 'continuable', subagentId: started.childId })
    expect(started.label).toBe('reviewer')
    // This line spreads the child request into the spec, so the parent and prompt
    // arrive as top-level fields.
    expect(started).toHaveProperty('parent')
    expect(started).toHaveProperty('prompt')
    // The card body travels as the child's own prompt section on this line,
    // never as the removed request field.
    expect(started).not.toHaveProperty('persona')
  })
})
