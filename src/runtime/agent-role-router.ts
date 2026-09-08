/** Execute user and installed-suite agent cards through the host subagent service. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parse as parseYaml } from 'yaml'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export const AGENT_ROLE_TOOL_NAME = 'market_agent'

/** Panel identity is preserved so identically named cards from different suites remain addressable. */
export interface AgentRoleEntry {
  name: string
  path: string
  description: string
  disabled: boolean
}

export interface AgentRolePolicy {
  content: string
  model?: string
  provider?: string
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
  if (model === 'inherit' && provider !== undefined) throw new Error('agent model inherit cannot specify a provider')
  return {
    content: text.slice(match[0].length),
    disabled: metadata.disabled === true,
    ...(model === undefined || model === 'inherit' ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    ...(metadata.tools === undefined ? {} : { tools: toolList(metadata.tools, 'tools') }),
    ...(metadata.disallowedTools === undefined ? {} : { disallowedTools: toolList(metadata.disallowedTools, 'disallowedTools') })
  }
}

interface ModelCatalog {
  listProviders(): { id: string }[]
  listModels(provider: string): Promise<{ id: string }[]>
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
  agentOptions: { provider?: string; model?: string }
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

/** Resolve fresh panel state and raw Markdown on every call, including after edits, disabling and uninstall. */
export async function executeAgentRole(
  host: AgentRoleHost,
  listRoles: () => Promise<AgentRoleEntry[]>,
  name: string,
  prompt: string,
  parent: unknown,
  signal: AbortSignal
): Promise<{ runId: string; output: JsonValue[] }> {
  if (parent === undefined) throw new Error('market_agent requires a calling agent')
  const entries = (await listRoles()).filter(entry => entry.name === name)
  if (entries.length !== 1) throw new Error(`agent role "${name}" is unavailable or ambiguous`)
  const entry = entries[0]!
  if (entry.disabled) throw new Error(`agent role "${name}" is disabled`)
  const policy = parseAgentRole(await readFile(entry.path, 'utf8'))
  if (policy.disabled) throw new Error(`agent role "${name}" is disabled`)
  const agentOptions = await resolveAgentModel(policy, host.llm)
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
export function mountAgentRoleTool(ctx: Context, listRoles: () => Promise<AgentRoleEntry[]>): () => void {
  const host = ctx as unknown as AgentRoleHost
  return host.tools.register(
    defineTool({
      name: AGENT_ROLE_TOOL_NAME,
      description:
        'List enabled market agent roles or delegate a self-contained task to one. A role applies its saved persona, model/provider and tool restrictions in a real subagent. List first to obtain the exact role name; run waits for completion.',
      parameters: {
        action: { type: 'string', enum: ['list', 'run'], required: true },
        role: { type: 'string', description: 'Exact role identity returned by list; required for run.' },
        prompt: { type: 'string', description: 'Complete task and context for the isolated child; required for run.' }
      },
      output: { schema: { type: 'json' }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (args.action === 'list')
          return (await listRoles()).filter(entry => !entry.disabled).map(entry => ({ name: entry.name, description: entry.description, path: entry.path }))
        if (args.role === undefined || args.prompt === undefined || args.prompt.trim() === '') throw new Error('market_agent run requires role and non-empty prompt')
        return executeAgentRole(host, listRoles, args.role, args.prompt, exec.agent, exec.signal)
      }
    })
  )
}
