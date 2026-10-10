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
import { qualifiedSuiteId } from '../../../market-catalog/src/index.js'

import type { LspLegacySeamMigration, LspStatusPayload } from '../../../market-contracts/src/contracts/lsp-status.js'
import type {
  MenuRowFaceWire,
  OverviewPayload,
  ServerConfigPayload,
  SourceOverview,
  SourceProgress,
  SuiteDetail,
  SuiteDocumentText,
  UserPanelKind
} from '../../../market-contracts/src/contracts/market.js'
import type { McpStatusPayload } from '../../../market-mcp/src/index.js'
import type { SourceRef, Suite, SuiteSurfaceKey } from '../../../market-contracts/src/model/types.js'
import type { McpBackend } from '../../../market-contracts/src/contracts/mcp.js'
import { loadUserMcpSuite } from '../../../market-mcp/src/index.js'
import type { McpMountDiagnostic } from '../../../market-contracts/src/contracts/mcp.js'
import { type McpServerOverride, type McpSuiteOverrides } from '../../../market-mcp/src/index.js'
import { loadUserHooksSuite } from '../../../market-runtime/src/index.js'
import { applyLspOverrides } from '../../../market-lsp/src/index.js'
import { SuiteQueries } from './suite-queries.js'
import { CatalogContext, type CatalogGitOptions, type CatalogOptions } from '../../../market-catalog/src/index.js'
import { TranslationService } from '../../../market-translation/src/index.js'
import type { DocumentTranslation, TranslationFields, TranslationSurfaceKind } from '../../../market-contracts/src/contracts/translation.js'
import { InstallStore } from '../../../market-catalog/src/index.js'
import { LspService } from '../../../market-lsp/src/index.js'
import { McpService } from '../../../market-mcp/src/index.js'
import {
  resolveCatalogPorts,
  type CatalogPorts,
  type LocalizeFields,
  type LspServerTable,
  type McpBackendInfo,
  type SourceInput,
  type SourcePatch
} from '../../../market-contracts/src/ports/ports.js'
import { SnapshotCache, type CatalogSnapshot } from '../../../market-catalog/src/index.js'
import { SourceStore, codeloadTarballUrl } from '../../../market-catalog/src/index.js'
import type { MarketService } from '../../../market-contracts/src/ports/queries.js'
import { readExtensionSuiteDeclarations } from '../../../market-runtime/src/index.js'
import type { ExtensionSuiteCandidate } from '../../../market-runtime/src/index.js'

export class Catalog implements MarketService {
  private readonly context: CatalogContext
  private readonly ports: CatalogPorts
  private readonly snapshots: SnapshotCache
  private readonly sourceStore: SourceStore
  private readonly installs: InstallStore
  private readonly mcp: McpService
  private readonly lsp: LspService
  private readonly translation: TranslationService
  private readonly suiteQueries: SuiteQueries

