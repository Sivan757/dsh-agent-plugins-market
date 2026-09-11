/** Execute user and installed-suite agent cards through the host subagent service. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parse as parseYaml } from 'yaml'
import { mountSubagentCatalog, type SubagentCatalogEntry } from './subagent-catalog.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'
import { namedAgentRoles } from './agent-role-names.js'

export const AGENT_ROLE_TOOL_NAME = 'subagent_run'

/**
 * Absolute delegation-depth cap applied to every role child. The host default is
 * the same value; keeping it explicit preserves the shipped recursion budget.
 */
const MAX_AGENT_ROLE_DEPTH = 3

/** Panel identity is preserved so identically named cards from different suites remain addressable. */
export interface AgentRoleEntry {
  name: string
  path: string
  description: string
  disabled: boolean
  title?: string
  rawText?: string
}

/**
 * The executable part of one card. `tools` / `disallowedTools` stay in the file
 * and are preserved by the editors, but they are not applied.
 */
export interface AgentRolePolicy {
  content: string
  model?: string
  provider?: string
  reasoningEffort?: string
  title?: string
  description?: string
  disabled: boolean
}

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

export interface AgentRoleHost {
  tools: { register(definition: unknown): () => void }
  llm: {
    resolveCallConfig(config: { provider: string; model: string; reasoningEffort?: string }, signal?: AbortSignal): Promise<unknown>
  }
  subagents: {
    startContinuable(spec: { provider: string; label: string; request: AgentRoleDelegation; signal: AbortSignal }): Promise<{ childId: string; messageId: string }>
  }
}

function optionalText(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`agent metadata ${key} must be a non-empty string`)
  return value.trim()
}

/** Strict YAML parsing prevents malformed routing metadata from silently inheriting wider privileges. */
export function parseAgentRole(text: string): AgentRolePolicy {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (match === null) {
    if (/^(?:\uFEFF)?---(?:\r?\n|$)/.test(text)) throw new Error('agent frontmatter is not closed')
    return { content: text, disabled: false }
  }
  const parsed: unknown = parseYaml(match[1]!)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('agent frontmatter must be a YAML object')
  const metadata = parsed as Record<string, unknown>
  if (metadata.disabled !== undefined && typeof metadata.disabled !== 'boolean') throw new Error('agent metadata disabled must be a boolean')
  const model = optionalText(metadata.model, 'model')
  const provider = optionalText(metadata.provider, 'provider')
  const effort = optionalText(metadata.reasoning_effort, 'reasoning_effort')
  const camelEffort = optionalText(metadata.reasoningEffort, 'reasoningEffort')
  if (effort !== undefined && camelEffort !== undefined && effort !== camelEffort) throw new Error('agent metadata reasoning_effort and reasoningEffort conflict')
  const reasoningEffort = effort ?? camelEffort
  const title = optionalText(metadata.name, 'name')
  const description = optionalText(metadata.description, 'description')
  if (model === 'inherit' && provider !== undefined) throw new Error('agent model inherit cannot specify a provider')
  return {
    content: text.slice(match[0].length),
    disabled: metadata.disabled === true,
    ...(model === undefined || model === 'inherit' ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description })
  }
}

/** Effective route the parent Agent's next request would use. */
interface ParentRoute {
  options?: AgentRoleOptions
  session?: { requestHeader?(): { config?: AgentRoleOptions } | undefined }
}

function parentRouteOf(parent: unknown): AgentRoleOptions {
  const agent = parent as ParentRoute | undefined
  return agent?.session?.requestHeader?.()?.config ?? agent?.options ?? {}
}

/**
 * Resolve the child LLM options one card may contribute.
 *
 * A card route is advisory. Only an exact `provider` plus `model` pair is
 * applied, and only when the live LLM runtime accepts it; every other
 * declaration — a bare id, a Claude alias, a lone `provider`, an unsupported
 * effort — degrades to inheriting the parent route and reports a diagnostic.
 * @param policy - the card's parsed routing metadata.
 * @param parent - the calling Agent whose route an unusable declaration falls back to.
 * @param llm - live LLM runtime owning provider, model and effort validation.
 * @param signal - tool-call cancellation signal.
 * @param subject - role name used in diagnostics.
 * @param diagnose - diagnostic sink; degradation is reported, never silent.
 * @returns the options to send, or undefined for pure inheritance.
 */
