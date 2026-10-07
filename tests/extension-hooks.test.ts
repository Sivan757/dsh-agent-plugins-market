import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveSurfaces, type Suite } from '../packages/market-contracts/src/model/types.js'
import { ExtensionHooks } from '../packages/market-runtime/src/runtime/surfaces/extension-hooks.js'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

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
  const calls: Array<{ command: string; stdin: string; signal: AbortSignal; workdir?: string; timeoutMs?: number; env?: Record<string, string> }> = []
  let run: (request: (typeof calls)[number]) => Promise<{ exitCode: number; stdout: string; stderr: string }> = async () => ({ exitCode: 0, stdout: '', stderr: '' })
  const execute = vi.fn(async (request: (typeof calls)[number]) => {
    calls.push(request)
    return {
      result: async () => {
        const result = await run(request)
        return { exitCode: result.exitCode, stdout: { text: result.stdout }, stderr: { text: result.stderr } }
      }
    }
  })
  const registry = new Map<string, Agent>()
  ctx.set('shell', { resolve: (request: (typeof calls)[number]) => request, execute })
  ctx.set('sessionProjections', { stateOf: () => ({ lastTurn: 1, openTurnStartSeq: 1 }) })
  ctx.set('agents', { get: (id: string) => registry.get(id) })
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const agents = (id: string, cwd = '/same-workspace') => {
    const append = vi.fn<(event: string, data: Record<string, unknown>) => void>()
    const inject = vi.fn()
    const steer = vi.fn()
    const value = { id, ctx, session: { header: { id, cwd }, append }, inject, steer } as unknown as Agent
    registry.set(id, value)
    return { value, append, inject, steer }
  }
  const mount = (owner: Agent, selected: Suite[], allows: (suite: Suite) => boolean = () => true, hookAllows?: (suite: Suite, event: string, index: number) => boolean) => {
    const hooks = new ExtensionHooks(ctx, owner, allows, hookAllows)
    disposers.push(() => hooks.dispose())
    return { hooks, ready: hooks.reconcile(selected) }
  }
  const exec = (agent: Agent, name = 'Read') => ({
    agent,
    name,
    arguments: { file_path: 'a.ts' },
    callId: ToolCallId('call-1'),
    rootCallId: ToolCallId('call-1'),
    token: Symbol('tool') as ToolExecution['token'],
    signal: new AbortController().signal
  })
  const subagent = async (parent: Agent | undefined, event: 'subagent/start' | 'subagent/end', info: Record<string, unknown>) => {
    const args = parent ? [scopeTarget({}, parent), event, info] : [event, info]
    const callbacks = ctx.events.dispatch('emit', args) as Array<(info: Record<string, unknown>) => unknown>
    await Promise.all(callbacks.map(callback => callback(info)))
  }
  return {
    ctx,
    calls,
    execute,
    agents,
    mount,
    exec,
    subagent,
    registry,
    warn,
    setRun: (value: typeof run) => {
      run = value
    }
  }
}

const payloads = (calls: ReturnType<typeof harness>['calls']) => calls.map(call => JSON.parse(call.stdin) as Record<string, unknown>)

