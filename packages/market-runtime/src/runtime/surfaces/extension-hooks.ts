/** Session-owned command hooks; execution, decoding, merging, and durable records use the host protocol. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_STDERR_SUMMARY_MAX_CHARS,
  appendHookInvoked,
  appendHookResult,
  createDetachedRuns,
  matchesMatcher,
  mergeHookOutputs,
  runHook
} from '@deepseek-ai/dsh-hook-protocol'
import { qualifiedSuiteId } from '../../../../market-catalog/src/index.js'
import { expandPluginPaths } from '../../../../market-catalog/src/index.js'
import { normalizeHookDocuments, standaloneHookDocument } from '../../../../market-catalog/src/index.js'
import type { ProjectHooks, Suite } from '../../../../market-contracts/src/model/types.js'
import { hookConfigPath, type HooksMountDiagnostic } from './hooks-mounts.js'

type Point = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SubagentStart' | 'SubagentStop'
type Outcome = ReturnType<typeof mergeHookOutputs>
type Turn = Parameters<typeof appendHookInvoked>[1]['turn']
type Source = 'startup' | 'resume'
interface Selection {
  suite: Suite
  hooks: ProjectHooks
}
const CONTEXT_SOURCE = { kind: 'hooks-claude-code' } as const

/**
 * Own one live Agent's hooks. Supply a live context injected with shell and
 * sessionProjections, plus a synchronous live authorization check. Reconcile before
 * awaiting start; agent/created is deliberately not observed. Dispose before the
 * Agent or its context tears down. Each command rechecks authorization.
 * Subagent events use the exact parent carrier, but identify the child on stdin.
 * Like the host bridge, input rewrites, systemMessage and run-level halt are not
 * applied; SubagentStop is observation-only. Unknown remote child cwd is empty.
 */
