/** Session-owned command hooks; execution, decoding, merging, and durable records use the host protocol. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_STDERR_SUMMARY_MAX_CHARS,
  appendHookInvoked,
  appendHookResult,
  createDetachedRuns,
  matchesMatcher,
  mergeHookOutputs,
  runHook,
  type HookOutput
} from '@deepseek-ai/dsh-hook-protocol'
import { qualifiedSuiteId } from '../../../../market-catalog/src/index.js'
import { expandPluginPaths, pluginPathEnvironment, pluginRootOf, suiteDataDir } from '../../../../market-catalog/src/index.js'
import { normalizeHookDocuments, standaloneHookDocument } from '../../../../market-catalog/src/index.js'
import type { ProjectHooks, Suite } from '../../../../market-contracts/src/model/types.js'
import { hookConfigPath, type HooksMountDiagnostic } from './hooks-mounts.js'

/**
 * Every Claude Code hook event this bridge runs. The host extension points
 * decide the list: an event with no reachable interception point stays out of
 * it and the catalog rejects the declaration with a diagnostic, so a suite
 * never believes a hook is live when it is not.
 *
 * The catalog derives the events it admits from the shared support table, and
 * `packages/market-runtime/test/hook-event-coverage.test.ts` holds this list to
 * that table, so the two cannot drift.
 */
export const HOOK_RUNTIME_POINTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionEnd'
] as const
type Point = (typeof HOOK_RUNTIME_POINTS)[number]
type Outcome = ReturnType<typeof mergeHookOutputs>
/** One point's merged decision, plus the denial reason rebuilt from denying hooks only. */
interface PointOutcome {
  merged: Outcome
  denySystemMessages: string[]
}
type Turn = Parameters<typeof appendHookInvoked>[1]['turn']
type Source = 'startup' | 'resume'
interface Selection {
  suite: Suite
  hooks: ProjectHooks
}
interface RunOptions {
  /**
   * Run the final pass that disposal owns. A closing pass reads a captured
   * selection snapshot, so the checks that stop a live pass do not stop it.
   */
  closing?: boolean
  /** Selection snapshot for a closing pass; a live pass reads the live map. */
  selection?: ReadonlyMap<string, Selection>
  /** Default per-hook timeout in ms; the point's own reference default when absent. */
  defaultTimeoutMs?: number
  /**
   * This pass runs PostToolUse for a failed call on behalf of a suite that
   * declares no matching failure hook. The first such run per suite is logged
   * once, so the divergence from the reference is diagnosable and bounded.
   */
  fallback?: boolean
}
const CONTEXT_SOURCE = { kind: 'hooks-claude-code' } as const
/** Plain (non-JSON) stdout is conversation context on exactly these events. */
const STDOUT_CONTEXT_POINTS: ReadonlySet<Point> = new Set<Point>(['SessionStart', 'UserPromptSubmit'])
/**
 * Reference per-event timeouts, in ms, for the events whose reference default
 * differs from the protocol default: Claude Code lowers UserPromptSubmit
 * commands to 30 seconds and gives SessionEnd a 1.5-second budget.
 */
const POINT_DEFAULT_TIMEOUT_MS: Partial<Record<Point, number>> = { UserPromptSubmit: 30_000, SessionEnd: 1_500 }
/** Consecutive stop continuations before a blocking Stop hook stops forcing another step. */
const STOP_CONTINUATION_CAP = 8
/** Separator between two joined hook reasons, as the shared merge joins them. */
const REASON_SEPARATOR = '\n\n'
/**
 * Failure codes that mean no tool body ran: the call was cancelled before or
 * during dispatch, named no registered tool, or carried rejected arguments.
 * The reference fires these two events only around an execution, so a result
 * carrying one of these codes fires neither.
 */
