/**
 * Runtime LSP mounts: one live `dsh-lsp-stdio` child plugin per enabled
 * suite's inline `lspServers` table, mounted through `ctx.plugin`.
 *
 * Mounts reconcile against the enabled-suite set exactly like the MCP mounts:
 * reconcile() unmounts rows whose suite was disabled or removed and mounts
 * rows that appeared. The host LSP package is optional at runtime — without
 * it, suites keep every other surface and the manager reports a one-line
 * `host-missing` diagnostic that does not enter the retry schedule (a missing
 * package is not a transient failure). Mount failures that can resolve after
 * user action (installing the language server executable) do retry.
 *
 * Provider identity: one `${suiteId}/${serverKey}` provider id per server, so
 * two suites declaring the same server key mount independently. Extension
 * ownership in `ctx.lsp` is exclusive by design; when two enabled suites
 * claim the same extension the later mount fails with `seam-conflict` and the
 * user resolves it through per-suite surface toggles.
 */
import type { Context } from '@deepseek-ai/cordis'
import { DIRECT_LSP_SUITE_ID } from './lsp-status.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { Suite } from '../model/types.js'

export interface LspMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: 'mount-failed' | 'unmount-failed' | 'seam-conflict' | 'host-missing'
}

interface LiveMount {
  suiteId: string
  serverKeys: string[]
  disposer: () => void | Promise<void>
}

/**
 * Bounded retry schedule for a failed mount/unmount, mirroring the MCP
 * mounts: a permanently broken server must stop consuming attempt budget,
 * and the schedule resets with every reconcile pass.
 */
const RETRY_SCHEDULE_MS = [1_500, 5_000, 15_000, 45_000, 120_000]
const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length

/** One dsh-lsp-stdio server configuration row (its Config.servers entry). */
export interface LspStdioServerConfig {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}

/** Build one dsh-lsp-stdio Config.servers entry from a normalized spec. */
export function toLspServerConfig(spec: {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}): LspStdioServerConfig {
  return {
    command: spec.command,
    args: spec.args,
    extensionToLanguage: spec.extensionToLanguage,
    ...(spec.env === undefined ? {} : { env: spec.env }),
    ...(spec.initializationOptions === undefined ? {} : { initializationOptions: spec.initializationOptions }),
    ...(spec.configuration === undefined ? {} : { configuration: spec.configuration })
  }
}

interface MountPluginHandle {
  await(): Promise<unknown>
  dispose(): void | Promise<void>
}

/** Structural `ctx.plugin` surface for mounting one plugin instance. */
interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountPluginHandle
}

/** Minimal structural shape of the dynamically imported `dsh-lsp-stdio` module. */
interface LspStdioModule {
  default?: unknown
}

/** Import spec kept as a string literal so the optional dependency stays dynamic. */
const LSP_STDIO_IMPORT = '@deepseek-ai/dsh-lsp-stdio'

export class LspMountRegistry {
  private readonly live = new Map<string, LiveMount>()
  /** Serialize mount and unmount passes so a disable cannot race an in-flight spawn. */
  private reconcileQueue: Promise<void> = Promise.resolve()
  /** Pending retry timers keyed by mount key, so a teardown can cancel them. */
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  /** Attempt count per mount key; reset whenever a retry succeeds. */
  private readonly attempts = new Map<string, number>()
  /** Snapshot of the last reconciled suite set, replayed by retry passes. */
  private lastEnabled: Suite[] = []
  /** Host module loader; overridable for tests. */
  private loadHost: () => Promise<LspStdioModule | undefined>
  /** Latest diagnostic per suite id; cleared when its suite mounts or leaves the wanted set. */
  private readonly lastDiagnostics = new Map<string, LspMountDiagnostic>()
  /** Direct (user-configured) server provider; defaults to none. */
  private directProvider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>> = async () => ({})

  constructor(
    private readonly ctx: Context,
    loadHost?: () => Promise<LspStdioModule | undefined>
  ) {
    this.loadHost =
      loadHost ??
      (async () => {
        try {
          return (await import(/* @vite-ignore */ LSP_STDIO_IMPORT)) as LspStdioModule
        } catch {
          return undefined
        }
      })
  }

