/**
 * The two tool events track an execution, not a waterfall visit.
 *
 * `tools/post-execute` is reached for a pre-execute denial, a pre-dispatch
 * cancellation, an unknown tool, and rejected arguments. The reference fires
 * PostToolUse and PostToolUseFailure only around a tool body, so a bridge that
 * mapped every `isError` result would alert a suite for a call another hook
 * refused.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { effectiveSurfaces, type Suite } from '../../../../packages/market-contracts/src/model/types.js'
import { ExtensionHooks } from '../../../../packages/market-runtime/src/runtime/surfaces/extension-hooks.js'

const disposers: Array<() => Promise<void>> = []

function suite(id: string, events: Record<string, string[]>): Suite {
  return {
    sourceId: 'source',
    id,
    root: '/plugins/' + id,
    manifest: { id, name: id, layout: 'claude-code', path: '/plugins/' + id + '/plugin.json' },
    skills: [],
    errors: [],
    dimension: 'user',
    enabled: true,
    surfaces: { skills: 0, commands: 0, agents: 0, hooks: 1, mcp: 0, lsp: 0 },
    activeSurfaces: effectiveSurfaces(undefined),
    hooks: { events: Object.fromEntries(Object.entries(events).map(([event, commands]) => [event, [{ hooks: commands.map(command => ({ type: 'command' as const, command })) }]])) }
  }
}

function harness() {
  const ctx = new Context()
  for (const name of ['shell', 'sessionProjections', 'agents']) ctx.provide(name)
  disposers.push(async () => {
    await ctx.fiber.dispose()
  })
  const commands: string[] = []
  ctx.set('shell', {
    resolve: (request: { command: string }) => request,
    execute: async (request: { command: string }) => {
      commands.push(request.command)
      return { result: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) }
    }
  })
  ctx.set('sessionProjections', { stateOf: () => ({ lastTurn: 1, openTurnStartSeq: 1 }) })
  ctx.set('agents', { get: () => undefined })
  vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const agent = { id: 'a', ctx, session: { header: { id: 'a', cwd: '/work' }, append: () => {} }, inject: () => {}, steer: () => {}, cancel: () => {} } as unknown as Agent
  const exec = () => ({
    agent,
    name: 'Bash',
    arguments: { command: 'ls' },
    callId: ToolCallId('call-1'),
    rootCallId: ToolCallId('call-1'),
    token: Symbol('tool') as ToolExecution['token'],
    signal: new AbortController().signal
  })
  const mount = () => {
    const hooks = new ExtensionHooks(ctx, agent, () => true)
    disposers.push(() => hooks.dispose())
    return hooks.reconcile([suite('one', { PostToolUse: ['success'], PostToolUseFailure: ['failure'] })])
  }
  const failed = (code?: string) => ({
    content: [{ type: 'text' as const, text: 'boom' }],
    isError: true as const,
    error: { message: 'boom', ...(code === undefined ? {} : { info: { name: 'HarnessError', code } }) }
  })
  return { ctx, agent, exec, mount, failed, commands }
}

describe('tool event execution marker', () => {
  for (const code of ['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'UNKNOWN_TOOL', 'INVALID_ARGS']) {
    it('runs neither tool event for a ' + code + ' result', async () => {
      const h = harness()
      await h.mount()
      await h.ctx.waterfall('tools/post-execute', h.exec(), h.failed(code), async () => ({ kind: 'accept' as const }))
      expect(h.commands).toEqual([])
    })
  }

  it('runs the failure event for a real execution failure, with or without a code', async () => {
    for (const code of [undefined, 'EACCES']) {
      const h = harness()
      await h.mount()
      await h.ctx.waterfall('tools/post-execute', h.exec(), h.failed(code), async () => ({ kind: 'accept' as const }))
      expect(h.commands).toEqual(['failure'])
    }
  })

  it('runs the success event for a successful call', async () => {
    const h = harness()
    await h.mount()
    await h.ctx.waterfall('tools/post-execute', h.exec(), { content: [{ type: 'text' as const, text: 'ok' }], isError: false, value: null }, async () => ({
      kind: 'accept' as const
    }))
    expect(h.commands).toEqual(['success'])
  })
})
