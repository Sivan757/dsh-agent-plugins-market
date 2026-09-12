/**
 * Runtime LSP mounts: one live `dsh-lsp-stdio` child plugin per enabled
 * suite's inline `lspServers` table, mounted through `ctx.plugin`.
 *
 * Mounts reconcile against the enabled-suite set exactly like the MCP mounts:
 * reconcile() unmounts rows whose suite was disabled or removed and mounts
 * rows that appeared. The first wanted server also mounts the capability seam
 * this plugin owns end to end — `ctx.lsp` and the model-facing `lsp` tool —
 * because the dsh installation does not carry the LSP packages; the last one
 * releases it, so a profile that never enables an LSP suite never grows the
 * `lsp` tool.
 *
 * Provisioning is a property of the plugin, not of the profile: both mounts
 * are unconditional and the version comes from this package's dependency
 * declaration. Nothing probes whether the profile already carries a seam — a
 * seam another layer registered comes back as a `seam-conflict` diagnostic
 * naming the layer to remove, so the aligned copy is the only one that can run.
 *
 * A failure the plugin cannot fix itself (a package that is genuinely absent
 * from the profile) reports a one-line `host-missing` diagnostic that does not
 * enter the retry schedule. Mount failures that can resolve after user action
 * (installing the language server executable) do retry.
 *
 * Provider identity: one `${suiteId}/${serverKey}` provider id per server, so
 * two suites declaring the same server key mount independently. Extension
 * ownership in `ctx.lsp` is exclusive by design; when two enabled suites
 * claim the same extension the later mount fails with `seam-conflict` and the
 * user resolves it through per-suite surface toggles.
 */
import type { Context } from '@deepseek-ai/cordis'
import { DIRECT_LSP_SUITE_ID } from './lsp-status.js'
import { SerialPassQueue, RetryScheduler, type MountPluginHandle, type PluginMountContext } from './mount-lifecycle.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { effectiveSurfaces, type Suite } from '../model/types.js'

export interface LspMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: 'mount-failed' | 'unmount-failed' | 'seam-conflict' | 'host-missing'
}

interface LiveMount {
  fingerprint: string
  suiteId: string
  serverKeys: string[]
  disposer: () => void | Promise<void>
}

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

/** Minimal structural shape of a dynamically imported host plugin module. */
interface HostModule {
  default?: unknown
}

/** Why the capability seam could not be mounted, with the diagnostic code it reports under. */
interface CapabilityFailure {
  reason: string
  code: 'host-missing' | 'mount-failed' | 'seam-conflict'
}

/** Import specifiers kept as string literals so the host packages stay dynamically loaded. */
const LSP_STDIO_IMPORT = '@deepseek-ai/dsh-lsp-stdio'
const LSP_SERVICE_IMPORT = '@deepseek-ai/dsh-lsp'
const LSP_TOOL_IMPORT = '@deepseek-ai/dsh-tool-lsp'

/**
 * Build one lazy loader for a host package. The specifier stays a literal in a
 * top-level `const` so an absent package degrades to `undefined` instead of
 * failing the import of this module.
 */
function lazyImport(specifier: string): () => Promise<HostModule | undefined> {
  return async () => {
    try {
      return (await import(/* @vite-ignore */ specifier)) as HostModule
    } catch {
      return undefined
    }
  }
}

export class LspMountRegistry {
  private readonly live = new Map<string, LiveMount>()
  /** Serialize mount and unmount passes so a disable cannot race an in-flight spawn. */
  private readonly passes = new SerialPassQueue()
  /** Delayed re-attempts for mounts that are not live yet. */
  private readonly retries: RetryScheduler
  /** Snapshot of the last reconciled suite set, replayed by retry passes. */
  private lastEnabled: Suite[] = []
  /** Host module loader; overridable for tests. */
  private loadHost: () => Promise<HostModule | undefined>
  /** `ctx.lsp` seam loader, mounted only when the profile supplies no service. */
  private loadService: () => Promise<HostModule | undefined>
  /** `lsp` tool loader, mounted only when the profile publishes no such tool. */
  private loadTool: () => Promise<HostModule | undefined>
  /** Capability plugins this registry mounted, in mount order, disposed with the last server. */
  private readonly capability: MountPluginHandle[] = []
  /** Whether the capability seam was already resolved for the current wanted set. */
  private capabilityReady = false
  /** Why the capability seam is unavailable; re-attempted on the next reconcile pass. */
  private capabilityFailure: CapabilityFailure | undefined
  /** Latest diagnostic per suite id; cleared when its suite mounts or leaves the wanted set. */
  private readonly lastDiagnostics = new Map<string, LspMountDiagnostic>()
  /** Direct (user-configured) server provider; defaults to none. */
  private directProvider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>> = async () => ({})
  private disabledProvider: () => Promise<Set<string>> = async () => new Set()
  private disabledSnapshot = new Set<string>()

