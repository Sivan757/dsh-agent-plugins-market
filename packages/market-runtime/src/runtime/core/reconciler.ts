/**
 * Runtime reconciliation for enabled suites.
 *
 * One catalog snapshot is fanned out to the existing MCP, command, hook, and
 * LSP mount adapters. The adapters remain separate because their host surfaces
 * and failure semantics differ; this module owns ordering, containment, and
 * disposal only.
 */
import type { Context } from '@deepseek-ai/cordis'
import { isDeepStrictEqual } from 'node:util'
import type { McpBackend, McpMountDiagnostic } from '../../../../market-contracts/src/contracts/mcp.js'
import type { LspMountDiagnostic } from '../../../../market-contracts/src/contracts/lsp.js'
import type { Suite } from '../../../../market-contracts/src/model/types.js'
import { CommandMountRegistry, type CommandMountDiagnostic } from '../surfaces/commands-mounts.js'
import type { MenuRowRegistration } from '../host/menu-row-identities.js'
import { HooksMountRegistry, type HooksMountDiagnostic } from '../surfaces/hooks-mounts.js'
import { projectExtensionSuites, type ExtensionSuiteCandidate } from '../../application/extension-suite-selection.js'
import { captureExtensionSelection } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { bindHostLocale, type HostTranslate } from '../host/host-locale.js'
import type { LspMountPort, McpOverridesPort, RuntimeMounts, SharedMcpMountPort } from '../../adapter-contracts.js'

/**
 * The per-surface mount gates one reconcile pass reads.
 *
 * A switched-off surface is gated here rather than by filtering the suite
 * snapshot: the reconciler owns both the MCP and the LSP mount branch, so
 * dropping suites from the shared list would unmount a sibling surface's
 * mounts along with it. Gating each branch instead keeps the two orthogonal —
 * an off MCP mount reconciles to zero servers while the same suites keep their
 * language servers.
 */
export interface RuntimeSurfaceGates {
  /** Whether the named surface may mount on this pass. */
  allows(surface: RuntimeSurfaceKey): boolean
}

/**
 * The toggle keys the reconciler's own mount branches answer to.
 *
 * Hooks have no per-workspace switch, so that branch stays ungated; skills and
 * agents mount through their own providers and the market through its routes.
 */
export type RuntimeSurfaceKey = 'commands' | 'mcp' | 'lsp'

/** Diagnostics returned by one runtime reconciliation pass. */
export interface RuntimeDiagnostics {
  mcp: McpMountDiagnostic[]
  commands: CommandMountDiagnostic[]
  hooks: HooksMountDiagnostic[]
  lsp: LspMountDiagnostic[]
  errors: Array<{ surface: 'mcp' | 'commands' | 'hooks' | 'lsp'; reason: string }>
}

export interface SessionDemandReceipt {
  /** Publish staged identities after durability; never throws, and revoked receipts are no-ops. */
  commit(): void
  rollback(): Promise<void>
}
interface StagedDemand {
  ids: Set<string>
  active: boolean
  ready: boolean
}

export class RuntimeReconciler {
  private readonly mcp: SharedMcpMountPort
  private readonly commands: CommandMountRegistry
  private readonly hooks: HooksMountRegistry
  private readonly lspRegistry: LspMountPort
  private readonly queues = new Map<keyof Omit<RuntimeDiagnostics, 'errors'>, Promise<void>>()
  private gates: RuntimeSurfaceGates | undefined
  private disposed = false
  private agentScopedContributors = false
  private authority: ExtensionSuiteCandidate[] | undefined
  private authorityEpoch = 0
  private globalSuites: Suite[] = []
  private readonly committed = new Map<object, Set<string>>()
  private readonly staged = new Map<object, StagedDemand>()
  private sharedQueue: Promise<unknown> = Promise.resolve()
  private demandedMcp = new Map<string, Set<string>>()
  private demandedLsp = new Set<string>()
  private overridesProvider: () => Promise<Map<string, McpOverridesPort>> = async () => new Map()
  private disposal?: Promise<void>
  private readonly warn: (message: string) => void