export async function resolveAgentOptions(
  policy: AgentRolePolicy,
  parent: unknown,
  llm: AgentRoleHost['llm'],
  signal: AbortSignal,
  subject: string,
  diagnose: (message: string) => void
): Promise<AgentRoleOptions | undefined> {
  const exact = policy.provider !== undefined && policy.model !== undefined
  if (!exact && (policy.provider !== undefined || policy.model !== undefined)) {
    const declared = [policy.provider, policy.model].filter(value => value !== undefined).join('/')
    diagnose(`agent "${subject}": route "${declared}" needs an exact provider and model pair; it is ignored and the child inherits the parent route`)
  }
  const requested: AgentRoleOptions = exact ? { provider: policy.provider, model: policy.model } : {}
  const effort = policy.reasoningEffort
  if (effort === undefined && requested.provider === undefined) return undefined

  const inherited = parentRouteOf(parent)
  const provider = requested.provider ?? inherited.provider
  const model = requested.model ?? inherited.model
  if (provider === undefined || model === undefined) {
    /* v8 ignore next 3 -- an effective route is always known once a parent Agent ran a request. */
    if (effort !== undefined) diagnose(`agent "${subject}": reasoning effort "${effort}" has no effective route to validate against; it is ignored`)
    return undefined
  }
  const routeChanged = provider !== inherited.provider || model !== inherited.model
  const effectiveEffort = effort ?? (routeChanged ? undefined : inherited.reasoningEffort)
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
    ...(requested.provider === undefined ? {} : { provider: requested.provider, model: requested.model! }),
    ...(effort === undefined ? {} : { reasoningEffort: effort })
  }
}

/** Stable summaries; invalid declarations are excluded and transient read failures abort publication. */
export async function agentRoleCatalog(entries: AgentRoleEntry[], signal: AbortSignal, diagnose: (message: string) => void = () => {}): Promise<SubagentCatalogEntry[]> {
  const summaries: SubagentCatalogEntry[] = []
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  for (const entry of namedAgentRoles(entries)) {
    signal.throwIfAborted()
    if (entry.disabled) continue
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
      policy = parseAgentRole(text)
    } catch (error) {
      diagnose(`${entry.path}: ${String(error)}`)
      continue
    }
    if (policy.disabled) continue
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

/** Read the same declaration for catalog summaries and execution, including inline resources. */
export async function readAgentRole(entry: AgentRoleEntry): Promise<AgentRolePolicy> {
  return parseAgentRole(entry.rawText ?? (await readFile(entry.path, 'utf8')))
}

/**
 * Start one role child and return its durable id without waiting for the result.
 * Resume state, steering, and the settlement notice belong to the host's
 * continuation manager; this executor owns only role resolution.
 */
export async function executeAgentRole(
  host: AgentRoleHost,
  listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>,
  agentName: string,
  prompt: string,
  parent: unknown,
  signal: AbortSignal,
  diagnose: (message: string) => void = () => {}
): Promise<{ subagentId: string }> {
  if (parent === undefined) throw new Error('subagent_run requires a calling agent')
  if (prompt.trim() === '') throw new Error('subagent_run requires a non-empty prompt')
  signal.throwIfAborted()
  const entries = namedAgentRoles(await listRoles(parent)).filter(entry => entry.callName === agentName)
  if (entries.length !== 1) throw new Error(`agent "${agentName}" is unavailable or ambiguous`)
  const entry = entries[0]!
  if (entry.disabled) throw new Error(`agent "${agentName}" is disabled`)
  const policy = await readAgentRole(entry)
  if (policy.disabled) throw new Error(`agent "${agentName}" is disabled`)
  const agentOptions = await resolveAgentOptions(policy, parent, host.llm, signal, agentName, diagnose)
  signal.throwIfAborted()
  const started = await host.subagents.startContinuable({
    provider: 'spawn',
    label: agentName,
    request: {
      prompt: [{ type: 'text', text: prompt }],
      parent,
      maxDepth: MAX_AGENT_ROLE_DEPTH,
      persona: policy.content,
      ...(agentOptions === undefined ? {} : { agentOptions })
    },
    signal
  })
  return { subagentId: started.childId }
}

/** Mount once after tools, llm and subagents are available; the returned disposer belongs to the plugin lifecycle. */
export function mountAgentRoleTool(ctx: Context, listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>, t: HostTranslate = bindHostLocale(undefined)): () => void {
  const host = ctx as unknown as AgentRoleHost
  const tool = defineTool({
    name: AGENT_ROLE_TOOL_NAME,
    description:
      'Delegate a self-contained task to a role from the current subagent catalog. The child starts without the parent conversation and runs ' +
      'in the background: this returns a durable subagent id immediately. When the run settles the runtime sends you a notice carrying its ' +
      "outcome and closing message, and send_message steers the child while it runs. The role's saved persona and model settings are applied automatically.",
    parameters: {
      agent: { type: 'string', required: true, description: 'Exact callable role name from the current subagent catalog.' },
      prompt: { type: 'string', required: true, description: 'Complete task and context for the isolated child.' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { subagentId: { type: 'string', required: true } }
      },
      render: (_args, value) => [{ type: 'text', text: `started subagent ${value.subagentId}` }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return executeAgentRole(host, listRoles, args.agent, args.prompt, exec.agent, exec.signal, message => ctx.logger?.warn(message))
    }
  })
  const disposeTool = host.tools.register(tool)
  let disposeCatalog: () => void
  try {
    disposeCatalog = mountSubagentCatalog(ctx, tool, async (agent, signal) => agentRoleCatalog(await listRoles(agent), signal, message => ctx.logger?.warn(message)), t)
  } catch (error) {
    disposeTool()
    throw error
  }
  return () => {
    disposeCatalog()
    disposeTool()
  }
}