export class ExtensionHooks {
  private selected = new Map<string, Selection>()
  private pending: Promise<void> = Promise.resolve()
  private readonly runs = createDetachedRuns()
  private readonly listeners: Array<() => void> = []
  private readonly children = new Map<string, Agent>()
  private startup?: Promise<void>
  private closing?: Promise<void>
  private disposed = false
  private revision = 0
  private handler = 0

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly isSuiteAllowed: (suite: Suite) => boolean,
    /**
     * Live check for one hook's own identity: the event and its declaration index,
     * the same position the session inventory published a row for. Absent keeps the
     * parent-suite contract, which is what a suite with no individual row requires.
     */
    private readonly isHookAllowed?: (suite: Suite, event: string, index: number) => boolean
  ) {
    this.listeners.push(
      ctx.on('agent/pre-step', (event, next) => {
        if (event.agent !== agent || this.disposed || event.messages.length === 0) return next()
        return this.track(async () => {
          const merged = await this.runPoint(
            'UserPromptSubmit',
            '',
            { ...base(agent, 'UserPromptSubmit'), prompt: text(event.messages.flatMap(message => message.content)) },
            agent,
            event.turn,
            event.signal
          )
          if (this.disposed) return next()
          if (merged.decision === 'deny') return { kind: 'reject' as const }
          const downstream = await next()
          const context = contextFrom(merged)
          return !this.disposed && context && downstream.kind === 'enter' ? { ...downstream, messages: [...downstream.messages, context] } : downstream
        })
      })
    )
    this.listeners.push(
      ctx.on('tools/pre-execute', (exec, next) => {
        if (exec.agent !== agent || this.disposed) return next()
        return this.track(async () => {
          const merged = await this.runPoint(
            'PreToolUse',
            exec.name,
            { ...base(agent, 'PreToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId },
            agent,
            this.lastTurn(),
            exec.signal
          )
          if (this.disposed) return next()
          if (merged.decision === 'deny') return { kind: 'deny' as const, reason: merged.reason ?? 'blocked by PreToolUse hook' }
          if (merged.decision === 'ask') return { kind: 'ask' as const, ...(merged.reason === undefined ? {} : { reason: merged.reason }) }
          return next()
        })
      })
    )
    this.listeners.push(
      ctx.on('tools/post-execute', (exec, result, next) => {
        if (exec.agent !== agent || this.disposed) return next()
        return this.track(async () => {
          const merged = await this.runPoint(
            'PostToolUse',
            exec.name,
            { ...base(agent, 'PostToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId, tool_response: text(result.content) },
            agent,
            this.lastTurn(),
            exec.signal
          )
          if (this.disposed) return next()
          const context = contextFrom(merged)
          if (merged.decision === 'deny')
            return {
              kind: 'block' as const,
              feedback: [{ type: 'text' as const, text: merged.reason ?? 'blocked by PostToolUse hook' }],
              ...(context ? { additionalContexts: [context] } : {})
            }
          const downstream = await next()
          return !this.disposed && context ? { ...downstream, additionalContexts: [context, ...(downstream.additionalContexts ?? [])] } : downstream
        })
      })
    )
    this.listeners.push(
      ctx.on('agent/turn-stopping', event => {
        if (event.agent !== agent || this.disposed) return
        return this.track(async () => {
          const merged = await this.runPoint('Stop', '', { ...base(agent, 'Stop'), stop_hook_active: false }, agent, event.turn, event.signal)
          if (!this.disposed && merged.decision === 'deny')
            agent.steer(createUserMessage({ content: [{ type: 'text', text: merged.reason ?? 'continue: blocked by Stop hook' }], source: CONTEXT_SOURCE }))
        })
      })
    )
    const observeSubagent = this.observeSubagent.bind(this)
    // Subagent lifecycle payloads omit the parent; Cordis binds this to its routing carrier.
    this.listeners.push(
      ctx.on('subagent/start', function (info) {
        if (carrierKeyOf(this) === agent) observeSubagent('SubagentStart', info)
      })
    )
    this.listeners.push(
      ctx.on('subagent/end', function (info) {
        if (carrierKeyOf(this) === agent) observeSubagent('SubagentStop', info)
      })
    )
  }

  /** Replace selection; malformed suites are dropped with diagnostics. Does not replay startup. */
  reconcile(suites: readonly Suite[]): Promise<HooksMountDiagnostic[]> {
    if (this.disposed) return Promise.resolve([])
    const revision = ++this.revision
    this.selected.clear()
    const run = this.pending.then(async () => {
      const selected = new Map<string, Selection>()
      const diagnostics: HooksMountDiagnostic[] = []
      for (const suite of suites) {
        if (!suite.enabled || !suite.activeSurfaces.hooks || this.disposed || revision !== this.revision) continue
        const suiteId = qualifiedSuiteId(suite.sourceId, suite.id)
        try {
          let raw: unknown = suite.hooks === undefined ? undefined : { hooks: suite.hooks.events }
          let file = suite.manifest.path
          if (raw === undefined && suite.resources === undefined) {
            const path = await hookConfigPath(suite.root)
            if (path !== undefined) {
              file = path
              raw = JSON.parse(await readFile(path, 'utf8'))
            }
          }
          if (raw === undefined) continue
          if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('hooks must be an event table')
          const errors: string[] = []
          const hooks = normalizeHookDocuments(suite.hooks?.projectRoot, [{ file, settings: standaloneHookDocument(raw as Record<string, unknown>) }], errors)
          diagnostics.push(...errors.map(reason => ({ suiteId, reason })))
          if (hooks) selected.set(suiteId, { suite, hooks })
        } catch (error) {
          diagnostics.push({ suiteId, reason: String(error) })
        }
      }
      if (!this.disposed && revision === this.revision) this.selected = selected
      return diagnostics
    })
    this.pending = run.then(() => undefined)
    return run
  }

  /** Run SessionStart once, after already-submitted reconciliation, and await its context injection. */
  start(source: Source, signal?: AbortSignal): Promise<void> {
    if (this.startup) return this.startup
    if (this.disposed) return Promise.resolve()
    this.startup = this.track(async () => {
      await this.pending
      const merged = await this.runPoint('SessionStart', source, { ...base(this.agent, 'SessionStart'), source }, this.agent, undefined, signal)
      const context = contextFrom(merged)
      if (!this.disposed && !signal?.aborted && context) this.agent.inject(context)
    })
    return this.startup
  }

  /** Stop admission, unregister listeners, abort and await owned runs. Repeated calls share completion. */
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.selected.clear()
    this.children.clear()
    for (const unregister of this.listeners.splice(0)) unregister()
    this.closing = Promise.all([this.runs.drain(), this.pending]).then(() => undefined)
    return this.closing
  }

  private observeSubagent(point: 'SubagentStart' | 'SubagentStop', info: SubagentRunInfo): void {
    if (this.disposed) return
    const child = this.children.get(info.runId) ?? (info.local ? this.ctx.get('agents')?.get(info.id) : undefined)
    if (point === 'SubagentStart' && child) this.children.set(info.runId, child)
    if (point === 'SubagentStop') this.children.delete(info.runId)
    void this.track(async () => {
      const merged = await this.runPoint(
        point,
        'general-purpose',
        {
          ...base(child, point, info.id),
          agent_id: info.id,
          agent_type: 'general-purpose',
          ...(point === 'SubagentStop' ? { stop_hook_active: false } : {})
        },
        child
      )
      const context = contextFrom(merged)
      if (!this.disposed && point === 'SubagentStart' && context && child && this.children.get(info.runId) === child) child.inject(context)
    }).catch(error => {
      this.ctx.logger.warn('extension-hooks: ' + point + ' hook failed: ' + String(error))
    })
  }

  private track<T>(work: () => Promise<T>): Promise<T> {
    const run = work()
    this.runs.track(run)
    return run
  }

  private lastTurn(): Turn | undefined {
    const boundary = this.ctx.sessionProjections.stateOf(this.agent.session, 'turnBoundary')
    return boundary?.openTurnStartSeq == null ? undefined : boundary.lastTurn
  }

  private async runPoint(point: Point, query: string, payload: Record<string, unknown>, subject?: Agent, turn?: Turn, signal?: AbortSignal): Promise<Outcome> {
    const outputs: Array<Awaited<ReturnType<typeof runHook>>['output']> = []
    const ownerSignal = signal ? AbortSignal.any([signal, this.runs.signal]) : this.runs.signal
    for (const [key, selection] of this.selected) {
      const { suite, hooks } = selection
      const cwd = subject?.session.header.cwd
      const projectDir = hooks.projectRoot ?? cwd
      // The declaration index counts every command hook of this event in declaration
      // order and across matcher groups, exactly as the session inventory numbered
      // its rows: a hook whose matcher does not apply still advances the position.
      let index = 0
      for (const group of hooks.events[point] ?? []) {
        const matched = matchesMatcher(group.matcher, query, 'claude-code')
        for (const hook of group.hooks) {
          const position = index++
          if (!matched) continue
          if (this.disposed || ownerSignal.aborted || this.selected.get(key) !== selection) break
          let allowed = false
          try {
            allowed = this.isSuiteAllowed(suite) === true && this.isHookAllowed?.(suite, point, position) !== false
          } catch (error) {
            this.ctx.logger.warn('extension-hooks: authorization failed for ' + key + ': ' + String(error))
          }
          if (!allowed) continue
          const handlerId = 'extension-hooks:' + this.agent.id + ':' + key + ':' + point + ':' + ++this.handler
          if (subject && turn !== undefined)
            appendHookInvoked(subject.session, { turn, point, dialect: 'claude-code', handlerId, ...(group.matcher === undefined ? {} : { matcher: group.matcher }) })
          const { output, durationMs } = await runHook(
            this.ctx.shell,
            { command: expandPluginPaths(hook.command, { root: suite.root, projectDir }), ...(hook.timeout === undefined ? {} : { timeoutSec: hook.timeout }) },
            {
              payload,
              defaultTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
              signal: ownerSignal,
              trailingNewline: true,
              expectedEventName: point,
              ...(cwd === undefined ? {} : { cwd }),
              ...(projectDir === undefined ? {} : { env: { CLAUDE_PROJECT_DIR: projectDir } })
            },
            () => performance.now()
          )
          if (subject && turn !== undefined)
            appendHookResult(subject.session, { turn, point, handlerId, output, durationMs, stderrSummaryMaxChars: DEFAULT_STDERR_SUMMARY_MAX_CHARS })
          if (output.updatedInput !== undefined || output.systemMessage !== undefined || output.continue === false)
            this.ctx.logger.warn('extension-hooks: ' + key + ' ' + point + ': updatedInput, systemMessage, and run-level halt are not supported by the host bridge')
          if (!this.disposed && !ownerSignal.aborted) outputs.push(output)
        }
      }
    }
    return mergeHookOutputs(outputs)
  }
}

function base(agent: Agent | undefined, point: Point, id = ''): Record<string, unknown> {
  return { session_id: agent?.session.header.id ?? id, transcript_path: '', cwd: agent?.session.header.cwd ?? '', hook_event_name: point }
}
function text(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}
function contextFrom(merged: Outcome) {
  return merged.additionalContext.length === 0
    ? undefined
    : createUserMessage({ content: merged.additionalContext.map(text => ({ type: 'text' as const, text })), source: CONTEXT_SOURCE })
}