  constructor(
    private readonly ctx: Context,
    loadHost?: () => Promise<HostModule | undefined>,
    loadService?: () => Promise<HostModule | undefined>,
    loadTool?: () => Promise<HostModule | undefined>
  ) {
    this.loadHost = loadHost ?? lazyImport(LSP_STDIO_IMPORT)
    this.loadService = loadService ?? lazyImport(LSP_SERVICE_IMPORT)
    this.loadTool = loadTool ?? lazyImport(LSP_TOOL_IMPORT)
    this.retries = new RetryScheduler({
      replay: () => this.reconcile(this.lastEnabled),
      log: message => this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] ${message}`)
    })
  }

  /** Queue one reconciliation behind any in-flight mount/unmount pass. */
  reconcile(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]> {
    return this.passes.run(() => this.reconcileNow(enabledSuites))
  }

  /** Mount/unmount LSP servers to match the enabled suites plus direct config exactly. */
  private async reconcileNow(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]> {
    this.lastEnabled = [...enabledSuites]
    const active = enabledSuites.filter(suite => suite.activeSurfaces.lsp !== false)
    const wanted = new Map<string, { suite: Suite; config: Record<string, LspStdioServerConfig> }>()
    const diagnostics: LspMountDiagnostic[] = []
    const disabled = await this.disabledProvider()
    this.disabledSnapshot = new Set(disabled)
    for (const suite of active) {
      const servers = Object.values(suite.lsp?.servers ?? {})
      if (servers.length === 0) continue
      // The wanted key is the qualified suite id: bare suite ids are unique
      // per source only, so two sources shipping the same suite name would
      // otherwise shadow each other's mount and diagnostics.
      const key = qualifiedSuiteId(suite.sourceId, suite.id)
      const config: Record<string, LspStdioServerConfig> = {}
      for (const spec of servers) if (!disabled.has(`${key}/${spec.key}`)) config[`${key}/${spec.key}`] = toLspServerConfig(spec)
      if (Object.keys(config).length > 0) wanted.set(key, { suite, config })
    }
    // Direct user-configured servers ride the same mount path under the
    // sentinel suite id, so their lifecycle (retries, diagnostics, disposal)
    // is identical to a suite's.
    const direct = await this.directProvider()
    const directKeys = Object.keys(direct)
    if (directKeys.length > 0) {
      const config: Record<string, LspStdioServerConfig> = {}
      for (const [key, spec] of Object.entries(direct)) if (!disabled.has(`${DIRECT_LSP_SUITE_ID}/${key}`)) config[`${DIRECT_LSP_SUITE_ID}/${key}`] = toLspServerConfig(spec)
      if (Object.keys(config).length > 0)
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
            // Direct servers carry no install state and no per-surface
            // overrides, so every surface keeps its enabled default.
            activeSurfaces: effectiveSurfaces(undefined),
            errors: []
          },
          config
        })
    }
    // The last remaining server releases the capability seam; the first one mounts it.
    if (wanted.size === 0) await this.releaseCapability()
    for (const [key, live] of [...this.live]) {
      const target = wanted.get(key)
      if (target === undefined || live.fingerprint !== JSON.stringify(target.config)) {
        const reason = await this.unmount(key, live)
        this.lastDiagnostics.delete(key)
        if (reason !== undefined) diagnostics.push({ suiteId: key, serverKey: live.serverKeys.join(','), reason, code: 'unmount-failed' })
      }
    }
    const capabilityFailure = wanted.size > 0 ? await this.ensureCapability() : undefined
    for (const [key, entry] of wanted) {
      if (this.live.has(key)) {
        this.lastDiagnostics.delete(key)
        continue
      }
      const failure =
        capabilityFailure === undefined
          ? await this.mountWith(key, entry.suite, entry.config)
          : { suiteId: key, serverKey: Object.keys(entry.config).join(','), reason: capabilityFailure.reason, code: capabilityFailure.code }
      if (failure !== undefined) {
        diagnostics.push(failure)
        this.lastDiagnostics.set(key, failure)
        this.retries.schedule({ key, label: failure.suiteId, ...(failure.code === 'host-missing' ? {} : { reason: failure.reason }) })
      } else {
        this.lastDiagnostics.delete(key)
      }
    }
    return diagnostics
  }

  /**
   * Mount the capability seam this plugin delivers end to end: `ctx.lsp`, then the model-facing
   * `lsp` tool.
   *
   * The plugin never asks what the profile already carries. Its dependency declaration decides
   * the version, so deferring to a seam another layer registered would silently run whatever
   * version that layer picked. Both mounts are therefore unconditional; a seam that is already
   * taken comes back as a `seam-conflict` diagnostic naming the layer to remove, which is the
   * only way the aligned copy can own it.
   * @returns the failure, or undefined when the seam is ready.
   */
  private async ensureCapability(): Promise<CapabilityFailure | undefined> {
    // A previous failure is re-attempted on the next pass: the user can fix a profile and the
    // retry schedule re-runs reconcile, while a module that still cannot load fails just as fast.
    if (this.capabilityReady && this.capabilityFailure === undefined) return undefined
    this.capabilityReady = true
    this.capabilityFailure = undefined
    const ctx = this.ctx as unknown as Partial<PluginMountContext>
    if (typeof ctx.plugin !== 'function') return (this.capabilityFailure = { reason: 'the host context does not support dynamic plugin mounting', code: 'host-missing' })
    for (const [load, specifier] of [
      [this.loadService, LSP_SERVICE_IMPORT],
      [this.loadTool, LSP_TOOL_IMPORT]
    ] as const) {
      const failure = await this.mountCapability(load, specifier)
      if (failure !== undefined) return (this.capabilityFailure = failure)
    }
    return undefined
  }

  /** Mount one capability plugin and remember it for teardown with the last server. */
  private async mountCapability(load: () => Promise<HostModule | undefined>, specifier: string): Promise<CapabilityFailure | undefined> {
    const module = await load()
    if (module === undefined) return { reason: `the ${specifier} package is not installed in this profile`, code: 'host-missing' }
    const ctx = this.ctx as unknown as PluginMountContext
    let handle: MountPluginHandle | undefined
    try {
      handle = ctx.plugin(module.default ?? module, {})
      await handle.await()
    } catch (error) {
      // A failed startup can leave a half-mounted handle behind; drop it before reporting.
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch {
          // Ignore teardown errors: the startup failure is the real signal.
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      // `service "lsp" has been registered` / `tool "lsp" is already registered`: another layer
      // owns the seam. Report the layer to drop rather than falling back to its version.
      if (/already registered|has been registered/.test(message)) {
        return {
          reason: `the profile already registers its own ${specifier} (${message}); remove that layer from the profile (a manual \`cordis.patch.yml\` row, or a profile dependency on the package) so this plugin's aligned copy owns the seam`,
          code: 'seam-conflict'
        }
      }
      return { reason: `mount failed: ${message}`, code: 'mount-failed' }
    }
    this.capability.push(handle)
    return undefined
  }

  /** Dispose the capability seam this registry mounted, once no wanted server needs it. */
  private async releaseCapability(): Promise<void> {
    const handles = this.capability.splice(0)
    this.capabilityReady = false
    this.capabilityFailure = undefined
    for (const handle of handles.reverse()) {
      try {
        await handle.dispose()
      } catch (error) {
        this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] LSP capability teardown failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Install the direct (user-configured) server provider used at reconcile time. */
  setDirectProvider(provider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>>): void {
    this.directProvider = provider
  }
  setDisabledProvider(provider: () => Promise<Set<string>>): void {
    this.disabledProvider = provider
  }
  disabledServers(): Set<string> {
    return new Set(this.disabledSnapshot)
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
      return { suiteId: key, serverKey: hostKeys, reason: HOST_MISSING_REASON, code: 'host-missing' }
    }
    const plugin = module.default ?? module
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') {
      return { suiteId: key, serverKey: hostKeys, reason: 'the host context does not support dynamic plugin mounting', code: 'host-missing' }
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
        suiteId: key,
        serverKey: hostKeys,
        reason: `mount failed: ${message}`,
        code: conflict ? 'seam-conflict' : 'mount-failed'
      }
    }
    this.live.set(key, { fingerprint: JSON.stringify(servers), suiteId: key, serverKeys: Object.keys(servers), disposer: () => handle.dispose() })
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

  /** Dispose every live mount after queued reconciliation passes settle. */
  async disposeAll(): Promise<void> {
    await this.passes.run(async () => {
      for (const [key, live] of [...this.live]) {
        await this.unmount(key, live)
      }
      await this.releaseCapability()
    })
    this.retries.clear()
  }
}

const HOST_MISSING_REASON = `the ${LSP_STDIO_IMPORT} package could not be loaded from this profile; reinstall the plugin (\`dsh plugin --profile <profile> add dsh-agent-plugins-market\`) so its LSP dependencies are provisioned`
