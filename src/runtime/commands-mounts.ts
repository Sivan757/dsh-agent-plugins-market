/**
 * Claude Code command compatibility: `commands/*.md` of enabled suites
 * register as dsh slash commands.
 *
 * A CC command is a prompt template the model executes (its body carries
 * `$ARGUMENTS`, path variables and `` !`cmd` `` dynamic-context placeholders),
 * so the handler maps it onto the harness's follow-up mechanism: the template
 * with those placeholders resolved becomes one durable user-role follow-up
 * message on the receiving agent. Registrations reconcile on every
 * enable/disable/install/uninstall; a broken command file, a failed injected
 * command, or an unavailable `ctx.commands` is contained per command and
 * reported as a diagnostic.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { parse as parseYaml } from 'yaml'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './user-store.js'
import { qualifiedSuiteId, suiteDataDir } from '../catalog/paths.js'
import { expandPluginPaths, pluginRootOf } from '../catalog/plugin-variables.js'
import type { Suite, SuiteMarkdownResource } from '../model/types.js'
import { defaultMarkdownResources, resourceText, resourceCommandName } from '../catalog/component-files.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'
import { injectDynamicContext, type ShellSeam } from './dynamic-context.js'

export interface CommandMountDiagnostic {
  suiteId: string
  command: string
  reason: string
}

interface CommandSpec {
  name: string
  description: string
  body: string
  hint?: string
  /** Set when the command file belongs to a suite with a plugin root; absent for project-native files. */
  suiteRoot?: string
  /** The suite's `${PLUGIN_DATA}` directory; absent for project-native files. */
  suiteData?: string
}

/** Handler outcome, as the host's command registry reports it. */
type CommandOutcome = { kind: 'success'; text: string } | { kind: 'error'; text: string }

interface CommandsHost {
  commands?: {
    register(definition: {
      name: string
      description: string
      input?: { hint: string }
      handler(invocation: { agent: unknown; rawInput: string }): CommandOutcome | Promise<CommandOutcome>
    }): () => void
  }
}

interface InboxAgent {
  followup(message: UserMessage): void
  session?: { header?: { cwd?: string } }
}

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

export class CommandMountRegistry {
  private readonly fingerprints = new Map<string, string>()
  private readonly live = new Map<string, () => void>()

  constructor(
    private readonly ctx: Context,
    private readonly t: HostTranslate = bindHostLocale(undefined),
    private readonly dataRoot?: string
  ) {}

  /** The live shell seam, when the profile has one; dynamic context stays literal without it. */
  private shell(): ShellSeam | undefined {
    return (this.ctx as unknown as { shell?: ShellSeam }).shell
  }

  /** Register/unregister suite commands to match the enabled suites exactly. */
  async reconcile(enabledSuites: Suite[]): Promise<CommandMountDiagnostic[]> {
    const diagnostics: CommandMountDiagnostic[] = []
    const wanted = new Map<string, CommandSpec & { suiteId: string; suiteName: string }>()
    for (const suite of enabledSuites) {
      const specs = suite.activeSurfaces.commands === false ? [] : await readCommands(suite.root, suite.resources?.commands)
      const suiteRoot = pluginRootOf(suite)
      const suiteData = suiteRoot === undefined || this.dataRoot === undefined ? undefined : suiteDataDir(this.dataRoot, suite.sourceId, suite.id)
      for (const spec of specs) {
        // The registry key is source-qualified: bare suite ids are unique per
        // source only, so two sources' same-named suites would collide.
        const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
        const key = `${suiteKey}/${spec.name}`
        if (wanted.has(key)) {
          diagnostics.push({ suiteId: suiteKey, command: spec.name, reason: 'duplicate normalized command name' })
          continue
        }
        wanted.set(key, {
          ...spec,
          suiteId: suiteKey,
          suiteName: suite.manifest.name,
          ...(suiteRoot === undefined ? {} : { suiteRoot }),
          ...(suiteData === undefined ? {} : { suiteData })
        })
      }
    }
    for (const [key, disposer] of [...this.live]) {
      if (!wanted.has(key)) {
        disposer()
        this.live.delete(key)
      }
    }
    const host = this.ctx as unknown as CommandsHost
    if (typeof host.commands?.register !== 'function') {
      if (wanted.size > 0) diagnostics.push({ suiteId: '', command: '', reason: 'ctx.commands is not available in this profile' })
      return diagnostics
    }
    for (const [key, spec] of wanted) {
      const fingerprint = JSON.stringify(spec)
      if (this.live.has(key) && this.fingerprints.get(key) === fingerprint) continue
      this.live.get(key)?.()
      this.live.delete(key)
      this.fingerprints.delete(key)
      try {
        const disposer = host.commands.register({
          name: spec.name,
          description: `[${spec.suiteName}] ${spec.description}`,
          ...(spec.hint === undefined ? {} : { input: { hint: spec.hint } }),
          handler: async invocation => {
            const agent = invocation.agent as InboxAgent
            const workdir = agent.session?.header?.cwd
            // The template rides the agent verbatim apart from the placeholders
            // its author wrote: a decorator line naming this plugin or the
            // suite would be text the command author never wrote, and the
            // follow-up's `source` already records provenance.
            const body = expandPluginPaths(spec.body, {
              ...(spec.suiteRoot === undefined ? {} : { root: spec.suiteRoot }),
              ...(spec.suiteData === undefined ? {} : { data: spec.suiteData }),
              ...(workdir === undefined ? {} : { projectDir: workdir })
            }).replaceAll('$ARGUMENTS', invocation.rawInput.trim())
            const shell = this.shell()
            if (shell === undefined) {
              agent.followup(
                createUserMessage({
                  content: [{ type: 'text', text: body }],
                  source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' }
                })
              )
              return { kind: 'success', text: this.t('commandAcknowledged', { command: spec.name }) }
            }
            let text: string
            try {
              text = await injectDynamicContext(body, { shell, ...(workdir === undefined ? {} : { workdir }) })
            } catch (error) {
              return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
            }
            agent.followup(
              createUserMessage({
                content: [{ type: 'text', text }],
                source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' }
              })
            )
            return { kind: 'success', text: this.t('commandAcknowledged', { command: spec.name }) }
          }
        })
        this.live.set(key, disposer)
        this.fingerprints.set(key, fingerprint)
      } catch (error) {
        diagnostics.push({ suiteId: spec.suiteId, command: spec.name, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return diagnostics
  }

  /** Dispose every registered command; used at plugin teardown. */
  disposeAll(): void {
    for (const disposer of [...this.live.values()]) disposer()
    this.live.clear()
    this.fingerprints.clear()
  }
}

/** Parse `commands/*.md` of one suite root (Claude Code format). */
export async function readCommands(root: string, resources?: SuiteMarkdownResource[]): Promise<CommandSpec[]> {
  const entries = resources ?? (await defaultMarkdownResources(root, 'commands'))
  const specs: CommandSpec[] = []
  for (const entry of entries) {
    const name = resourceCommandName(entry.name)
    if (!COMMAND_NAME.test(name)) continue
    let text: string
    try {
      text = await resourceText(entry)
    } catch {
      continue
    }
    try {
      if (parseFrontmatterRecord(text).disabled === true) continue
    } catch {
      continue
    }
    const meta = commandMeta(text)
    const description = meta?.description ?? firstLine(text)
    if (description === undefined) continue
    specs.push({ name, description, hint: meta?.hint, body: stripFrontmatter(text) })
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
