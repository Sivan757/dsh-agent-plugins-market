import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentRoleCatalog, executeAgentRole, mountAgentRoleTool, parseAgentRole, resolveAgentModel, type AgentRoleHost } from '../src/runtime/agent-role-router.js'
import type { Context } from '@deepseek-ai/cordis'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function hostFixture() {
  const dispose = vi.fn()
  const start = vi.fn(async () => ({ id: 'child-1', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] }), dispose }))
  const host: AgentRoleHost = {
    tools: { register: vi.fn(() => vi.fn()) },
    llm: { listProviders: () => [{ id: 'deepseek' }, { id: 'other' }], listModels: async () => [{ id: 'shared-model' }], resolveCallConfig: vi.fn(async config => config) },
    subagents: { start }
  }
  return { host, start, dispose }
}

async function roleFile(text: string) {
  const root = await mkdtemp(join(tmpdir(), 'market-role-'))
  roots.push(root)
  const path = join(root, 'reviewer.md')
  await writeFile(path, text)
  return { name: 'source/suite/reviewer', path, description: 'Review code', disabled: false }
}

describe('agent role metadata and runtime routing', () => {
  it('enforces metadata in BOM and CRLF files accepted by the editor', () => {
    expect(parseAgentRole('\uFEFF---\r\nmodel: inherit\r\ntools: []\r\n--- \t\r\nBody')).toEqual({ content: 'Body', tools: [], disabled: false })
    expect(() => parseAgentRole('\uFEFF---\nmodel: x')).toThrow('not closed')
  })
  it('parses Claude comma-separated tools and YAML list disallowedTools without consuming body content', () => {
    expect(parseAgentRole('---\nmodel: deepseek/deepseek-chat\ntools: read, grep\ndisallowedTools:\n  - bash\n---\nReview carefully.')).toEqual({
      model: 'deepseek/deepseek-chat',
      tools: ['read', 'grep'],
      disallowedTools: ['bash'],
      disabled: false,
      content: 'Review carefully.'
    })
    expect(parseAgentRole('---\nmodel: inherit\ntools: []\n---\ncard')).toEqual({ tools: [], content: 'card', disabled: false })
  })

  it('fails closed on invalid frontmatter or tool declarations', () => {
    for (const text of [
      '---\nmodel: [bad\n---\nbody',
      '---\nmodel: x',
      '---\ntools: false\n---\nbody',
      '---\nmodel: a\nmodel: b\n---\nbody',
      '---\ndisabled: "false"\n---\nbody'
    ]) {
      expect(() => parseAgentRole(text)).toThrow()
    }
  })

  it('resolves explicit routes without relying on remote catalogs and rejects ambiguous bare ids and Claude aliases', async () => {
    const { host } = hostFixture()
    expect(await resolveAgentModel(parseAgentRole('---\nmodel: deepseek/deepseek-chat\n---\nbody'), host.llm)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(await resolveAgentModel(parseAgentRole('---\nprovider: deepseek\nmodel: vendor/model\n---\nbody'), host.llm)).toEqual({ provider: 'deepseek', model: 'vendor/model' })
    await expect(resolveAgentModel(parseAgentRole('---\nmodel: shared-model\n---\nbody'), host.llm)).rejects.toThrow('ambiguous')
    await expect(resolveAgentModel(parseAgentRole('---\nmodel: sonnet\n---\nbody'), host.llm)).rejects.toThrow('not advertised')
    await expect(resolveAgentModel(parseAgentRole('---\nprovider: absent\nmodel: model\n---\nbody'), host.llm)).rejects.toThrow('not registered')
  })

  it('runs the selected persona with model options, tool restrictions, parent, cancellation and depth cap', async () => {
    const { host, start, dispose } = hostFixture()
    const entry = await roleFile('---\nmodel: deepseek/deepseek-chat\ntools: [read, grep]\ndisallowedTools: bash\n---\nReview carefully.')
    const parent = { id: 'parent-1' }
    const signal = new AbortController().signal
    expect(await executeAgentRole(host, async () => [entry], entry.name, 'Review my diff', parent, signal)).toEqual({ runId: 'child-1', output: [{ type: 'text', text: 'done' }] })
    expect(start).toHaveBeenCalledWith('spawn', {
      label: entry.name,
      parent,
      signal,
      maxDepth: 3,
      prompt: [{ type: 'text', text: 'Review my diff' }],
      persona: 'Review carefully.',
      agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
      toolFilter: { allow: ['read', 'grep'], deny: ['bash'] }
    })
    expect(dispose).toHaveBeenCalledOnce()
    await writeFile(entry.path, '---\ndisabled: true\n---\nReview carefully.')
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Again', parent, signal)).rejects.toThrow('disabled')
    expect(start).toHaveBeenCalledTimes(1)
    await expect(executeAgentRole(host, async () => [], entry.name, 'Again', parent, signal)).rejects.toThrow('unavailable')
  })

  it('disposes failed runs and preserves failure and partial output', async () => {
    const { host, start, dispose } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview.')
    start.mockResolvedValue({ id: 'child-1', result: Promise.resolve({ stopReason: 'max-tokens', output: [{ type: 'text', text: 'partial' }] }), dispose })
    await expect(
      executeAgentRole(host, async () => [entry], entry.name, 'Review', { options: { provider: 'deepseek', model: 'deepseek-chat' } }, new AbortController().signal)
    ).rejects.toThrow('max-tokens; partial output')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('registers a real host tool with a valid value schema and a disposer', () => {
    const { host } = hostFixture()
    const disposeListener = vi.fn()
    const on = vi.fn(() => disposeListener)
    const dispose = mountAgentRoleTool({ ...host, on } as unknown as Context, async () => [])
    expect(host.tools.register).toHaveBeenCalledWith(expect.objectContaining({ name: 'subagents_run' }))
    expect(on).toHaveBeenCalledWith('agent/pre-step', expect.any(Function))
    dispose()
    expect(disposeListener).toHaveBeenCalledOnce()
  })

  it.each(['reasoning_effort', 'reasoningEffort'])('parses %s and sends all saved model fields through host preflight', async field => {
    const { host, start } = hostFixture()
    const entry = await roleFile(`---\nprovider: deepseek\nmodel: deepseek-chat\n${field}: high\n---\nReview`)
    const parent = { options: { provider: 'other', model: 'other-model', reasoningEffort: 'low' } }
    const signal = new AbortController().signal
    const summaries = await agentRoleCatalog([entry], signal)
    expect(summaries[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
    await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, signal)
    expect(host.llm.resolveCallConfig).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, signal)
    expect(start.mock.calls[0]?.[1].agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
  })

  it('inherits compatible parent effort but clears it on a model change', async () => {
    const { host, start } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview')
    const parent = { options: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } }
    const signal = new AbortController().signal
    await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, signal)
    expect(host.llm.resolveCallConfig).toHaveBeenLastCalledWith(parent.options, signal)
    expect(start.mock.calls[0]?.[1].agentOptions).toEqual({})
    await writeFile(entry.path, '---\nmodel: deepseek/other-model\n---\nReview')
    await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, signal)
    expect(host.llm.resolveCallConfig).toHaveBeenLastCalledWith({ provider: 'deepseek', model: 'other-model' }, signal)
    expect(start.mock.calls[1]?.[1].agentOptions).toEqual({ provider: 'deepseek', model: 'other-model' })
  })

  it('inherits the latest request route instead of stale agent creation options', async () => {
    const { host } = hostFixture()
    const entry = await roleFile('---\nmodel: inherit\n---\nReview')
    const current = { provider: 'other', model: 'current-model' }
    const parent = { options: { provider: 'deepseek', model: 'old-model', reasoningEffort: 'high' }, session: { requestHeader: () => ({ config: current }) } }
    const signal = new AbortController().signal
    await executeAgentRole(host, async () => [entry], entry.name, 'Review', parent, signal)
    expect(host.llm.resolveCallConfig).toHaveBeenCalledWith(current, signal)
  })

  it('rejects invalid efforts, provider failures and cancelled preflight before creating a child', async () => {
    for (const metadata of ['reasoning_effort: false', 'reasoning_effort: ""', 'reasoning_effort: [high]', 'reasoning_effort: high\nreasoningEffort: low']) {
      expect(() => parseAgentRole(`---\n${metadata}\n---\nReview`)).toThrow()
    }
    const { host, start } = hostFixture()
    const entry = await roleFile('---\nmodel: deepseek/deepseek-chat\nreasoning_effort: unsupported\n---\nReview')
    vi.mocked(host.llm.resolveCallConfig).mockRejectedValueOnce(new Error('unsupported reasoning effort'))
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', {}, new AbortController().signal)).rejects.toThrow('unsupported reasoning effort')
    const controller = new AbortController()
    vi.mocked(host.llm.resolveCallConfig).mockImplementationOnce(async () => {
      controller.abort()
      return {}
    })
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', {}, controller.signal)).rejects.toThrow()
    expect(start).not.toHaveBeenCalled()
  })

  it('filters malformed or ambiguous roles, preserves exact IDs and reads inline definitions', async () => {
    const entry = await roleFile('---\nname: Reviewer\ndescription: Review\nmodel: inherit\n---\nSecret persona')
    const signal = new AbortController().signal
    const diagnose = vi.fn()
    const invalid = { ...entry, name: 'invalid', rawText: '---\nreasoning_effort: false\n---\nBad' }
    expect(await agentRoleCatalog([entry, entry, invalid], signal, diagnose)).toEqual([])
    expect(diagnose).toHaveBeenCalled()
    const inline = { ...entry, name: 'inline', path: '/unused/plugin.json', rawText: '---\nname: Inline\nmodel: deepseek/deepseek-chat\n---\nInline persona' }
    expect((await agentRoleCatalog([inline, entry], signal)).map(role => role.name)).toEqual(['inline', entry.name])
    const { host, start } = hostFixture()
    await executeAgentRole(host, async () => [inline], 'inline', 'Review', {}, signal)
    expect(start.mock.calls[0]?.[1].persona).toBe('Inline persona')
  })
})