describe('ExtensionHooks', () => {
  it('keeps remote child identity without substituting the parent session', async () => {
    const h = harness()
    const parent = h.agents('parent')
    await h.mount(parent.value, [suite('parent', { SubagentStart: ['remote-start'], SubagentStop: ['remote-stop'] })]).ready
    const info = { id: 'remote-child', runId: 'remote-run', provider: 'remote', local: false }
    await h.subagent(parent.value, 'subagent/start', info)
    await h.subagent(parent.value, 'subagent/end', { ...info, stopReason: 'completed' })
    expect(h.calls.map(call => call.command)).toEqual(['remote-start', 'remote-stop'])
    expect(payloads(h.calls).map(payload => [payload.session_id, payload.agent_id, payload.cwd])).toEqual([
      ['remote-child', 'remote-child', ''],
      ['remote-child', 'remote-child', '']
    ])
    expect(parent.inject).not.toHaveBeenCalled()
  })

  it('does not inject late subagent startup context after the child run ended', async () => {
    const h = harness()
    const parent = h.agents('parent').value
    const child = h.agents('child')
    const entered = deferred<void>()
    const release = deferred<void>()
    h.setRun(async () => {
      entered.resolve()
      await release.promise
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'too late' } }) }
    })
    const { hooks, ready } = h.mount(parent, [suite('parent', { SubagentStart: ['start'] })])
    await ready
    const info = { id: 'child', runId: 'run', provider: 'local', local: true }
    await h.subagent(parent, 'subagent/start', info)
    await entered.promise
    await h.subagent(parent, 'subagent/end', { ...info, stopReason: 'completed' })
    release.resolve()
    await hooks.dispose()
    expect(child.inject).not.toHaveBeenCalled()
  })

  it('does not record tool hooks outside an open turn and honors aborted callers', async () => {
    const h = harness()
    const a = h.agents('a')
    h.ctx.set('sessionProjections', { stateOf: () => ({ lastTurn: 2, openTurnStartSeq: null }) })
    await h.mount(a.value, [suite('one', { PreToolUse: ['tool'] })]).ready
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    expect(h.calls).toHaveLength(1)
    expect(a.append).not.toHaveBeenCalled()
    const signal = AbortSignal.abort()
    await h.ctx.waterfall('tools/pre-execute', { ...h.exec(a.value), signal }, async () => ({ kind: 'allow' as const }))
    expect(h.calls).toHaveLength(1)
  })

  it('drains awaited tool hooks and preserves invocation/result pairing on disposal', async () => {
    const h = harness()
    const a = h.agents('a')
    const entered = deferred<void>()
    const release = deferred<void>()
    h.setRun(async () => {
      entered.resolve()
      await release.promise
      return { exitCode: 2, stdout: '', stderr: 'late block' }
    })
    const { hooks, ready } = h.mount(a.value, [suite('one', { PreToolUse: ['first', 'second'] })])
    await ready
    const running = h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    await entered.promise
    const disposed = hooks.dispose()
    expect(h.calls[0]?.signal.aborted).toBe(true)
    release.resolve()
    expect(await running).toEqual({ kind: 'allow' })
    await disposed
    expect(h.calls).toHaveLength(1)
    expect(a.append.mock.calls.map(call => call[0])).toEqual(['hook/invoked', 'hook/result'])
  })

  it('maps prompt, tool and stop decisions and records paired open-turn events', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { UserPromptSubmit: ['prompt'], PreToolUse: ['pre'], PostToolUse: ['post'], Stop: ['stop'] })]).ready
    const message = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
    const prompt = { agent: a.value, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }
    h.setRun(async () => ({ exitCode: 2, stdout: '', stderr: 'do not enter' }))
    const enter = vi.fn(async () => ({ kind: 'enter' as const, messages: [message] }))
    expect(await h.ctx.waterfall('agent/pre-step', prompt, enter)).toEqual({ kind: 'reject' })
    expect(enter).not.toHaveBeenCalled()
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name,
          additionalContext: 'context',
          permissionDecision: 'ask',
          permissionDecisionReason: 'ask first'
        }
      })
    }))
    expect(await h.ctx.waterfall('agent/pre-step', prompt, enter)).toMatchObject({
      kind: 'enter',
      messages: [message, { source: { kind: 'hooks-claude-code' }, content: [{ type: 'text', text: 'context' }] }]
    })
    const allow = vi.fn(async () => ({ kind: 'allow' as const }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), allow)).toEqual({ kind: 'ask', reason: 'ask first' })
    expect(allow).not.toHaveBeenCalled()
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        decision: 'block',
        reason: 'blocked',
        hookSpecificOutput: { hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name, additionalContext: 'feedback' }
      })
    }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), allow)).toEqual({ kind: 'deny', reason: 'blocked' })
    const post = await h.ctx.waterfall('tools/post-execute', h.exec(a.value), { content: [{ type: 'text', text: 'result' }], isError: false, value: null }, async () => ({
      kind: 'accept' as const
    }))
    expect(post).toMatchObject({ kind: 'block', feedback: [{ type: 'text', text: 'blocked' }], additionalContexts: [{ content: [{ type: 'text', text: 'feedback' }] }] })
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    expect(a.steer).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'hooks-claude-code' }, content: [{ type: 'text', text: 'blocked' }] }))
    expect(payloads(h.calls)).toEqual([
      expect.objectContaining({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }),
      expect.objectContaining({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }),
      expect.objectContaining({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.ts' }, tool_use_id: 'call-1' }),
      expect.objectContaining({ hook_event_name: 'PreToolUse' }),
      expect.objectContaining({ hook_event_name: 'PostToolUse', tool_response: 'result' }),
      expect.objectContaining({ hook_event_name: 'Stop', stop_hook_active: false })
    ])
    expect(a.append).toHaveBeenCalledTimes(12)
    for (let index = 0; index < a.append.mock.calls.length; index += 2) {
      const invoked = a.append.mock.calls[index]!
      const result = a.append.mock.calls[index + 1]!
      expect(invoked).toEqual(['hook/invoked', expect.objectContaining({ turn: 1, dialect: 'claude-code' })])
      expect(result).toEqual(['hook/result', expect.objectContaining({ turn: 1, handlerId: invoked[1].handlerId, point: invoked[1].point })])
    }
  })

  it('preserves downstream context and most-restrictive cross-suite decisions', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { PreToolUse: ['deny'], PostToolUse: ['context'] }), suite('two', { PreToolUse: ['allow'] })]).ready
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name,
          permissionDecision: request.command === 'deny' ? 'deny' : 'allow',
          permissionDecisionReason: 'denial',
          additionalContext: request.command === 'context' ? 'ours' : ''
        }
      })
    }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))).toEqual({ kind: 'deny', reason: 'denial' })
    const downstream = createUserMessage({ content: [{ type: 'text', text: 'downstream' }], source: { kind: 'user' } })
    const result = await h.ctx.waterfall('tools/post-execute', h.exec(a), { content: [], isError: false, value: null }, async () => ({
      kind: 'accept' as const,
      additionalContexts: [downstream]
    }))
    expect(result).toMatchObject({ kind: 'accept', additionalContexts: [{ content: [{ type: 'text', text: 'ours' }] }, downstream] })
  })

  it('rejects malformed suites and contains executor errors with canonical matcher and timeout behavior', async () => {
    const h = harness()
    const a = h.agents('a')
    const invalid = suite('bad', { PreToolUse: ['must not run'] })
    invalid.hooks!.events.PreToolUse!.push({ matcher: '[', hooks: [{ type: 'command', command: 'bad regex' }] })
    const valid = suite('good', { PreToolUse: ['echo $' + '{CLAUDE_PLUGIN_ROOT} $' + '{CLAUDE_PROJECT_DIR}'] })
    valid.hooks!.events.PreToolUse![0]!.matcher = 'Read|Write'
    valid.hooks!.events.PreToolUse![0]!.hooks[0]!.timeout = 1.5
    const { ready } = h.mount(a.value, [invalid, valid])
    const diagnostics = await ready
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.suiteId).toBe('source/bad')
    expect(diagnostics[0]?.reason).toContain('invalid PreToolUse hook matcher')
    h.setRun(async () => {
      throw new Error('executor unavailable')
    })
    const next = async () => ({ kind: 'allow' as const })
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value, 'ReadFile'), next)
    expect(h.calls).toHaveLength(0)
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), next)).toEqual({ kind: 'allow' })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toMatchObject({ command: 'echo /plugins/good /same-workspace', workdir: '/same-workspace', timeoutMs: 1500, env: { CLAUDE_PROJECT_DIR: '/same-workspace' } })
    expect(h.calls[0]!.stdin.endsWith(String.fromCharCode(10))).toBe(true)
    expect(a.append.mock.calls[1]).toEqual(['hook/result', expect.objectContaining({ decision: 'pass', stderrSummary: 'executor unavailable' })])
  })

  it('removes obsolete selections during in-flight execution', async () => {
    const h = harness()
    const a = h.agents('a').value
    const entered = deferred<void>()
    const release = deferred<void>()
    h.setRun(async () => {
      entered.resolve()
      await release.promise
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const { hooks, ready } = h.mount(a, [suite('one', { PreToolUse: ['first', 'obsolete'] })])
    await ready
    const running = h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))
    await entered.promise
    await hooks.reconcile([])
    release.resolve()
    await running
    expect(h.calls.map(call => call.command)).toEqual(['first'])
    await hooks.reconcile([suite('two', { PreToolUse: ['new'] })])
    await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))
    expect(h.calls.map(call => call.command)).toEqual(['first', 'new'])
  })

  it('fails closed when live authorization throws', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { PreToolUse: ['denied'] })], () => {
      throw new Error('selection unavailable')
    }).ready
    await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('authorization failed for source/one'))
  })

  it('isolates two agents sharing cwd and rejects a different object with the same id', async () => {
    const h = harness()
    const a = h.agents('a').value
    const b = h.agents('b').value
    await h.mount(a, [suite('a', { PreToolUse: ['hook-a'] })]).ready
    await h.mount(b, [suite('b', { PreToolUse: ['hook-b'] })]).ready
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await h.ctx.waterfall('tools/pre-execute', h.exec(a), next)
    await h.ctx.waterfall('tools/pre-execute', h.exec(b), next)
    await h.ctx.waterfall('tools/pre-execute', h.exec({ ...a }), next)
    expect(h.calls.map(call => call.command)).toEqual(['hook-a', 'hook-b'])
    expect(payloads(h.calls).map(payload => payload.session_id)).toEqual(['a', 'b'])
    expect(next).toHaveBeenCalledTimes(3)
  })

  it('runs startup exactly once after selection loading, never from agent/created or reconcile', async () => {
    const h = harness()
    const a = h.agents('a')
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'startup context' } }) }))
    const { hooks, ready } = h.mount(a.value, [suite('one', { SessionStart: ['startup'] })])
    const first = hooks.start('resume')
    expect(hooks.start('startup')).toBe(first)
    await Promise.all([ready, first])
    await h.ctx.serial('agent/created', { agent: a.value, source: 'startup' })
    await hooks.reconcile([suite('two', { SessionStart: ['later'] })])
    await hooks.start('startup')
    expect(h.calls).toHaveLength(1)
    expect(payloads(h.calls)[0]).toMatchObject({ session_id: 'a', hook_event_name: 'SessionStart', source: 'resume' })
    expect(a.inject).toHaveBeenCalledOnce()
    expect(a.append).not.toHaveBeenCalled()
  })

  it('denies every selected hook without invoking shell', async () => {
    const h = harness()
    const a = h.agents('a')
    const all = suite(
      'one',
      Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop'].map(event => [event, [event]]))
    )
    const { hooks, ready } = h.mount(a.value, [all], () => false)
    await ready
    await hooks.start('startup')
    await h.ctx.waterfall(
      'agent/pre-step',
      {
        agent: a.value,
        messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
        turn: 1,
        step: 1,
        signal: new AbortController().signal
      },
      async () => ({ kind: 'enter' as const, messages: [] })
    )
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    await h.ctx.waterfall('tools/post-execute', h.exec(a.value), { content: [], isError: false, value: null }, async () => ({ kind: 'accept' as const }))
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    await h.subagent(a.value, 'subagent/start', { id: 'remote', runId: 'run', local: false, provider: 'remote' })
    await h.subagent(a.value, 'subagent/end', { id: 'remote', runId: 'run', local: false, provider: 'remote', stopReason: 'completed' })
    expect(h.execute).not.toHaveBeenCalled()
    expect(a.append).not.toHaveBeenCalled()
  })

  it('rechecks suite permission before each shell command', async () => {
    const h = harness()
    const a = h.agents('a').value
    let allowed = true
    const { ready } = h.mount(a, [suite('one', { PreToolUse: ['first', 'second'] }), suite('two', { PreToolUse: ['third'] })], () => allowed)
    await ready
    h.setRun(async () => {
      allowed = false
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))
    expect(h.calls.map(call => call.command)).toEqual(['first'])
  })

  it('uses the exact parent selection for subagent events and child payload identity', async () => {
    const h = harness()
    const parent = h.agents('parent').value
    const other = h.agents('other').value
    const child = h.agents('child', '/child-workspace')
    await h.mount(parent, [suite('parent', { SubagentStart: ['parent-start'], SubagentStop: ['parent-stop'] })]).ready
    await h.mount(child.value, [suite('child', { SubagentStart: ['child-start'], SubagentStop: ['child-stop'] })]).ready
    const info = { id: 'child', runId: 'run', provider: 'local', local: true }
    await h.subagent(other, 'subagent/start', info)
    await h.subagent(undefined, 'subagent/start', info)
    await h.subagent(parent, 'subagent/start', info)
    h.registry.delete('child')
    await h.subagent(parent, 'subagent/end', { ...info, stopReason: 'completed' })
    expect(h.calls.map(call => call.command)).toEqual(['parent-start', 'parent-stop'])
    expect(payloads(h.calls)).toEqual([
      expect.objectContaining({ session_id: 'child', agent_id: 'child', cwd: '/child-workspace', hook_event_name: 'SubagentStart', agent_type: 'general-purpose' }),
      expect.objectContaining({ session_id: 'child', agent_id: 'child', cwd: '/child-workspace', hook_event_name: 'SubagentStop', stop_hook_active: false })
    ])
    expect(child.append).not.toHaveBeenCalled()
  })

  it('aborts and drains in-flight hooks, detaches listeners, and suppresses late injection', async () => {
    const h = harness()
    const a = h.agents('a')
    const entered = deferred<void>()
    const release = deferred<void>()
    h.setRun(async () => {
      entered.resolve()
      await release.promise
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'late' } }) }
    })
    const { hooks, ready } = h.mount(a.value, [suite('one', { SessionStart: ['first', 'second'], PreToolUse: ['tool'] })])
    await ready
    const started = hooks.start('startup')
    await entered.promise
    let drained = false
    const disposing = hooks.dispose().then(() => {
      drained = true
    })
    expect(h.calls[0]?.signal.aborted).toBe(true)
    await Promise.resolve()
    expect(drained).toBe(false)
    release.resolve()
    await Promise.all([started, disposing, hooks.dispose()])
    await hooks.reconcile([suite('new', { SessionStart: ['new'], PreToolUse: ['new'] })])
    await hooks.start('startup')
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    expect(h.calls.map(call => call.command)).toEqual(['first'])
    expect(a.inject).not.toHaveBeenCalled()
  })

  it('denies one hook by its own declaration position while its sibling still runs', async () => {
    const h = harness()
    const a = h.agents('a')
    const asked: string[] = []
    const { ready } = h.mount(
      a.value,
      [suite('one', { PreToolUse: ['first', 'second'] })],
      () => true,
      (_suite, event, index) => {
        asked.push(event + '/' + index)
        return index !== 0
      }
    )
    await ready
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    expect(h.calls.map(call => call.command)).toEqual(['second'])
    expect(asked).toEqual(['PreToolUse/0', 'PreToolUse/1'])
  })

  it('numbers a hook across matcher groups, the way the session inventory publishes its row', async () => {
    const h = harness()
    const a = h.agents('a')
    const { hooks, ready } = h.mount(
      a.value,
      [],
      () => true,
      (_suite, _event, index) => index !== 1
    )
    const grouped = suite('grouped', { PreToolUse: [] })
    grouped.hooks = {
      events: {
        PreToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: 'first-group' }] },
          { matcher: 'Read', hooks: [{ type: 'command', command: 'second-group' }] }
        ]
      }
    }
    await hooks.reconcile([grouped])
    await ready
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    // Per-group numbering would call the second group's first hook position 0 and let it run.
    expect(h.calls.map(call => call.command)).toEqual(['first-group'])
  })

  it('still advances the declaration position past a hook whose matcher does not apply', async () => {
    const h = harness()
    const a = h.agents('a')
    const { hooks, ready } = h.mount(
      a.value,
      [],
      () => true,
      (_suite, _event, index) => index !== 1
    )
    const grouped = suite('grouped', { PreToolUse: [] })
    grouped.hooks = {
      events: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'unmatched' }] },
          { matcher: '*', hooks: [{ type: 'command', command: 'matched' }] }
        ]
      }
    }
    await hooks.reconcile([grouped])
    await ready
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value, 'Read'), async () => ({ kind: 'allow' as const }))
    // The unmatched group owns position 0, so the matched hook is the denied position 1.
    expect(h.calls).toEqual([])
  })
})
