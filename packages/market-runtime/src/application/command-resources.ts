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
}
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

/** Parse one declared resource; resourceName retains its identity before call-name flattening. */
export function parseCommandResource(entry: SuiteMarkdownResource, text: string, options: CommandReadOptions = {}): CommandSpec | undefined {
  const name = resourceCommandName(entry.name)
  if (!COMMAND_NAME.test(name)) return undefined
  try {
    const metadata = parseFrontmatterRecord(text)
    if (metadata.disabled === true && !options.includeDisabled) return undefined
  } catch {
    return undefined
  }
  const meta = commandMeta(text)
  const description = meta?.description ?? firstLine(text)
  if (description === undefined) return undefined
  return { name, description, hint: meta?.hint, body: stripFrontmatter(text), resourceName: entry.name }
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
}

function commandMeta(text: string): CommandMeta | undefined {
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
    return meta
  } catch {
    return undefined
  }
}

function firstLine(text: string): string | undefined {
  const line = text
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '')
  return line
}
