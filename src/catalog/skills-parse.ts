/**
 * SKILL.md frontmatter parsing shared by suite discovery (summaries) and the
 * skill provider (full definitions).
 *
 * Parses the open YAML object dsh-skill documents: required `name` and
 * `description`, optional `whenToUse`, and the two invocation controls
 * (`disable-model-invocation`, `user-invocable`) with the same boolean forms
 * and fail-closed behavior as the shipped filesystem provider.
 */
import { parse as parseYaml } from 'yaml'
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'

export interface ParsedSkillFrontmatter {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
}

/** Kebab-case skill names only, matching the shipped provider's rule. */
function isSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

/**
 * Normalize a display-style skill name into kebab-case (e.g. "Presentations"
 * → "presentations"), or `undefined` when nothing usable remains.
 */
function normalizeSkillName(name: string): string | undefined {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized === '' ? undefined : normalized
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
      case '1':
        return true
      case 'false':
      case 'no':
      case 'off':
      case '0':
        return false
      default:
        return undefined
    }
  }
  return undefined
}

/**
 * Parse skill frontmatter with the shipped provider's fail-closed semantics.
 * @returns the parsed frontmatter, or a rejection string explaining why the
 *   skill must be dropped from discovery.
 */
export function parseSkillFrontmatter(text: string, expectedName: string | undefined): ParsedSkillFrontmatter | string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1]
  if (frontmatter === undefined) return 'missing YAML frontmatter'
  let raw: unknown
  try {
    raw = parseYaml(frontmatter)
  } catch {
    // Claude Code-authored frontmatter sometimes carries unquoted `: `
    // sequences in prose fields, which strict YAML rejects. A lenient
    // line-based fallback recovers the standard fields first-occurrence
    // wins; values that still fail the field checks below drop the skill.
    raw = lenientFrontmatter(frontmatter)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'frontmatter is not an object'
  const record = raw as Record<string, unknown>
  const rawName = record['name']
  const description = record['description']
  if (typeof rawName !== 'string') return 'frontmatter name is missing or not kebab-case'
  // Codex plugins ship display names in `name` (e.g. "Presentations"); the
  // skill identity is its kebab form, so normalize instead of dropping.
  const name = isSkillName(rawName) ? rawName : normalizeSkillName(rawName)
  if (name === undefined) return 'frontmatter name is missing or not kebab-case'
  if (expectedName !== undefined && name !== expectedName) return `frontmatter name "${rawName}" does not match skill directory "${expectedName}"`
  if (typeof description !== 'string' || description.trim() === '') return 'frontmatter description is missing or empty'

  const disableModel = parseBoolean(record['disable-model-invocation'])
  if (disableModel === undefined && record['disable-model-invocation'] !== undefined) {
    return 'invalid disable-model-invocation value'
  }
  const userInvocable = parseBoolean(record['user-invocable'])
  if (userInvocable === undefined && record['user-invocable'] !== undefined) {
    return 'invalid user-invocable value'
  }

  const whenToUse = typeof record['whenToUse'] === 'string' ? record['whenToUse'] : undefined
  return {
    name,
    description: description.trim(),
    ...(whenToUse === undefined ? {} : { whenToUse }),
    invocation: {
      modelInvocable: disableModel !== true,
      userInvocable: userInvocable !== false
    }
  }
}

/** Lenient frontmatter recovery for prose fields with embedded `: `. */
function lenientFrontmatter(body: string): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    const [, key, value] = match
    if (key === undefined || value === undefined) continue
    if (record[key] === undefined) record[key] = value.trim()
  }
  return record
}

/** Strip the frontmatter block, returning the instruction body. */
export function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)
  return match === null ? text : text.slice(match[0].length)
}
