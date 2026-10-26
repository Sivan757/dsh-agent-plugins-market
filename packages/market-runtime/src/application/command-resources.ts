/** Command document parsing shared by runtime registration and declaration validation. */
import { parse as parseYaml } from 'yaml'
import { stripFrontmatter } from '../../../market-catalog/src/index.js'
import { parseFrontmatterRecord } from './panels/user-store.js'
import type { SuiteMarkdownResource } from '../../../market-contracts/src/model/types.js'
import { defaultMarkdownResources, resourceText, resourceCommandName } from '../../../market-catalog/src/index.js'

export interface CommandSpec {
  name: string
  description: string
  body: string
  hint?: string
  /**
   * The argument names the `arguments:` frontmatter declares, in order. The
   * body binds them to the invocation text positionally (`$system`,
   * `$target_stack`), so the declaration is the only record of which word each
   * placeholder receives.
   */
  args?: string[]
  /**
   * The resource name as authored, before it was flattened into
   * {@link CommandSpec.name} (`git/commit` where the call name is
   * `git-commit`). The panel addresses the same document by this spelling, so
   * it is the id the two surfaces have to agree on.
   */
  resourceName: string
  /** Set when the command file belongs to a suite with a plugin root; absent for project-native files. */
  suiteRoot?: string
  /** The suite's `${PLUGIN_DATA}` directory; absent for project-native files. */
  suiteData?: string
}

export interface CommandReadOptions {
  /** Preserve valid disabled declarations without changing their document or the default runtime policy. */
  includeDisabled?: boolean
  /**
   * Receives every resource this parser refuses, so a caller can report it.
   * A skipped command is otherwise indistinguishable from a command the suite
   * never shipped.
   */
  onIssue?: (issue: CommandParseIssue) => void
}

/** One command resource the parser refused, with a reason fit for a diagnostic. */
export interface CommandParseIssue {
  /** The resource name as authored, before call-name flattening. */
  resourceName: string
  reason: string
}

/** Render a thrown value without trusting its string coercion. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

/** Parse one declared resource; resourceName retains its identity before call-name flattening. */
export function parseCommandResource(entry: SuiteMarkdownResource, text: string, options: CommandReadOptions = {}): CommandSpec | undefined {
  const name = resourceCommandName(entry.name)
  if (!COMMAND_NAME.test(name)) return undefined
  try {
    const metadata = parseFrontmatterRecord(text)
    if (metadata.disabled === true && !options.includeDisabled) return undefined
  } catch (error) {
    // Deliberately still skipped — an invalid declaration is never half-mounted —
    // but the caller has to be able to say which file and why.
    options.onIssue?.({ resourceName: entry.name, reason: `invalid frontmatter: ${messageOf(error)}` })
    return undefined
  }
  const report = (reason: string): void => options.onIssue?.({ resourceName: entry.name, reason })
  const meta = commandMeta(text, report)
  const description = meta?.description ?? firstLine(text)
  if (description === undefined) {
    report('no description in frontmatter or body')
    return undefined
  }
  return { name, description, hint: meta?.hint, args: meta?.args, body: stripFrontmatter(text), resourceName: entry.name }
}

/** Read declared commands, or discover the conventional directory when resources is omitted. */
export async function readCommands(root: string, resources?: SuiteMarkdownResource[], options: CommandReadOptions = {}): Promise<CommandSpec[]> {
  const entries = resources ?? (await defaultMarkdownResources(root, 'commands'))
  const specs: CommandSpec[] = []
  for (const entry of entries) {
    if (!COMMAND_NAME.test(resourceCommandName(entry.name))) continue
    let text: string
    try {
      text = await resourceText(entry)
    } catch {
      continue
    }
    const spec = parseCommandResource(entry, text, options)
    if (spec) specs.push(spec)
  }
  return specs
}

interface CommandMeta {
  description?: string
  hint?: string
  args?: string[]
}

/** A placeholder name a body can carry as `$name`. */
const ARGUMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function commandMeta(text: string, report: (reason: string) => void): CommandMeta | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1]
  if (frontmatter === undefined) return undefined
  try {
    const raw: unknown = parseYaml(frontmatter)
    if (typeof raw !== 'object' || raw === null) return undefined
    const record = raw as Record<string, unknown>
    const meta: CommandMeta = {}
    const description = record['description']
    if (typeof description === 'string' && description.trim() !== '') meta.description = description.trim()
    const hint = record['argument-hint'] ?? record['argumentHint']
    if (typeof hint === 'string' && hint.trim() !== '') meta.hint = hint.trim()
    const args = declaredArguments(record['arguments'], report)
    if (args !== undefined) meta.args = args
    return meta
  } catch {
    return undefined
  }
}

/**
 * Read the `arguments:` frontmatter, which Claude Code accepts either as one
 * space- or comma-separated string (`arguments: system target_stack`) or as a
 * list of names.
 *
 * An entry that names no usable placeholder is diagnosed and dropped while the
 * remaining names still bind, so one typo costs one placeholder rather than
 * the command.
 */
function declaredArguments(value: unknown, report: (reason: string) => void): string[] | undefined {
  if (value === undefined) return undefined
  const items: readonly unknown[] | undefined = typeof value === 'string' ? value.split(/[\s,]+/) : Array.isArray(value) ? value : undefined
  if (items === undefined) {
    report('"arguments" must be a string or a list of argument names')
    return undefined
  }
  const names: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') {
      report(`"arguments" entry ${JSON.stringify(item)} is not a string`)
      continue
    }
    const name = item.trim()
    if (name === '') continue
    if (!ARGUMENT_NAME.test(name)) {
      report(`"${name}" is not a usable argument name`)
      continue
    }
    if (names.includes(name)) {
      report(`"${name}" is declared more than once in "arguments"`)
      continue
    }
    names.push(name)
  }
  return names.length === 0 ? undefined : names
}

function firstLine(text: string): string | undefined {
  const line = text
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '')
  return line
}
