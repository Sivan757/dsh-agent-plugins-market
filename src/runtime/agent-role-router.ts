/** Execute user and installed-suite agent cards through the host subagent service. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parse as parseYaml } from 'yaml'
import { mountSubagentCatalog, type SubagentCatalogEntry } from './subagent-catalog.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export const AGENT_ROLE_TOOL_NAME = 'subagents_run'

/** Panel identity is preserved so identically named cards from different suites remain addressable. */
export interface AgentRoleEntry {
  name: string
  path: string
  description: string
  disabled: boolean
  title?: string
  rawText?: string
}

export interface AgentRolePolicy {
  content: string
  model?: string
  provider?: string
  reasoningEffort?: string
  title?: string
  description?: string
  tools?: string[]
  disallowedTools?: string[]
  disabled: boolean
}

function optionalText(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`agent metadata ${key} must be a non-empty string`)
  return value.trim()
}

function toolList(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return undefined
  const entries: unknown[] = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [value]
  return [
    ...new Set(
      entries.map(entry => {
        if (typeof entry !== 'string' || !/^[\w.:-]+$/.test(entry.trim())) throw new Error(`agent metadata ${key} must contain tool names (comma-separated or a YAML array)`)
        return entry.trim()
      })
    )
  ]
}

/** Strict YAML parsing prevents malformed routing/restriction metadata from silently inheriting wider privileges. */
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
    ...(description === undefined ? {} : { description }),
    ...(metadata.tools === undefined ? {} : { tools: toolList(metadata.tools, 'tools') }),
    ...(metadata.disallowedTools === undefined ? {} : { disallowedTools: toolList(metadata.disallowedTools, 'disallowedTools') })
  }
}

interface ModelCatalog {
  listProviders(): { id: string }[]
  listModels(provider: string): Promise<{ id: string }[]>
  resolveCallConfig(config: { provider: string; model: string; reasoningEffort?: string }, signal?: AbortSignal): Promise<unknown>
}

/** Bare ids must resolve uniquely; Claude aliases are accepted only if actually advertised by a DSH provider. */
export async function resolveAgentModel(policy: AgentRolePolicy, catalog: ModelCatalog): Promise<{ provider?: string; model?: string }> {
  if (policy.model === undefined) return policy.provider === undefined ? {} : { provider: policy.provider }
  const providers = catalog.listProviders()
  if (policy.provider !== undefined) {
    if (!providers.some(provider => provider.id === policy.provider)) throw new Error(`agent model provider "${policy.provider}" is not registered`)
    return { provider: policy.provider, model: policy.model }
  }
  const qualified = providers.filter(provider => policy.model!.startsWith(`${provider.id}/`)).sort((a, b) => b.id.length - a.id.length)[0]
  if (qualified !== undefined) {
    const model = policy.model.slice(qualified.id.length + 1)
    if (model === '') throw new Error('agent model id must not be empty')
    return { provider: qualified.id, model }
  }
  const matches = (
    await Promise.all(
      providers.map(async provider => {
        try {
          return (await catalog.listModels(provider.id)).some(model => model.id === policy.model) ? provider.id : undefined
        } catch {
          return undefined
        }
      })
    )
  ).filter((provider): provider is string => provider !== undefined)
  if (matches.length !== 1) throw new Error(`agent model "${policy.model}" ${matches.length === 0 ? 'is not advertised' : 'is ambiguous'}; configure provider and model explicitly`)
  return { provider: matches[0], model: policy.model }
}

export interface AgentRoleRequest {
  label: string
  prompt: { type: 'text'; text: string }[]
  parent: unknown
  signal: AbortSignal
  maxDepth: number
  agentOptions: { provider?: string; model?: string; reasoningEffort?: string }
  persona: string
  toolFilter?: { allow?: string[]; deny?: string[] }
}

export interface AgentRoleHost {
  tools: { register(definition: unknown): () => void }
  llm: ModelCatalog
  subagents: {
    start(
      provider: string,
      request: AgentRoleRequest
    ): Promise<{
      id: string
      result: Promise<{ stopReason: string; output: JsonValue[] }>
      dispose(): void | Promise<void>
    }>
  }
}

/** Read the same declaration for catalog summaries and execution, including inline resources. */
export async function readAgentRole(entry: AgentRoleEntry): Promise<AgentRolePolicy> {
  return parseAgentRole(entry.rawText ?? (await readFile(entry.path, 'utf8')))
}