  /** Queue one reconciliation behind any in-flight mount/unmount pass. */
  reconcile(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]> {
    const run = this.reconcileQueue.then(() => this.reconcileNow(enabledSuites))
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** Mount/unmount LSP servers to match the enabled suites plus direct config exactly. */
  private async reconcileNow(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]> {
    this.lastEnabled = [...enabledSuites]
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.lsp !== false)
    const wanted = new Map<string, { suite: Suite; config: Record<string, LspStdioServerConfig> }>()
    const diagnostics: LspMountDiagnostic[] = []
    for (const suite of active) {
      const servers = Object.values(suite.lsp?.servers ?? {})
      if (servers.length === 0) continue
      // The wanted key is the qualified suite id: bare suite ids are unique
      // per source only, so two sources shipping the same suite name would
      // otherwise shadow each other's mount and diagnostics.
      const key = qualifiedSuiteId(suite.sourceId, suite.id)
      const config: Record<string, LspStdioServerConfig> = {}
      for (const spec of servers) config[`${key}/${spec.key}`] = toLspServerConfig(spec)
      wanted.set(key, { suite, config })
    }
    // Direct user-configured servers ride the same mount path under the
    // sentinel suite id, so their lifecycle (retries, diagnostics, disposal)
    // is identical to a suite's.
    const direct = await this.directProvider()
    const directKeys = Object.keys(direct)
    if (directKeys.length > 0) {
      const config: Record<string, LspStdioServerConfig> = {}
      for (const [key, spec] of Object.entries(direct)) config[`${DIRECT_LSP_SUITE_ID}/${key}`] = toLspServerConfig(spec)
      wanted.set(DIRECT_LSP_SUITE_ID, {
        suite: {
          sourceId: '',
          id: DIRECT_LSP_SUITE_ID,
          root: '',
          manifest: { layout: 'claude-code', path: '', id: DIRECT_LSP_SUITE_ID, name: DIRECT_LSP_SUITE_ID },
          skills: [],
          surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: directKeys.length },
          dimension: 'user',
          enabled: true,
          errors: []
        },
        config
      })
    }
    for (const [key, live] of [...this.live]) {
      if (!wanted.has(key)) {
        const reason = await this.unmount(key, live)
        this.lastDiagnostics.delete(live.suiteId)
        if (reason !== undefined) diagnostics.push({ suiteId: live.suiteId, serverKey: live.serverKeys.join(','), reason, code: 'unmount-failed' })
      }
    }
    for (const [key, entry] of wanted) {
      if (this.live.has(key)) {
        this.lastDiagnostics.delete(key)
        continue
      }
      const failure = await this.mountWith(key, entry.suite, entry.config)
      if (failure !== undefined) {
        diagnostics.push(failure)
        this.lastDiagnostics.set(key, failure)
        this.scheduleRetry(key, failure.code === 'host-missing' ? undefined : failure)
      } else {
        this.lastDiagnostics.delete(key)
      }
    }
    return diagnostics
  }

  /** Install the direct (user-configured) server provider used at reconcile time. */
  setDirectProvider(provider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>>): void {
    this.directProvider = provider
  }

  /** The latest mount diagnostic per suite, for the LSP status surface. */
  diagnosticsSnapshot(): Map<string, LspMountDiagnostic> {
    return new Map(this.lastDiagnostics)
  }

  /** Whether at least one suite mount is live. */
  hasLiveMounts(): boolean {
    return this.live.size > 0
  }

  /** Mount one suite's full server table as a single `dsh-lsp-stdio` instance. */
  private async mountWith(key: string, suite: Suite, servers: Record<string, LspStdioServerConfig>): Promise<LspMountDiagnostic | undefined> {
    const hostKeys = Object.keys(servers).join(',')
    const module = await this.loadHost()
    if (module === undefined) {
      return { suiteId: suite.id, serverKey: hostKeys, reason: HOST_MISSING_REASON, code: 'host-missing' }
    }
    const plugin = module.default ?? module
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') {
      return { suiteId: suite.id, serverKey: hostKeys, reason: 'the host context does not support dynamic plugin mounting', code: 'host-missing' }
    }
    let handle: MountPluginHandle | undefined
    try {
      handle = mountCtx.plugin(plugin, { servers })
      await handle.await()
    } catch (error) {
      // A failed startup can leave a half-mounted handle behind; drop it so
      // no orphan child process survives, then report the real signal.
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch {
          // Ignore teardown errors: the startup failure is the real signal.
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      const conflict = /already handled by another LSP provider|already registered/.test(message)
      return {
        suiteId: suite.id,
        serverKey: hostKeys,
        reason: `mount failed: ${message}`,
        code: conflict ? 'seam-conflict' : 'mount-failed'
      }
    }
    this.live.set(key, { suiteId: suite.id, serverKeys: Object.keys(servers), disposer: () => handle.dispose() })
    return undefined
  }

  private async unmount(key: string, live: LiveMount): Promise<string | undefined> {
    try {
      await live.disposer()
      this.live.delete(key)
      return undefined
    } catch (error) {
      const reason = `unmount failed: ${error instanceof Error ? error.message : String(error)}`
      this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] ${reason} (${live.suiteId})`)
      return reason
    }
  }

  /**
   * Schedule a delayed re-attempt for a mount that still is not live. A
   * `host-missing` failure passes no diagnostic and is never retried; the
   * schedule is bounded and resets with every reconcile pass.
   */
  private scheduleRetry(key: string, failure: LspMountDiagnostic | undefined): void {
    const pending = this.retries.get(key)
    if (pending !== undefined) clearTimeout(pending)
    this.retries.delete(key)
    if (failure === undefined || failure.code === 'host-missing') {
      this.attempts.delete(key)
      return
    }
    const attempt = (this.attempts.get(key) ?? 0) + 1
    this.attempts.set(key, attempt)
    if (attempt > MAX_RETRY_ATTEMPTS) {
      this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] ${failure.suiteId}: giving up after ${MAX_RETRY_ATTEMPTS} attempts — ${failure.reason}`)
      return
    }
    const delay = RETRY_SCHEDULE_MS[attempt - 1] ?? RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]!
    const timer = setTimeout(() => {
      this.retries.delete(key)
      // Re-run against the last known suite set: a retry must not resurrect
      // servers of a suite that has since been disabled or uninstalled.
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
  }
}

const HOST_MISSING_REASON =
  'the @deepseek-ai/dsh-lsp-stdio package is not installed in this profile; upgrade to a DSH build carrying the LSP packages (@deepseek-ai/dsh-lsp, dsh-lsp-stdio, dsh-tool-lsp) and mount tool-lsp in the profile to expose the `lsp` tool'
