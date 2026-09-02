/**
 * Runtime MCP mounts: one live self-built bridge child plugin per enabled
 * suite's mcp.json server, mounted through `ctx.plugin`.
 *
 * Mounts reconcile against the enabled-suite set: reconcile() unmounts rows
 * whose suite was disabled or removed and mounts rows that appeared. A
 * duplicate derived serverName or a load failure is contained per server — a
 * broken third-party suite must not take the host down — and reported through
 * the manager's diagnostic list.
 */
import type { Context } from '@deepseek-ai/cordis'
import * as mcpBridge from './mcp-client/bridge.js'
import type { McpBackend } from './mcp-backend.js'
import { applyOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import { credentialRefsInServer, toMcpMounts, type McpMountFailureCode, type McpMountRequest } from './mcp-config.js'
import { mcpCredentialResolver } from './mcp-credentials.js'
import type { McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'

export interface McpMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: McpMountFailureCode
  credentialRefs?: string[]
}

interface LiveMount {
  suiteId: string
  serverKey: string
  serverName: string
  disposer: () => void | Promise<void>
}

/**
 * Bounded retry schedule for a failed mount/unmount. A crash-looping or
 * permanently broken server must eventually stop consuming attempt budget, so
 * the schedule is capped and resets with every reconcile pass.
 */
const RETRY_SCHEDULE_MS = [1_500, 5_000, 15_000, 45_000, 120_000]
const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length

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
  private readonly credentialRefs = new Set<string>()
  private overridesProvider: () => Promise<Map<string, McpSuiteOverrides>> = async () => new Map()
  /** Live model-facing tool names, for foreign-namespace detection before a mount. */
  private toolNamesProvider: () => string[] = () => []
  /** The active MCP mount backend ('builtin' bridge or host client compat mode). */
  private backendProvider: () => Promise<McpBackend> = async () => 'builtin'
  /** Serialize mount and unmount passes so a disable cannot race an in-flight spawn. */
  private reconcileQueue: Promise<void> = Promise.resolve()
  /** Pending retry timers keyed by mount key, so a teardown can cancel them. */
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  /** Attempt count per mount key; reset whenever a retry succeeds. */
  private readonly attempts = new Map<string, number>()
  /** Snapshot of the last reconciled suite set, replayed by retry passes. */
  private lastEnabled: Suite[] = []

  constructor(
    private readonly ctx: Context,
    private readonly pluginDataRoot: string
  ) {}

  /** Install the per-suite overrides provider (suiteId -> overrides). */
  setOverridesProvider(provider: () => Promise<Map<string, McpSuiteOverrides>>): void {
    this.overridesProvider = provider
  }

  /**
   * Install the live model-facing tool-name provider (the host registry
   * snapshot) used to detect foreign `mcp__<serverName>__` namespaces before
   * a mount is attempted.
   */
  setToolNamesProvider(provider: () => string[]): void {
    this.toolNamesProvider = provider
  }

  /** Install the backend provider deciding which client mounts each server. */
  setBackendProvider(provider: () => Promise<McpBackend>): void {
    this.backendProvider = provider
  }

  /** Whether the last catalog snapshot uses one credential reference. */
  usesCredential(ref: string): boolean {
    return this.credentialRefs.has(ref)
  }

  /** Queue one reconciliation behind any in-flight mount/unmount pass. */
  async reconcile(enabledSuites: Suite[]): Promise<McpMountDiagnostic[]> {
    const run = this.reconcileQueue.then(() => this.reconcileNow(enabledSuites))
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** Mount/unmount MCP servers to match the enabled suites exactly. */
  private async reconcileNow(enabledSuites: Suite[]): Promise<McpMountDiagnostic[]> {
    this.lastEnabled = [...enabledSuites]
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.mcp !== false)
    const overrides = await this.overridesProvider()
    const resolver = mcpCredentialResolver(this.ctx)
    const wanted = new Map<string, { suite: Suite; serverKey: string; request: McpMountRequest }>()
    const diagnostics: McpMountDiagnostic[] = []
    this.credentialRefs.clear()
    for (const suite of active) {
      const suiteOverrides = overrides.get(suite.id)
      for (const [serverKey, source] of Object.entries(suite.mcp?.servers ?? {})) {
        const override = suiteOverrides?.[serverKey]
        if (override?.enabled === false) continue
        const effective = applyOverride(source as McpServerStdio | McpServerStreamableHttp, override)
        for (const ref of credentialRefsInServer(effective)) this.credentialRefs.add(ref)
      }
      const { mounts, failures } = await toMcpMounts(suite, this.pluginDataRoot, suiteOverrides, resolver)
      for (const failure of failures) {
        diagnostics.push({
          suiteId: suite.id,
          serverKey: failure.serverKey,
          reason: failure.reason,
          ...(failure.code === undefined ? {} : { code: failure.code }),
          ...(failure.credentialRefs === undefined ? {} : { credentialRefs: failure.credentialRefs })
        })
      }
      for (const mount of mounts) {
        wanted.set(mountKey(mount.suiteId, mount.serverKey), { suite, serverKey: mount.serverKey, request: mount })
      }
    }
    for (const [key, live] of [...this.live]) {
      if (!wanted.has(key)) {
        const reason = await this.unmount(key, live)
        diagnostics.push({
          suiteId: live.suiteId,
          serverKey: live.serverKey,
          reason: reason ?? 'unmounted',
          ...(reason === undefined ? {} : { code: 'unmount-failed' as const })
        })
      }
    }
    for (const [key, entry] of wanted) {
      if (this.live.has(key)) continue
      // A retry attempt runs the same mount path; only the last failure is
      // reported so a transient error does not shadow the final state.
      const reason = await this.mountWith(entry.request)
      if (reason !== undefined) diagnostics.push({ suiteId: entry.suite.id, serverKey: entry.serverKey, reason, code: 'mount-failed' })
      this.scheduleRetry(key, entry.suite.id, entry.serverKey, reason)
    }
    return diagnostics.filter(diagnostic => diagnostic.reason !== 'unmounted')
  }

  /**
   * Schedule a delayed re-attempt for a mount that still is not live.
   *
   * Mounts are retried because a remote endpoint or a credential may become
   * available slightly after the suite is enabled. The schedule is bounded, and
   * a server that keeps failing simply stops retrying until the next reconcile.
   */
  private scheduleRetry(key: string, suiteId: string, serverKey: string, reason: string | undefined): void {
    const pending = this.retries.get(key)
    if (pending !== undefined) clearTimeout(pending)
    this.retries.delete(key)
    if (reason === undefined) {
      this.attempts.delete(key)
      return
    }
    const attempt = (this.attempts.get(key) ?? 0) + 1
    this.attempts.set(key, attempt)
    if (attempt > MAX_RETRY_ATTEMPTS) {
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] ${suiteId}/${serverKey}: giving up after ${MAX_RETRY_ATTEMPTS} attempts — ${reason}`)
      return
    }
    const delay = RETRY_SCHEDULE_MS[attempt - 1] ?? RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]!
    const timer = setTimeout(() => {
      this.retries.delete(key)
      // Re-run against the last known suite set: a retry must not resurrect a
      // server that has since been disabled or uninstalled.
      void this.reconcile(this.lastEnabled).catch(() => {})
    }, delay)
    timer.unref?.()
    this.retries.set(key, timer)
  }

  /** Dispose every live mount after queued reconciliation passes settle. */
  async disposeAll(): Promise<void> {
    const run = this.reconcileQueue.then(async () => {
      for (const [key, live] of [...this.live]) {
        await this.unmount(key, live)
      }
    })
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    await run
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
    this.attempts.clear()
    this.credentialRefs.clear()
  }

  /** Mount one precomputed request (source config merged with overrides). */
  private async mountWith(request: McpMountRequest): Promise<string | undefined> {
    const owner = this.names.get(request.config.serverName)
    if (owner !== undefined) return `derived serverName "${request.config.serverName}" already mounted by ${owner}`
    // Foreign-namespace guard: a native host MCP client (or another plugin's
    // mount) may already own this `mcp__<serverName>__` namespace. Registering
    // into it would fail loudly mid-mount; skipping here reports the conflict
    // as a clear per-server diagnostic instead, and a later reconcile mounts
    // this server if the foreign owner goes away. The matching names ride the
    // diagnostic — a leftover of this plugin's own earlier mount (registry
    // record lost without a teardown) reads as an orphan here, and a Host
    // restart clears it; a genuinely foreign owner keeps the skip sticky.
    const prefix = `mcp__${request.config.serverName}__`
    const foreign = this.toolNamesProvider().filter(name => name.startsWith(prefix))
    if (foreign.length > 0) {
      return `serverName "${request.config.serverName}" is already mounted by another MCP client (native config or another plugin; matching tools: ${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? `, +${foreign.length - 3} more` : ''}) — skipped to avoid a duplicate mount; restart the Host if these tools are a leftover`
    }
    // Backend dispatch: the built-in bridge connects stdio, Streamable HTTP
    // (with OAuth), and legacy SSE servers in-process; the host backend
    // mounts the host's own `dsh-mcp-client` for compatibility, at the cost
    // of OAuth and SSE support.
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') return 'the host context does not support dynamic plugin mounting'
    let pluginModule: unknown = mcpBridge
    if ((await this.backendProvider()) === 'host') {
      if (request.config.transport === 'sse') {
        return 'the host dsh-mcp-client does not support the legacy SSE transport — switch the MCP backend back to the built-in client for this server'
      }
      try {
        pluginModule = await import('@deepseek-ai/dsh-mcp-client')
      } catch {
        return 'the @deepseek-ai/dsh-mcp-client package is not installed in this profile — switch the MCP backend back to the built-in client'
      }
    }
    let handle: MountPluginHandle | undefined
    try {
      handle = mountCtx.plugin(pluginModule, request.config)
      await handle.await()
    } catch (error) {
      // The bridge mounts with failOnStartupError for suite servers, so a
      // connection or initialization failure rejects here. Drop the
      // half-mounted handle before reporting so no orphan child survives a
      // failed startup.
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch {
          // Ignore teardown errors: the startup failure is the real signal.
        }
      }
      return `mount failed: ${error instanceof Error ? error.message : String(error)}`
    }
    this.live.set(mountKey(request.suiteId, request.serverKey), {
      suiteId: request.suiteId,
      serverKey: request.serverKey,
      serverName: request.config.serverName,
      disposer: () => handle.dispose()
    })
    this.names.set(request.config.serverName, `${request.suiteId}/${request.serverKey}`)
    return undefined
  }

  private async unmount(key: string, live: LiveMount): Promise<string | undefined> {
    try {
      await live.disposer()
      this.live.delete(key)
      this.names.delete(live.serverName)
      return undefined
    } catch (error) {
      const reason = `unmount failed: ${error instanceof Error ? error.message : String(error)}`
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] ${reason} (${live.suiteId}/${live.serverKey})`)
      return reason
    }
  }
}

function mountKey(suiteId: string, serverKey: string): string {
  return `${suiteId}\u0000${serverKey}`
}
