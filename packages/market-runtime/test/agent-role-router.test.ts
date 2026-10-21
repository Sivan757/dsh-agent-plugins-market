import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentRoleCatalog,
  executeAgentRole,
  mountAgentRoleTool,
  parseAgentRole,
  resolveAgentOptions,
  type AgentRoleHost
} from '../../../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import type { Context } from '@deepseek-ai/cordis'
import type { RoleChildComposition } from '../../../packages/market-runtime/src/runtime/agents/role-composition.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * The role composition the section channel needs. The router refuses without
 * one, so every fixture supplies it and the section cases can assert what was
 * reserved and released.
 */
function compositionFixture() {
  const requirePersistence = vi.fn<RoleChildComposition['requirePersistence']>()
  const reserve = vi.fn<RoleChildComposition['reserve']>()
  const release = vi.fn<RoleChildComposition['release']>()
  const abandon = vi.fn<RoleChildComposition['abandon']>(async () => {})
  const roleComposition: RoleChildComposition = { requirePersistence, reserve, release, abandon }
  return { roleComposition, requirePersistence, reserve, release, abandon }
}

function hostFixture(terminal: { stopReason?: string; diagnostic?: string; output?: unknown[] } = {}) {
  // Typed against the host contract so `mock.calls` records the real argument
  // tuple; an untyped spy records `[]` and the argument assertions below are unchecked.
  // The spies are returned alongside the host because a host method read as a
  // value detaches from its receiver, and these assertions need the mock itself.
  const startContinuable = vi.fn<NonNullable<AgentRoleHost['subagents']['startContinuable']>>(async () => ({ childId: 'child-1', messageId: 'message-1' }))
  const disposeRun = vi.fn(async () => {})
  const start = vi.fn<NonNullable<AgentRoleHost['subagents']['start']>>(async () => ({
    id: 'child-1',
    result: Promise.resolve({
      output: terminal.output ?? [{ type: 'text', text: 'Looks correct.' }],
      stopReason: terminal.stopReason ?? 'completed',
      ...(terminal.diagnostic === undefined ? {} : { diagnostic: terminal.diagnostic })
    }),
    dispose: disposeRun
  }))
  const resolveCallConfig = vi.fn<AgentRoleHost['llm']['resolveCallConfig']>(async config => config)
  const register = vi.fn<AgentRoleHost['tools']['register']>(() => vi.fn())
  const composition = compositionFixture()
  const host: AgentRoleHost = {
    tools: { register },
    llm: { resolveCallConfig },
    subagents: { startContinuable, start },
    roleComposition: composition.roleComposition
  }
  return { host, startContinuable, start, disposeRun, resolveCallConfig, register, composition }
}

/**
 * The 0.2.1 host line: one activation member and no one-shot start at all. A
 * fixture that carries both members cannot report the foreground crash this
 * suite exists to prevent.
 */
function activationHostFixture(terminal: { stopReason?: string; diagnostic?: string; output?: unknown[] } = {}) {
  // Typed against the host contract so `mock.calls` records the real argument
  // tuple; an untyped spy records `[]` and the argument assertions below are unchecked.
  const disposeActivation = vi.fn(async () => {})
  // A real activation publishes the identity the caller reserved. A fixture with
  // a fixed id would hide the router's identity guard on this line.
  const startActivation = vi.fn<NonNullable<AgentRoleHost['subagents']['startActivation']>>(async spec => ({
    childId: spec.childId ?? 'host-generated',
    messageId: 'message-1',
    result: Promise.resolve({
      output: terminal.output ?? [{ type: 'text', text: 'Looks correct.' }],
      stopReason: terminal.stopReason ?? 'completed',
      ...(terminal.diagnostic === undefined ? {} : { diagnostic: terminal.diagnostic })
    }),
    dispose: disposeActivation
  }))
  const resolveCallConfig = vi.fn<AgentRoleHost['llm']['resolveCallConfig']>(async config => config)
  const register = vi.fn<AgentRoleHost['tools']['register']>(() => vi.fn())
  const composition = compositionFixture()
  const host: AgentRoleHost = {
    tools: { register },
    llm: { resolveCallConfig },
    subagents: { startActivation },
    roleComposition: composition.roleComposition
  }
  return { host, startActivation, disposeActivation, resolveCallConfig, register, composition }
}

