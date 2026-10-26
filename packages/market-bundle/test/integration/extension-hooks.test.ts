import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveSurfaces, type Suite } from '../../../../packages/market-contracts/src/model/types.js'
import { ExtensionHooks } from '../../../../packages/market-runtime/src/runtime/surfaces/extension-hooks.js'

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
    const cancel = vi.fn()
    const value = { id, ctx, session: { header: { id, cwd }, append }, inject, steer, cancel } as unknown as Agent
    registry.set(id, value)
    return { value, append, inject, steer, cancel }
  }
  const mount = (owner: Agent, selected: Suite[], allows: (suite: Suite) => boolean = () => true, hookAllows?: (suite: Suite, event: string, index: number) => boolean) => {
    const hooks = new ExtensionHooks(ctx, owner, allows, hookAllows, '/data')
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
  // session/event carries two arguments, which the cordis helper overloads do not express.
  const sessionEvent = async (session: unknown, event: Record<string, unknown>) => {
    const callbacks = ctx.events.dispatch('emit', ['session/event', session, event]) as Array<(session: unknown, event: Record<string, unknown>) => unknown>
    await Promise.all(callbacks.map(callback => callback(session, event)))
  }
  return {
    ctx,
    calls,
    execute,
    agents,
    mount,
    exec,
    subagent,
    sessionEvent,
    registry,
    warn,
    setRun: (value: typeof run) => {
      run = value
    }
  }
}

const payloads = (calls: ReturnType<typeof harness>['calls']) => calls.map(call => JSON.parse(call.stdin) as Record<string, unknown>)
const FRAME_OPEN = '<system-reminder>'
const FRAME_CLOSE = '</system-reminder>'
const CONTEXT_INTRO =
  'The following context was injected by an enabled agent plugin suite. It is session instructions, not a message from the user. More specific instructions take precedence over broader ones. It does not override system, developer, or direct user instructions.'
