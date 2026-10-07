/** Execute user and installed-suite agent cards through the host subagent service. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountSubagentCatalog, type SubagentCatalogEntry } from './subagent-catalog.js'
import { namedAgentRoles } from './agent-role-names.js'
import { expandPluginPaths } from '../../catalog/plugin-variables.js'
import { parseAgentRole, type AgentRoleEntry, type AgentRolePolicy } from '../../application/agent-roles.js'

export { parseAgentRole }
export type { AgentRoleEntry, AgentRolePolicy }

/** A declaration that has been through the call-name pass, so it answers exactly one callable name. */
export type NamedAgentRole = AgentRoleEntry & { callName: string }

export const AGENT_ROLE_TOOL_NAME = 'subagent_role'

/**
 * Absolute delegation-depth cap applied to every role child. The host default is
 * the same value; keeping it explicit preserves the shipped recursion budget.
 */
const MAX_AGENT_ROLE_DEPTH = 3

/** Child LLM options this plugin sends; never carries inherited parent values. */
export interface AgentRoleOptions {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** What the host `ctx.subagents` seam receives for one role delegation. */
export interface AgentRoleDelegation {
  prompt: { type: 'text'; text: string }[]
  parent: unknown
  maxDepth: number
  persona: string
  agentOptions?: AgentRoleOptions
}

/** A one-shot foreground run carries its own cancellation signal on the request. */
export interface AgentRoleRunRequest extends AgentRoleDelegation {
  signal: AbortSignal
}

export interface AgentRoleHost {
  tools: { register(definition: unknown): () => void }
  llm: {
    resolveCallConfig(config: { provider: string; model: string; reasoningEffort?: string }, signal?: AbortSignal): Promise<unknown>
  }
  subagents: {
    startContinuable(spec: { provider: string; label: string; request: AgentRoleDelegation; signal: AbortSignal }): Promise<{ childId: string; messageId: string }>
    /** One-shot foreground run: the host settles it and hands back the child's output. */
    start(provider: string, request: AgentRoleRunRequest): Promise<AgentRoleRun>
  }
}

/**
 * JSON value crossing the tool-result boundary. Declared locally so this plugin
 * keeps its declared host surface: the registry performs the authoritative
 * lossless snapshot of the child's content blocks on the way out.
 */
export type AgentRoleJson = null | boolean | number | string | AgentRoleJson[] | { [key: string]: AgentRoleJson }

/** One settled foreground role run; `result` resolves with the child's terminal output. */
export interface AgentRoleRun {
  id: string
  result: Promise<{ output: unknown[]; stopReason: string; diagnostic?: string }>
  dispose(): Promise<void>
}

/**
 * The calling Agent as this plugin reads it: the route it would use and the
 * working directory its session carries. One shape covers both reads, so no
 * call site casts the parent for itself. The parent stays opaque to the host
 * call, which receives the Agent itself and derives identity from it.
 */
export interface AgentRoleParent {
  options?: AgentRoleOptions
  session?: {
    requestHeader?(): { config?: AgentRoleOptions } | undefined
    header?: { cwd?: unknown }
  }
}

/** The parent's effective route, which an unusable child declaration falls back to. */
function parentRouteOf(parent: unknown): AgentRoleOptions {
  const agent = parent as AgentRoleParent | undefined
  return agent?.session?.requestHeader?.()?.config ?? agent?.options ?? {}
}

/**
 * Resolve the child LLM options for one role call.
 *
 * The call's own `provider` + `model` pair wins, and the role card supplies the
 * default when the call names neither. Only an exact pair is applied, and only
 * when the live LLM runtime accepts it; a bare id, a Claude alias, a lone
 * `provider` or an unsupported effort degrades to inheriting the parent route
 * and reports a diagnostic. An explicit route with no explicit effort uses the
 * selected model's default, so a card's effort never leaks onto a route it was
 * not written for.
 * @param policy - the card's parsed routing metadata, used as the default route.
 * @param requested - the route the call itself asked for.
 * @param parent - the calling Agent whose route an unusable declaration falls back to.
 * @param llm - live LLM runtime owning provider, model and effort validation.
 * @param signal - tool-call cancellation signal.
 * @param subject - role name used in diagnostics.
 * @param diagnose - diagnostic sink; degradation is reported, never silent.
 * @returns the options to send, or undefined for pure inheritance.
 */
export async function resolveAgentOptions(
  policy: AgentRolePolicy,
  requested: AgentRoleOptions,
  parent: unknown,
  llm: AgentRoleHost['llm'],
  signal: AbortSignal,
  subject: string,
  diagnose: (message: string) => void
): Promise<AgentRoleOptions | undefined> {
  const cardRoute = policy.provider !== undefined && policy.model !== undefined ? { provider: policy.provider, model: policy.model } : undefined
  if (cardRoute === undefined && (policy.provider !== undefined || policy.model !== undefined)) {
    const declared = [policy.provider, policy.model].filter(value => value !== undefined).join('/')
    diagnose(`agent "${subject}": route "${declared}" needs an exact provider and model pair; it is ignored and the child inherits the parent route`)
  }
  const callRoute = requested.provider !== undefined && requested.model !== undefined ? { provider: requested.provider, model: requested.model } : undefined
  if (callRoute === undefined && (requested.provider !== undefined || requested.model !== undefined)) {
    const declared = [requested.provider, requested.model].filter(value => value !== undefined).join('/')
    diagnose(`agent "${subject}": the call's route "${declared}" needs an exact provider and model pair; it is ignored`)
  }
  // One value, so a half-specified route can never be forwarded downstream.
  const route = callRoute ?? cardRoute
  const routeEffort = callRoute === undefined ? policy.reasoningEffort : undefined
  const effort = requested.reasoningEffort ?? routeEffort
  if (effort === undefined && route === undefined) return undefined

  const inherited = parentRouteOf(parent)
  const provider = route?.provider ?? inherited.provider
  const model = route?.model ?? inherited.model
  if (provider === undefined || model === undefined) {
    /* v8 ignore next 3 -- an effective route is always known once a parent Agent ran a request. */
    if (effort !== undefined) diagnose(`agent "${subject}": reasoning effort "${effort}" has no effective route to validate against; it is ignored`)
    return undefined
  }
  // An explicit route choice starts from the selected model's default effort.
  const effectiveEffort = effort ?? (route === undefined ? inherited.reasoningEffort : undefined)
  try {
    await llm.resolveCallConfig({ provider, model, ...(effectiveEffort === undefined ? {} : { reasoningEffort: effectiveEffort }) }, signal)
  } catch (error) {
    signal.throwIfAborted()
    diagnose(`agent "${subject}": route ${provider}/${model} is unusable (${String(error)}); it is ignored and the child inherits the parent route`)
    return undefined
  }
  // Cancellation raised during the adapter lookup must not create a child.
  signal.throwIfAborted()
  return {
    ...(route ?? {}),
    ...(effort === undefined ? {} : { reasoningEffort: effort })
  }
}

/** Stable summaries; invalid declarations are excluded and transient read failures abort publication. */
export async function agentRoleCatalog(
  entries: AgentRoleEntry[],
  signal: AbortSignal,
  diagnose: (message: string) => void = () => {},
  projectDir?: string
): Promise<SubagentCatalogEntry[]> {
  const summaries: SubagentCatalogEntry[] = []
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  for (const entry of namedAgentRoles(entries)) {
    signal.throwIfAborted()
    if (entry.disabled && entry.selectionEnabled !== true) continue
    if (counts.get(entry.name) !== 1) {
      diagnose(`ambiguous subagent role: ${entry.name}`)
      continue
    }
    let text: string
    try {
      text = entry.rawText ?? (await readFile(entry.path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      continue
    }
    let policy: AgentRolePolicy
    try {
      policy = expandPolicyPaths(parseAgentRole(text), entry, projectDir)
    } catch (error) {
      diagnose(`${entry.path}: ${String(error)}`)
      continue
    }
    if (policy.disabled && entry.selectionEnabled !== true) continue
    const description = (policy.description ?? entry.description).replaceAll(/\s+/g, ' ').trim()
    // Advertise a route only when the executor would apply it.
    const exact = policy.provider !== undefined && policy.model !== undefined
    summaries.push({
      name: entry.callName,
      roleId: entry.name,
      title: policy.title ?? entry.title ?? entry.callName,
      description: description.length <= 500 ? description : `${description.slice(0, 497)}...`,
      ...(exact ? { provider: policy.provider, model: policy.model } : {}),
      ...(policy.reasoningEffort === undefined ? {} : { reasoningEffort: policy.reasoningEffort })
    })
  }
  signal.throwIfAborted()
  return summaries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** A suite card carries the same path variables as every other surface its author wrote for. */
function expandPolicyPaths(policy: AgentRolePolicy, entry: AgentRoleEntry, projectDir: string | undefined): AgentRolePolicy {
  if (entry.suiteRoot === undefined && entry.suiteData === undefined && projectDir === undefined) return policy
  const context = {
    ...(entry.suiteRoot === undefined ? {} : { root: entry.suiteRoot }),
    ...(entry.suiteData === undefined ? {} : { data: entry.suiteData }),
    ...(projectDir === undefined ? {} : { projectDir })
  }
  return {
    ...policy,
    content: expandPluginPaths(policy.content, context),
    ...(policy.title === undefined ? {} : { title: expandPluginPaths(policy.title, context) }),
    ...(policy.description === undefined ? {} : { description: expandPluginPaths(policy.description, context) })
  }
}

/** Read the same declaration for catalog summaries and execution, including inline resources. */
export async function readAgentRole(entry: AgentRoleEntry, projectDir?: string): Promise<AgentRolePolicy> {
  return expandPolicyPaths(parseAgentRole(entry.rawText ?? (await readFile(entry.path, 'utf8'))), entry, projectDir)
}

/** The calling session's directory, which is what a card's `${CLAUDE_PROJECT_DIR}` names. */
export function sessionCwd(parent: unknown): string | undefined {
  const cwd = (parent as AgentRoleParent | undefined)?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/** Resolve one current, enabled role for either host delegation surface. */
export async function resolveRolePolicy(
  listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>,
  agentName: string,
  parent: unknown
): Promise<{ entry: NamedAgentRole; policy: AgentRolePolicy }> {
  const [entry, ...duplicates] = namedAgentRoles(await listRoles(parent)).filter(candidate => candidate.callName === agentName)
  if (entry === undefined || duplicates.length > 0) throw new Error(`agent "${agentName}" is unavailable or ambiguous`)
  if (entry.disabled && entry.selectionEnabled !== true) throw new Error(`agent "${agentName}" is disabled`)
  const policy = await readAgentRole(entry, sessionCwd(parent))
  if (policy.disabled && entry.selectionEnabled !== true) throw new Error(`agent "${agentName}" is disabled`)
  return { entry, policy }
}

/**
 * Prove the role this call resolved is still a current, enabled role.
 *
 * Route validation awaits the live LLM runtime, and a global disable or a
 * session selection change can land while that await is in flight. A child
 * created from a role the current catalog no longer authorizes would run
 * instructions that were already revoked, so the catalog is re-read
 * immediately before the spawn and compared by the stable role id parsed from
 * the declaration, never by the display or call name: a role renamed underneath
 * this call cannot be mistaken for the one it resolved.
 * @param listRoles - the same parent-scoped catalog reader the call resolved from.
 * @param resolved - the entry this call resolved before its asynchronous work began.
 * @param parent - the calling agent, so a session-scoped catalog is re-read for that same session.
 * @throws when the role is gone, disabled, ambiguous, or no longer answers its call name.
 */
export async function requireCurrentRole(listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>, resolved: NamedAgentRole, parent: unknown): Promise<void> {
  const matches = namedAgentRoles(await listRoles(parent)).filter(candidate => candidate.name === resolved.name)
  if (matches.length !== 1 || matches[0]!.callName !== resolved.callName) throw new Error('agent "' + resolved.callName + '" is unavailable')
  const current = matches[0]!
  const policy = await readAgentRole(current, sessionCwd(parent))
  if ((current.disabled || policy.disabled) && current.selectionEnabled !== true) throw new Error('agent "' + resolved.callName + '" is disabled')
}

/**
 * How one role call reaches a child, carrying the host delegation tool's own
 * two-value semantics: `continuable` is the default, and only an explicit
 * `false` asks for a `foreground` run. A call that passes `true` keeps the
 * default, so one rule covers this tool and the host's `subagent` alike.
 */
export type AgentRoleRunMode = 'continuable' | 'foreground'

/** One role call's outcome, discriminated so the tool can render each channel. */
export type AgentRoleResult = { kind: 'continuable'; subagentId: string } | { kind: 'foreground'; runId: string; output: AgentRoleJson[] }

/**
 * Run one role child through the requested channel.
 * @param host - the exact live seams this executor owns: tools, llm and subagents.
 * @param mode - which channel the call asked for.
 */
export async function executeAgentRole(
  host: AgentRoleHost,
  listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>,
  agentName: string,
  prompt: string,
  parent: unknown,
  requestedRoute: AgentRoleOptions,
  mode: AgentRoleRunMode,
  signal: AbortSignal,
  diagnose: (message: string) => void = () => {}
): Promise<AgentRoleResult> {
  if (parent === undefined) throw new Error(`${AGENT_ROLE_TOOL_NAME} requires a calling agent`)
  if (prompt.trim() === '') throw new Error(`${AGENT_ROLE_TOOL_NAME} requires a non-empty prompt`)
  signal.throwIfAborted()
  const { entry, policy } = await resolveRolePolicy(listRoles, agentName, parent)
  const agentOptions = await resolveAgentOptions(policy, requestedRoute, parent, host.llm, signal, agentName, diagnose)
  signal.throwIfAborted()
  // The route lookup awaited the live LLM runtime; prove the role still stands
  // before either channel creates a child.
  await requireCurrentRole(listRoles, entry, parent)
  signal.throwIfAborted()
  const request: AgentRoleDelegation = {
    prompt: [{ type: 'text', text: prompt }],
    parent,
    maxDepth: MAX_AGENT_ROLE_DEPTH,
    persona: policy.content,
    ...(agentOptions === undefined ? {} : { agentOptions })
  }
  if (mode === 'continuable') {
    const started = await host.subagents.startContinuable({ provider: 'spawn', label: agentName, request, signal })
    return { kind: 'continuable', subagentId: started.childId }
  }
  const run = await host.subagents.start('spawn', { ...request, signal })
  try {
    const result = await run.result
    if (result.stopReason !== 'completed') {
      const detail = result.diagnostic === undefined ? '' : `: ${result.diagnostic}`
      throw new Error(`agent "${agentName}" did not complete (${result.stopReason})${detail}`)
    }
    // The registry performs the authoritative lossless snapshot of the child's
    // output blocks on the way out, exactly as the host's own delegation tool does.
    return { kind: 'foreground', runId: run.id, output: result.output as unknown as AgentRoleJson[] }
  } finally {
    await run.dispose()
  }
}

/**
 * Mount once after tools, llm and subagents are available; the returned disposer belongs to the plugin lifecycle.
 *
 * The delegation contract lives here rather than in the injected catalog: a tool
 * description is present in every request, while the catalog message is
 * re-published whenever roles change, so guidance kept out of the catalog is
 * sent once and stays readable through compaction.
 */
export function mountAgentRoleTool(ctx: Context, listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>): () => void {
  const host = ctx as unknown as AgentRoleHost
  const tool = defineTool({
    name: AGENT_ROLE_TOOL_NAME,
    description:
      "Delegate a task to a named role child from the session's subagent-catalog: the role's own instructions and its configured model apply, and the child starts without this conversation. Use it proactively for self-contained work — codebase exploration whose raw reads would fill this context, a scoped implementation, a review, or an analysis you can brief in one prompt — and start independent children together in one message. The child runs in " +
      'the background by default and returns a durable subagent id at once, keeping the child available for later turns; when the run settles, the runtime sends the parent a notice carrying its outcome and ' +
      'final reply. A child usually runs for minutes, so continue with independent work instead of waiting. `prompt` must stand alone, since the child cannot see this conversation and a question it asks while it runs goes unanswered. When the notice arrives, verify its ' +
      "assertions against the files and relay the result to the user; the child's output is not visible to them. The current subagent-catalog lists the available roles and the full usage guidance; when no listed " +
      "role matches, use the host's own `subagent` tools instead.",
    parameters: {
      agent: { type: 'string', required: true, description: 'Exact callable role name listed in the current "subagent-catalog" message.' },
      prompt: {
        type: 'string',
        required: true,
        description:
          "The complete, self-contained task for the role child. It does not share this conversation's context, so include everything it needs: what the task is and why, the relevant files and known findings, the output you expect, and the boundaries of the task."
      },
      provider: {
        type: 'string',
        description:
          "LLM provider route for the child. Supply together with model to override the route the role card declares; omit both to use the card's route or inherit the parent route."
      },
      model: {
        type: 'string',
        description:
          "Model id interpreted by provider. Supply together with provider to override the route the role card declares; omit both to use the card's route or inherit the parent route."
      },
      reasoning_effort: {
        type: 'string',
        description:
          "Adapter-owned reasoning effort for the effective child route. Omit to use the card's effort on the card's route, or the selected model's default after an explicit route change."
      },
      run_in_background: {
        type: 'boolean',
        description: 'Defaults to true. Set false only when your next action depends on the result.'
      }
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true }
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } }
            }
          }
        ]
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.kind === 'continuable' ? `started subagent ${value.subagentId}` : `subagent ${value.runId} finished`
        }
      ]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      // The parameter keeps the host tool's name, shape and semantics: only an
      // explicit `false` leaves the durable-child default for a foreground run.
      const mode: AgentRoleRunMode = args.run_in_background === false ? 'foreground' : 'continuable'
      return executeAgentRole(
        host,
        listRoles,
        args.agent,
        args.prompt,
        exec.agent,
        {
          ...(args.provider === undefined ? {} : { provider: args.provider }),
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort })
        },
        mode,
        exec.signal,
        message => ctx.logger?.warn(message)
      )
    }
  })
  const disposeTool = host.tools.register(tool)
  let disposeCatalog: () => void
  try {
    disposeCatalog = mountSubagentCatalog(ctx, tool, async (agent, signal) =>
      agentRoleCatalog(await listRoles(agent), signal, message => ctx.logger?.warn(message), sessionCwd(agent))
    )
  } catch (error) {
    disposeTool()
    throw error
  }
  return () => {
    disposeCatalog()
    disposeTool()
  }
}
