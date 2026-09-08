import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeAgentRole, mountAgentRoleTool, parseAgentRole, resolveAgentModel, type AgentRoleHost } from '../src/runtime/agent-role-router.js'
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
    llm: { listProviders: () => [{ id: 'deepseek' }, { id: 'other' }], listModels: async () => [{ id: 'shared-model' }] },
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
    await expect(executeAgentRole(host, async () => [entry], entry.name, 'Review', {}, new AbortController().signal)).rejects.toThrow('max-tokens; partial output')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('registers a real host tool with a valid value schema and a disposer', () => {
    const { host } = hostFixture()
    expect(mountAgentRoleTool(host as unknown as Context, async () => [])).toBeTypeOf('function')
    expect(host.tools.register).toHaveBeenCalledWith(expect.objectContaining({ name: 'market_agent' }))
  })
})