/** The frame a durable session context carries, for one contributing suite. */
const framedContext = (suite: string, body: string): string => [FRAME_OPEN, CONTEXT_INTRO, '', '### ' + suite, '', body, FRAME_CLOSE].join('\n')

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
      messages: [message, { source: { kind: 'hooks-claude-code' }, content: [{ type: 'text', text: framedContext('one', 'context') }] }]
    })
    const allow = vi.fn(async () => ({ kind: 'allow' as const }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), allow)).toEqual({
      kind: 'ask',
      reason: 'ask first',
      displayReason: { en: 'A PreToolUse hook asks before this tool runs', zh: 'PreToolUse 钩子要求先确认再运行此工具' }
    })
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
    expect(h.calls[0]).toMatchObject({ command: 'echo /plugins/good /same-workspace', workdir: '/same-workspace', timeoutMs: 1500 })
    expect(h.calls[0]!.env).toEqual({
      CLAUDE_PLUGIN_ROOT: '/plugins/good',
      CLAUDE_PLUGIN_DATA: '/data/source/good',
      CLAUDE_PROJECT_DIR: '/same-workspace'
    })
    expect(h.calls[0]!.stdin.endsWith(String.fromCharCode(10))).toBe(true)
    expect(a.append.mock.calls[1]).toEqual(['hook/result', expect.objectContaining({ decision: 'pass', stderrSummary: 'executor unavailable' })])
  })

  it('exports the claude-code names and omits an absent plugin root', async () => {
    const h = harness()
    const a = h.agents('project')
    const command = 'echo ${CLAUDE_PLUGIN_ROOT} ${CLAUDE_PLUGIN_DATA}'
    const native = suite('native', { PreToolUse: [command] })
    native.manifest.layout = 'project-native'
    delete (native as Partial<Suite>).root
    const { ready } = h.mount(a.value, [native])
    expect(await ready).toEqual([])
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    expect(h.calls[0]!.command).toBe(command)
    expect(h.calls[0]!.env).toEqual({ CLAUDE_PROJECT_DIR: '/same-workspace' })
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

  it('pre-approves a downstream ask on a hook allow and keeps a downstream deny', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { PreToolUse: ['allow'] })]).ready
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name, permissionDecision: 'allow' }
      })
    }))
    // The hook pre-approves an approval prompt: the call runs without asking.
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'ask' as const, reason: 'needs approval' }))).toEqual({ kind: 'allow' })
    // It never overrides a denial, so a later policy keeps its veto.
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'deny' as const, reason: 'policy' }))).toEqual({ kind: 'deny', reason: 'policy' })
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))).toEqual({ kind: 'allow' })
  })

  it('uses the hook systemMessage as the denial reason when the hook names no reason', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { PreToolUse: ['deny'], Stop: ['stop'] })]).ready
    // hookify blocks exactly this way: permissionDecision deny, text in systemMessage.
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name, permissionDecision: 'deny' },
        systemMessage: '**[no-rm]** do not delete files'
      })
    }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))).toEqual({
      kind: 'deny',
      reason: '**[no-rm]** do not delete files'
    })
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('PreToolUse systemMessage: **[no-rm]** do not delete files'))
  })

  it('injects PreToolUse additionalContext into the model request only for a call that proceeds', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { PreToolUse: ['context'] })]).ready
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name, additionalContext: 'read the guide first' }
      })
    }))
    await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))
    expect(a.inject).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'hooks-claude-code' }, content: [{ type: 'text', text: 'read the guide first' }] }))
    a.inject.mockClear()
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name,
          permissionDecision: 'deny',
          permissionDecisionReason: 'not this one',
          additionalContext: 'read the guide first'
        }
      })
    }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))).toEqual({
      kind: 'deny',
      reason: 'not this one'
    })
    expect(a.inject).not.toHaveBeenCalled()
  })

  it('halts the run through the host hook cancellation cause for continue false', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { PreToolUse: ['halt'] })]).ready
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ continue: false, stopReason: 'quota reached' }) }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))).toEqual({
      kind: 'deny',
      reason: 'quota reached'
    })
    expect(a.cancel).toHaveBeenCalledWith({ kind: 'hook', reason: 'quota reached' })
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('PreToolUse hook halted the run: quota reached'))
  })

  it('treats exit code 2 as a blocking error with stderr as the reason on every deciding point', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { PreToolUse: ['pre'], PostToolUse: ['post'], Stop: ['stop'] })]).ready
    h.setRun(async () => ({ exitCode: 2, stderr: 'refused by rule 7', stdout: '' }))
    expect(await h.ctx.waterfall('tools/pre-execute', h.exec(a.value), async () => ({ kind: 'allow' as const }))).toEqual({ kind: 'deny', reason: 'refused by rule 7' })
    expect(
      await h.ctx.waterfall('tools/post-execute', h.exec(a.value), { content: [{ type: 'text', text: 'ok' }], isError: false, value: null }, async () => ({
        kind: 'accept' as const
      }))
    ).toEqual({ kind: 'block', feedback: [{ type: 'text', text: 'refused by rule 7' }] })
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    // The Stop reason reaches the turn as steering, which is the continuation.
    expect(a.steer).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: 'refused by rule 7' }] }))
    // A blocking exit code is not a halt: the run continues.
    expect(a.cancel).not.toHaveBeenCalled()
  })

  it('folds plain stdout as context on SessionStart and UserPromptSubmit only', async () => {
    const h = harness()
    const a = h.agents('a')
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: 'plain guidance' }))
    const { hooks, ready } = h.mount(a.value, [suite('one', { SessionStart: ['start'], UserPromptSubmit: ['prompt'], PostToolUse: ['post'] })])
    await ready
    await hooks.start('startup')
    expect(a.inject).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: framedContext('one', 'plain guidance') }] }))
    const message = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
    const prompt = { agent: a.value, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }
    expect(await h.ctx.waterfall('agent/pre-step', prompt, async () => ({ kind: 'enter' as const, messages: [message] }))).toMatchObject({
      kind: 'enter',
      messages: [message, { content: [{ type: 'text', text: framedContext('one', 'plain guidance') }] }]
    })
    // PostToolUse documents no plain-stdout context, so nothing is folded there.
    expect(await h.ctx.waterfall('tools/post-execute', h.exec(a.value), { content: [], isError: false, value: null }, async () => ({ kind: 'accept' as const }))).toEqual({
      kind: 'accept'
    })
  })

  it('runs PostToolUseFailure for a failed call and keeps its error visible', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { PostToolUse: ['after-success'], PostToolUseFailure: ['after-failure'] })]).ready
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name, additionalContext: 'the sandbox refused it' },
        systemMessage: 'retry with a narrower path'
      })
    }))
    const failed = { content: [{ type: 'text' as const, text: 'boom' }], isError: true as const, error: { message: 'boom' } }
    const result = await h.ctx.waterfall('tools/post-execute', h.exec(a), failed, async () => ({ kind: 'accept' as const }))
    expect(h.calls.map(call => call.command)).toEqual(['after-failure'])
    expect(payloads(h.calls)[0]).toMatchObject({ hook_event_name: 'PostToolUseFailure', tool_name: 'Read', tool_input: { file_path: 'a.ts' }, error: 'boom' })
    expect(result).toMatchObject({
      kind: 'accept',
      additionalContexts: [{ content: [{ type: 'text', text: 'the sandbox refused it' }] }]
    })
    // The failure itself is never replaced, and a warning with no decision is
    // reported rather than folded into a block reason.
    expect(result).not.toHaveProperty('content')
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('PostToolUseFailure systemMessage: retry with a narrower path'))
  })

  it('keeps a suite that declares only PostToolUse seeing failed calls, with one notice', async () => {
    const h = harness()
    const a = h.agents('a').value
    // The shape the catalog's hookify and security-guidance suites ship: no
    // PostToolUseFailure anywhere, so the reference split cannot apply yet.
    await h.mount(a, [suite('one', { PostToolUse: ['after-success'] })]).ready
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name, additionalContext: 'the write did not land' }
      })
    }))
    const failed = { content: [{ type: 'text' as const, text: 'EACCES' }], isError: true as const, error: { message: 'EACCES' } }
    const result = await h.ctx.waterfall('tools/post-execute', h.exec(a), failed, async () => ({ kind: 'accept' as const }))
    expect(h.calls.map(call => call.command)).toEqual(['after-success'])
    // It runs as PostToolUse, the point the suite declared, with the older payload.
    expect(payloads(h.calls)[0]).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'EACCES' })
    expect(result).toMatchObject({ kind: 'accept', additionalContexts: [{ content: [{ type: 'text', text: 'the write did not land' }] }] })
    const notice = 'declares PostToolUse without PostToolUseFailure'
    expect(h.warn.mock.calls.filter(call => String(call[0]).includes(notice))).toHaveLength(1)
    // A second failed call runs the hook again and does not repeat the notice.
    await h.ctx.waterfall('tools/post-execute', h.exec(a), failed, async () => ({ kind: 'accept' as const }))
    expect(h.calls).toHaveLength(2)
    expect(h.warn.mock.calls.filter(call => String(call[0]).includes(notice))).toHaveLength(1)
  })

  it('stops the fallback for the tools a suite routes to the failure event', async () => {
    const h = harness()
    const a = h.agents('a').value
    // claude-security's shape: both events, with the failure event limited to Bash.
    const both = suite('both', { PostToolUse: [] })
    both.hooks = {
      events: {
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'edit-review' }] }],
        PostToolUseFailure: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash-review' }] }]
      }
    }
    await h.mount(a, [both]).ready
    const failed = { content: [{ type: 'text' as const, text: 'boom' }], isError: true as const, error: { message: 'boom' } }
    await h.ctx.waterfall('tools/post-execute', h.exec(a, 'Bash'), failed, async () => ({ kind: 'accept' as const }))
    // The reference split applies to Bash: the failure event runs and PostToolUse does not.
    expect(h.calls.map(call => call.command)).toEqual(['bash-review'])
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: '' }))
    h.warn.mockClear()
    // Edit is not routed to the failure event, so its PostToolUse hook still runs.
    await h.ctx.waterfall('tools/post-execute', h.exec(a, 'Edit'), failed, async () => ({ kind: 'accept' as const }))
    expect(h.calls.map(call => call.command)).toEqual(['bash-review', 'edit-review'])
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('declares PostToolUse without PostToolUseFailure'))
  })

  it('folds a failure-event denial into context instead of replacing the error', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { PostToolUseFailure: ['after-failure'] })]).ready
    h.setRun(async () => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', permissionDecision: 'deny' }, systemMessage: 'check the branch first' })
    }))
    const failed = { content: [{ type: 'text' as const, text: 'boom' }], isError: true as const, error: { message: 'boom' } }
    const result = await h.ctx.waterfall('tools/post-execute', h.exec(a), failed, async () => ({ kind: 'accept' as const }))
    // The failure stays a failure; the hook's reason rides the next request.
    expect(result).toMatchObject({ kind: 'accept', additionalContexts: [{ content: [{ type: 'text', text: 'check the branch first' }] }] })
    expect(result).not.toHaveProperty('content')
  })

  it('resets stop hook activation when a new prompt is submitted', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { Stop: ['stop'] })]).ready
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ decision: 'block', reason: 'keep going' }) }))
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    expect(payloads(h.calls).map(payload => payload.stop_hook_active)).toEqual([false, true])
    // A new authored prompt owns a fresh count, so the flag resets.
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: '' }))
    const message = createUserMessage({ content: [{ type: 'text', text: 'next task' }], source: { kind: 'user' } })
    await h.ctx.waterfall('agent/pre-step', { agent: a.value, messages: [message], turn: 2, step: 1, signal: new AbortController().signal }, async () => ({
      kind: 'enter' as const,
      messages: [message]
    }))
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ decision: 'block', reason: 'keep going' }) }))
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 2, signal: new AbortController().signal })
    expect(
      payloads(h.calls)
        .filter(payload => payload.hook_event_name === 'Stop')
        .map(payload => payload.stop_hook_active)
    ).toEqual([false, true, false])
  })

  it('applies a blocking reason to feedback and to a Stop continuation when the call succeeded', async () => {
    const h = harness()
    const a = h.agents('a')
    // The failure path is covered above. This case pins the success path: the
    // reason becomes corrective feedback, and a Stop block steers it.
    await h.mount(a.value, [suite('one', { PostToolUse: ['post'], Stop: ['stop'] })]).ready
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name, permissionDecision: 'deny' },
        systemMessage: 'rewrite the header'
      })
    }))
    const blocked = await h.ctx.waterfall('tools/post-execute', h.exec(a.value), { content: [], isError: false, value: null }, async () => ({
      kind: 'accept' as const
    }))
    expect(blocked).toEqual({ kind: 'block', feedback: [{ type: 'text', text: 'rewrite the header' }] })
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    expect(a.steer).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: 'rewrite the header' }] }))
  })

  it('continues a turn for Stop context that carries no blocking decision', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { Stop: ['stop'] })]).ready
    // A context-only Stop hook: no decision, just additionalContext.
    h.setRun(async () => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'one more thing to check' } })
    }))
    await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    expect(a.steer).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: 'one more thing to check' }] }))
    expect(a.cancel).not.toHaveBeenCalled()
  })

  it('halts with the hook reason at every point that can apply a stop', async () => {
    const cases: Array<[string, (h: ReturnType<typeof harness>, agent: Agent) => Promise<unknown>]> = [
      [
        'UserPromptSubmit',
        async (h, agent) => {
          const message = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
          return h.ctx.waterfall('agent/pre-step', { agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({
            kind: 'enter' as const,
            messages: [message]
          }))
        }
      ],
      ['PreToolUse', (h, agent) => h.ctx.waterfall('tools/pre-execute', h.exec(agent), async () => ({ kind: 'allow' as const }))],
      ['PostToolUse', (h, agent) => h.ctx.waterfall('tools/post-execute', h.exec(agent), { content: [], isError: false, value: null }, async () => ({ kind: 'accept' as const }))],
      ['Stop', (h, agent) => h.ctx.parallel('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })]
    ]
    for (const [point, drive] of cases) {
      const h = harness()
      const a = h.agents('a')
      await h.mount(a.value, [suite('one', { [point]: ['hook'] })]).ready
      h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ continue: false, stopReason: point + ' halt' }) }))
      await drive(h, a.value)
      expect(a.cancel, point).toHaveBeenCalledWith({ kind: 'hook', reason: point + ' halt' })
    }
  })

  it('runs PreCompact hooks on a compaction start event and reports the missing veto', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { PreCompact: ['compact'] })]).ready
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ decision: 'block', reason: 'keep the context' }) }))
    await h.sessionEvent(a.value.session, { type: 'compaction/start', seq: 3, time: 1, data: { turn: 1, sourceCommandId: 'compact' } })
    await vi.waitFor(() => expect(h.calls).toHaveLength(1))
    expect(payloads(h.calls)[0]).toMatchObject({ hook_event_name: 'PreCompact', trigger: 'manual', session_id: 'a' })
    await vi.waitFor(() => expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('the host exposes no pre-compaction veto')))
    // A committed compaction happens inside the open turn, so the pair is recorded.
    expect(a.append.mock.calls.map(call => call[0])).toEqual(['hook/invoked', 'hook/result'])
    // Nothing can veto the compaction, so the run continues.
    expect(a.cancel).not.toHaveBeenCalled()
  })

  it('derives an automatic compaction trigger and ignores a payload it cannot read', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { PreCompact: ['compact'] })]).ready
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: '' }))
    await h.sessionEvent(a.value.session, { type: 'compaction/start', seq: 3, time: 1, data: { turn: 1 } })
    await vi.waitFor(() => expect(h.calls).toHaveLength(1))
    expect(payloads(h.calls)[0]).toMatchObject({ hook_event_name: 'PreCompact', trigger: 'auto' })
    await h.sessionEvent(a.value.session, { type: 'compaction/start', seq: 4, time: 2, data: 'not an object' })
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('ignored a compaction/start payload with no readable trigger'))
    expect(h.calls).toHaveLength(1)
  })

  it('runs SessionEnd hooks once from disposal and discards their output', async () => {
    const h = harness()
    const a = h.agents('a')
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ decision: 'block', reason: 'ignored' }) }))
    const { hooks, ready } = h.mount(a.value, [suite('one', { SessionEnd: ['end'] })])
    await ready
    await hooks.dispose()
    expect(h.calls.map(call => call.command)).toEqual(['end'])
    expect(payloads(h.calls)[0]).toMatchObject({ hook_event_name: 'SessionEnd', reason: 'other', session_id: 'a' })
    expect(h.calls[0]!.timeoutMs).toBe(1_500)
    // Disposal happens outside any open turn, so the pair is not recorded.
    expect(a.append).not.toHaveBeenCalled()
    expect(a.cancel).not.toHaveBeenCalled()
    // A declaration that asks for longer than the reference ceiling is clamped,
    // so one suite cannot hold session teardown for its own timeout.
    const long = suite('long', { SessionEnd: ['slow'] })
    long.hooks!.events.SessionEnd![0]!.hooks[0]!.timeout = 600
    const second = h.mount(h.agents('b').value, [long])
    await second.ready
    await second.hooks.dispose()
    expect(h.calls.at(-1)!.timeoutMs).toBe(60_000)
  })

  it('caps consecutive Stop continuations and reports stop hook activation', async () => {
    const h = harness()
    const a = h.agents('a')
    await h.mount(a.value, [suite('one', { Stop: ['stop'] })]).ready
    h.setRun(async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ decision: 'block', reason: 'keep going' }) }))
    for (let index = 0; index < 9; index += 1) await h.ctx.parallel('agent/turn-stopping', { agent: a.value, turn: 1, signal: new AbortController().signal })
    expect(a.steer).toHaveBeenCalledTimes(8)
    expect(payloads(h.calls).map(payload => payload.stop_hook_active)).toEqual([false, true, true, true, true, true, true, true, true])
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('reached the 8 continuation cap'))
  })

  it('reports updatedInput without applying it and leaves the tool arguments untouched', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { PreToolUse: ['rewrite'] })]).ready
    h.setRun(async request => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: (JSON.parse(request.stdin) as { hook_event_name: string }).hook_event_name,
          updatedInput: { file_path: 'b.ts' }
        }
      })
    }))
    const execution = h.exec(a)
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await h.ctx.waterfall('tools/pre-execute', execution, next)
    expect(next).toHaveBeenCalledOnce()
    expect(execution.arguments).toEqual({ file_path: 'a.ts' })
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('updatedInput is not applied; the host PreToolDecision union (@deepseek-ai/dsh-tools) has no input-rewrite arm'))
  })

  it('applies the reference per-event timeout defaults', async () => {
    const h = harness()
    const a = h.agents('a').value
    await h.mount(a, [suite('one', { UserPromptSubmit: ['prompt'], PreToolUse: ['pre'] })]).ready
    const message = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
    await h.ctx.waterfall('agent/pre-step', { agent: a, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({
      kind: 'enter' as const,
      messages: [message]
    }))
    await h.ctx.waterfall('tools/pre-execute', h.exec(a), async () => ({ kind: 'allow' as const }))
    expect(h.calls.map(call => call.timeoutMs)).toEqual([30_000, 600_000])
  })
})
