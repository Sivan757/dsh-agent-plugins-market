/**
 * User command mounting: every enabled entry of the user commands panel
 * registers as a dsh slash command, so user-authored quick replies behave
 * exactly like suite commands — the body with `$ARGUMENTS` substituted rides
 * one follow-up message on the receiving agent. A nested entry registers
 * under its flattened call name (`git/commit` → `git-commit`) while the panel
 * keeps addressing it by path; when two entries flatten to one call name the
 * later one takes a numeric suffix (`git-commit-1`) and is reported, because a
 * second registration of one name is what makes the host's slash menu drop it.
 * Reconciled on every catalog change, keyed by the entry path.
 * @module runtime/user-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { commandCallName } from '../../model/command-names.js'
import type { HostTranslate } from '../host/host-locale.js'
import { USER_ENTRY_PATH } from '../../application/panels/user-store.js'
import type { UserPanelStore } from './user-panels.js'
import { pluginMarketSource } from '../host/plugin-message-source.js'
import { CommandNameRegistry, registerWithAllocatedName } from '../host/command-name-allocator.js'
import type { MenuRowRegistration } from '../host/menu-row-identities.js'

/** Render a thrown value for a diagnostic, without trusting its string coercion. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Host surface this registry touches (mirrors commands-mounts.ts). */
interface CommandsHost {
  commands?: {
    register(definition: {
      name: string
      description: string
      input?: { hint: string }
      handler(invocation: { agent: unknown; rawInput: string }): { kind: 'success'; text: string } | { kind: 'error'; text: string }
    }): () => void
  }
}

interface InboxAgent {
  followup(message: UserMessage): void
}

/** One reconciled user command's spec. */
interface UserCommandSpec {
  name: string
  description: string
  hint?: string
  body: string
}

/** Register/unregister user-panel commands to match the panel's enabled entries. */
export class UserCommandMountRegistry {
  private readonly fingerprints = new Map<string, string>()
  private readonly live = new Map<string, () => void>()
  /**
   * The call names this seat holds, and the entry each one was registered for.
   *
   * Occupancy is per layer, which is the unit the host checks: this registry
   * registers into the global layer, so its names must be unique among
   * themselves and against every other registration in that layer.
   */
  private readonly names = new CommandNameRegistry()
  private readonly registeredName = new Map<string, string>()
  /** The menu row each live registration produces, with the panel id it translates as. */
  private readonly registered = new Map<string, MenuRowRegistration>()
  /** Per-workspace entry filter; an absent provider registers everything wanted. */
  private entryFilter: (() => { allows(face: 'commands', entryId: string): boolean }) | undefined

  constructor(
    private readonly ctx: Context,
    private readonly store: UserPanelStore,
    private readonly t: HostTranslate
  ) {}

  /**
   * Install the per-workspace entry filter read at wanted-row time, keyed by
   * the panel path name the resource window lists (`commands:${entry.name}`).
   */
  setEntryFilter(filter: () => { allows(face: 'commands', entryId: string): boolean }): void {
    this.entryFilter = filter
  }

  /**
   * Sync the live registrations with the panel's enabled entries.
   *
   * A switched-off commands surface reconciles against no entries at all,
   * which unregisters whatever is live — skipping the pass would leave the
   * previous registrations mounted after the switch went off.
   * @param allow - whether the workspace's commands switch is on.
   */
  async reconcile(allow = true): Promise<string[]> {
    const diagnostics: string[] = []
    const entries = allow ? await this.store.list() : []
    const wanted = new Map<string, UserCommandSpec>()
    // Keyed by the entry path, not the call name: two entries that flatten to
    // one call name are two commands, and the second gets a suffixed call name
    // rather than replacing the first in the wanted map.
    for (const entry of entries) {
      if (entry.disabled) continue
      if (this.entryFilter?.().allows('commands', `commands:${entry.name}`) === false) continue
      if (!USER_ENTRY_PATH.test(entry.name)) continue
      wanted.set(entry.name, {
        name: commandCallName(entry.name),
        description:
          entry.description === '' ? `[${this.t('userCommandSourceLabel')}] ${commandCallName(entry.name)}` : `[${this.t('userCommandSourceLabel')}] ${entry.description}`,
        ...(typeof entry.metadata['argument-hint'] === 'string' && entry.metadata['argument-hint'] !== '' ? { hint: entry.metadata['argument-hint'] } : {}),
        body: entry.content
      })
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
      if (wanted.size > 0) diagnostics.push('ctx.commands is not available in this profile; user commands stay unregistered')
      return diagnostics
    }
    for (const [key, spec] of wanted) {
      const fingerprint = JSON.stringify(spec)
      if (this.live.has(key) && this.fingerprints.get(key) === fingerprint) continue
      this.live.get(key)?.()
      this.live.delete(key)
      this.fingerprints.delete(key)
      this.releaseName(key)
      const attempt = registerWithAllocatedName(this.names, spec.name, name =>
        commands.register({
          name,
          description: spec.description,
          ...(spec.hint === undefined ? {} : { input: { hint: spec.hint } }),
          handler: invocation => {
            const agent = invocation.agent as InboxAgent
            const text = spec.body.replaceAll('$ARGUMENTS', invocation.rawInput.trim())
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
        diagnostics.push(`command "${spec.name}": ${messageOf(attempt.error)}`)
        continue
      }
      this.live.set(key, attempt.disposer)
      this.fingerprints.set(key, fingerprint)
      this.registeredName.set(key, attempt.name)
      // The wanted map is keyed by the entry name the panel lists, which is also
      // the id the panel translated that entry under — one spelling, one cache
      // entry, so the menu shows the text the panel already paid for.
      this.registered.set(key, { name: attempt.name, id: key })
      // The panel addresses the entry by path, so a renamed registration is
      // reported where the entry is listed rather than left to be discovered
      // from the slash menu.
      if (attempt.name !== spec.name) {
        diagnostics.push(`command "${spec.name}": registered as "${attempt.name}" because the call name is already taken`)
      }
    }
    return diagnostics
  }

  /**
   * Every command this seat currently holds: the call name the menu row carries
   * and the panel identity that owns its translation.
   *
   * The registry is the only place that knows a name allocation suffixed, and a
   * user entry's panel identity is the entry name the panel lists.
   * @returns one row per live registration, in registration-key order.
   */
  registrations(): MenuRowRegistration[] {
    return [...this.registered.values()]
  }

  /** Dispose every registration (plugin teardown). */
  disposeAll(): void {
    for (const disposer of [...this.live.values()]) disposer()
    for (const key of [...this.registeredName.keys()]) this.releaseName(key)
    this.registered.clear()
    this.live.clear()
    this.fingerprints.clear()
  }

  /** Free the call name one unmounted entry held, so a later claim can reuse it. */
  private releaseName(key: string): void {
    const name = this.registeredName.get(key)
    if (name === undefined) return
    this.names.forget(name)
    this.registeredName.delete(key)
    this.registered.delete(key)
  }
}
