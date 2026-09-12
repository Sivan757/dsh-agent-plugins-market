/**
 * Catalog application module: the use-case surface the HTTP routes, the host
 * entry, and the runtime mount adapters call.
 *
 * The class is a thin facade. Persisted state, the serialized mutation queue,
 * the revision and scan generations, and the change pipeline live in
 * {@link CatalogContext}; discovery caching in {@link SnapshotCache}; and each
 * use-case family in its own collaborator (source acquisition, install state,
 * MCP, LSP). The facade composes them and forwards, so a caller never has to
 * know which collaborator owns a given invariant.
 */
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { OverviewPayload, ServerConfigPayload, SkillContent, SourceOverview, SourceProgress, SuiteDetail } from '../contracts/market.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { SourceRef, Suite, SuiteSurfaceKey } from '../model/types.js'
import type { McpBackend } from '../runtime/mcp-backend.js'
import { loadUserMcpSuite } from '../runtime/mcp-direct-config.js'
import type { McpMountDiagnostic } from '../runtime/mcp-mounts.js'
import { loadSuiteOverrides, type McpServerOverride, type McpSuiteOverrides } from '../runtime/mcp-overrides.js'
import { applyLspOverrides } from '../runtime/server-config.js'
import { buildSuiteDetail, readSkillContent } from './details.js'
import { CatalogContext, type CatalogGitOptions, type CatalogOptions } from './catalog-context.js'
import { InstallStore } from './install-store.js'
import { LspService } from './lsp-service.js'
import { McpService } from './mcp-service.js'
import { resolveCatalogPorts, type CatalogPorts, type LspServerTable, type McpBackendInfo, type SourceInput, type SourcePatch } from './ports.js'
import { SnapshotCache, type CatalogSnapshot } from './snapshot-cache.js'
import { SourceStore, codeloadTarballUrl } from './source-store.js'
import type { MarketService } from './queries.js'

export class Catalog implements MarketService {
  private readonly context: CatalogContext
  private readonly ports: CatalogPorts
  private readonly snapshots: SnapshotCache
  private readonly sourceStore: SourceStore
  private readonly installs: InstallStore
  private readonly mcp: McpService
  private readonly lsp: LspService

  constructor(options: CatalogOptions) {
    this.context = new CatalogContext(options)
    this.ports = resolveCatalogPorts(options.ports)
    this.snapshots = this.context.snapshots
    this.sourceStore = new SourceStore(this.context, this.ports)
    this.installs = new InstallStore(this.context, this.sourceStore)
    this.mcp = new McpService(this.context, this.ports, this.sourceStore)
    this.lsp = new LspService(this.context, this.ports)
  }

  /** Latest MCP mount diagnostics (suiteId -> reasons), fed by host reconcile. */
  get mcpDiagnostics(): McpMountDiagnostic[] {
    return this.mcp.diagnostics
  }

  set mcpDiagnostics(value: McpMountDiagnostic[]) {
    this.mcp.diagnostics = value
  }

  /** The user-dimension suite root this catalog operates. */
  get userRoot(): string {
    return this.context.userRoot
  }

  get sources(): SourceRef[] {
    return this.context.state.sources
  }

  /** Whether one suite currently carries an install entry. */
  isInstalled(sourceId: string, suiteId: string): boolean {
    return this.context.installed(sourceId, suiteId) !== undefined
  }

  /** Apply the host's project-layout switch and invalidate every project snapshot. */
  async setScanProjectLayouts(enabled: boolean): Promise<void> {
    await this.context.setScanProjectLayouts(enabled)
  }

  /** Load persisted user state once at plugin activation. */
  async load(): Promise<void> {
    await this.context.load()
  }

  /** Append config-seeded sources missing from user state and persist them. */
  async mergeSources(sources: SourceRef[]): Promise<void> {
    await this.installs.mergeSources(sources)
  }

  /**
   * Panel changed hook: the HTTP layer notifies after a user-panel mutation
   * (skills / commands / agent personas). Catalog state is untouched — this
   * only runs the change pipeline so the runtime remounts commands and the
   * skill providers re-read their catalogs.
   */
  async notifyPanelsChanged(): Promise<void> {
    await this.context.notifyChanged()
  }

  /** Read one coherent user-dimension snapshot, reusing in-flight discovery. */
  async readUserCatalog(): Promise<CatalogSnapshot> {
    return this.snapshots.readUserCatalog()
  }

