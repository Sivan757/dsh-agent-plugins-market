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
  type AgentRoleHost,
  type AgentRoleJobs
} from '../src/runtime/agent-role-router.js'
import type { Context } from '@deepseek-ai/cordis'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function hostFixture(terminal: { stopReason?: string; diagnostic?: string; output?: unknown[] } = {}) {
  // Typed against the host contract so `mock.calls` records the real argument
  // tuple; an untyped spy records `[]` and the argument assertions below are unchecked.
  // The spies are returned alongside the host because a host method read as a
  // value detaches from its receiver, and these assertions need the mock itself.
  const startContinuable = vi.fn<AgentRoleHost['subagents']['startContinuable']>(async () => ({ childId: 'child-1', messageId: 'message-1' }))
  const disposeRun = vi.fn(async () => {})
  const start = vi.fn<AgentRoleHost['subagents']['start']>(async () => ({
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
  const startJob = vi.fn<AgentRoleJobs['start']>(() => 'subagent-1')
  const jobs: AgentRoleJobs = { start: startJob }
  const host: AgentRoleHost = {
    tools: { register },
    llm: { resolveCallConfig },
    subagents: { startContinuable, start }
  }
  return { host, jobs, startJob, startContinuable, start, disposeRun, resolveCallConfig, register }
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
    const { host, startContinuable, start, startJob } = hostFixture()
    const entry = await roleFile('---\nprovider: deepseek\nmodel: deepseek-chat\ntools: [Read, Grep]\n---\nReview carefully.')
    const call = signal()
    expect(await executeAgentRole(host, async () => [entry], entry.name, 'Review my diff', parent, {}, 'continuable', call)).toEqual({ kind: 'continuable', subagentId: 'child-1' })
    expect(start).not.toHaveBeenCalled()
    expect(startJob).not.toHaveBeenCalled()
    expect(startContinuable).toHaveBeenCalledWith({
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
    // The card's Claude tool names must never reach the host as a restriction.
    expect(startContinuable.mock.calls[0]?.[0].request).not.toHaveProperty('toolFilter')
  })

  it('runs the child as a tracked job and returns its job id', async () => {
    const { host, jobs, startJob, startContinuable, start } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview carefully.')
    expect(await executeAgentRole(host, async () => [entry], entry.name, 'Review my diff', parent, {}, 'background', signal(), undefined, jobs)).toEqual({
      kind: 'background',
      jobId: 'subagent-1'
    })
    // The job is registered without starting the child: `run()` owns that.
    expect(startContinuable).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'subagent', label: entry.name, owner: parent }))
    const spec = startJob.mock.calls[0]?.[0]
    if (spec === undefined) throw new Error('expected the job spec')
    const hooks = spec.run()
    // Cancellation reaches the child's own run through its abort controller.
    hooks.cancel('enough')
    expect(await hooks.done).toEqual({ status: 'completed' })
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({ parent, maxDepth: 3, persona: 'Review carefully.' }))
  })

  it('refuses the job channel when the host jobs registry is not loaded', async () => {
    const { host } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'background', signal())).rejects.toThrow('background role jobs unavailable')
  })

  it('runs one foreground child, returns its report and always disposes the run', async () => {
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

  it('reports a foreground child that did not complete and still disposes it', async () => {
    const { host, disposeRun } = hostFixture({ stopReason: 'max-tokens', diagnostic: 'ran out of room', output: [] })
    const entry = await roleFile('---\nmodel: inherit\n---\nReview.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, {}, 'foreground', signal())).rejects.toThrow(
      'did not complete (max-tokens): ran out of room'
    )
    expect(disposeRun).toHaveBeenCalledOnce()
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
    // The role name is the first parameter; every other name matches `subagent`.
    for (const key of ['agent', 'prompt', 'provider', 'model', 'reasoning_effort', 'run_in_background']) {
      expect(definition).toHaveProperty(`parameters.properties.${key}`, expect.anything())
    }
    // Three channels, matching the host tool's discriminated result shape.
    expect(definition).toHaveProperty('output.schema.oneOf')
    expect(on).toHaveBeenCalledWith('agent/pre-step', expect.any(Function))
    dispose()
    expect(disposeListener).toHaveBeenCalledOnce()
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
    expect(startContinuable.mock.calls[0]?.[0].request.persona).toBe('Inline persona')
  })
})
