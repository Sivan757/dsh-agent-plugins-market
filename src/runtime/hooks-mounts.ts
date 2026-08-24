/**
 * Claude Code hook compatibility: each enabled suite's `hooks/hooks.json`
 * mounts one live `dsh-hooks-claude-code` bridge on the harness's canonical
 * interception points (SessionStart, UserPromptSubmit, PreToolUse,
 * PostToolUse, Stop, SubagentStart, SubagentStop).
 *
 * The bridge is a cordis function plugin (`inject: ['shell']`) whose config
 * is a single `configPath` plus `pluginRoot` for `${CLAUDE_PLUGIN_ROOT}`
 * substitution — exactly the shape a suite hook file needs. Mounts reconcile
 * on every enable/disable/install/uninstall; a missing bridge package, a
 * broken hook file, or a mount failure is contained per suite.
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type * as HooksBridge from '@deepseek-ai/dsh-hooks-claude-code'
import type { Suite } from '../model/types.js'

export interface HooksMountDiagnostic {
  suiteId: string
  reason: string
}

interface MountHandle {
  await(): Promise<unknown>
  dispose(): void | Promise<void>
}

interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountHandle
}

export class HooksMountRegistry {
  private readonly live = new Map<string, MountHandle>()

  constructor(private readonly ctx: Context) {}

  /** Mount/unmount one bridge per suite to match the enabled suites exactly. */
  async reconcile(enabledSuites: Suite[]): Promise<HooksMountDiagnostic[]> {
    const diagnostics: HooksMountDiagnostic[] = []
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.hooks !== false)
    const wanted = new Set(active.map(suite => suite.id))
    for (const [suiteId, handle] of [...this.live]) {
      if (!wanted.has(suiteId)) {
        await this.unmount(suiteId, handle)
      }
    }
    for (const suite of active) {
      if (this.live.has(suite.id)) continue
      const reason = await this.mount(suite)
      if (reason !== undefined) diagnostics.push({ suiteId: suite.id, reason })
    }
    return diagnostics
  }

  /** Dispose every live bridge; used at plugin teardown. */
  async disposeAll(): Promise<void> {
    for (const [suiteId, handle] of [...this.live]) {
      await this.unmount(suiteId, handle)
    }
  }

  private async mount(suite: Suite): Promise<string | undefined> {
    const configPath = await hookConfigPath(suite.root)
    if (configPath === undefined) return undefined
    let bridge: typeof HooksBridge | undefined
    try {
      bridge = await import('@deepseek-ai/dsh-hooks-claude-code')
    } catch {
      return 'the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile'
    }
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') return 'the host context does not support dynamic plugin mounting'
    try {
      const handle = mountCtx.plugin(bridge, {
        configPath,
        pluginRoot: suite.root
      })
      await handle.await()
      this.live.set(suite.id, handle)
      return undefined
    } catch (error) {
      return `mount failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async unmount(suiteId: string, handle: MountHandle): Promise<void> {
    this.live.delete(suiteId)
    try {
      await handle.dispose()
    } catch (error) {
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] hooks unmount ${suiteId} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** The first existing CC hook config of a suite root. */
export async function hookConfigPath(root: string): Promise<string | undefined> {
  for (const relative of [join('hooks', 'hooks.json'), 'hooks.json']) {
    const path = join(root, relative)
    try {
      if ((await stat(path)).isFile()) return path
    } catch {
      // try the next candidate
    }
  }
  return undefined
}