  /**
   * @param ctx - the context every mount registers through.
   * @param dataRoot - the plugin data root the mount adapters store under.
   * @param mounts - the transport adapters this coordinator drives. The
   * composition root builds them, so no transport package is imported here.
   * @param t - host translator for the command registry's own diagnostics.
   */
  constructor(ctx: Context, dataRoot: string, mounts: RuntimeMounts, t: HostTranslate = bindHostLocale(undefined)) {
    this.mcp = mounts.mcp
    this.commands = new CommandMountRegistry(ctx, t, dataRoot)
    this.hooks = new HooksMountRegistry(ctx)
    this.lspRegistry = mounts.lsp
    this.lspRegistry.setPluginDataRoot(dataRoot)
    this.lspRegistry.setDemandedProviderIdsProvider(() => this.demandedLsp)
    this.warn = message => ctx.logger?.warn(message)
    this.mcp.setOverridesProvider(async () => {
      const overrides = new Map(await this.overridesProvider())
      for (const [suiteId, keys] of this.demandedMcp) {
        const rows = { ...overrides.get(suiteId) }
        for (const key of keys) rows[key] = { ...rows[key], enabled: true }
        overrides.set(suiteId, rows)
      }
      return overrides
    })
  }

  /** Transfer commands and hooks to per-agent registries; call before the first reconcile. */
  setAgentScopedContributors(): void {
    this.agentScopedContributors = true
  }

  /** Exact live MCP definitions and their owning extension resources. */
  mcpToolOwnership(): import('../host/extension-tool-gates.js').ExtensionMcpTool[] {
    return this.mcp.toolOwnership()
  }

  /** The LSP mount registry, consumed by the LSP status surface. */
  get lsp(): LspMountPort {
    return this.lspRegistry
  }

  /** The suite commands the global layer currently holds, for the slash menu's row faces. */
  commandRegistrations(): MenuRowRegistration[] {
    return this.commands.registrations()
  }

  /** Install the per-workspace entry filter on the MCP mount registry. */
  setMcpEntryFilter(filter: () => { allows(face: 'mcp', entryId: string): boolean }): void {
    this.mcp.setEntryFilter(filter)
  }

  /** Install the per-workspace entry filter on the command mount registry. */
  setCommandsEntryFilter(filter: () => { allows(face: 'commands', entryId: string): boolean }): void {
    this.commands.setEntryFilter(filter)
  }

  /**
   * Install the per-workspace surface gates, read on every pass.
   *
   * Set after construction because the toggle service is built later in
   * composition; until then every surface mounts, which is the all-on default.
   */
  setSurfaceGates(gates: RuntimeSurfaceGates): void {
    this.gates = gates
  }

  /** Install the per-suite MCP overrides provider used at mount time. */
  setMcpOverridesProvider(provider: () => Promise<Map<string, McpOverridesPort>>): void {
    this.overridesProvider = provider
  }

  /** Install the live tool-name provider used for foreign-namespace mount guards. */
  setMcpToolNamesProvider(provider: () => string[]): void {
    this.mcp.setToolNamesProvider(provider)
  }

  /** Install the backend provider deciding which MCP client mounts each server. */
  setMcpBackendProvider(provider: () => Promise<McpBackend>): void {
    this.mcp.setBackendProvider(provider)
  }

  /** Whether the current MCP snapshot uses one credential reference. */
  usesCredential(ref: string): boolean {
    return this.mcp.usesCredential(ref)
  }

  /** Flag one MCP mount for an explicit rebuild on the next reconcile. */
  forceMcpRemount(suiteId: string, serverKey: string): void {
    this.mcp.forceRemount(suiteId, serverKey)
  }

  /** Flag every live MCP mount for a rebuild on the next reconcile. */
  forceMcpRemountAll(): void {
    this.mcp.forceRemountAll()
  }

  /** The mount key owning one derived serverName; undefined when not mounted here. */
  mcpServerOwner(serverName: string): { suiteId: string; serverKey: string } | undefined {
    return this.mcp.serverOwner(serverName)
  }

  /** Publish fresh immutable authority without mounting or waiting behind network work. */
  setCatalogAuthority(candidates: readonly ExtensionSuiteCandidate[], global: readonly Suite[]): void {
    if (this.disposed) return
    if (isDeepStrictEqual(this.authority, candidates) && isDeepStrictEqual(this.globalSuites, global)) return
    this.authorityEpoch++
    this.authority = structuredClone([...candidates])
    this.globalSuites = structuredClone([...global])
  }

  /** Update full validated authority and the ordinary global base in one shared-service pass. */
  refreshCatalog(candidates: readonly ExtensionSuiteCandidate[], global: readonly Suite[]): Promise<RuntimeDiagnostics> {
    return this.reconcileSnapshot(global, structuredClone([...candidates]))
  }

  /** Legacy enabled-only refresh never replaces full authority or session demand. */
  reconcile(global: readonly Suite[]): Promise<RuntimeDiagnostics> {
    return this.reconcileSnapshot(global)
  }

