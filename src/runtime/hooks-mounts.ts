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
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type * as HooksBridge from '@deepseek-ai/dsh-hooks-claude-code'
import { SerialPassQueue, type MountPluginHandle, type PluginMountContext } from './mount-lifecycle.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { Suite } from '../model/types.js'

export interface HooksMountDiagnostic {
  suiteId: string
  reason: string
}

export class HooksMountRegistry {
  private readonly live = new Map<string, MountPluginHandle>()
  private readonly fingerprints = new Map<string, string>()
  private readonly temporary = new Map<string, string>()
  private readonly passes = new SerialPassQueue()

  constructor(private readonly ctx: Context) {}

  /** Mount/unmount one bridge per suite to match the enabled suites exactly. */
  reconcile(enabledSuites: Suite[]): Promise<HooksMountDiagnostic[]> {
    return this.passes.run(() => this.reconcileNow(enabledSuites))
  }

  private async reconcileNow(enabledSuites: Suite[]): Promise<HooksMountDiagnostic[]> {
    const diagnostics: HooksMountDiagnostic[] = []
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.hooks !== false && (suite.resources === undefined || suite.hooks !== undefined))
    // Keys are the qualified suite id: bare ids are unique per source only.
    const wanted = new Set(active.map(suite => qualifiedSuiteId(suite.sourceId, suite.id)))
    for (const [suiteId, handle] of [...this.live]) {
      if (!wanted.has(suiteId)) {
        await this.unmount(suiteId, handle)
      }
    }
    for (const suite of active) {
      const key = qualifiedSuiteId(suite.sourceId, suite.id)
      const originalPath = suite.hooks === undefined ? await hookConfigPath(suite.root) : undefined
      const content =
        suite.hooks === undefined
          ? originalPath === undefined
            ? undefined
            : await readFile(originalPath, 'utf8').catch(() => undefined)
          : JSON.stringify({ hooks: suite.hooks.events })
      const fingerprint =
        content === undefined
          ? undefined
          : createHash('sha256')
              .update(JSON.stringify([content, suite.root, suite.hooks?.projectRoot]))
              .digest('hex')
      const previous = this.live.get(key)
      if (previous !== undefined && fingerprint === this.fingerprints.get(key)) continue
      if (previous !== undefined) await this.unmount(key, previous)
      if (content === undefined || fingerprint === undefined) continue
      const reason = await this.mount(key, suite, content, fingerprint, originalPath)
      if (reason !== undefined) diagnostics.push({ suiteId: key, reason })
    }
    return diagnostics
  }

  /** Dispose every live bridge; used at plugin teardown. */
  async disposeAll(): Promise<void> {
    await this.passes.run(async () => {
      for (const [suiteId, handle] of [...this.live]) await this.unmount(suiteId, handle)
    })
  }

  private async mount(key: string, suite: Suite, content: string, fingerprint: string, originalPath?: string): Promise<string | undefined> {
    let bridge: typeof HooksBridge | undefined
    try {
      bridge = await import('@deepseek-ai/dsh-hooks-claude-code')
    } catch {
      return 'the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile'
    }
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') return 'the host context does not support dynamic plugin mounting'
    let temporary: string | undefined
    let handle: MountPluginHandle | undefined
    try {
      let configPath = originalPath
      if (configPath === undefined) {
        temporary = await mkdtemp(join(tmpdir(), 'dsh-project-hooks-'))
        configPath = join(temporary, 'hooks.json')
        await writeFile(configPath, content, { mode: 0o600 })
      }
      handle = mountCtx.plugin(bridge, {
        configPath,
        pluginRoot: suite.root,
        ...(suite.hooks === undefined ? {} : { projectDir: suite.hooks.projectRoot })
      })
      await handle.await()
      this.live.set(key, handle)
      this.fingerprints.set(key, fingerprint)
      if (temporary !== undefined) this.temporary.set(key, temporary)
      return undefined
    } catch (error) {
      try {
        await handle?.dispose()
      } catch {
        /* Preserve the startup failure. */
      }
      if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
      return `mount failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async unmount(suiteId: string, handle: MountPluginHandle): Promise<void> {
    this.live.delete(suiteId)
    this.fingerprints.delete(suiteId)
    try {
      await handle.dispose()
    } catch (error) {
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] hooks unmount ${suiteId} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      const temporary = this.temporary.get(suiteId)
      this.temporary.delete(suiteId)
      if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
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