async function roleFile(text: string) {
  const root = await mkdtemp(join(tmpdir(), 'market-role-'))
  roots.push(root)
  const path = join(root, 'reviewer.md')
  await writeFile(path, text)
  return { name: 'source/suite/reviewer', path, description: 'Review code', disabled: false }
}

const signal = () => new AbortController().signal
const parent = { options: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } }

describe('agent role metadata and runtime routing', () => {
  it('enforces metadata in BOM and CRLF files accepted by the editor', () => {
    expect(parseAgentRole('\uFEFF---\r\nmodel: inherit\r\n--- \t\r\nBody')).toEqual({ content: 'Body', disabled: false })
    expect(() => parseAgentRole('\uFEFF---\nmodel: x')).toThrow('not closed')
  })

  it('keeps Claude tool lists in the file without turning them into execution input', () => {
    // The card dialect declares Claude Code tool names; the host registry has
    // different, case-sensitive names, so the router must not consume them.
    expect(parseAgentRole('---\nmodel: deepseek/deepseek-chat\ntools: Read, Grep\ndisallowedTools:\n  - Bash\n---\nReview carefully.')).toEqual({
      model: 'deepseek/deepseek-chat',
      disabled: false,
      content: 'Review carefully.'
    })
    expect(parseAgentRole('---\nmodel: inherit\ntools: false\n---\ncard')).toEqual({ content: 'card', disabled: false })
  })

  it('fails closed on malformed frontmatter and on contradicting routing metadata', () => {
    for (const text of [
      '---\nmodel: [bad\n---\nbody',
      '---\nmodel: x',
      '---\nmodel: a\nmodel: b\n---\nbody',
      '---\ndisabled: "false"\n---\nbody',
      '---\nmodel: inherit\nprovider: deepseek\n---\nbody',
      '---\nprovider: ""\n---\nbody'
    ]) {
      expect(() => parseAgentRole(text)).toThrow()
    }
  })

  it('applies an exact provider and model pair from the card through host preflight', async () => {
    const { host, resolveCallConfig } = hostFixture()
    const call = signal()
    expect(
      await resolveAgentOptions(parseAgentRole('---\nprovider: deepseek\nmodel: deepseek-chat\nreasoning_effort: high\n---\nbody'), {}, parent, host.llm, call, 'reviewer', vi.fn())
    ).toEqual({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, call)
  })

  it('degrades every inexact route to inheritance and reports why', async () => {
    const { host, resolveCallConfig } = hostFixture()
    for (const metadata of ['model: sonnet', 'model: deepseek/deepseek-chat', 'model: GPT-4.1', 'provider: deepseek']) {
      const diagnose = vi.fn()
      const declared = parseAgentRole(`---\n${metadata}\n---\nbody`)
      expect(await resolveAgentOptions(declared, {}, parent, host.llm, signal(), 'reviewer', diagnose)).toBeUndefined()
      expect(diagnose).toHaveBeenCalled()
    }
    expect(resolveCallConfig).not.toHaveBeenCalled()
  })

  it('inherits silently when the card declares no route at all', async () => {
    const { host, resolveCallConfig } = hostFixture()
    const diagnose = vi.fn()
    expect(await resolveAgentOptions(parseAgentRole('---\nmodel: inherit\n---\nbody'), {}, parent, host.llm, signal(), 'reviewer', diagnose)).toBeUndefined()
    expect(await resolveAgentOptions(parseAgentRole('body only'), {}, parent, host.llm, signal(), 'reviewer', diagnose)).toBeUndefined()
    expect(diagnose).not.toHaveBeenCalled()
    expect(resolveCallConfig).not.toHaveBeenCalled()
  })

  it('validates a lone reasoning effort against the inherited route', async () => {
    const { host, resolveCallConfig } = hostFixture()
    const call = signal()
    expect(await resolveAgentOptions(parseAgentRole('---\nreasoning_effort: low\n---\nbody'), {}, parent, host.llm, call, 'reviewer', vi.fn())).toEqual({ reasoningEffort: 'low' })
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' }, call)
  })

  it("lets the call's exact route override the card's route", async () => {
    const { host, resolveCallConfig } = hostFixture()
    const call = signal()
    expect(
      await resolveAgentOptions(
        parseAgentRole('---\nprovider: workbuddy\nmodel: hy3\nreasoning_effort: high\n---\nbody'),
        { provider: 'deepseek', model: 'deepseek-reasoner' },
        parent,
        host.llm,
        call,
        'reviewer',
        vi.fn()
      )
    ).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner' })
    // An explicit route change starts from the selected model's default effort,
    // so the card's effort never leaks onto a route it was not written for.
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-reasoner' }, call)
  })

  it("starts from the selected model's default when the call names a route", async () => {
    const { host, resolveCallConfig } = hostFixture()
    const call = signal()
    // The same pair as the card is still an explicit call-side choice, so the
    // card's effort does not leak onto it.
    expect(
      await resolveAgentOptions(
        parseAgentRole('---\nprovider: workbuddy\nmodel: hy3\nreasoning_effort: high\n---\nbody'),
        { provider: 'workbuddy', model: 'hy3' },
        parent,
        host.llm,
        call,
        'reviewer',
        vi.fn()
      )
    ).toEqual({ provider: 'workbuddy', model: 'hy3' })
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'workbuddy', model: 'hy3' }, call)
  })

  it("takes the call's own effort, and reports an inexact call route", async () => {
    const { host } = hostFixture()
    const diagnose = vi.fn()
    expect(
      await resolveAgentOptions(
        parseAgentRole('---\nprovider: workbuddy\nmodel: hy3\nreasoning_effort: high\n---\nbody'),
        { reasoningEffort: 'low' },
        parent,
        host.llm,
        signal(),
        'reviewer',
        diagnose
      )
    ).toEqual({ provider: 'workbuddy', model: 'hy3', reasoningEffort: 'low' })
    // A lone call-side field is inexact on the call's side, not only on the card's.
    expect(await resolveAgentOptions(parseAgentRole('body only'), { provider: 'deepseek' }, parent, host.llm, signal(), 'reviewer', diagnose)).toBeUndefined()
    expect(diagnose).toHaveBeenCalledWith(expect.stringContaining("the call's route"))
  })

  it('degrades an unusable route instead of failing the call', async () => {
    const { host, resolveCallConfig } = hostFixture()
    const diagnose = vi.fn()
    resolveCallConfig.mockRejectedValueOnce(new Error('unsupported reasoning effort'))
    expect(
      await resolveAgentOptions(
        parseAgentRole('---\nprovider: deepseek\nmodel: deepseek-chat\nreasoning_effort: nope\n---\nbody'),
        {},
        parent,
        host.llm,
        signal(),
        'reviewer',
        diagnose
      )
    ).toBeUndefined()
    expect(diagnose).toHaveBeenCalledWith(expect.stringContaining('unusable'))
  })

  it('propagates cancellation raised during preflight', async () => {
    const { host, resolveCallConfig } = hostFixture()
    const controller = new AbortController()
    resolveCallConfig.mockImplementationOnce(async () => {
      controller.abort()
      return {}
    })
    await expect(
      resolveAgentOptions(parseAgentRole('---\nprovider: deepseek\nmodel: deepseek-chat\n---\nbody'), {}, parent, host.llm, controller.signal, 'reviewer', vi.fn())
    ).rejects.toThrow()
  })

  it('starts a continuable child and returns its durable id without waiting', async () => {
    const { host, startContinuable, start } = hostFixture()
    const entry = await roleFile('---\nprovider: deepseek\nmodel: deepseek-chat\ntools: [Read, Grep]\n---\nReview carefully.')
    const call = signal()
    expect(await executeAgentRole(host, async () => [entry], entry.name, 'Review my diff', parent, {}, 'continuable', call)).toEqual({ kind: 'continuable', subagentId: 'child-1' })
    expect(start).not.toHaveBeenCalled()
    expect(startContinuable).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'spawn',
        label: entry.name,
        request: {
          prompt: [{ type: 'text', text: 'Review my diff' }],
          parent,
          maxDepth: 3,
          persona: 'Review carefully.',
          agentOptions: { provider: 'deepseek', model: 'deepseek-chat' }
        },
        signal: call
      })
    )
    // The plugin reserves the child identity before the host start call.
    expect(startContinuable.mock.calls[0]?.[0].childId).toMatch(/^[0-9a-f-]{36}$/)
    // The card's Claude tool names must never reach the host as a restriction.
    expect(startContinuable.mock.calls[0]?.[0].request).not.toHaveProperty('toolFilter')
  })

  it('runs one foreground child on the older line through start and never touches the activation member', async () => {
    const { host, start, disposeRun, startContinuable } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    expect(await executeAgentRole(host, async () => [entry], entry.name, 'Review my diff', parent, {}, 'foreground', signal())).toEqual({
      kind: 'foreground',
      runId: 'child-1',
      output: [{ type: 'text', text: 'Looks correct.' }]
    })
    expect(startContinuable).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({ parent, maxDepth: 3, persona: 'Review carefully.' }))
    expect(disposeRun).toHaveBeenCalledOnce()
  })

  it('runs one foreground child on the 0.2.1 line through startActivation and disposes it once', async () => {
    const { host, startActivation, disposeActivation } = activationHostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    const call = signal()
    expect(await executeAgentRole(host, async () => [entry], entry.name, 'Review my diff', parent, {}, 'foreground', call)).toEqual({
      kind: 'foreground',
      // The host published the id this call reserved, which is the run identity.
      runId: startActivation.mock.calls[0]?.[0].childId,
      output: [{ type: 'text', text: 'Looks correct.' }]
    })
    expect(startActivation).toHaveBeenCalledWith(expect.objectContaining({ provider: 'spawn', label: entry.name, delivery: 'caller', signal: call }))
    expect(disposeActivation).toHaveBeenCalledOnce()
  })

  it('reports a foreground child that did not complete, on both host lines, and still disposes it', async () => {
    const entry = await roleFile('---\nmodel: inherit\n---\nReview.')
    const older = hostFixture({ stopReason: 'max-tokens', diagnostic: 'ran out of room', output: [] })
    await expect(executeAgentRole(older.host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())).rejects.toThrow(
      'did not complete (max-tokens): ran out of room'
    )
    expect(older.disposeRun).toHaveBeenCalledOnce()
    const newer = activationHostFixture({ stopReason: 'max-tokens', diagnostic: 'ran out of room', output: [] })
    await expect(executeAgentRole(newer.host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())).rejects.toThrow(
      'did not complete (max-tokens): ran out of room'
    )
    expect(newer.disposeActivation).toHaveBeenCalledOnce()
  })

  it('refuses a host that exposes neither foreground start member before creating a child', async () => {
    const register = vi.fn<AgentRoleHost['tools']['register']>(() => vi.fn())
    const host: AgentRoleHost = {
      tools: { register },
      llm: { resolveCallConfig: vi.fn<AgentRoleHost['llm']['resolveCallConfig']>(async config => config) },
      subagents: {},
      roleComposition: compositionFixture().roleComposition
    }
    const entry = await roleFile('---\nmodel: inherit\n---\nReview.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())).rejects.toThrow('no start or startActivation member')
  })

  it('builds one request shape per host line from the same call site', async () => {
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    const older = hostFixture()
    await executeAgentRole(older.host, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())
    const olderRequest = older.startContinuable.mock.calls[0]?.[0].request as Record<string, unknown>
    expect(olderRequest.persona).toBe('Review carefully.')

    const newer = activationHostFixture()
    await executeAgentRole(newer.host, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())
    const newerRequest = newer.startActivation.mock.calls[0]?.[0].request as Record<string, unknown>
    // The 0.2.1 line removed the request field; the plugin composes a section instead.
    expect(newerRequest).not.toHaveProperty('persona')

    const newerForeground = activationHostFixture()
    await executeAgentRole(newerForeground.host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())
    expect(newerForeground.startActivation.mock.calls[0]?.[0].request).not.toHaveProperty('persona')

    const olderForeground = hostFixture()
    await executeAgentRole(olderForeground.host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())
    expect(olderForeground.start.mock.calls[0]?.[1]).toMatchObject({ persona: 'Review carefully.' })
  })

  it('mints one SessionId child identity and returns it as both subagentId and runId', async () => {
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    const disposeActivation = vi.fn(async () => {})
    const startActivation = vi.fn<NonNullable<AgentRoleHost['subagents']['startActivation']>>(async spec => ({
      childId: spec.childId ?? 'generated',
      messageId: 'message-1',
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: disposeActivation
    }))
    const composition = compositionFixture()
    const host: AgentRoleHost = {
      tools: { register: vi.fn<AgentRoleHost['tools']['register']>(() => vi.fn()) },
      llm: { resolveCallConfig: vi.fn<AgentRoleHost['llm']['resolveCallConfig']>(async config => config) },
      subagents: { startActivation },
      roleComposition: composition.roleComposition
    }
    const continuable = await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())
    const reserved = startActivation.mock.calls[0]?.[0].childId
    expect(reserved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(continuable).toEqual({ kind: 'continuable', subagentId: reserved })
    const foreground = await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())
    const reservedForeground = startActivation.mock.calls[1]?.[0].childId
    expect(foreground).toMatchObject({ kind: 'foreground', runId: reservedForeground })
  })

  it('passes the same minted identity to the older continuable member that honours it', async () => {
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    const startContinuable = vi.fn<NonNullable<AgentRoleHost['subagents']['startContinuable']>>(async spec => ({
      childId: spec.childId ?? 'generated',
      messageId: 'message-1'
    }))
    const host: AgentRoleHost = {
      tools: { register: vi.fn<AgentRoleHost['tools']['register']>(() => vi.fn()) },
      llm: { resolveCallConfig: vi.fn<AgentRoleHost['llm']['resolveCallConfig']>(async config => config) },
      subagents: { startContinuable },
      roleComposition: compositionFixture().roleComposition
    }
    const result = await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())
    const reserved = startContinuable.mock.calls[0]?.[0].childId
    expect(reserved).toBeDefined()
    expect(result).toEqual({ kind: 'continuable', subagentId: reserved })
  })

  it('refuses the section channel when the role composition is not mounted', async () => {
    // The mount reaches the host through a cast, so the required field is a
    // compile-time guarantee only. A host built outside that view must refuse
    // rather than start a child with no role instructions.
    const { host, startActivation, composition } = activationHostFixture()
    const bare = { ...host, roleComposition: undefined } as unknown as AgentRoleHost
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    await expect(executeAgentRole(bare, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())).rejects.toThrow(
      'agent "source/suite/reviewer" cannot run without its role instructions: the role composition is not mounted'
    )
    expect(startActivation).not.toHaveBeenCalled()
    expect(composition.reserve).not.toHaveBeenCalled()
  })

  it('refuses a host that publishes its own identity on the composed continuable channel', async () => {
    const { host, startActivation, composition } = activationHostFixture()
    // A host that accepts the spec and allocates another id leaves the child
    // uncomposed: the reservation and the durable binding are keyed by the
    // reserved id.
    startActivation.mockImplementationOnce(async () => ({
      childId: 'host-generated',
      messageId: 'message-1',
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: async () => {}
    }))
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())).rejects.toThrow(
      'agent "source/suite/reviewer" cannot run without its role instructions: the host published child "host-generated" for the reserved child "'
    )
    const reservedId = composition.reserve.mock.calls[0]?.[0]
    expect(reservedId).toMatch(/^[0-9a-f-]{36}$/)
    // The child the host published is released, not left resident without its
    // instructions, and the failed call leaves no reservation behind.
    expect(composition.abandon).toHaveBeenCalledWith('host-generated')
    expect(composition.release).toHaveBeenCalledWith(reservedId)
  })

  it('refuses a host that publishes its own identity on the composed foreground channel and still disposes the run', async () => {
    const { host, startActivation, disposeActivation, composition } = activationHostFixture()
    startActivation.mockImplementationOnce(async () => ({
      childId: 'host-generated',
      messageId: 'message-1',
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: disposeActivation
    }))
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())).rejects.toThrow(
      'the host published child "host-generated" for the reserved child "'
    )
    // The guard runs inside the try, so the run is still released once.
    expect(disposeActivation).toHaveBeenCalledOnce()
    expect(composition.release).toHaveBeenCalledOnce()
  })

  it('surfaces the identity refusal even when the release stalls', async () => {
    const { host, startActivation, composition } = activationHostFixture()
    startActivation.mockImplementationOnce(async () => ({
      childId: 'host-generated',
      messageId: 'message-1',
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: async () => {}
    }))
    // The real composition bounds its release; this asserts the caller does not
    // wait on that bound to learn the call failed.
    let releaseResolved = false
    composition.abandon.mockImplementation(async () => {
      releaseResolved = true
    })
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())).rejects.toThrow('the host published child')
    expect(releaseResolved).toBe(true)
    expect(composition.release).toHaveBeenCalledOnce()
  })

  it('keeps the older line host-allocated foreground identity', async () => {
    // The older one-shot start allocates its own id and cannot take the reserved
    // one, so the identity guard belongs to the composed channel only.
    const { host, start } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    expect(await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())).toMatchObject({
      kind: 'foreground',
      runId: 'child-1'
    })
    expect(start).toHaveBeenCalledOnce()
  })

  it('rejects disabled, missing and ambiguous roles before starting a child', async () => {
    const { host, startContinuable, start } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, '   ', parent, {}, 'continuable', signal())).rejects.toThrow('non-empty prompt')
    await expect(executeAgentRole(host, async () => [], entry.name, 'Review', parent, {}, 'continuable', signal())).rejects.toThrow('unavailable')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', undefined, {}, 'continuable', signal())).rejects.toThrow('calling agent')
    await writeFile(entry.path, '---\ndisabled: true\n---\nReview.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'continuable', signal())).rejects.toThrow('disabled')
    expect(startContinuable).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('registers subagent_role with the subagent parameter surface and a disposer', () => {
    const { host, register } = hostFixture()
    const disposeListener = vi.fn()
    const on = vi.fn(() => disposeListener)
    const dispose = mountAgentRoleTool({ ...host, on } as unknown as Context, async () => [])
    // The call shape is asserted first, then the definition by path: the tool
    // schema is the contract the model sees, and `register` records it as an
    // opaque value, so a nested matcher cannot be typed there.
    expect(register).toHaveBeenCalledWith(expect.anything())
    const [call] = register.mock.calls
    if (call === undefined) throw new Error('expected the agent role tool to register exactly once')
    const [definition] = call
    expect(definition).toHaveProperty('name', 'subagent_role')
    expect(definition).toHaveProperty('parameters.required', ['agent', 'prompt'])
    expect(definition).toHaveProperty('parameters.properties.agent.description', 'Exact callable role name listed in the current "subagent-catalog" message.')
    // The role name is the first parameter; every other name matches `subagent`.
    for (const key of ['agent', 'prompt', 'provider', 'model', 'reasoning_effort', 'run_in_background']) {
      expect(definition).toHaveProperty(`parameters.properties.${key}`, expect.anything())
    }
    // Two channels, matching the host tool's discriminated result shape.
    expect(definition).toHaveProperty('output.schema.oneOf')
    expect(on).toHaveBeenCalledWith('agent/pre-step', expect.any(Function))
    // The mount owns the role composition, so it subscribes to child creation too.
    expect(on).toHaveBeenCalledWith('agent/created', expect.any(Function))
    expect(on).toHaveBeenCalledWith('agent/disposed', expect.any(Function))
    dispose()
    // Every registration is released; the fake returns one shared disposer.
    expect(disposeListener).toHaveBeenCalledTimes(on.mock.calls.length)
  })

  it('maps run_in_background to the two channels on both host lines', async () => {
    // The parameter keeps the host tool's own two-value semantics, so the
    // mapping is asserted through the registered tool rather than by calling
    // the executor with a mode the model cannot actually select.
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    const invoke = async (args: Record<string, unknown>, line: 'older' | 'newer') => {
      const fixture = line === 'older' ? hostFixture() : activationHostFixture()
      const { register } = fixture
      // The 0.2.1 channel reserves a durable binding before the start call, so the
      // mount only needs the two persistence services to be readable.
      const services = new Map<string, unknown>([
        ['sessionQuery', {}],
        ['sessions', { flush: async () => true }]
      ])
      const dispose = mountAgentRoleTool({ ...fixture.host, on: vi.fn(() => vi.fn()), get: (name: string) => services.get(name) } as unknown as Context, async () => [entry])
      try {
        const [call] = register.mock.calls
        if (call === undefined) throw new Error('expected the agent role tool to register exactly once')
        const definition = call[0] as { execute(args: Record<string, unknown>, exec: { agent: unknown; signal: AbortSignal }): Promise<unknown> }
        return { result: await definition.execute(args, { agent: parent, signal: signal() }), fixture, dispose }
      } finally {
        dispose()
      }
    }

    for (const args of [
      { agent: entry.name, prompt: 'Review' },
      { agent: entry.name, prompt: 'Review', run_in_background: true }
    ]) {
      const { result, fixture } = await invoke(args, 'older')
      expect(result).toEqual({ kind: 'continuable', subagentId: 'child-1' })
      if (!('startContinuable' in fixture)) throw new Error('expected the older fixture')
      expect(fixture.startContinuable).toHaveBeenCalledOnce()
      expect(fixture.start).not.toHaveBeenCalled()
    }

    const olderForeground = await invoke({ agent: entry.name, prompt: 'Review', run_in_background: false }, 'older')
    expect(olderForeground.result).toEqual({ kind: 'foreground', runId: 'child-1', output: [{ type: 'text', text: 'Looks correct.' }] })
    if (!('start' in olderForeground.fixture)) throw new Error('expected the older fixture')
    expect(olderForeground.fixture.start).toHaveBeenCalledOnce()
    expect(olderForeground.fixture.startContinuable).not.toHaveBeenCalled()

    const newerForeground = await invoke({ agent: entry.name, prompt: 'Review', run_in_background: false }, 'newer')
    if (!('startActivation' in newerForeground.fixture)) throw new Error('expected the newer fixture')
    expect(newerForeground.result).toEqual({
      kind: 'foreground',
      runId: newerForeground.fixture.startActivation.mock.calls[0]?.[0].childId,
      output: [{ type: 'text', text: 'Looks correct.' }]
    })
    expect(newerForeground.fixture.startActivation).toHaveBeenCalledWith(expect.objectContaining({ delivery: 'caller' }))
  })

  it('catalogs roles with exact routes only and reads inline definitions', async () => {
    const entry = await roleFile('---\nname: Reviewer\ndescription: Review\nmodel: inherit\n---\nSecret persona')
    const signalValue = signal()
    const diagnose = vi.fn()
    const invalid = { ...entry, name: 'invalid', rawText: '---\nreasoning_effort: false\n---\nBad' }
    expect(await agentRoleCatalog([entry, entry, invalid], signalValue, diagnose)).toEqual([])
    expect(diagnose).toHaveBeenCalled()
    const inline = { ...entry, name: 'inline', path: '/unused/plugin.json', rawText: '---\nname: Inline\nprovider: deepseek\nmodel: deepseek-chat\n---\nInline persona' }
    const inexact = { ...entry, name: 'alias', path: '/unused/plugin.json', rawText: '---\nname: Alias\nmodel: sonnet\n---\nAlias persona' }
    const summaries = await agentRoleCatalog([inline, inexact, entry], signalValue)
    expect(summaries.find(role => role.name === 'inline')).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat' })
    // An unresolvable Claude alias must not be advertised as a usable route.
    expect(summaries.find(role => role.name === 'alias')).not.toHaveProperty('provider')
    expect(summaries.find(role => role.name === 'alias')).not.toHaveProperty('model')
    const { host, startContinuable } = hostFixture()
    await executeAgentRole(host, async () => [inline], 'inline', 'Review', parent, {}, 'continuable', signalValue)
    expect((startContinuable.mock.calls[0]?.[0].request as { persona?: string }).persona).toBe('Inline persona')
  })
})