  private async reconcileSnapshot(global: readonly Suite[], authority?: ExtensionSuiteCandidate[]): Promise<RuntimeDiagnostics> {
    const diagnostics = emptyDiagnostics()
    if (this.disposed) return diagnostics
    const captured = structuredClone([...global])
    if (authority !== undefined) this.setCatalogAuthority(authority, captured)
    else if (!isDeepStrictEqual(this.globalSuites, captured)) {
      this.authorityEpoch++
      this.globalSuites = captured
    }
    const local = Promise.all([
      this.surface('commands', diagnostics, () => this.commands.reconcile(this.agentScopedContributors || this.gates?.allows('commands') === false ? [] : captured)),
      this.surface('hooks', diagnostics, () => this.hooks.reconcile(this.agentScopedContributors ? [] : captured))
    ])
    const shared = this.enqueue(async () => {
      if (this.disposed) return
      const result = await this.reconcileShared()
      diagnostics.mcp = result.mcp
      diagnostics.lsp = result.lsp
      diagnostics.errors.push(...result.errors)
    })
    await Promise.all([local, shared])
    return diagnostics
  }

  private surface<K extends keyof Omit<RuntimeDiagnostics, 'errors'>>(key: K, diagnostics: RuntimeDiagnostics, work: () => Promise<RuntimeDiagnostics[K]>): Promise<void> {
    const run = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      if (this.disposed) return
      try {
        diagnostics[key] = await work()
      } catch (error) {
        diagnostics.errors.push({ surface: key, reason: messageOf(error) })
      }
    })
    this.queues.set(key, run)
    return run
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.sharedQueue.then(work)
    this.sharedQueue = run.catch(() => undefined)
    return run
  }

  /** Stage only identities; configuration always comes from current validated authority. */
  stageSessionDemand(owner: object, requested: readonly Suite[], directLspIds: readonly string[] = []): Promise<SessionDemandReceipt> {
    const ids = demandIds(requested)
    for (const id of directLspIds) {
      if (!id.startsWith('direct/') || id.length === 7 || Array.from(id).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
        return Promise.reject(new Error('extension-shared-invalid-direct-lsp'))
      ids.add('lsp:' + id)
    }
    return (async () => {
      if (this.disposed || this.authority === undefined) throw new Error('extension-shared-not-ready')
      if (this.staged.has(owner)) throw new Error('extension-shared-demand-busy')
      const token: StagedDemand = { ids, active: true, ready: false }
      this.staged.set(owner, token)
      let mounted = false
      const covered = new Set<string>()
      try {
        const epoch = this.authorityEpoch
        const projected = this.project(ids)
        const eligible = demandIds(projected)
        for (const id of ids) if (id.startsWith('lsp:direct/')) eligible.add(id)
        if ([...ids].some(id => !eligible.has(id))) throw new Error('extension-shared-demand-unavailable')
        const overrides = await this.overridesProvider()
        const disabledLsp = await this.lspRegistry.globalDisabledProviderIds()
        if (epoch !== this.authorityEpoch) throw new Error('extension-shared-catalog-conflict')
        const activation = projected.map(suite => {
          const row = structuredClone(suite)
          const key = suiteKey(suite)
          const base = this.globalSuites.find(candidate => suiteKey(candidate) === key)
          if (row.mcp)
            row.mcp.servers = Object.fromEntries(
              Object.entries(row.mcp.servers).filter(
                ([name]) =>
                  !(
                    base?.enabled &&
                    base.activeSurfaces.mcp &&
                    this.gates?.allows('mcp') !== false &&
                    Object.hasOwn(base.mcp?.servers ?? {}, name) &&
                    overrides.get(key)?.[name]?.enabled !== false
                  )
              )
            )
          if (row.lsp)
            row.lsp.servers = Object.fromEntries(
              Object.entries(row.lsp.servers).filter(
                ([, spec]) =>
                  !(
                    base?.enabled &&
                    base.activeSurfaces.lsp &&
                    this.gates?.allows('lsp') !== false &&
                    Object.values(base.lsp?.servers ?? {}).some(candidate => candidate.key === spec.key) &&
                    !disabledLsp.has(key + '/' + spec.key)
                  )
              )
            )
          return row
        })
        const activationIds = demandIds(activation)
        for (const id of ids) {
          if (id.startsWith('market:') || (!activationIds.has(id) && (!id.startsWith('lsp:direct/') || (!disabledLsp.has(id.slice(4)) && this.gates?.allows('lsp') !== false))))
            covered.add(id)
        }
        const needsActivation = [...ids].some(id => !covered.has(id))
        if (!token.active || this.disposed || this.staged.get(owner) !== token) throw new Error('extension-shared-not-ready')
        token.ready = true
        if (needsActivation)
          await this.enqueue(async () => {
            const current = demandIds(this.project(ids))
            if ([...ids].some(id => !id.startsWith('lsp:direct/') && !current.has(id))) throw new Error('extension-shared-demand-unavailable')
            mounted = true
            const result = await this.reconcileShared()
            if (this.disposed) throw new Error('extension-shared-not-ready')
            this.assertMounted(activation, result)
            const owned = new Set(this.lspRegistry.providerOwnership().map(row => row.resourceId))
            for (const id of ids)
              if (
                id.startsWith('lsp:direct/') &&
                (disabledLsp.has(id.slice(4)) || this.gates?.allows('lsp') === false) &&
                (!owned.has(id) ||
                  result.errors.some(row => row.surface === 'lsp') ||
                  result.lsp.some(row => row.suiteId === 'direct' && (row.serverKey === id.slice(11) || row.serverKey === id.slice(4))))
              )
                throw new Error('extension-shared-lsp-unavailable: ' + id)
          })
      } catch (error) {
        token.active = false
        this.staged.delete(owner)
        try {
          const cleanup = mounted ? await this.enqueue(() => this.reconcileShared()) : emptyDiagnostics()
          if (cleanupFailed(cleanup)) this.warn('extension shared stage rollback failed; retained mounts remain execution-gated')
        } catch (cleanupError) {
          this.warn('extension shared stage rollback failed: ' + messageOf(cleanupError))
        }
        throw error
      }
      return {
        commit: () => {
          if (!token.active || this.disposed || this.staged.get(owner) !== token) return
          const removed = [...(this.committed.get(owner) ?? [])].some(id => !token.ids.has(id) && !covered.has(id))
          token.active = false
          this.committed.set(owner, token.ids)
          this.staged.delete(owner)
          if (removed)
            void this.enqueue(() => this.reconcileShared())
              .then(result => {
                if (cleanupFailed(result)) this.warn('extension shared cleanup failed; retained mounts remain execution-gated')
              })
              .catch(error => {
                this.warn('extension shared committed cleanup failed: ' + messageOf(error))
              })
        },
        rollback: async () => {
          if (!token.active || this.staged.get(owner) !== token) return
          token.active = false
          this.staged.delete(owner)
          if (mounted) {
            const result = await this.enqueue(() => this.reconcileShared())
            if (cleanupFailed(result)) throw new Error('extension-shared-rollback-failed')
          } else if (token.ready && token.ids.size > 0) {
            void this.enqueue(() => this.reconcileShared()).catch(error => this.warn('extension shared rollback cleanup failed: ' + messageOf(error)))
          }
        }
      }
    })()
  }

  releaseSessionDemand(owner: object): Promise<void> {
    return this.enqueue(async () => {
      const token = this.staged.get(owner)
      if (token) token.active = false
      this.staged.delete(owner)
      this.committed.delete(owner)
      const result = await this.reconcileShared()
      if (cleanupFailed(result)) throw new Error('extension-shared-release-failed')
    })
  }

  private project(ids: Set<string>): Suite[] {
    return projectExtensionSuites(
      (this.authority ?? []).filter(row => row.suite.dimension === 'user'),
      captureExtensionSelection(null, [...ids])
    ).map(row => row.suite)
  }

  private async reconcileShared(): Promise<RuntimeDiagnostics> {
    const diagnostics = emptyDiagnostics()
    if (this.disposed) return diagnostics
    const epoch = this.authorityEpoch
    const ids = new Set([...this.committed.values(), ...[...this.staged.values()].filter(row => row.ready).map(row => row.ids)].flatMap(set => [...set]))
    const projected = this.project(ids)
    this.demandedMcp = new Map()
    this.demandedLsp = new Set([...ids].filter(id => id.startsWith('lsp:direct/')).map(id => id.slice(4)))
    for (const row of projected) {
      const key = suiteKey(row)
      const mcp = Object.keys(row.mcp?.servers ?? {})
      if (mcp.length) this.demandedMcp.set(key, new Set(mcp))
      for (const spec of Object.values(row.lsp?.servers ?? {})) this.demandedLsp.add(key + '/' + spec.key)
    }
    const forSurface = (face: 'mcp' | 'lsp'): Suite[] => {
      const global = this.gates?.allows(face) === false ? [] : this.globalSuites
      const rows = new Map<string, Suite>()
      for (const base of global) {
        if (!base.activeSurfaces[face]) continue
        if (this.authority === undefined || base.dimension !== 'user') {
          rows.set(suiteKey(base), structuredClone(base))
          continue
        }
        const current = this.authority.find(row => suiteKey(row.suite) === suiteKey(base))
        if (!current || current.validSurfaces[face] !== true) continue
        const row = structuredClone(current.suite)
        row.enabled = true
        row.activeSurfaces[face] = true
        if (face === 'mcp' && row.mcp) row.mcp.servers = Object.fromEntries(Object.entries(row.mcp.servers).filter(([key]) => Object.hasOwn(base.mcp?.servers ?? {}, key)))
        if (face === 'lsp' && row.lsp) {
          const keys = new Set(Object.values(base.lsp?.servers ?? {}).map(spec => spec.key))
          row.lsp.servers = Object.fromEntries(Object.entries(row.lsp.servers).filter(([, spec]) => keys.has(spec.key)))
        }
        rows.set(suiteKey(base), row)
      }
      for (const demand of projected) {
        if (!demand.activeSurfaces[face]) continue
        const key = suiteKey(demand)
        const base = rows.get(key)
        const latest = this.authority?.find(row => suiteKey(row.suite) === key)?.suite
        const merged = structuredClone(latest ?? demand)
        merged.enabled = true
        merged.activeSurfaces[face] = true
        if (face === 'mcp') merged.mcp = { ...demand.mcp!, servers: { ...(base?.mcp?.servers ?? {}), ...demand.mcp!.servers } }
        else merged.lsp = { servers: { ...(base?.lsp?.servers ?? {}), ...demand.lsp!.servers } }
        rows.set(key, merged)
      }
      return [...rows.values()]
    }
    await Promise.all([
      this.surface('mcp', diagnostics, () => this.mcp.reconcile(forSurface('mcp'))),
      this.surface('lsp', diagnostics, () => this.lspRegistry.reconcile(forSurface('lsp')))
    ])
    if (!this.disposed && epoch !== this.authorityEpoch) {
      void this.enqueue(() => this.reconcileShared()).catch(error => this.warn('extension shared catalog refresh failed: ' + messageOf(error)))
    }
    return diagnostics
  }

  private assertMounted(suites: Suite[], diagnostics: RuntimeDiagnostics): void {
    const mcpFailed = diagnostics.errors.some(row => row.surface === 'mcp')
    const lspFailed = diagnostics.errors.some(row => row.surface === 'lsp')
    const lsp = new Set(this.lspRegistry.providerOwnership().map(row => row.resourceId))
    for (const suite of suites) {
      const key = suiteKey(suite)
      // Each suite proves its own surfaces in order: the MCP half needs this
      // adapter's server-name derivation, so the adapter owns it.
      this.mcp.assertMounted(suite, diagnostics.mcp, mcpFailed)
      for (const spec of Object.values(suite.lsp?.servers ?? {})) {
        if (
          !lsp.has('lsp:' + key + '/' + spec.key) ||
          diagnostics.lsp.some(row => row.suiteId === key && (row.serverKey === spec.key || row.serverKey.split(',').includes(key + '/' + spec.key))) ||
          lspFailed
        )
          throw new Error('extension-shared-lsp-unavailable: ' + key + '/' + spec.key)
      }
    }
  }

  /** Stop receipt admission before draining shared and independently queued local work. */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    for (const token of this.staged.values()) token.active = false
    this.staged.clear()
    this.committed.clear()
    this.disposal = (async () => {
      await this.sharedQueue
      await Promise.all(this.queues.values())
      this.commands.disposeAll()
      await Promise.all([this.mcp.disposeAll(), this.hooks.disposeAll(), this.lspRegistry.disposeAll()])
      this.queues.clear()
    })()
    return this.disposal
  }
}

function cleanupFailed(result: RuntimeDiagnostics): boolean {
  return result.errors.length > 0 || [...result.mcp, ...result.lsp].some(row => row.code === 'unmount-failed')
}
function emptyDiagnostics(): RuntimeDiagnostics {
  return { mcp: [], commands: [], hooks: [], lsp: [], errors: [] }
}
function suiteKey(suite: Suite): string {
  return suite.sourceId + '/' + suite.id
}
function demandIds(suites: readonly Suite[]): Set<string> {
  const ids = new Set<string>()
  for (const suite of suites) {
    if (suite.dimension !== 'user') continue
    const key = suiteKey(suite)
    if (suite.activeSurfaces.mcp)
      for (const name of Object.keys(suite.mcp?.servers ?? {})) {
        ids.add('market:' + key)
        ids.add('mcp:plugin:' + key + '/' + name)
      }
    if (suite.activeSurfaces.lsp)
      for (const spec of Object.values(suite.lsp?.servers ?? {})) {
        ids.add('market:' + key)
        ids.add('lsp:' + key + '/' + spec.key)
      }
  }
  return ids
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
