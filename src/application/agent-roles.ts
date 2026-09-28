/**
 * Agent-role card parsing: the frontmatter grammar and the policy it yields.
 * Pure text processing shared by the project-role projection and the runtime
 * delegation router; the executing half stays in runtime.
 * @module application/agent-roles
 */
import { parse as parseYaml } from 'yaml'

/**
 * Panel identity is preserved so identically named cards from different suites remain addressable.
 */
export interface AgentRoleEntry {
  name: string
  path: string
  description: string
  disabled: boolean
  title?: string
  rawText?: string
  /** Suite checkout root the card's `${PLUGIN_ROOT}` variables resolve to; absent for project-native files. */
  suiteRoot?: string
  /** The suite's `${PLUGIN_DATA}` directory; absent for project-native files. */
  suiteData?: string
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
  // A matched block always carries its body; the check keeps the type honest.
  const frontmatter = match[1]
  if (frontmatter === undefined) throw new Error('agent frontmatter is not closed')
  const parsed: unknown = parseYaml(frontmatter)
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
