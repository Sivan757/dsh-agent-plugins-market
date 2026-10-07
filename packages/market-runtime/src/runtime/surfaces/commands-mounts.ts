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
import { qualifiedSuiteId, suiteDataDir } from '../../../../market-catalog/src/index.js'
import { expandPluginPaths, pluginRootOf } from '../../../../market-catalog/src/index.js'
import type { Suite, SuiteMarkdownResource } from '../../../../market-contracts/src/model/types.js'
import { defaultMarkdownResources, resourceText } from '../../../../market-catalog/src/index.js'
import { parseCommandResource, readCommands, type CommandSpec } from '../../application/command-resources.js'
export { readCommands } from '../../application/command-resources.js'
import { bindHostLocale, type HostTranslate } from '../host/host-locale.js'
import { injectDynamicContext, shellSeamOf, type ShellSeam } from './dynamic-context.js'
import { pluginMarketSource } from '../../../../market-contracts/src/host/plugin-message-source.js'
import { CommandNameRegistry, registerWithAllocatedName } from '../host/command-name-allocator.js'
import { pluginResourceId } from '../../application/panel-resources.js'
import type { MenuRowRegistration } from '../host/menu-row-identities.js'

/** Render a thrown value for a diagnostic, without trusting its string coercion. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface CommandMountDiagnostic {
  suiteId: string
  command: string
  reason: string
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

export class CommandMountRegistry {
  private readonly fingerprints = new Map<string, string>()
  private readonly live = new Map<string, () => void>()
  /**
   * The call names this seat holds, and the keys they were registered under.
   *
   * Occupancy is per layer, which is the unit the host checks: this registry
   * instance registers into one layer (an agent's scope on the project path,
   * the global layer on the user path), and a sibling registry in another
   * layer neither sees nor is seen by these names.
   */
  private readonly names = new CommandNameRegistry()
  private readonly registeredName = new Map<string, string>()
  /** The menu row each live registration produces, with the panel id it translates as. */
  private readonly registered = new Map<string, MenuRowRegistration>()
  /** Per-workspace entry filter; an absent provider registers everything wanted. */
  private entryFilter: (() => { allows(face: 'commands', entryId: string): boolean }) | undefined
  private selectionPolicy: ((suite: Suite, commandName: string) => boolean) | undefined
  private registrationPolicy: ((suite: Suite, commandName: string) => boolean) | undefined
  private allowDisabled = false

  constructor(
    private readonly ctx: Context,
    private readonly t: HostTranslate = bindHostLocale(undefined),
    private readonly dataRoot?: string
  ) {}

  /**
   * Install the per-workspace entry filter read at wanted-row time. A filtered
   * command never becomes wanted, which unregisters it through the ordinary
   * reconcile pass — the same path a removed command file takes.
   */
  setEntryFilter(filter: () => { allows(face: 'commands', entryId: string): boolean }): void {
    this.entryFilter = filter
  }

  /**
   * Gate reconcile and execution by owning suite and authored resource name,
   * before call-name flattening or collision allocation. Unset allows all.
   */
  setSelectionPolicy(
    callback: (suite: Suite, commandName: string) => boolean,
    registration: (suite: Suite, commandName: string) => boolean = callback,
    options: { allowDisabled?: boolean } = {}
  ): void {
    this.selectionPolicy = callback
    this.registrationPolicy = registration
    this.allowDisabled = options.allowDisabled === true
  }

  /** The live shell seam, when the profile has one; dynamic context stays literal without it. */
  private shell(): ShellSeam | undefined {
    return shellSeamOf(this.ctx)
  }

  /** Register/unregister suite commands to match the enabled suites exactly. */
  async reconcile(enabledSuites: Suite[]): Promise<CommandMountDiagnostic[]> {
    const diagnostics: CommandMountDiagnostic[] = []
    const wanted = new Map<string, CommandSpec & { resource: SuiteMarkdownResource; suite: Suite; suiteId: string; suiteName: string; sourceId: string; rawSuiteId: string }>()
    /** How many specs already claimed one suite-qualified call name this pass. */
    const occurrences = new Map<string, number>()
    for (const suite of enabledSuites) {
      const specs: Array<CommandSpec & { resource: SuiteMarkdownResource }> = []
      const resources = suite.activeSurfaces.commands === false ? [] : (suite.resources?.commands ?? (await defaultMarkdownResources(suite.root, 'commands')))
      for (const resource of resources) {
        const includeDisabled = this.allowDisabled && this.registrationPolicy?.(suite, resource.name) === true
        for (const spec of await readCommands(suite.root, [resource], { includeDisabled })) specs.push({ ...spec, resource })
      }
      const suiteRoot = pluginRootOf(suite)
      const suiteData = suiteRoot === undefined || this.dataRoot === undefined ? undefined : suiteDataDir(this.dataRoot, suite.sourceId, suite.id)
      for (const spec of specs) {
        // The registry key is source-qualified: bare suite ids are unique per
        // source only, so two sources' same-named suites would collide.
        const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
        // Two files of one suite flatten to one call name (`git/commit` and
        // `git-commit`) and are both real commands, so the key counts them
        // apart and allocation gives the second one a suffix instead of
        // dropping it. The count is per pass, so re-reading the same suite
        // reproduces the same keys.
        const qualified = `${suiteKey}/${spec.name}`
        const occurrence = occurrences.get(qualified) ?? 0
        occurrences.set(qualified, occurrence + 1)
        const key = occurrence === 0 ? qualified : `${qualified}#${occurrence}`
        // The per-workspace resource filter answers by the call name the model
        // types, so the window and the registry agree on what one row names.
        if (this.entryFilter?.().allows('commands', `commands:${spec.name}`) === false) continue
        if (this.registrationPolicy?.(suite, spec.resourceName) === false) continue
        wanted.set(key, {
          ...spec,
          suite,
          suiteId: suiteKey,
          suiteName: suite.manifest.name,
          // Kept apart from the qualified `suiteId` above: the panel id is built
          // from the two raw halves, exactly as the panel builds it.
          sourceId: suite.sourceId,
          rawSuiteId: suite.id,
          ...(suiteRoot === undefined ? {} : { suiteRoot }),
          ...(suiteData === undefined ? {} : { suiteData })
        })
      }
    }
    for (const [key, disposer] of [...this.live]) {
      if (!wanted.has(key)) {
        disposer()
        this.live.delete(key)
        this.fingerprints.delete(key)
        this.releaseName(key)
      }
    }
    const host = this.ctx as unknown as CommandsHost
    const commands = host.commands
    if (typeof commands?.register !== 'function') {
      if (wanted.size > 0) diagnostics.push({ suiteId: '', command: '', reason: 'ctx.commands is not available in this profile' })
      return diagnostics
    }
    for (const [key, { suite, ...spec }] of wanted) {
      const fingerprint = JSON.stringify(spec)
      if (this.live.has(key) && this.fingerprints.get(key) === fingerprint) continue
      this.live.get(key)?.()
      this.live.delete(key)
      this.fingerprints.delete(key)
      this.releaseName(key)
      // A name the layer already holds — a sibling suite flattening to the
      // same call name, a host built-in such as /compact, or a leftover
      // registration — is the one case the host refuses outright, and a
      // refused definition is what the slash menu drops. Allocating the name
      // first turns that collision into a suffix instead of a disappearance.
      const attempt = registerWithAllocatedName(this.names, spec.name, name =>
        commands.register({
          name,
          description: `[${spec.suiteName}] ${spec.description}`,
          ...(spec.hint === undefined ? {} : { input: { hint: spec.hint } }),
          handler: async invocation => {
            const agent = invocation.agent as InboxAgent
            const workdir = agent.session?.header?.cwd
            // The template rides the agent verbatim apart from the placeholders
            // its author wrote: a decorator line naming this plugin or the
            // suite would be text the command author never wrote, and the
            // follow-up's `source` already records provenance.
            let authoredBody = spec.body
            if (this.selectionPolicy) {
              if (this.selectionPolicy(suite, spec.resourceName) !== true) return { kind: 'error', text: this.t('commandNotSelected', { command: name }) }
              try {
                const resource = !this.allowDisabled || spec.resource.file === suite.manifest.path ? spec.resource : { name: spec.resource.name, file: spec.resource.file }
                const fresh = parseCommandResource(resource, await resourceText(resource), { includeDisabled: this.allowDisabled })
                if (!fresh || this.selectionPolicy(suite, spec.resourceName) !== true) return { kind: 'error', text: this.t('commandNotSelected', { command: name }) }
                authoredBody = fresh.body
              } catch {
                return { kind: 'error', text: this.t('commandNotSelected', { command: name }) }
              }
            }
            const body = expandPluginPaths(authoredBody, {
              ...(spec.suiteRoot === undefined ? {} : { root: spec.suiteRoot }),
              ...(spec.suiteData === undefined ? {} : { data: spec.suiteData }),
              ...(workdir === undefined ? {} : { projectDir: workdir })
            }).replaceAll('$ARGUMENTS', invocation.rawInput.trim())
            if (this.selectionPolicy?.(suite, spec.resourceName) === false) {
              return { kind: 'error', text: this.t('commandNotSelected', { command: name }) }
            }
            const shell = this.shell()
            if (shell === undefined) {
              agent.followup(
                createUserMessage({
                  content: [{ type: 'text', text: body }],
                  source: pluginMarketSource()
                })
              )
              return { kind: 'success', text: this.t('commandAcknowledged', { command: name }) }
            }
            let text: string
            try {
              text = await injectDynamicContext(body, { shell, ...(workdir === undefined ? {} : { workdir }) })
            } catch (error) {
              return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
            }
            if (this.selectionPolicy?.(suite, spec.resourceName) === false) {
              return { kind: 'error', text: this.t('commandNotSelected', { command: name }) }
            }
            agent.followup(
              createUserMessage({
                content: [{ type: 'text', text }],
                source: pluginMarketSource()
              })
            )
            return { kind: 'success', text: this.t('commandAcknowledged', { command: name }) }
          }
        })
      )
      if (attempt.kind === 'failed') {
        diagnostics.push({ suiteId: spec.suiteId, command: spec.name, reason: messageOf(attempt.error) })
        continue
      }
      this.live.set(key, attempt.disposer)
      this.fingerprints.set(key, fingerprint)
      this.registeredName.set(key, attempt.name)
      // The panel addresses this document by the resource name it read plus the
      // suite it belongs to, so the id is built exactly as the panel builds it —
      // same inputs, same string, one shared cache entry.
      this.registered.set(key, { name: attempt.name, id: pluginResourceId(spec.sourceId, spec.rawSuiteId, 'commands', spec.resourceName ?? spec.name) })
      // A renamed command still works, so this is not a failure: it is the
      // one record that the name a user types is not the name the file
      // carries, which nothing else in the status surfaces would show.
      if (attempt.name !== spec.name) {
        diagnostics.push({
          suiteId: spec.suiteId,
          command: attempt.name,
          reason: `registered as "${attempt.name}" because "${spec.name}" is already taken in this command layer`
        })
      }
    }
    return diagnostics
  }

  /**
   * Every command this layer currently holds: the call name the menu row
   * carries and the panel identity that owns its translation.
   *
   * Two files of one suite can flatten to the same call name, so the
   * registration key (not the name) is what tells those rows apart; each one
   * keeps its own resource name and therefore its own translation id.
   * @returns one row per live registration, in registration-key order.
   */
  registrations(): MenuRowRegistration[] {
    return [...this.registered.values()]
  }

  /** Dispose every registered command; used at plugin teardown. */
  disposeAll(): void {
    for (const disposer of [...this.live.values()]) disposer()
    for (const key of [...this.registeredName.keys()]) this.releaseName(key)
    this.registered.clear()
    this.live.clear()
    this.fingerprints.clear()
  }

  /** Free the call name one unmounted key held, so a later claim can reuse it. */
  private releaseName(key: string): void {
    const name = this.registeredName.get(key)
    if (name === undefined) return
    this.names.forget(name)
    this.registeredName.delete(key)
    this.registered.delete(key)
  }
}
