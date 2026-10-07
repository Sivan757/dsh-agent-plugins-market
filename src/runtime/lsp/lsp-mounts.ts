/**
 * Runtime LSP mounts: one live `dsh-lsp-stdio` child plugin per enabled
 * provider in a suite's inline `lspServers` table, mounted through `ctx.plugin`.
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
import type { ExtensionLspProvider } from '../host/extension-tool-gates.js'
import { DIRECT_LSP_SUITE_ID } from '../../application/lsp/lsp-status.js'
import { SerialPassQueue, RetryScheduler, type MountPluginHandle, type PluginMountContext } from '../core/mount-lifecycle.js'
import { describeLegacySeam, findLegacyLspSeams, type LegacyLspSeam } from '../../application/lsp/profile-seam.js'
import { qualifiedSuiteId, suiteDataDir } from '../../catalog/paths.js'
import { expandPluginPaths, pluginRootOf, type PluginPathContext } from '../../catalog/plugin-variables.js'
import { causeMessages } from '../host/failure-detail.js'
import { resolveDeclaredCommand } from '../host/shell-path.js'
import type { Suite } from '../../model/types.js'

import type { LspMountDiagnostic } from '../../contracts/lsp.js'

export type { LspMountDiagnostic }

interface WantedMount {
  config: Record<string, LspStdioServerConfig>
  facts: string[]
  pathExtensions: string[]
}

interface LiveMount {
  fingerprint: string
  suiteId: string
  serverKeys: string[]
  providers: ExtensionLspProvider[]
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

/** Resolve author-written paths in one declaration before the host spawns the server. */
export function expandLspServerConfig(config: LspStdioServerConfig, context: PluginPathContext): LspStdioServerConfig {
  return {
    ...config,
    command: expandPluginPaths(config.command, context),
    args: config.args.map(argument => expandPluginPaths(argument, context)),
    ...(config.env === undefined ? {} : { env: Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expandPluginPaths(value, context)])) })
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
  causes?: string[]
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
  /**
   * Reads the profile files when a seam conflict needs explaining. Injectable
   * because it touches the machine's own `$DSH_HOME`, so a test must not
   * inherit whatever the developer running it happens to have configured.
   */
  private readonly locateSeams: () => Promise<LegacyLspSeam[]>
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
  /** Plugin storage root holding each suite's `${PLUGIN_DATA}` directory; unset leaves the variable verbatim. */
  private pluginDataRoot?: string
  /** Direct (user-configured) server provider; defaults to none. */
  private directProvider: () => Promise<Record<string, import('../../model/types.js').LspServerSpec>> = async () => ({})
  /** Per-workspace entry filter; an absent provider mounts everything wanted. */
  private entryFilter: (() => { allows(face: 'lsp', entryId: string): boolean }) | undefined
  private disabledProvider: () => Promise<Set<string>> = async () => new Set()
  private disabledSnapshot = new Set<string>()
  private demandedProviderIds: () => ReadonlySet<string> = () => new Set()

  constructor(
    private readonly ctx: Context,
    loadHost?: () => Promise<HostModule | undefined>,
    loadService?: () => Promise<HostModule | undefined>,
    loadTool?: () => Promise<HostModule | undefined>,
    locateSeams?: () => Promise<LegacyLspSeam[]>
  ) {
    this.loadHost = loadHost ?? lazyImport(LSP_STDIO_IMPORT)
    this.loadService = loadService ?? lazyImport(LSP_SERVICE_IMPORT)
    this.loadTool = loadTool ?? lazyImport(LSP_TOOL_IMPORT)
    this.locateSeams = locateSeams ?? findLegacyLspSeams
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
    const wanted = new Map<string, WantedMount>()
    const diagnostics: LspMountDiagnostic[] = []
    const disabled = await this.disabledProvider()
    const demanded = new Set(this.demandedProviderIds())
    this.disabledSnapshot = new Set(disabled)
    for (const suite of active) {
      const servers = Object.values(suite.lsp?.servers ?? {})
      if (servers.length === 0) continue
      // The wanted key is the qualified suite id: bare suite ids are unique
      // per source only, so two sources shipping the same suite name would
      // otherwise shadow each other's mount and diagnostics.
      const key = qualifiedSuiteId(suite.sourceId, suite.id)
      const config: Record<string, LspStdioServerConfig> = {}
      const facts: string[] = []
      const pathExtensions: string[] = []
      const root = pluginRootOf(suite)
      const context: PluginPathContext = {
        ...(root === undefined ? {} : { root }),
        ...(root === undefined || this.pluginDataRoot === undefined ? {} : { data: suiteDataDir(this.pluginDataRoot, suite.sourceId, suite.id) })
      }
      for (const spec of servers) {
        if (disabled.has(`${key}/${spec.key}`) && !demanded.has(`${key}/${spec.key}`)) continue
        // The per-workspace resource filter answers by the status-row id, so
        // the window and the mount agree on what one entry names.
        if (this.entryFilter?.().allows('lsp', `lsp:${key}/${spec.key}`) === false) continue
        const serverConfig = expandLspServerConfig(toLspServerConfig(spec), context)
        config[`${key}/${spec.key}`] = await this.resolveServerCommand(serverConfig, spec.key, facts, pathExtensions)
      }
      if (Object.keys(config).length > 0) wanted.set(key, { config, facts, pathExtensions })
    }
    // Direct user-configured servers ride the same mount path under the
    // sentinel suite id, so their lifecycle (retries, diagnostics, disposal)
    // is identical to a suite's.
    const direct = await this.directProvider()
    const directKeys = Object.keys(direct)
    if (directKeys.length > 0) {
      const config: Record<string, LspStdioServerConfig> = {}
      const facts: string[] = []
      const pathExtensions: string[] = []
      for (const [key, spec] of Object.entries(direct)) {
        if (disabled.has(`${DIRECT_LSP_SUITE_ID}/${key}`) && !demanded.has(`${DIRECT_LSP_SUITE_ID}/${key}`)) continue
        if (this.entryFilter?.().allows('lsp', `lsp:direct/${key}`) === false) continue
        config[`${DIRECT_LSP_SUITE_ID}/${key}`] = await this.resolveServerCommand(toLspServerConfig(spec), key, facts, pathExtensions)
      }
      if (Object.keys(config).length > 0)
        wanted.set(DIRECT_LSP_SUITE_ID, {
          config,
          facts,
          pathExtensions
        })
    }
    // Each child owns one provider, so changing a sibling cannot restart its process pool.
    const wantedProviders = new Map<string, { suiteId: string; entry: WantedMount }>()
    for (const [suiteId, entry] of wanted) {
      for (const [providerId, config] of Object.entries(entry.config)) {
        wantedProviders.set(providerId, { suiteId, entry: { ...entry, config: { [providerId]: config } } })
      }
    }
    for (const [key, live] of [...this.live]) {
      const target = wantedProviders.get(key)
      if (target === undefined || live.fingerprint !== JSON.stringify(target.entry.config)) {
        const reason = await this.unmount(key, live)
        this.lastDiagnostics.delete(key)
        if (reason !== undefined) diagnostics.push({ suiteId: live.suiteId, serverKey: live.serverKeys.join(','), reason, code: 'unmount-failed' })
      }
    }
    if (wantedProviders.size === 0 && this.live.size === 0) await this.releaseCapability()
    const capabilityFailure = wantedProviders.size > 0 ? await this.ensureCapability() : undefined
    for (const [key, { suiteId, entry }] of wantedProviders) {
      if (this.live.has(key)) {
        this.lastDiagnostics.delete(key)
        continue
      }
      const causes = [...(capabilityFailure?.causes ?? []), ...entry.facts]
      const failure =
        capabilityFailure === undefined
          ? await this.mountWith(key, suiteId, entry.config, entry.facts, entry.pathExtensions)
          : {
              suiteId,
              serverKey: Object.keys(entry.config).join(','),
              reason: capabilityFailure.reason,
              code: capabilityFailure.code,
              ...(causes.length === 0 ? {} : { causes })
            }
      if (failure !== undefined) {
        diagnostics.push(failure)
        this.lastDiagnostics.set(key, failure)
        this.retries.schedule({ key, label: failure.suiteId, ...(failure.code === 'host-missing' ? {} : { reason: failure.reason }) })
      } else {
        this.lastDiagnostics.delete(key)
      }
    }
    for (const key of this.lastDiagnostics.keys()) {
      if (!wantedProviders.has(key)) this.lastDiagnostics.delete(key)
    }
    return diagnostics
  }

  /**
   * Resolve one server's declared command, extending its `PATH` from the
   * login shell only when the current environment cannot find the command.
   *
   * An explicit `env.PATH` is a declaration and is left verbatim; the command
   * itself is never rewritten. A resolution fact (the extension, or the
   * searched `PATH` when it still failed) is appended to the suite's facts so
   * it reaches the mount diagnostic; a fact is also a PATH extension exactly
   * when `resolution.path` is set, and rides `pathExtensions` for the trace log.
   */
  private async resolveServerCommand(config: LspStdioServerConfig, serverKey: string, facts: string[], pathExtensions: string[]): Promise<LspStdioServerConfig> {
    const resolution = await resolveDeclaredCommand(this.ctx, config.command, config.env ?? {})
    if (resolution === undefined) return config
    if (resolution.diagnostic !== undefined) {
      const fact = `${serverKey}: ${resolution.diagnostic}`
      facts.push(fact)
      if (resolution.path !== undefined) pathExtensions.push(fact)
    }
    if (resolution.path === undefined) return config
    return { ...config, env: { ...(config.env ?? {}), PATH: resolution.path } }
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
        return { reason: await this.seamConflictReason(specifier, message), code: 'seam-conflict', causes: causeMessages(error) }
      }
      return { reason: `mount failed: ${message}`, code: 'mount-failed', causes: causeMessages(error) }
    }
    this.capability.push(handle)
    return undefined
  }

  /**
   * Explain a taken seam, naming the profile layer to remove when one can be
   * found on disk. Releases before the plugin provisioned LSP itself told users
   * to add that layer by hand, so the message points at the exact file and rows
   * rather than at "the profile" in general.
   */
  private async seamConflictReason(specifier: string, message: string): Promise<string> {
    const head = `the profile already registers its own ${specifier} (${message})`
    const seams = await this.locateSeams().catch(() => [])
    const seam = seams[0]
    if (seam === undefined) {
      return `${head}; remove that layer from the profile (a manual \`cordis.patch.yml\` row, or a profile dependency on the package) so this plugin's aligned copy owns the seam`
    }
    return `${head}; ${describeLegacySeam(seam)} — remove those rows (the LSP panel offers a one-click removal) so this plugin's aligned copy owns the seam`
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

  /** Install the plugin storage root per-suite data directories resolve against. */
  setPluginDataRoot(root: string): void {
    this.pluginDataRoot = root
  }

  /** Install the direct (user-configured) server provider used at reconcile time. */
  setDirectProvider(provider: () => Promise<Record<string, import('../../model/types.js').LspServerSpec>>): void {
    this.directProvider = provider
  }

  /**
   * Install the per-workspace entry filter read at wanted-row time. A filtered
   * server is never added to its suite's wanted config, so it unmounts through
   * the ordinary fingerprint pass; the registry itself stays attached.
   */
  setEntryFilter(filter: () => { allows(face: 'lsp', entryId: string): boolean }): void {
    this.entryFilter = filter
  }
  /** Session demand overrides ordinary disabled-provider defaults only; validation and entry filters still apply. */
  setDemandedProviderIdsProvider(provider: () => ReadonlySet<string>): void {
    this.demandedProviderIds = provider
  }

  setDisabledProvider(provider: () => Promise<Set<string>>): void {
    this.disabledProvider = provider
  }
  /** Read current global disabled IDs without merging session demand. */
  async globalDisabledProviderIds(): Promise<ReadonlySet<string>> {
    return new Set(await this.disabledProvider())
  }

  disabledServers(): Set<string> {
    return new Set(this.disabledSnapshot)
  }

  /** The latest mount diagnostic per suite, for the LSP status surface. */
  diagnosticsSnapshot(): Map<string, LspMountDiagnostic> {
    const suites = new Map<string, LspMountDiagnostic>()
    for (const diagnostic of this.lastDiagnostics.values()) {
      if (!suites.has(diagnostic.suiteId)) suites.set(diagnostic.suiteId, diagnostic)
    }
    return suites
  }

  /** Whether this registry owns the LSP tool, including its startup publication window. */
  ownsTool(): boolean {
    return this.capabilityReady && this.capabilityFailure === undefined
  }

  /** Routes from successfully mounted provider tables; conflicts and failed mounts publish none. */
  providerOwnership(): ExtensionLspProvider[] {
    return [...this.live.values()].flatMap(mount => mount.providers)
  }

  /** Whether at least one suite mount is live. */
  hasLiveMounts(): boolean {
    return this.live.size > 0
  }

  /** Mount one provider as an independently disposable `dsh-lsp-stdio` instance. */
  private async mountWith(
    key: string,
    suiteId: string,
    servers: Record<string, LspStdioServerConfig>,
    facts: string[] = [],
    pathExtensions: string[] = []
  ): Promise<LspMountDiagnostic | undefined> {
    const hostKeys = Object.keys(servers).join(',')
    const module = await this.loadHost()
    if (module === undefined) {
      return { suiteId, serverKey: hostKeys, reason: HOST_MISSING_REASON, code: 'host-missing' }
    }
    const plugin = module.default ?? module
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') {
      return { suiteId, serverKey: hostKeys, reason: 'the host context does not support dynamic plugin mounting', code: 'host-missing' }
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
        suiteId,
        serverKey: hostKeys,
        reason: `mount failed: ${message}`,
        code: conflict ? 'seam-conflict' : 'mount-failed',
        causes: [...causeMessages(error), ...facts]
      }
    }
    // The mount is live: only a genuine PATH extension is worth a trace, and
    // resolveServerCommand already marked those facts structurally.
    for (const fact of pathExtensions) this.ctx.logger?.info?.(`[dsh-agent-plugins-market] ${key}: ${fact}`)
    const providers = Object.entries(servers).map(([providerId, config]) => ({
      resourceId: suiteId === DIRECT_LSP_SUITE_ID ? 'lsp:direct/' + providerId.slice(suiteId.length + 1) : 'lsp:' + providerId,
      ...(suiteId === DIRECT_LSP_SUITE_ID ? {} : { suiteId }),
      extensions: Object.keys(config.extensionToLanguage)
    }))
    this.live.set(key, { fingerprint: JSON.stringify(servers), suiteId, serverKeys: Object.keys(servers), providers, disposer: () => handle.dispose() })
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