/** Stable summaries; invalid declarations are excluded and transient read failures abort publication. */
export async function agentRoleCatalog(entries: AgentRoleEntry[], signal: AbortSignal, diagnose: (message: string) => void = () => {}): Promise<SubagentCatalogEntry[]> {
  const summaries: SubagentCatalogEntry[] = []
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  for (const entry of entries) {
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
    summaries.push({
      name: entry.name,
      title: policy.title ?? entry.title ?? entry.name,
      description: description.length <= 500 ? description : `${description.slice(0, 497)}...`,
      ...(policy.provider === undefined ? {} : { provider: policy.provider }),
      ...(policy.model === undefined ? {} : { model: policy.model }),
      ...(policy.reasoningEffort === undefined ? {} : { reasoningEffort: policy.reasoningEffort })
    })
  }
  signal.throwIfAborted()
  return summaries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Resolve fresh panel state and raw Markdown on every call, including after edits, disabling and uninstall. */
export async function executeAgentRole(
  host: AgentRoleHost,
  listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>,
  name: string,
  prompt: string,
  parent: unknown,
  signal: AbortSignal
): Promise<{ runId: string; output: JsonValue[] }> {
  if (parent === undefined) throw new Error('subagents_run requires a calling agent')
  if (prompt.trim() === '') throw new Error('subagents_run requires a non-empty prompt')
  signal.throwIfAborted()
  const entries = (await listRoles(parent)).filter(entry => entry.name === name)
  if (entries.length !== 1) throw new Error(`agent role "${name}" is unavailable or ambiguous`)
  const entry = entries[0]!
  if (entry.disabled) throw new Error(`agent role "${name}" is disabled`)
  const policy = await readAgentRole(entry)
  if (policy.disabled) throw new Error(`agent role "${name}" is disabled`)
  const agentOptions = { ...(await resolveAgentModel(policy, host.llm)), ...(policy.reasoningEffort === undefined ? {} : { reasoningEffort: policy.reasoningEffort }) }
  const parentAgent = parent as { options?: AgentRoleRequest['agentOptions']; session?: { requestHeader?(): { config: AgentRoleRequest['agentOptions'] } | undefined } }
  const parentOptions = parentAgent.session?.requestHeader?.()?.config ?? parentAgent.options ?? {}
  const provider = agentOptions.provider ?? parentOptions.provider
  const model = agentOptions.model ?? parentOptions.model
  if (provider === undefined || model === undefined) throw new Error('subagents_run requires an effective provider and model')
  const routeChanged = provider !== parentOptions.provider || model !== parentOptions.model
  const reasoningEffort = agentOptions.reasoningEffort ?? (routeChanged ? undefined : parentOptions.reasoningEffort)
  await host.llm.resolveCallConfig({ provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }, signal)
  signal.throwIfAborted()
  const run = await host.subagents.start('spawn', {
    label: name,
    prompt: [{ type: 'text', text: prompt }],
    parent,
    signal,
    maxDepth: 3,
    agentOptions,
    persona: policy.content,
    ...(policy.tools === undefined && policy.disallowedTools === undefined
      ? {}
      : {
          toolFilter: {
            ...(policy.tools === undefined ? {} : { allow: policy.tools }),
            ...(policy.disallowedTools === undefined ? {} : { deny: policy.disallowedTools })
          }
        })
  })
  try {
    const result = await run.result
    if (result.stopReason !== 'completed') throw new Error(`agent role "${name}" stopped: ${result.stopReason}; partial output: ${JSON.stringify(result.output)}`)
    return { runId: run.id, output: result.output }
  } finally {
    await run.dispose()
  }
}

/** Mount once after tools, llm and subagents are available; the returned disposer belongs to the plugin lifecycle. */
export function mountAgentRoleTool(ctx: Context, listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>, t: HostTranslate = bindHostLocale(undefined)): () => void {
  const host = ctx as unknown as AgentRoleHost
  const tool = defineTool({
    name: AGENT_ROLE_TOOL_NAME,
    description:
      'Delegate a self-contained task to a role from the current subagent catalog and wait for its result. The child starts without the parent conversation. Its saved provider, model, reasoning effort, persona and tool restrictions are applied automatically.',
    parameters: {
      role: { type: 'string', required: true, description: 'Exact role ID from the current subagent catalog.' },
      prompt: { type: 'string', required: true, description: 'Complete task and context for the isolated child.' }
    },
    output: { schema: { type: 'json' }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return executeAgentRole(host, listRoles, args.role, args.prompt, exec.agent, exec.signal)
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
