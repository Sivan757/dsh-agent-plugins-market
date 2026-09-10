/**
 * User command mounting: every enabled entry of the user commands panel
 * registers as a dsh slash command, so user-authored quick replies behave
 * exactly like suite commands — the body with `$ARGUMENTS` substituted rides
 * one follow-up message on the receiving agent. Reconciled on every catalog
 * change, keyed `user/<name>`.
 * @module runtime/user-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { HostTranslate } from './host-locale.js'
import { USER_ENTRY_NAME } from './user-store.js'
import type { UserPanelStore } from './user-panels.js'

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
  followup(message: { content: Array<{ type: string; text: string }>; source: unknown }): void
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
    for (const entry of entries) {
      if (entry.disabled) continue
      if (!USER_ENTRY_NAME.test(entry.name)) continue
      wanted.set(entry.name, {
        name: entry.name,
        description: entry.description === '' ? `[${this.t('userCommandSourceLabel')}] ${entry.name}` : `[${this.t('userCommandSourceLabel')}] ${entry.description}`,
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
            const text = [this.t('userCommandForwardTitle', { command: spec.name }), '', spec.body.replaceAll('$ARGUMENTS', invocation.rawInput.trim())].join('\n')
            agent.followup({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' } })
            return { kind: 'success', text: this.t('userCommandAcknowledged', { command: spec.name }) }
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