  /** Read one coherent project-dimension snapshot for a workspace cwd. */
  async readProjectCatalog(cwd: string): Promise<CatalogSnapshot> {
    return this.snapshots.readProjectCatalog(cwd)
  }

  /** Runtime discovery scans only sources containing an enabled install. No acquisition or network access. */
  async enabledUserSuites(): Promise<Suite[]> {
    const state = this.context.state
    const enabledSources = new Set(
      Object.entries(state.installed)
        .filter(([, entry]) => entry.enabled)
        .map(([key]) => key.slice(0, key.indexOf('/')))
    )
    const sources = state.sources.filter(source => enabledSources.has(source.id))
    const suites = sources.length === 0 ? [] : (await this.snapshots.build({ ...state, sources }, 'user', this.context.userRoot)).enabledSuites
    const direct = await loadUserMcpSuite(this.context.dataRoot)
    return applyLspOverrides(this.context.dataRoot, Object.keys(direct.mcp!.servers).length === 0 ? suites : [...suites, direct])
  }

  /** The full market overview from one user snapshot. */
  async overview(): Promise<OverviewPayload> {
    const snapshot = await this.readUserCatalog()
    const sourceRows: SourceOverview[] = await this.sourceStore.overviewRows(snapshot)
    const cards = snapshot.suites.map(suite => {
      const isInstalled = this.isInstalled(suite.sourceId, suite.id)
      return {
        sourceId: suite.sourceId,
        suiteId: suite.id,
        name: suite.manifest.name,
        version: suite.manifest.version,
        description: suite.manifest.description,
        keywords: suite.manifest.keywords ?? [],
        surfaces: suite.surfaces,
        enabled: suite.enabled,
        installed: isInstalled,
        ...(isInstalled ? { surfaceToggles: suite.activeSurfaces } : {}),
        ...(suite.remote === undefined ? {} : { remoteUrl: suite.remote.url }),
        dimension: suite.dimension,
        layout: suite.manifest.layout,
        errors: suite.errors,
        mcpErrors: this.mcp.diagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`)
      }
    })
    return {
      sources: sourceRows,
      suites: cards,
      totals: {
        all: cards.length,
        installed: cards.filter(card => card.installed).length,
        enabled: cards.filter(card => card.enabled).length
      },
      roots: { user: this.context.userRoot, data: this.context.dataRoot },
      unmanaged: await this.sourceStore.unmanaged()
    }
  }

  /** One suite's full detail for the market detail modal. */
  async suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    return buildSuiteDetail(suite, this.context.installed(sourceId, suiteId), this.mcp.diagnostics, await loadSuiteOverrides(this.context.dataRoot, suiteKey))
  }

  /** One skill's full SKILL.md text for the market detail modal. */
  async skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return readSkillContent(suite, skillName)
  }

  // ---- Source acquisition and CRUD ----

  /** Add a source and acquire it immediately (clone, download, or in-place). */
  async addSource(input: SourceInput): Promise<SourceRef> {
    return this.sourceStore.add(input)
  }

  /** Register one unmanaged `.sources/` checkout as a source without touching its files. */
  async adoptSource(id: string): Promise<SourceRef> {
    return this.sourceStore.adopt(id)
  }

  /** Unmanaged `.sources/` checkouts: present on disk, absent from state. */
  async unmanagedSources(): Promise<Array<{ id: string; url?: string }>> {
    return this.sourceStore.unmanaged()
  }

  /** Update one source's URL, branch, kind, or archive digest. */
  async updateSource(sourceId: string, patch: SourcePatch): Promise<void> {
    await this.sourceStore.update(sourceId, patch)
  }

  /** Remove a source and its install entries; `deleteCheckout` also deletes the managed checkout. */
  async removeSource(sourceId: string, deleteCheckout = false): Promise<void> {
    await this.sourceStore.remove(sourceId, deleteCheckout)
  }

  /** Refresh one source checkout, or every source when sourceId is omitted. */
  async refreshSource(sourceId?: string): Promise<void> {
    await this.sourceStore.refresh(sourceId)
  }

  /** Progress snapshot for the progress route. */
  sourceProgress(): SourceProgress {
    return this.sourceStore.progress()
  }

  /** Begin reporting progress for a source mutation. */
  beginSourceState(sourceId: string, step: string, cloned: boolean): void {
    this.sourceStore.beginSourceState(sourceId, step, cloned)
  }

  /** Advance the in-flight source mutation step. */
  updateSourceStep(step: string): void {
    this.sourceStore.updateSourceStep(step)
  }

  /** Stop reporting source mutation progress. */
  endSourceState(): void {
    this.sourceStore.endSourceState()
  }

  // ---- Install state ----

  /** Install a suite from a source and enable it. */
  async install(sourceId: string, suiteId: string): Promise<void> {
    await this.installs.install(sourceId, suiteId)
  }

  /** Uninstall a suite while retaining the source checkout. */
  async uninstall(sourceId: string, suiteId: string): Promise<void> {
    await this.installs.uninstall(sourceId, suiteId)
  }

  /** Enable or disable an installed suite. */
  async setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void> {
    await this.installs.setEnabled(sourceId, suiteId, enabled)
  }

  /** Enable or disable one runtime surface of an installed suite. */
  async setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void> {
    await this.installs.setSurface(sourceId, suiteId, surface, enabled)
  }

  // ---- MCP ----

  /** Build the flat MCP service inventory for the status surface. */
  async mcpStatus(): Promise<McpStatusPayload> {
    return this.mcp.status()
  }

  /** Persist a user-owned MCP service and reconcile its bridge mount. */
  async addMcpServer(name: string, server: unknown): Promise<void> {
    await this.mcp.addServer(name, server)
  }

  /** Read effective service configuration without exposing credential literals. */
  async serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
    return this.mcp.serverConfig(kind, id)
  }

  /** Validate a complete replacement before writing; plugin checkouts remain untouched. */
  async saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: unknown): Promise<void> {
    await this.mcp.saveServerConfig(kind, id, config)
  }

  /** One suite's persisted MCP overrides, addressed by qualified suite id. */
  async mcpOverrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides> {
    return this.mcp.overrides(sourceId, suiteId)
  }

  /** Set or clear one server's MCP override and remount it. */
  async setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void> {
    await this.mcp.setOverride(sourceId, suiteId, serverKey, override)
  }

  /** Re-run the MCP reconcile pass without changing any catalog state. */
  async retryMounts(): Promise<void> {
    await this.mcp.retryMounts()
  }

  /** The persisted MCP backend choice without the host-client probe. */
  async mcpBackend(): Promise<McpBackend> {
    return this.mcp.backend()
  }

  /**
   * The active MCP mount backend plus a live probe of the host client, and
   * the download-region setting with its locale-resolved effective route.
   */
  async mcpBackendInfo(): Promise<McpBackendInfo> {
    return this.mcp.backendInfo()
  }

  /** Switch the MCP mount backend and remount every suite server through it. */
  async setMcpBackend(backend: McpBackend): Promise<void> {
    await this.mcp.setBackend(backend)
  }

  /**
   * Drop one MCP server's OAuth grant record so the next mount re-runs the
   * browser authorization.
   * @throws when the credentials service is not mounted.
   */
  async reauthorizeMcpServer(serverName: string): Promise<void> {
    await this.mcp.reauthorize(serverName)
  }

  /** Whether the re-authorize action can run in this composition. */
  mcpReauthorizeAvailable(): boolean {
    return this.mcp.reauthorizeAvailable()
  }

  /** MCP overrides for a supplied runtime selection, or the full market catalog when omitted. */
  async allMcpOverrides(suites?: readonly Suite[]): Promise<Map<string, McpSuiteOverrides>> {
    return this.mcp.allOverrides(suites)
  }

  // ---- LSP ----

  /** The LSP status surface: declared servers merged with mount diagnostics. */
  async lspStatus(): Promise<LspStatusPayload> {
    return this.lsp.status()
  }

  /** The user's direct LSP server table (normalized specs). */
  async lspServers(): Promise<LspServerTable> {
    return this.lsp.servers()
  }

  /** Create one direct LSP declaration without replacing other user servers. */
  async addLspServer(name: string, config: unknown): Promise<void> {
    await this.lsp.addServer(name, config)
  }

  /** Validate and persist the user's direct LSP server table. */
  async setLspServers(raw: unknown): Promise<LspServerTable> {
    return this.lsp.setServers(raw)
  }

  /** Enable or disable one declared language server by row id. */
  async setLspServerEnabled(id: string, enabled: boolean): Promise<void> {
    await this.lsp.setEnabled(id, enabled)
  }
}

export type { CatalogGitOptions, CatalogOptions }
export type { CatalogSnapshot }
export { codeloadTarballUrl }
