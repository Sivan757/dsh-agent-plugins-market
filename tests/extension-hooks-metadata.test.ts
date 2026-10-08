/**
 * UserPromptSubmit fires for a submitted prompt, not for every claimed message.
 *
 * A claimed batch can carry this plugin's own metadata: selection envelopes, a
 * request intent, or the recovery wake marker. None of them is a prompt, so none of
 * them runs the hook, and none of their placeholder text reaches a prompt payload.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { effectiveSurfaces, type Suite } from '../packages/market-contracts/src/model/types.js'
import { ExtensionHooks } from '../packages/market-runtime/src/runtime/surfaces/extension-hooks.js'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

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
  const calls: Array<{ command: string; stdin: string }> = []
  const execute = vi.fn(async (request: { command: string; stdin: string }) => {
    calls.push({ command: request.command, stdin: request.stdin })
    return { result: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) }
  })
  const registry = new Map<string, Agent>()
  ctx.set('shell', { resolve: (request: unknown) => request, execute })
  ctx.set('sessionProjections', { stateOf: () => ({ lastTurn: 1, openTurnStartSeq: 1 }) })
  ctx.set('agents', { get: (id: string) => registry.get(id) })
  vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const agents = (id: string) => {
    const value = { id, ctx, session: { header: { id, cwd: '/workspace' }, append: vi.fn() }, inject: vi.fn(), steer: vi.fn() } as unknown as Agent
    registry.set(id, value)
    return value
  }
  const mount = async (owner: Agent, selected: Suite[]) => {
    const hooks = new ExtensionHooks(ctx, owner, () => true)
    disposers.push(() => hooks.dispose())
    await hooks.reconcile(selected)
    return hooks
  }
  return { ctx, calls, execute, agents, mount }
}

/** One of this plugin's own metadata messages, the shape a claimed batch can carry. */
const metadata = (kind: string, text: string): UserMessage =>
  ({ ...createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), source: { kind, form: 'context' } }) as UserMessage
const user = (text: string): UserMessage => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const step = (agent: Agent, messages: UserMessage[]) => ({
  agent,
  messages,
  turn: 1,
  step: 1,
  signal: new AbortController().signal
})

it('runs no hook for a metadata-only claimed batch', async () => {
  const h = harness()
  const agent = h.agents('only-metadata')
  const hooks = await h.mount(agent, [suite('one', { UserPromptSubmit: ['prompt'] })])
  await hooks.start('startup')
  h.execute.mockClear()
  const enter = vi.fn(async () => ({ kind: 'enter' as const, messages: [] }))
  const decision = await h.ctx.waterfall(
    'agent/pre-step',
    step(agent, [
      metadata('market-extension-selection', 'Session extension selection envelope.'),
      metadata('market-extension-intent', 'Session extension selection request.'),
      metadata('market-extension-wake', 'Session extension readiness restored.')
    ]),
    enter
  )
  expect(decision).toEqual({ kind: 'enter', messages: [] })
  expect(enter).toHaveBeenCalledTimes(1)
  // Selection envelopes, a pending request and the wake marker are not prompts.
  expect(h.execute).not.toHaveBeenCalled()
})

it('keeps metadata placeholders out of a mixed prompt payload', async () => {
  const h = harness()
  const agent = h.agents('mixed')
  const hooks = await h.mount(agent, [suite('one', { UserPromptSubmit: ['prompt'] })])
  await hooks.start('startup')
  h.execute.mockClear()
  await h.ctx.waterfall(
    'agent/pre-step',
    step(agent, [
      metadata('market-extension-selection', 'Session extension selection envelope.'),
      user('hello from the user'),
      metadata('market-extension-wake', 'Session extension readiness restored.')
    ]),
    async () => ({ kind: 'enter' as const, messages: [] })
  )
  expect(h.execute).toHaveBeenCalledTimes(1)
  const payload = JSON.parse(h.calls[0]!.stdin) as { prompt: string }
  expect(payload.prompt).toBe('hello from the user')
})

it('runs for an authored prompt, including a steer claimed mid-turn', async () => {
  const h = harness()
  const agent = h.agents('authored')
  const hooks = await h.mount(agent, [suite('one', { UserPromptSubmit: ['prompt'] })])
  await hooks.start('startup')
  h.execute.mockClear()
  await h.ctx.waterfall('agent/pre-step', step(agent, [user('first prompt'), user('mid-turn steer')]), async () => ({ kind: 'enter' as const, messages: [] }))
  expect(h.execute).toHaveBeenCalledTimes(1)
  const payload = JSON.parse(h.calls[0]!.stdin) as { prompt: string }
  expect(payload.prompt).toBe('first promptmid-turn steer')
})
