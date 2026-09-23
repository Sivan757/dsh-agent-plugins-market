/**
 * User command mounting: every enabled entry of the user commands panel
 * registers as a dsh slash command, so user-authored quick replies behave
 * exactly like suite commands — the body with `$ARGUMENTS` substituted rides
 * one follow-up message on the receiving agent. A nested entry registers
 * under its flattened call name (`git/commit` → `git-commit`) while the panel
 * keeps addressing it by path; when two entries flatten to one call name the
 * first registers and the other is reported. Reconciled on every catalog
 * change, keyed by the call name.
 * @module runtime/user-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { commandCallName } from '../model/command-names.js'
import type { HostTranslate } from './host-locale.js'
import { USER_ENTRY_PATH } from './user-store.js'
import type { UserPanelStore } from './user-panels.js'
import { pluginMarketSource } from './plugin-message-source.js'

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

  constructor(
    private readonly ctx: Context,
    private readonly store: UserPanelStore,
    private readonly t: HostTranslate
  ) {}

  /** Sync the live registrations with the panel's enabled entries. */
  async reconcile(): Promise<string[]> {
    const diagnostics: string[] = []
    const entries = await this.store.list()
    const wanted = new Map<string, UserCommandSpec>()
    // Registration is keyed by call name, so two entries that flatten to the
    // same one cannot silently shadow each other.
    const owners = new Map<string, string>()
    for (const entry of entries) {
      if (entry.disabled) continue
      if (!USER_ENTRY_PATH.test(entry.name)) continue
      const callName = commandCallName(entry.name)
      const owner = owners.get(callName)
      if (owner !== undefined) {
        diagnostics.push(`command "${callName}": "${entry.name}" is shadowed by "${owner}" — both flatten to the same call name`)
        continue
      }
      owners.set(callName, entry.name)
      wanted.set(callName, {
        name: callName,
        description: entry.description === '' ? `[${this.t('userCommandSourceLabel')}] ${callName}` : `[${this.t('userCommandSourceLabel')}] ${entry.description}`,
        ...(typeof entry.metadata['argument-hint'] === 'string' && entry.metadata['argument-hint'] !== '' ? { hint: entry.metadata['argument-hint'] } : {}),
        body: entry.content
      })
    }
    for (const [key, disposer] of [...this.live]) {
      if (!wanted.has(key)) {
        disposer()
        this.live.delete(key)
      }
    }
    const host = this.ctx as unknown as CommandsHost
    if (typeof host.commands?.register !== 'function') {
      if (wanted.size > 0) diagnostics.push('ctx.commands is not available in this profile; user commands stay unregistered')
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
            return { kind: 'success', text: this.t('commandAcknowledged', { command: spec.name }) }
          }
        })
        this.live.set(key, disposer)
        this.fingerprints.set(key, fingerprint)
      } catch (error) {
        diagnostics.push(`command "${spec.name}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return diagnostics
  }

  /** Dispose every registration (plugin teardown). */
  disposeAll(): void {
    for (const disposer of [...this.live.values()]) disposer()
    this.live.clear()
    this.fingerprints.clear()
  }
}