  constructor(options: CatalogOptions) {
    this.context = new CatalogContext(options)
    this.ports = resolveCatalogPorts(options.ports)
    this.snapshots = this.context.snapshots
    this.sourceStore = new SourceStore(this.context, this.ports)
    this.installs = new InstallStore(this.context, this.sourceStore)
    // The status builders resolve translations through this callback rather
    // than reaching into the service, so the panel surfaces stay independent
    // of how the catalog stores them.
    const localizeFields: LocalizeFields = (surface, id, fields, locale) => this.translateFields(surface, id, fields, locale)
    this.mcp = new McpService(this.context, this.ports, this.sourceStore, localizeFields)
    this.lsp = new LspService(this.context, this.ports, localizeFields)
    this.translation = new TranslationService({
      dataRoot: this.context.dataRoot,
      providers: this.ports.translationProviders ?? [],
      ...(this.ports.translationEnabled === undefined ? {} : { enabled: this.ports.translationEnabled }),
      providerIdentity: this.ports.translationProviderIdentity ?? (() => 'none')
    })
    // Every dependency is a closure over this instance, so a caller that replaces
    // one of these methods still decides what the query sees.
    this.suiteQueries = new SuiteQueries({
      readUserCatalog: () => this.readUserCatalog(),
      readProjectCatalog: cwd => this.readProjectCatalog(cwd),
      installed: (sourceId, suiteId) => this.context.installed(sourceId, suiteId),
      dataRoot: () => this.context.dataRoot,
      mcpDiagnostics: () => this.mcp.diagnostics,
      localePreference: () => this.ports.localePreference(),
      translateFields: (surface, id, fields, locale) => this.translateFields(surface, id, fields, locale),
      translateDocument: (surface, id, text, locale, retry) => this.translateDocument(surface, id, text, locale, retry)
    })
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

  /** The plugin storage root holding per-suite `${PLUGIN_DATA}` directories and overrides. */
  get dataRoot(): string {
    return this.context.dataRoot
  }

  /** The shared Agent layout root the direct user declarations (hooks, MCP) are read from. */
  get agentsRoot(): string {
    return this.context.agentsRoot
  }

  /**
   * The host locale preference the panels render in.
   *
   * A read that walks many rows resolves it once and passes the value to every
   * {@link translateFields} call: the host answers the preference by projecting
   * every profile entry's live configuration, so reading it per row made a
   * panel's latency scale with its row count instead of its work.
   */
  get localePreference(): string {
    return this.ports.localePreference()
  }

  /**
   * The clock this catalog's caches age against.
   *
   * The panel row cache is derived from the same files the snapshot cache
   * walks, so it measures its maximum age on the same timeline: a test that
   * drives the catalog's injected clock drives both, and a deployment gets the
   * one process clock.
   */
  now(): number {
    return this.context.now()
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
    // Cached translations load alongside the catalog so the first overview
    // answers from cache instead of re-asking a provider.
    await this.translation.load()
  }

  /** Release the localizer's and the snapshot cache's timers; in-flight work still persists. */
  dispose(): void {
    this.translation.dispose()
    this.snapshots.dispose()
  }

  /**
   * Drop every cached translation, in memory and on disk.
   *
   * Translation is lazy, so this is the whole of the reset: nothing is queued
   * here, and the next panel read repopulates the cache from scratch. The
   * in-memory copy is emptied too, or the same process would keep serving text
   * the file no longer holds.
   * @returns fulfillment once the cache is empty.
   */
  async clearTranslations(): Promise<void> {
    await this.translation.clear()
  }

  /** Apply the current display preference to pending translation work. */
  syncTranslationEnabled(): void {
    this.translation.onEnabledChanged()
  }

  /**
   * Wait for queued translations to finish.
   *
   * Nothing on the request path calls this — the panel renders upstream text
   * and re-reads. It exists so a test can observe the settled state instead of
   * polling.
   * @param deadlineMs - maximum wait; omitted waits for the queue alone.
   * @returns whether the queue drained before the deadline.
   */
  async settleDescriptions(deadlineMs?: number): Promise<boolean> {
    return this.translation.settle(deadlineMs)
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

  /**
   * Wait for the derived refresh triggered by the latest change, bounded so a
   * stuck mount reports back instead of holding an explicit retry open.
   */
  async refreshSettled(deadlineMs?: number): Promise<boolean> {
    return this.context.refreshSettled(deadlineMs)
  }

  /** Read one coherent user-dimension snapshot, reusing in-flight discovery. */
  async readUserCatalog(): Promise<CatalogSnapshot> {
    return this.snapshots.readUserCatalog()
  }

  /** Installed local user declarations, including globally disabled suites; never changes global runtime discovery. */
  async installedSuiteDeclarations(): Promise<ExtensionSuiteCandidate[]> {
    const snapshot = await this.readUserCatalog()
    return readExtensionSuiteDeclarations(snapshot.suites.filter(suite => this.context.installed(suite.sourceId, suite.id) !== undefined))
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
    // The user's own Agent layout declarations ride the same mount registries
    // as an installed suite: each direct suite joins the list only when it
    // declares the content its surface count reports, so an absent or empty
    // file costs no mount pass.
    const mcp = await loadUserMcpSuite(this.context.agentsRoot)
    const hooks = await loadUserHooksSuite(this.context.agentsRoot)
    const direct = [...(Object.keys(mcp.mcp.servers).length === 0 ? [] : [mcp]), ...(hooks.surfaces.hooks === 0 ? [] : [hooks])]
    return applyLspOverrides(this.context.dataRoot, direct.length === 0 ? suites : [...suites, ...direct])
  }

  /**
   * The full market overview from one user snapshot.
   *
   * The description is localized on the way out: a suite whose text is already
   * Chinese (or already bilingual) is served as authored, and every other
   * description is translated in the background. The read itself never waits on
   * a provider call — a suite with no cached translation carries its original
   * text plus a translated field only once one lands, and the panel re-reads
   * while anything reports itself pending.
   */
  async overview(): Promise<OverviewPayload> {
    const snapshot = await this.readUserCatalog()
    const sourceRows: SourceOverview[] = await this.sourceStore.overviewRows(snapshot)
    const locale = this.ports.localePreference()
    let translationPending = 0
    const cards = snapshot.suites.map(suite => {
      const isInstalled = this.isInstalled(suite.sourceId, suite.id)
      const localized = this.translateFields('market', qualifiedSuiteId(suite.sourceId, suite.id), { name: suite.manifest.name, description: suite.manifest.description }, locale)
      translationPending += localized.pending
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
        mcpErrors: this.mcp.diagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`),
        ...localized.fields
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
      unmanaged: await this.sourceStore.unmanaged(),
      ...(translationPending === 0 ? {} : { translationPending })
    }
  }

  /** One entity's translated description, pending count included. {@link TranslationService.translateFields} owns the rule. */
  translateFields(
    surface: TranslationSurfaceKind,
    id: string,
    fields: { name?: string | undefined; description?: string | undefined },
    locale: string
  ): { fields: TranslationFields; pending: number } {
    return this.translation.translateFields(surface, id, fields, locale)
  }

  /** One authored text translated chunk by chunk. {@link TranslationService.translateDocument} owns the rule for bodies. */
  translateDocument(surface: TranslationSurfaceKind, id: string, text: string, locale: string, retry = false): DocumentTranslation {
    return this.translation.translateDocument(surface, id, text, locale, retry)
  }

  /**
   * The localized face of every `/` menu row this plugin owns.
   *
   * The rows come from the runtime registries (through
   * {@link CatalogPorts.menuRowIdentities}) because only they know the call name
   * a command actually got; the text comes from the shared translation service,
   * because the panel reads it through the same translation cache. Resolution
   * is a cache read and never a provider call: a row whose text is not cached
   * yet answers without a face, and the panel read that follows queues it.
   *
   * A field is emitted only when the translation differs from the authored
   * text. The menu shows the call name beside the label, so a name that
   * translated to itself would only duplicate the alias.
   * @returns one wire row per owned menu row, without rows carrying no translation.
   */
  async menuRowFaces(): Promise<MenuRowFaceWire[]> {
    // No chain, no translations: every cache key is folded with the chain's
    // identity, so a deployment with no provider has nothing cached to serve.
    // Skipping it also skips the panel reads behind the rows, which walk every
    // suite's resources.
    if ((this.ports.translationProviders ?? []).length === 0) return []
    // The switch mirrors the client's: while it is off the `/` menu is not
    // wrapped at all and renders the host's own rows, so walking the panels for
    // faces nothing would display only spends the reads. The panels themselves
    // still render what is already cached — the switch gates new work there.
    if (this.ports.translationEnabled?.() === false) return []
    // One preference read for the whole menu: the host answers it by projecting
    // every profile entry's live configuration, so resolving it per row made
    // opening the menu scale with the row count.
    const locale = this.ports.localePreference()
    const faces: MenuRowFaceWire[] = []
    for (const row of await this.ports.menuRowIdentities()) {
      const { fields } = this.translateFields(row.source, row.id, { description: row.authoredDescription }, locale)
      const description = row.authoredDescription === undefined || fields.translatedDescription === row.authoredDescription ? undefined : fields.translatedDescription
      if (description === undefined) continue
      faces.push({ source: row.source, name: row.name, description })
    }
    return faces
  }

  /** One suite's full detail. {@link SuiteQueries.suiteDetail} owns the composition. */
  async suiteDetail(sourceId: string, suiteId: string, projectCwd?: string): Promise<SuiteDetail> {
    return this.suiteQueries.suiteDetail(sourceId, suiteId, projectCwd)
  }

  /** One suite document's authored text. {@link SuiteQueries.suiteDocument} owns the read. */
  async suiteDocument(sourceId: string, suiteId: string, kind: UserPanelKind, name: string, projectCwd?: string): Promise<SuiteDocumentText> {
    return this.suiteQueries.suiteDocument(sourceId, suiteId, kind, name, projectCwd)
  }

  /** One suite document's translation. {@link SuiteQueries.suiteDocumentTranslation} owns the keying. */
  async suiteDocumentTranslation(sourceId: string, suiteId: string, kind: UserPanelKind, name: string, retry = false, projectCwd?: string): Promise<DocumentTranslation> {
    return this.suiteQueries.suiteDocumentTranslation(sourceId, suiteId, kind, name, projectCwd, retry)
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
    // No warm-up here: a refresh runs from the background updater too, and
    // translating then would make the layer eager again. The next panel read
    // discovers the new text and queues it.
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

  /** Validate and persist a user-owned MCP service with optional policy before reconciling its mount. */
  async addMcpServer(name: string, server: unknown, policy?: unknown): Promise<void> {
    await this.mcp.addServer(name, server, policy)
  }

  /**
   * Read a service without credential literals, or an unsaved template when
   * `create` is true. The two transports have separate owners, so this facade
   * only routes the request to the module that owns the declaration.
   */
  async serverConfig(kind: 'mcp' | 'lsp', id: string, create = false): Promise<ServerConfigPayload> {
    return kind === 'mcp' ? this.mcp.serverConfig(id, create) : this.lsp.serverConfig(id, create)
  }

  /**
   * Validate a complete replacement before writing; plugin checkouts remain
   * untouched. The MCP half also carries the editing policy, which the LSP
   * document has no seat for.
   */
  async saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: unknown, policy?: unknown): Promise<void> {
    if (kind === 'mcp') await this.mcp.saveServerConfig(id, config, policy)
    else await this.lsp.saveServerConfig(id, config)
  }

  /** One suite's persisted MCP overrides, addressed by qualified suite id. */
  async mcpOverrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides> {
    return this.mcp.overrides(sourceId, suiteId)
  }

  /** Set or clear one server's MCP override and remount it. */
  async setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void> {
    await this.mcp.setOverride(sourceId, suiteId, serverKey, override)
  }

  /**
   * Enable or disable one declared MCP server, addressed by the same
   * source-qualified suite id its status row carries. Disabling writes an
   * override rather than editing the suite's `mcp.json`, so a refresh cannot
   * clobber the user's choice.
   */
  async setMcpServerEnabled(suiteKey: string, serverKey: string, enabled: boolean): Promise<void> {
    await this.mcp.setServerEnabled(suiteKey, serverKey, enabled)
  }

  /**
   * Allow or deny one tool of a declared MCP server, addressed by the same
   * source-qualified suite id its status row carries. The denial lands in the
   * override record, so the suite's own `mcp.json` stays source-owned.
   */
  async setMcpServerToolEnabled(suiteKey: string, serverKey: string, tool: string, enabled: boolean): Promise<void> {
    await this.mcp.setServerToolEnabled(suiteKey, serverKey, tool, enabled)
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

  /**
   * Remove one profile's legacy LSP layer — the hand-written
   * `cordis.patch.yml` rows an older release told users to add, which now
   * register a seam this plugin owns.
   */
  async migrateLegacyLspSeam(profile: string): Promise<LspLegacySeamMigration> {
    return this.lsp.migrateLegacySeam(profile)
  }
}

export type { CatalogGitOptions, CatalogOptions }
export type { CatalogSnapshot }
export { codeloadTarballUrl }