const NON_EXECUTED_FAILURE_CODES: ReadonlySet<string> = new Set(['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'UNKNOWN_TOOL', 'INVALID_ARGS'])
/** The reference raises SessionEnd's 1.5-second budget only up to this ceiling. */
const SESSION_END_MAX_TIMEOUT_MS = 60_000
/** Never aborted: a closing pass outlives the drain that aborts the shared run signal. */
const NEVER_ABORTED = new AbortController().signal
/** English fallback the model and the session log read when a hook blocks without a reason. */
const DEFAULT_REASON: Partial<Record<Point, string>> = {
  UserPromptSubmit: 'blocked by UserPromptSubmit hook',
  PreToolUse: 'blocked by PreToolUse hook',
  PostToolUse: 'blocked by PostToolUse hook',
  Stop: 'continue: blocked by Stop hook'
}

/**
 * Own one live Agent's hooks. Supply a live context injected with shell and
 * sessionProjections, plus a synchronous live authorization check. Reconcile before
 * awaiting start; agent/created is deliberately not observed. Dispose before the
 * Agent or its context tears down. Each command rechecks authorization.
 *
 * Decisions are applied, not logged: a deny, block, ask, or allow reaches the
 * host decision it names, additionalContext is delivered to the turn or the
 * tool call, `continue: false` cancels the run through the host's own hook
 * cancellation cause, and an exit-2 hook blocks with its stderr as the reason.
 * A hook that returns nothing, times out, cannot be decoded, or answers for a
 * different event is contained: it contributes no decision and the point
 * proceeds as if it had not run.
 *
 * PostToolUse and PostToolUseFailure are separate events, as the reference has
 * them: PostToolUse after a successful call, PostToolUseFailure after a failed
 * one. A suite that declares only PostToolUse cannot be edited by this plugin
 * and keeps seeing failed calls through its PostToolUse hooks, and the first
 * such run per suite is logged with the event to declare to get the split. A
 * matching PostToolUseFailure group takes the tool, so a suite that declares
 * both never runs twice for one call.
 *
 * One divergence remains and is not simulated: a denial produced by a
 * tools/pre-execute listener reaches tools/post-execute with no marker that says
 * the tool body never ran, so a failed call denied by another hook still fires
 * the failure event. The host's ToolFailure.info carries a code for a
 * cancellation, an unknown tool, and invalid arguments, which this bridge
 * excludes, but not for a policy denial.
 *
 * Three reference fields have no host seam and are reported instead of applied:
 * `updatedInput` (the host decision union has no rewrite arm), a user-visible
 * `systemMessage` channel (no notice surface on the interception points, so the
 * text falls back into the block reason and the host log), and a PreCompact
 * veto (no pre-compaction interception point). docs/reference/hooks-event-coverage.md
 * records each gap beside the host symbol that would have to change.
 *
 * Subagent events use the exact parent carrier, but identify the child on stdin.
 * SessionEnd runs from disposal, so its reason vocabulary is `other` only.
 * Unknown remote child cwd is empty. Every command receives its suite's path
 * variables in the process environment, the same values its command string
 * expands to.
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
  /** Consecutive Stop continuations this run has forced, for the reference cap. */
  private continuations = 0
  /** Suites already told that their PostToolUse hooks still run for failed calls. */
  private readonly compatNotices = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly isSuiteAllowed: (suite: Suite) => boolean,
    /**
     * Live check for one hook's own identity: the event and its declaration index,
     * the same position the session inventory published a row for. Absent keeps the
     * parent-suite contract, which is what a suite with no individual row requires.
     */
    private readonly isHookAllowed?: (suite: Suite, event: string, index: number) => boolean,
    /** Plugin storage root; supplies the suite's data directory to hook processes. */
    private readonly dataRoot?: string
  ) {
    this.listeners.push(
      ctx.on('agent/pre-step', (event, next) => {
        // A submitted prompt is authored input. A claimed batch can also carry this
        // plugin's own metadata, which is neither a prompt nor prompt content.
        const authored = event.messages.filter(message => message.source.kind === 'user')
        if (event.agent !== agent || this.disposed || authored.length === 0) return next()
        // A new authored prompt starts its own stop-hook count. Without this
        // reset the flag stays true for the rest of the session after one forced
        // continuation, and every later Stop hook reads a stale activation.
        this.continuations = 0
        return this.track(async () => {
          const { merged } = await this.runPoint(
            'UserPromptSubmit',
            '',
            { ...base(agent, 'UserPromptSubmit'), prompt: text(authored.flatMap(message => message.content)) },
            agent,
            event.turn,
            event.signal
          )
          if (this.disposed) return next()
          if (merged.stop) {
            this.halt(agent, 'UserPromptSubmit', merged)
            return { kind: 'reject' as const }
          }
          if (merged.decision === 'deny') {
            this.reportBlocked('UserPromptSubmit', merged)
            return { kind: 'reject' as const }
          }
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
          const outcome = await this.runPoint(
            'PreToolUse',
            exec.name,
            { ...base(agent, 'PreToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId },
            agent,
            this.lastTurn(),
            exec.signal
          )
          const { merged } = outcome
          if (this.disposed) return next()
          if (merged.stop) {
            this.halt(agent, 'PreToolUse', merged)
            return { kind: 'deny' as const, reason: this.blockReason('PreToolUse', outcome) }
          }
          if (merged.decision === 'deny') return { kind: 'deny' as const, reason: this.blockReason('PreToolUse', outcome) }
          if (merged.decision === 'ask')
            return {
              kind: 'ask' as const,
              ...(merged.reason === undefined ? {} : { reason: merged.reason }),
              displayReason: ASK_DISPLAY_REASON
            }
          const downstream = await next()
          // A hook allow pre-approves an approval prompt; it never overrides a
          // denial, so a later guard keeps its veto.
          const decision: PreToolDecision = merged.decision === 'allow' && downstream.kind === 'ask' ? { kind: 'allow' } : downstream
          // The pre-execute decision carries no context field, so context reaches
          // the next request through the agent's own model-facing inbox.
          const context = contextFrom(merged)
          if (!this.disposed && decision.kind === 'allow' && context) agent.inject(context)
          return decision
        })
      })
    )
    this.listeners.push(
      ctx.on('tools/post-execute', (exec, result, next) => {
        if (exec.agent !== agent || this.disposed) return next()
        // A failure that never executed a tool body is not a tool failure: the
        // host reports a pre-execute denial, a pre-dispatch cancellation, an
        // unknown tool, and rejected arguments through this same waterfall.
        if (result.isError && NON_EXECUTED_FAILURE_CODES.has(result.error.info?.code ?? '')) return next()
        return this.track(async () => {
          // The reference protocol separates the two events: PostToolUse fires
          // after a tool succeeds, PostToolUseFailure after it fails.
          const point: Point = result.isError ? 'PostToolUseFailure' : 'PostToolUse'
          const turn = this.lastTurn()
          const payload = {
            ...base(agent, point),
            tool_name: exec.name,
            tool_input: exec.arguments,
            tool_use_id: exec.callId,
            ...(result.isError ? { error: result.error.message } : { tool_response: text(result.content) })
          }
          const outputs = await this.collect(point, exec.name, payload, agent, turn, exec.signal)
          // A suite written before the split declares only PostToolUse and cannot
          // be edited here. It keeps seeing failed calls, as it did before, until
          // it declares the failure event that expresses the same intent.
          if (result.isError && !this.declaresFailureFor(exec.name))
            outputs.push(
              ...(await this.collect(
                'PostToolUse',
                exec.name,
                { ...base(agent, 'PostToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId, tool_response: text(result.content) },
                agent,
                turn,
                exec.signal,
                { fallback: true }
              ))
            )
          const outcome = foldOutcome(outputs)
          const { merged } = outcome
          if (this.disposed) return next()
          if (merged.stop) {
            this.halt(agent, point, merged)
            return next()
          }
          const context = contextFrom(merged)
          const reason = merged.decision === 'deny' ? this.blockReason(point, outcome) : undefined
          if (result.isError) {
            // A failed call already carries its own error. Replacing it would hide
            // the failure, so a blocking hook's reason rides the next request.
            const downstream = await next()
            const contexts = [...(reason === undefined ? [] : [contextFromReason(reason)]), ...(context === undefined ? [] : [context])]
            return this.disposed || contexts.length === 0 ? downstream : { ...downstream, additionalContexts: [...contexts, ...(downstream.additionalContexts ?? [])] }
          }
          if (reason !== undefined)
            return {
              kind: 'block' as const,
              feedback: [{ type: 'text' as const, text: reason }],
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
          const outcome = await this.runPoint('Stop', '', { ...base(agent, 'Stop'), stop_hook_active: this.continuations > 0 }, agent, event.turn, event.signal)
          const { merged } = outcome
          if (this.disposed) return
          if (merged.stop) {
            this.reportBlocked('Stop', merged)
            this.halt(agent, 'Stop', merged)
            return
          }
          const reason = merged.decision === 'deny' ? this.blockReason('Stop', outcome) : undefined
          if (merged.decision === 'deny') this.reportBlocked('Stop', merged)
          if (reason === undefined && merged.additionalContext.length === 0) {
            this.continuations = 0
            return
          }
          // A blocking or context-bearing Stop hook continues the turn; the
          // reference cap stops an unconditionally blocking hook from looping.
          if (this.continuations >= STOP_CONTINUATION_CAP) {
            this.ctx.logger?.warn(
              'extension-hooks: Stop hook reached the ' + STOP_CONTINUATION_CAP + ' continuation cap for session ' + agent.session.header.id + '; the turn ends'
            )
            this.continuations = 0
            return
          }
          this.continuations += 1
          for (const message of [reason, ...merged.additionalContext]) {
            if (message === undefined || message.length === 0) continue
            agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: CONTEXT_SOURCE }))
          }
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
    this.listeners.push(
      ctx.on('session/event', (session, event) => {
        if (session !== agent.session || this.disposed) return
        // Compaction is owned by the host's compaction plugin, which this
        // package does not depend on: the event is read as durable data, by
        // its name, and a payload that is not an object runs nothing.
        const type: string = event.type
        if (type !== 'compaction/start') return
        const trigger = compactionTrigger(event.data)
        if (trigger === undefined) {
          this.ctx.logger?.warn('extension-hooks: ignored a compaction/start payload with no readable trigger for session ' + agent.session.header.id)
          return
        }
        void this.track(async () => {
          const { merged } = await this.runPoint(
            'PreCompact',
            trigger,
            { ...base(agent, 'PreCompact'), trigger, custom_instructions: '' },
            agent,
            this.lastTurn(),
            this.runs.signal
          )
          // No host interception point precedes a committed compaction, so a
          // blocking PreCompact decision cannot veto it.
          if (!this.disposed && merged.decision === 'deny')
            this.ctx.logger?.warn('extension-hooks: PreCompact hook blocked compaction for session ' + agent.session.header.id + ', but the host exposes no pre-compaction veto')
        }).catch(error => {
          this.ctx.logger?.warn('extension-hooks: PreCompact hook failed: ' + String(error))
        })
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
      const { merged } = await this.runPoint('SessionStart', source, { ...base(this.agent, 'SessionStart'), source }, this.agent, undefined, signal)
      if (this.disposed || signal?.aborted) return
      if (merged.stop) {
        this.reportBlocked('SessionStart', merged)
        this.halt(this.agent, 'SessionStart', merged)
        return
      }
      // No SessionStart interception point exists, so a blocking start hook is
      // reported and the session opens anyway.
      if (merged.decision === 'deny') this.reportBlocked('SessionStart', merged)
      const context = contextFrom(merged)
      if (context) this.agent.inject(context)
    })
    return this.startup
  }

  /** Stop admission, unregister listeners, abort and await owned runs. Repeated calls share completion. */
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    const finalSelection = new Map(this.selected)
    this.disposed = true
    // SessionEnd is the one point that fires from disposal, so it takes its own
    // signal: the shared drain signal is aborted by the drain this waits behind.
    const sessionEnd = finalSelection.size === 0 ? Promise.resolve() : this.sessionEnd(finalSelection)
    this.selected.clear()
    this.children.clear()
    for (const unregister of this.listeners.splice(0)) unregister()
    this.closing = Promise.all([sessionEnd, this.runs.drain(), this.pending]).then(() => undefined)
    return this.closing
  }

  /**
   * Run every selected SessionEnd hook once, and discard its output.
   *
   * The reference event cannot decide anything: its stdout is discarded and its
   * timeout is 1.5 seconds. The reason vocabulary has no host seam: the agent
   * disposal payload carries no reason, so the payload reports `other`, the
   * value the reference protocol uses when nothing finer is known.
   */
  private sessionEnd(selection: ReadonlyMap<string, Selection>): Promise<void> {
    return this.runPoint('SessionEnd', 'other', { ...base(this.agent, 'SessionEnd'), reason: 'other' }, this.agent, undefined, undefined, {
      closing: true,
      selection,
      defaultTimeoutMs: POINT_DEFAULT_TIMEOUT_MS.SessionEnd
    })
      .then(({ merged }) => {
        for (const message of merged.systemMessages) this.warnSystemMessage('SessionEnd', message, undefined)
        if (merged.decision === 'deny') this.reportBlocked('SessionEnd', merged)
      })
      .catch(error => {
        this.ctx.logger?.warn('extension-hooks: SessionEnd hook failed: ' + String(error))
      })
  }

  private observeSubagent(point: 'SubagentStart' | 'SubagentStop', info: SubagentRunInfo): void {
    if (this.disposed) return
    const child = this.children.get(info.runId) ?? (info.local ? this.ctx.get('agents')?.get(info.id) : undefined)
    if (point === 'SubagentStart' && child) this.children.set(info.runId, child)
    if (point === 'SubagentStop') this.children.delete(info.runId)
    void this.track(async () => {
      const { merged } = await this.runPoint(
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
      if (this.disposed) return
      if (point === 'SubagentStop') {
        // The subagent end edge is an emit-only notification: it carries no
        // interception point, so a block cannot keep the child running.
        if (merged.decision === 'deny') this.reportBlocked('SubagentStop', merged)
        return
      }
      const context = contextFrom(merged)
      if (context && child && this.children.get(info.runId) === child) child.inject(context)
      if (merged.stop && child) this.halt(child, 'SubagentStart', merged)
      // The subagent start edge cannot veto a spawn, so a denial is reported.
      if (merged.decision === 'deny') this.reportBlocked('SubagentStart', merged)
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

  /** Fold one point's hooks into the single decision its caller applies. */
  private async runPoint(
    point: Point,
    query: string,
    payload: Record<string, unknown>,
    subject?: Agent,
    turn?: Turn,
    signal?: AbortSignal,
    options: RunOptions = {}
  ): Promise<PointOutcome> {
    return foldOutcome(await this.collect(point, query, payload, subject, turn, signal, options))
  }

  /** Run every matching hook of one point and answer their decoded outputs. */
  private async collect(
    point: Point,
    query: string,
    payload: Record<string, unknown>,
    subject?: Agent,
    turn?: Turn,
    signal?: AbortSignal,
    options: RunOptions = {}
  ): Promise<HookOutput[]> {
    const closing = options.closing === true
    const selection = options.selection ?? this.selected
    const outputs: HookOutput[] = []
    // Disposal drains by aborting the shared signal, so the final pass it waits
    // behind cannot use it: SessionEnd would be killed before it ran.
    const ownerSignal = closing ? (signal ?? NEVER_ABORTED) : signal === undefined ? this.runs.signal : AbortSignal.any([signal, this.runs.signal])
    for (const [key, selected] of selection) {
      const { suite, hooks } = selected
      const cwd = subject?.session.header.cwd
      const projectDir = hooks.projectRoot ?? cwd
      // One context drives both the inline substitution and the process
      // environment, so a command and its own process.env reads agree.
      const root = pluginRootOf(suite)
      const data = root === undefined || this.dataRoot === undefined ? undefined : suiteDataDir(this.dataRoot, suite.sourceId, suite.id)
      const pathContext = { ...(root === undefined ? {} : { root }), ...(data === undefined ? {} : { data }), ...(projectDir === undefined ? {} : { projectDir }) }
      const env = pluginPathEnvironment(pathContext)
      // The declaration index counts every command hook of this event in declaration
      // order and across matcher groups, exactly as the session inventory numbered
      // its rows: a hook whose matcher does not apply still advances the position.
      let index = 0
      for (const group of hooks.events[point] ?? []) {
        const matched = matchesMatcher(group.matcher, query, 'claude-code')
        for (const hook of group.hooks) {
          const position = index++
          if (!matched) continue
          if ((!closing && this.disposed) || ownerSignal.aborted || selection.get(key) !== selected) break
          let allowed = false
          try {
            allowed = this.isSuiteAllowed(suite) === true && this.isHookAllowed?.(suite, point, position) !== false
          } catch (error) {
            this.ctx.logger.warn('extension-hooks: authorization failed for ' + key + ': ' + String(error))
          }
          if (!allowed) continue
          if (options.fallback === true) this.noticeFallback(key)
          const handlerId = 'extension-hooks:' + this.agent.id + ':' + key + ':' + point + ':' + ++this.handler
          if (subject && turn !== undefined)
            appendHookInvoked(subject.session, { turn, point, dialect: 'claude-code', handlerId, ...(group.matcher === undefined ? {} : { matcher: group.matcher }) })
          const { output, durationMs } = await runHook(
            this.ctx.shell,
            {
              command: expandPluginPaths(hook.command, pathContext),
              ...(hook.timeout === undefined ? {} : { timeoutSec: closing ? Math.min(hook.timeout, SESSION_END_MAX_TIMEOUT_MS / 1000) : hook.timeout })
            },
            {
              payload,
              defaultTimeoutMs: options.defaultTimeoutMs ?? POINT_DEFAULT_TIMEOUT_MS[point] ?? DEFAULT_HOOK_TIMEOUT_MS,
              signal: ownerSignal,
              trailingNewline: true,
              expectedEventName: point,
              ...(cwd === undefined ? {} : { cwd }),
              ...(Object.keys(env).length === 0 ? {} : { env })
            },
            () => performance.now()
          )
          if (subject && turn !== undefined)
            appendHookResult(subject.session, { turn, point, handlerId, output, durationMs, stderrSummaryMaxChars: DEFAULT_STDERR_SUMMARY_MAX_CHARS })
          this.reportUnapplied(key, point, output, position)
          this.warnSystemMessage(point, output.systemMessage, key)
          if ((!closing && this.disposed) || ownerSignal.aborted) continue
          outputs.push(withStdoutContext(point, output))
        }
      }
    }
    return outputs
  }

  /**
   * Whether any selected suite routes a failed call of this tool to the failure
   * event.
   *
   * The test is per matcher, not per suite: a suite may handle failed edits and
   * failed shell calls through different events, and one matching group is
   * enough to make the reference split apply to that tool.
   */
  private declaresFailureFor(toolName: string): boolean {
    for (const { hooks } of this.selected.values())
      for (const group of hooks.events.PostToolUseFailure ?? []) if (matchesMatcher(group.matcher, toolName, 'claude-code')) return true
    return false
  }

  /**
   * Report once per suite that its PostToolUse hooks still run for failed calls.
   *
   * The reference protocol runs PostToolUse only after a successful call. A
   * suite that declares no PostToolUseFailure keeps the older behavior, and this
   * line is how an author learns which event to declare to get the reference
   * split. It fires once per suite per agent, not once per failed call.
   */
  private noticeFallback(suiteKey: string): void {
    if (this.compatNotices.has(suiteKey)) return
    this.compatNotices.add(suiteKey)
    this.ctx.logger?.warn(
      'extension-hooks: ' +
        suiteKey +
        ' declares PostToolUse without PostToolUseFailure, so its PostToolUse hooks also run for failed calls; declare PostToolUseFailure to follow the reference split'
    )
  }

  /**
   * Report the reference fields this bridge cannot apply.
   *
   * Each is named with the host symbol that would have to change, so a suite
   * author reads why the field had no effect instead of assuming it did.
   */
  private reportUnapplied(key: string, point: Point, output: HookOutput, position: number): void {
    if (output.updatedInput !== undefined)
      this.ctx.logger.warn(
        'extension-hooks: ' + key + ' ' + point + '#' + position + ': updatedInput is not applied; the host PreToolDecision union (@deepseek-ai/dsh-tools) has no input-rewrite arm'
      )
  }

  /** Record a hook's user-visible warning on the only channel the host exposes: its log. */
  private warnSystemMessage(point: Point, message: string | undefined, key: string | undefined): void {
    if (message === undefined || message.trim() === '') return
    this.ctx.logger?.warn('extension-hooks: ' + (key ?? 'session') + ' ' + point + ' systemMessage: ' + logSafe(message))
  }

  /** Report a blocking decision the host point cannot enforce, or one whose output is discarded. */
  private reportBlocked(point: Point, merged: Outcome): void {
    this.ctx.logger?.warn('extension-hooks: ' + point + ' hook blocked: ' + logSafe(merged.reason ?? merged.stopReason ?? 'no reason supplied'))
  }

  /**
   * The model-facing reason one blocking decision carries.
   *
   * The reference protocol keeps the reason in two places: `permissionDecisionReason`
   * (or a top-level `reason`, or exit-2 stderr) and `systemMessage`. The merged
   * reason wins; the hook's own system message is the next best authored text, so
   * a hook that blocks with only a system message still explains itself instead of
   * falling back to a generic sentence.
   */
  private blockReason(point: Point, outcome: PointOutcome): string {
    const { merged } = outcome
    if (merged.reason !== undefined && merged.reason.length > 0) return merged.reason
    if (merged.stopReason !== undefined && merged.stopReason.length > 0) return merged.stopReason
    // A hook that allowed the call may still have written a warning. Folding that
    // text into the denial would present one hook's notice as another hook's
    // reason, so only a denying hook's own message can stand in for a reason.
    if (outcome.denySystemMessages.length > 0) return outcome.denySystemMessages.join(REASON_SEPARATOR)
    return DEFAULT_REASON[point] ?? 'blocked by ' + point + ' hook'
  }

  /**
   * Halt the run the way the host records a hook-caused cancellation.
   *
   * `AgentCancelCause` carries a `hook` arm, and the loop records the turn as
   * aborted with that reason, so `continue: false` is a real run-level halt
   * rather than a logged field. Cancelling also clears the pending inbox, which
   * is what a halt means.
   */
  private halt(subject: Agent, point: Point, merged: Outcome): void {
    const reason = merged.stopReason ?? merged.reason ?? DEFAULT_REASON[point] ?? 'stopped by ' + point + ' hook'
    this.ctx.logger?.warn('extension-hooks: ' + point + ' hook halted the run: ' + logSafe(reason))
    try {
      subject.cancel({ kind: 'hook', reason })
    } catch (error) {
      this.ctx.logger?.warn('extension-hooks: could not halt the run for ' + point + ': ' + String(error))
    }
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
/**
 * Fold one point's decoded outputs into the decision its caller applies.
 *
 * The merged outcome deliberately loses which hook said what, so the denial
 * reason kept beside it is rebuilt from the denying hooks alone.
 * @param outputs - every matched hook's decoded output, in hook order.
 * @returns the merged decision plus the system messages of denying hooks.
 */
function foldOutcome(outputs: HookOutput[]): PointOutcome {
  const denySystemMessages = outputs
    .filter(output => output.decision === 'deny' || output.decision === 'block')
    .map(output => output.systemMessage)
    .filter((message): message is string => message !== undefined && message.length > 0)
  return { merged: mergeHookOutputs(outputs), denySystemMessages }
}
function contextFrom(merged: Outcome) {
  return merged.additionalContext.length === 0
    ? undefined
    : createUserMessage({ content: merged.additionalContext.map(text => ({ type: 'text' as const, text })), source: CONTEXT_SOURCE })
}
function contextFromReason(reason: string) {
  return createUserMessage({ content: [{ type: 'text' as const, text: reason }], source: CONTEXT_SOURCE })
}

/**
 * Make hook-authored text safe to place in one log line.
 *
 * A hook controls its own output, and an unescaped newline would let it forge a
 * second log line. Every control character becomes a space, so the text stays
 * one record and the reader still sees what the hook wrote.
 * @param text - the hook-authored text.
 * @returns the same text with control characters replaced.
 */
function logSafe(text: string): string {
  let safe = ''
  for (const character of text) safe += character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character
  return safe
}

/**
 * Whether a hook's stdout is a JSON object the shared codec would parse.
 *
 * Exit-0 stdout is structured only when it parses as an object; anything else,
 * including text that opens with a brace, remains plain output.
 * @param stdout - the trimmed stdout.
 * @returns true when the text is a JSON object.
 */
function parsesAsJsonObject(stdout: string): boolean {
  if (!stdout.startsWith('{')) return false
  try {
    const parsed: unknown = JSON.parse(stdout)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Fold plain stdout into context for the two events the reference protocol
 * reads it on.
 *
 * Both reference events document plain (non-JSON) stdout as conversation
 * context. The codec keeps the raw stream, so the fold happens here rather
 * than in the shared decoder, which stays dialect-neutral.
 * @param point - the firing event.
 * @param output - the decoded hook outcome.
 * @returns the outcome, with plain stdout added as context when it applies.
 */
function withStdoutContext(point: Point, output: HookOutput): HookOutput {
  if (!STDOUT_CONTEXT_POINTS.has(point)) return output
  if (output.exitCode !== 0) return output
  const stdout = output.stdout.trim()
  if (stdout === '' || output.additionalContext !== undefined) return output
  // The codec applies structured fields only when the text parses as a JSON
  // object. Asking the same question answers "did the codec take it": a suite
  // banner that merely begins with a brace stays plain context.
  if (parsesAsJsonObject(stdout)) return output
  return { ...output, additionalContext: stdout }
}

/**
 * The approval prompt a hook-initiated ask shows.
 *
 * `PreToolDecision.ask.displayReason` carries one label per locale, so this
 * plugin's own prompt text ships both languages. The hook's authored reason
 * stays in `reason`, the audited field, rather than standing in for UI copy.
 *
 * The pair is written here instead of resolved through `HostTranslate` or
 * `locales.ts` because the host type is a per-locale record and every call site
 * is a synchronous host decision. A lookup would make an approval prompt depend
 * on a locale service the interception point does not inject, and a missing
 * service would leave the prompt empty rather than translated.
 */
const ASK_DISPLAY_REASON: { readonly en: string; readonly [locale: string]: string } = {
  en: 'A PreToolUse hook asks before this tool runs',
  zh: 'PreToolUse 钩子要求先确认再运行此工具'
}

/**
 * Read the compaction trigger out of a durable `compaction/start` payload.
 *
 * The compaction plugin is not a dependency of this package, so the payload is
 * validated as durable data: a manual compaction carries the command that asked
 * for it, an automatic one does not.
 * @param data - the event's data, as recorded.
 * @returns the trigger, or undefined when the payload is not an object.
 */
function compactionTrigger(data: unknown): 'manual' | 'auto' | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  return 'sourceCommandId' in data && data.sourceCommandId !== undefined ? 'manual' : 'auto'
}
