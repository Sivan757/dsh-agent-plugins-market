/**
 * Runtime MCP mounts: one live `dsh-mcp-client` child plugin per enabled
 * suite's mcp.json server, mounted through `ctx.plugin`.
 *
 * Mounts reconcile against the enabled-suite set: reconcile() unmounts rows
 * whose suite was disabled or removed and mounts rows that appeared. A
 * missing `@deepseek-ai/dsh-mcp-client` install, a duplicate derived
 * serverName, or a load failure is contained per server — a broken third-party
 * suite must not take the host down — and reported through the manager's
 * diagnostic list.
 */
import type { Context } from '@deepseek-ai/cordis'
import type * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { toMcpMounts } from './mcp-config.js'
import type { Suite } from '../model/types.js'

export interface McpMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
}

interface LiveMount {
  suiteId: string
  serverKey: string
  serverName: string
  disposer: () => void | Promise<void>
}

interface MountPluginHandle {
  await(): Promise<unknown>
  dispose(): void | Promise<void>
}

/** Structural `ctx.plugin` surface for mounting one plugin instance. */
interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountPluginHandle
}

export class McpMountRegistry {
  private readonly live = new Map<string, LiveMount>()
  private readonly names = new Map<string, string>()

  constructor(
    private readonly ctx: Context,
    private readonly pluginDataRoot: string
  ) {}

  /** Mount/unmount MCP servers to match the enabled suites exactly. */
  async reconcile(enabledSuites: Suite[]): Promise<McpMountDiagnostic[]> {
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.mcp !== false)
    const wanted = new Map<string, { suite: Suite; serverKey: string }>()
    const diagnostics: McpMountDiagnostic[] = []
    for (const suite of active) {
      const { mounts, failures } = toMcpMounts(suite, this.pluginDataRoot)
      for (const failure of failures) {
        diagnostics.push({ suiteId: suite.id, serverKey: failure.serverKey, reason: failure.reason })
      }
      for (const mount of mounts) {
        wanted.set(mountKey(mount.suiteId, mount.serverKey), { suite, serverKey: mount.serverKey })
      }
    }
    for (const [key, live] of [...this.live]) {
      if (!wanted.has(key)) {
        await this.unmount(key, live)
        diagnostics.push({ suiteId: live.suiteId, serverKey: live.serverKey, reason: 'unmounted' })
      }
    }
    for (const [key, entry] of wanted) {
      if (this.live.has(key)) continue
      const reason = await this.mount(entry.suite, entry.serverKey)
      if (reason !== undefined) diagnostics.push({ suiteId: entry.suite.id, serverKey: entry.serverKey, reason })
    }
    return diagnostics.filter(diagnostic => diagnostic.reason !== 'unmounted')
  }

  /** Dispose every live mount; used at plugin teardown. */
  async disposeAll(): Promise<void> {
    for (const [key, live] of [...this.live]) {
      await this.unmount(key, live)
    }
  }

  private async mount(suite: Suite, serverKey: string): Promise<string | undefined> {
    const { mounts } = toMcpMounts(suite, this.pluginDataRoot)
    const request = mounts.find(mount => mount.serverKey === serverKey)
    if (request === undefined) return 'server no longer present in mcp.json'
    const owner = this.names.get(request.config.serverName)
    if (owner !== undefined) return `derived serverName "${request.config.serverName}" already mounted by ${owner}`
    let mcpClient: typeof McpClient | undefined
    try {
      mcpClient = await import('@deepseek-ai/dsh-mcp-client')
    } catch {
      return 'the @deepseek-ai/dsh-mcp-client package is not installed in this profile'
    }
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') return 'the host context does not support dynamic plugin mounting'
    try {
      const handle = mountCtx.plugin(mcpClient, request.config)
      await handle.await()
      const key = mountKey(suite.id, serverKey)
      this.live.set(key, { suiteId: suite.id, serverKey, serverName: request.config.serverName, disposer: () => handle.dispose() })
      this.names.set(request.config.serverName, `${suite.id}/${serverKey}`)
      return undefined
    } catch (error) {
      return `mount failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async unmount(key: string, live: LiveMount): Promise<void> {
    this.live.delete(key)
    this.names.delete(live.serverName)
    try {
      await live.disposer()
    } catch (error) {
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] unmount ${live.suiteId}/${live.serverKey} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function mountKey(suiteId: string, serverKey: string): string {
  return `${suiteId}\u0000${serverKey}`
}
