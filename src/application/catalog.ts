/**
 * Catalog application module: the host-authoritative owner of source state,
 * discovery, install mutations, and coherent suite snapshots.
 *
 * The module deliberately keeps the existing filesystem and Git operations
 * behind one interface while callers migrate from SuiteManager. User and
 * project snapshots use their own persisted state files and share the same
 * source-selection and suite-scanning rules.
 */
import { mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { repoName } from '../catalog/manifests.js'
import { canonicalGitUrl } from '../catalog/scan-resolvers.js'
import { discoverSourceListWithNotes } from '../catalog/source-catalog.js'
import { discoverSuitesInSource } from '../catalog/suite-scanner.js'
import { archiveInstall } from '../catalog/archive.js'
import { gitClone, gitCurrentBranch, gitHead, gitRemoteUrl, gitRemove, gitSync, type GitOptions } from '../catalog/git.js'
import { buildMcpStatus, type McpToolSnapshot } from '../runtime/mcp-status.js'
import type { McpMountDiagnostic } from '../runtime/mcp-mounts.js'
import { buildLspStatus, type LspMountStatusSource } from '../runtime/lsp-status.js'
import { loadLspServers, saveLspServers } from '../runtime/lsp-direct-config.js'
import { loadSuiteOverrides, mergeOverridePatch, saveSuiteOverrides, type McpServerOverride, type McpSuiteOverrides } from '../runtime/mcp-overrides.js'
import { probeHostMcpClient, type HostMcpClientProbe, type McpBackend } from '../runtime/mcp-backend.js'
import { githubCloneUrl, resolveRegion, type DownloadRegionSetting, type EffectiveRegion } from '../runtime/regions.js'
import { readLocalePreference } from '../runtime/host-locale.js'
import { redactMcpOverrides } from '../runtime/mcp-redaction.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { OverviewPayload, SkillContent, SourceOverview, SuiteDetail } from '../contracts/market.js'
import { buildSuiteDetail, readSkillContent } from './details.js'
import {
  deriveSourceIdCandidates,
  expandHome,
  isDirectory,
  pathExists,
  qualifiedSuiteId,
  resolveProjectRoot,
  sanitizeId,
  sourceCheckoutDir,
  sourcesDir,
  STATE_FILE_NAME
} from '../catalog/paths.js'
import { loadState, saveState, EMPTY_STATE } from '../model/state.js'
import {
  effectiveSurfaces,
  SUITE_SURFACE_KEYS,
  type InstalledEntry,
  type SourceKind,
  type SourceRef,
  type Suite,
  type SuiteDimension,
  type SuiteState,
  type SuiteSurfaceKey,
  type SurfaceOverrides,
  resolveSourceKind
} from '../model/types.js'

/**
 * Git network tuning, plumbed from the host config to every remote-touching
 * invocation (proxy, `insteadOf` mirrors, timeout, retry). `fallbackTarball`
 * additionally lets a failed GitHub clone fall back to a codeload tarball
 * download through the archive pipeline.
 */
export interface CatalogGitOptions extends GitOptions {
  /** Retry a failed GitHub clone as a codeload tarball download; default false. */
  fallbackTarball?: boolean
  /** Allow plain-http archive downloads (intranet mirrors); default false. */
  allowHttpArchives?: boolean
}

/** Dependencies and host callback used by the catalog application module. */
export interface CatalogOptions {
  userRoot: string
  dataRoot: string
  onChanged: () => void | Promise<void>
  /** Git/archive acquisition tuning. */
  git?: CatalogGitOptions
  /**
   * Freshness window for cached project-dimension snapshots. The project
   * catalog sits on the skill-list hot path (every provider `list()` call),
   * and its inputs — the project's own files — change only through editor
   * saves; a short window keeps listing cheap without going stale. Defaults
   * to 5 seconds; 0 disables caching.
   */
  projectSnapshotTtlMs?: number
}

/** A coherent discovered-and-installed view for one catalog dimension. */
export interface CatalogSnapshot {
  revision: number
  sources: SourceRef[]
  suites: Suite[]
  enabledSuites: Suite[]
  /** Per-source scan diagnostics (sourceId → notes), absent when clean. */
  scanNotes?: Record<string, string[]>
}

export class Catalog {
  private state: SuiteState = EMPTY_STATE
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly statePath: string
  private readonly headCache = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private userSnapshot: CatalogSnapshot | undefined
  private userSnapshotExpiresAt = 0
  private userSnapshotPromise: Promise<CatalogSnapshot> | undefined
  /**
   * Discovery scan cache: per-sources-fingerprint scan results with a TTL.
   * Install / enable / surface toggles re-derive the snapshot from cached
   * discovery (cheap mapping) instead of re-walking every checkout — a full
   * rescan of a 2,500-suite catalog costs ~1s and UI mutations happen in
   * bursts. Content-changing mutations (add / update / remove / adopt /
   * refresh / acquire) set {@link scanCacheDirty}, which bypasses the cache
   * until the next scan; the TTL bounds staleness for in-place working-tree
   * edits of local sources.
   */
  private readonly scanCache = new Map<string, { at: number; discovered: Suite[]; scanNotes: Record<string, string[]> }>()
  private scanCacheDirty = true
  private static readonly SCAN_CACHE_TTL_MS = 30_000
  private static readonly SCAN_CACHE_MAX_ENTRIES = 8
  /**
   * User-dimension snapshot TTL: bounded staleness for edits made outside the
   * plugin (a new skill dropped into a local source's working tree, a hand
   * edit in a project layout) becomes visible on the next read past the TTL
   * instead of living until the next mutation. It bounds the *snapshot*
   * freshness; the scan cache TTL below bounds the reuse of a full scan, so
   * this must stay at or below the scan TTL to actually force a rescan.
   */
  private static readonly USER_SNAPSHOT_TTL_MS = Catalog.SCAN_CACHE_TTL_MS
  /** Project-dimension snapshots keyed by project root, with TTL freshness. */
  private readonly projectSnapshots = new Map<string, { snapshot: CatalogSnapshot; expiresAt: number }>()
  private readonly projectSnapshotPromises = new Map<string, Promise<CatalogSnapshot>>()
  private readonly projectSnapshotTtlMs: number
  /** Latest MCP mount diagnostics (suiteId -> reasons), fed by host reconcile. */
  mcpDiagnostics: McpMountDiagnostic[] = []
  /** Latest LSP mount diagnostics source, wired by the host entry. */
  private lspStatusSource: LspMountStatusSource | undefined
  /** Credential-store seam for dropping a grant record (MCP re-authorize). */
  private credentialsStore: { deleteGrantRecord(serverName: string): Promise<void> } | undefined
  private toolSnapshotProvider: () => readonly McpToolSnapshot[] = () => []
  /** Backend source (the host settings namespace scope); default is the built-in client. */
  private mcpBackendProvider: () => Promise<McpBackend> = async () => 'builtin'
  /** Backend writer (a scope update); absent until the settings service resolves. */
  private mcpBackendWriter: (backend: McpBackend) => Promise<void> = async () => {
    throw new Error('the settings service is not mounted')
  }
  /** Download-region source (the host settings namespace scope). */
  private downloadRegionProvider: () => Promise<DownloadRegionSetting> = async () => 'auto'

  constructor(private readonly options: CatalogOptions) {
    this.statePath = join(options.userRoot, STATE_FILE_NAME)
    this.projectSnapshotTtlMs = options.projectSnapshotTtlMs ?? 5_000
  }

  /** Install the host tool snapshot provider used by the MCP status surface. */
  setMcpToolSnapshotProvider(provider: () => readonly McpToolSnapshot[]): void {
    this.toolSnapshotProvider = provider
  }

  /** Install the credential-store seam backing the MCP re-authorize action. */
  setCredentialsStore(store: { deleteGrantRecord(serverName: string): Promise<void> }): void {
    this.credentialsStore = store
  }

  /**
   * Drop one MCP server's OAuth grant record so the next mount re-runs the
   * browser authorization — the path for "I picked too narrow a scope".
   * @param suiteId - the owning suite.
   * @param serverKey - the suite's server key.
   * @param serverName - the derived `dsh-mcp-client` serverName whose folded form keys the record.
   * @throws when the credentials service is not mounted.
   */
  async reauthorizeMcpServer(serverName: string): Promise<void> {
    await this.enqueue(async () => {
      await this.credentialsStore?.deleteGrantRecord(serverName)
      await this.notifyChanged(true)
    })
  }

  /** Whether the re-authorize action can run in this composition. */
  mcpReauthorizeAvailable(): boolean {
    return this.credentialsStore !== undefined
  }

  /** Install the LSP mount status source used by the LSP status surface. */
  setLspStatusSource(source: LspMountStatusSource): void {
    this.lspStatusSource = source
  }

  /** Subscribe to completed catalog mutations; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Build the flat MCP service inventory for the status surface. */
  async mcpStatus(): Promise<McpStatusPayload> {
    const snapshot = await this.readUserCatalog()
    return buildMcpStatus(snapshot.suites, this.mcpDiagnostics, this.toolSnapshotProvider(), await this.allMcpOverrides())
  }

  /** The LSP status surface: declared servers merged with mount diagnostics. */
  async lspStatus(): Promise<LspStatusPayload> {
    const snapshot = await this.readUserCatalog()
    const direct = await loadLspServers(this.options.dataRoot)
    return buildLspStatus(snapshot.suites, this.lspStatusSource ?? { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => false }, direct)
  }

  /** The user's direct LSP server table (normalized specs). */
  async lspServers(): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return (await loadLspServers(this.options.dataRoot)).servers
  }

  /** Validate and persist the user's direct LSP server table. */
  async setLspServers(raw: unknown): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return this.enqueue(async () => {
      const { servers } = await saveLspServers(this.options.dataRoot, raw)
      await this.notifyChanged(true)
      return servers
    })
  }

  /** One suite's persisted MCP overrides. */
  async mcpOverrides(suiteId: string): Promise<McpSuiteOverrides> {
    const snapshot = await this.readUserCatalog()
    if (!snapshot.suites.some(suite => suite.id === suiteId)) throw new Error(`suite "${suiteId}" not found`)
    return redactMcpOverrides(await loadSuiteOverrides(this.options.dataRoot, suiteId))
  }

  /**
   * Set or clear one server's MCP override and remount it. `override === null`
   * clears the override (back to the source config). The serverKey must exist
   * in the suite's parsed mcp.json.
   */
  async setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
      const checkout = this.sourceCheckoutPath(source)
      if (!(await isDirectory(checkout))) await this.acquire(source)
      const suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.mcp?.servers[serverKey] === undefined) throw new Error(`server "${serverKey}" is not defined by suite "${suiteId}"`)
      const overrides = await loadSuiteOverrides(this.options.dataRoot, suiteId)
      if (override === null) {
        delete overrides[serverKey]
      } else {
        // Merge onto the stored record: the UI never receives literal secret
        // values, so a verbatim write would drop keys it simply redacted.
        overrides[serverKey] = mergeOverridePatch(overrides[serverKey] ?? {}, override)
      }
      await saveSuiteOverrides(this.options.dataRoot, suiteId, overrides)
      await this.notifyChanged(true)
    })
  }

  /**
   * Re-run the MCP reconcile pass: retries failed mounts and clears residual
   * tools, without changing any catalog state.
   */
  async retryMounts(): Promise<void> {
    await this.notifyChanged(true)
  }

  /** The persisted backend choice without the host-client probe (mount-time provider). */
  async mcpBackend(): Promise<McpBackend> {
    return this.mcpBackendProvider()
  }

  /**
   * The active MCP mount backend plus a live probe of the host client, and
   * the download-region setting with its locale-resolved effective route —
   * everything the plugin-config card renders.
   */
  async mcpBackendInfo(): Promise<{
    backend: McpBackend
    hostClient: HostMcpClientProbe
    downloadRegion: { setting: DownloadRegionSetting; effective: EffectiveRegion }
  }> {
    const [backend, hostClient, regionSetting, locale] = await Promise.all([this.mcpBackendProvider(), probeHostMcpClient(), this.downloadRegionProvider(), readLocalePreference()])
    return { backend, hostClient, downloadRegion: { setting: regionSetting, effective: resolveRegion(regionSetting, locale) } }
  }

  /**
   * Switch the MCP mount backend and remount every suite server through it.
   * A host-client switch takes effect only where the host package resolves;
   * unresolvable or unsupported transports surface as per-server diagnostics.
   */
  async setMcpBackend(backend: McpBackend): Promise<void> {
    return this.enqueue(async () => {
      await this.mcpBackendWriter(backend)
      await this.notifyChanged(true)
    })
  }

  /** Install the backend source (the host settings namespace's scope). */
  setMcpBackendProvider(provider: () => Promise<McpBackend>): void {
    this.mcpBackendProvider = provider
  }

  /** Install the backend writer (a scope update on the same namespace). */
  setMcpBackendWriter(writer: (backend: McpBackend) => Promise<void>): void {
    this.mcpBackendWriter = writer
  }

  /** Install the download-region source (the host settings namespace scope). */
  setDownloadRegionProvider(provider: () => Promise<DownloadRegionSetting>): void {
    this.downloadRegionProvider = provider
  }

  /** All persisted MCP overrides keyed by qualified suite id (mount-time provider). */
  async allMcpOverrides(): Promise<Map<string, McpSuiteOverrides>> {
    const snapshot = await this.readUserCatalog()
    const map = new Map<string, McpSuiteOverrides>()
    for (const suite of snapshot.suites) {
      const overrides = await loadSuiteOverrides(this.options.dataRoot, suite.id)
      if (Object.keys(overrides).length > 0) map.set(qualifiedSuiteId(suite.sourceId, suite.id), overrides)
    }
    return map
  }

  /** Load persisted user state once at plugin activation. */
  async load(): Promise<void> {
    this.state = await loadState(this.statePath)
    this.scanCacheDirty = true
    this.invalidateSnapshot(false)
  }

  get sources(): SourceRef[] {
    return this.state.sources
  }

  /** The user-dimension suite root this catalog operates. */
  get userRoot(): string {
    return this.options.userRoot
  }

  /** Read one coherent user-dimension snapshot, reusing in-flight discovery. */
  async readUserCatalog(): Promise<CatalogSnapshot> {
    if (this.userSnapshot !== undefined && Date.now() < this.userSnapshotExpiresAt) return this.userSnapshot
    this.userSnapshotPromise ??= this.buildSnapshot(this.state, 'user', this.options.userRoot)
      .then(snapshot => {
        this.userSnapshot = snapshot
        this.userSnapshotExpiresAt = Date.now() + Catalog.USER_SNAPSHOT_TTL_MS
        return snapshot
      })
      .finally(() => {
        this.userSnapshotPromise = undefined
      })
    return this.userSnapshotPromise
  }

  /** Read one coherent project-dimension snapshot for a workspace cwd. */
  async readProjectCatalog(cwd: string): Promise<CatalogSnapshot> {
    const projectRoot = await resolveProjectRoot(cwd)
    if (this.projectSnapshotTtlMs <= 0) return this.buildProjectSnapshot(projectRoot)
    const cached = this.projectSnapshots.get(projectRoot)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.snapshot
    const inFlight = this.projectSnapshotPromises.get(projectRoot)
    if (inFlight !== undefined) return inFlight
    const promise = this.buildProjectSnapshot(projectRoot)
      .then(snapshot => {
        this.projectSnapshots.set(projectRoot, { snapshot, expiresAt: Date.now() + this.projectSnapshotTtlMs })
        return snapshot
      })
      .finally(() => {
        this.projectSnapshotPromises.delete(projectRoot)
      })
    this.projectSnapshotPromises.set(projectRoot, promise)
    return promise
  }

  private async buildProjectSnapshot(projectRoot: string): Promise<CatalogSnapshot> {
    const state = await loadState(join(projectRoot, STATE_FILE_NAME))
    // TTL 0 means caching is disabled for this dimension: bypass the scan
    // cache so every read observes the working tree as it stands.
    return this.buildSnapshot(state, 'project', projectRoot, this.projectSnapshotTtlMs <= 0)
  }

  /** One suite's full detail for the market detail modal. */
  async suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return buildSuiteDetail(suite, this.state.installed[installKey(sourceId, suiteId)], this.mcpDiagnostics, await loadSuiteOverrides(this.options.dataRoot, suiteId))
  }

  /** One skill's full SKILL.md text for the market detail modal. */
  async skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return readSkillContent(suite, skillName)
  }

  /** The full market overview from one user snapshot. */
  async overview(): Promise<OverviewPayload> {
    const snapshot = await this.readUserCatalog()
    const sourceRows: SourceOverview[] = []
    for (const source of snapshot.sources) {
      const inFlight = this.currentSourceState?.sourceId === source.id ? this.currentSourceState : undefined
      const checkout = this.sourceCheckoutPath(source)
      const kind = resolveSourceKind(source)
      let cloned = false
      let lockCommit: string | undefined
      let error: string | undefined
      if (kind === 'local') {
        cloned = await isDirectory(checkout)
        if (!cloned) error = `local source directory ${checkout} is missing`
      } else if (kind === 'archive') {
        cloned = await isDirectory(checkout)
        lockCommit = this.headCache.get(source.id)
      } else if (inFlight !== undefined) {
        // A mutation owns this source right now: do not race git against its checkout.
        cloned = inFlight.cloned || (await isDirectory(checkout))
        lockCommit = inFlight.head
      } else {
        const cachedHead = this.headCache.get(source.id)
        if (cachedHead !== undefined && (await isDirectory(checkout))) {
          cloned = true
          lockCommit = cachedHead
        } else {
          try {
            lockCommit = await gitHead(checkout)
            cloned = true
            this.headCache.set(source.id, lockCommit)
          } catch {
            // Not cloned yet or a broken checkout; refresh reports the actionable error.
          }
        }
      }
      const sourceSuites = snapshot.suites.filter(suite => suite.sourceId === source.id)
      const scanNotes = snapshot.scanNotes?.[source.id]
      sourceRows.push({
        id: source.id,
        url: source.url,
        ...(source.branch === undefined ? {} : { branch: source.branch }),
        ...(source.local === true ? { local: true } : {}),
        kind,
        ...(source.adopted === true ? { adopted: true } : {}),
        cloned,
        ...(lockCommit === undefined ? {} : { lockCommit }),
        ...(error === undefined ? {} : { error }),
        ...(scanNotes === undefined ? {} : { scanNotes }),
        suiteIds: sourceSuites.map(suite => suite.id)
      })
    }
    const installed = new Set(Object.keys(this.state.installed))
    const cards = snapshot.suites.map(suite => ({
      sourceId: suite.sourceId,
      suiteId: suite.id,
      name: suite.manifest.name,
      version: suite.manifest.version,
      description: suite.manifest.description,
      keywords: suite.manifest.keywords ?? [],
      surfaces: suite.surfaces,
      enabled: suite.enabled,
      installed: installed.has(installKey(suite.sourceId, suite.id)),
      ...(installed.has(installKey(suite.sourceId, suite.id)) ? { surfaceToggles: suite.activeSurfaces } : {}),
      ...(suite.remote === undefined ? {} : { remoteUrl: suite.remote.url }),
      dimension: suite.dimension,
      layout: suite.manifest.layout,
      errors: suite.errors,
      mcpErrors: this.mcpDiagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`)
    }))
    return {
      sources: sourceRows,
      suites: cards,
      totals: {
        all: cards.length,
        installed: cards.filter(card => card.installed).length,
        enabled: cards.filter(card => card.enabled).length
      },
      roots: { user: this.options.userRoot, data: this.options.dataRoot },
      unmanaged: await this.unmanagedSources()
    }
  }

  /** Enabled user-dimension suites from one user snapshot. */
  async enabledUserSuites(): Promise<Suite[]> {
    return (await this.readUserCatalog()).enabledSuites
  }

  /** Enabled user- and project-dimension suites for a workspace cwd. */
  async enabledSuitesForCwd(cwd: string): Promise<{ user: Suite[]; project: Suite[] }> {
    const [user, project] = await Promise.all([this.readUserCatalog(), this.readProjectCatalog(cwd)])
    return { user: user.enabledSuites, project: project.enabledSuites }
  }

  /** All suites of one dimension. */
  async suitesForDimension(dimension: SuiteDimension, dimensionRoot: string): Promise<Suite[]> {
    const state = dimension === 'user' && dimensionRoot === this.options.userRoot ? this.state : await loadState(join(dimensionRoot, STATE_FILE_NAME))
    return (await this.buildSnapshot(state, dimension, dimensionRoot)).suites
  }

  /**
   * Add a source and acquire it immediately (clone, download, or in-place).
   *
   * Git sources with an already-present checkout whose `origin` matches the
   * input URL are adopted in place — the manual-clone repair path — so no
   * second clone is made and no `-2` suffixed id is invented. Adopted
   * checkouts are never deleted on source removal.
   */
  async addSource(input: { url: string; branch?: string; local?: boolean; kind?: SourceKind; sha256?: string }): Promise<SourceRef> {
    return this.enqueue(async () => {
      const kind = input.local === true ? ('local' as const) : resolveSourceKind({ url: input.url, kind: input.kind })
      if (kind === 'git') {
        // Adoption first: a pre-existing checkout with a matching origin URL
        // is registered as-is, skipping the clone entirely.
        const adoptable = await this.findAdoptableCheckout(input.url, deriveSourceIdCandidates(input.url))
        if (adoptable !== undefined) {
          const source: SourceRef = {
            id: adoptable,
            url: input.url,
            ...(input.branch === undefined ? {} : { branch: input.branch }),
            kind: 'git',
            adopted: true
          }
          const head = await tryHead(sourceCheckoutDir(this.options.userRoot, adoptable))
          if (head !== undefined) this.headCache.set(source.id, head)
          this.state = { ...this.state, sources: [...this.state.sources, source] }
          await saveState(this.statePath, this.state)
          await this.notifyChanged()
          return source
        }
      }
      const baseId = await this.pickSourceId(deriveSourceIdCandidates(input.url), kind === 'local')
      const source: SourceRef = {
        id: baseId,
        url: input.url,
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(kind === 'local' ? { local: true as const } : { kind }),
        ...(input.kind === 'archive' && input.sha256 !== undefined && input.sha256 !== '' ? { sha256: input.sha256 } : {})
      }
      let checkout = this.sourceCheckoutPath(source)
      if (kind === 'local') {
        if (!(await isDirectory(checkout))) throw new Error(`local source directory ${checkout} is missing`)
      } else {
        this.beginSourceState(baseId, kind === 'archive' ? 'downloading' : 'cloning', false)
        try {
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
        } catch (error) {
          this.endSourceState()
          throw error
        }
        this.updateSourceStep('reading')
      }
      // The repo's own manifest names the source; move the checkout along so
      // the registered id and its `.sources/` directory stay coherent. URL
      // derived candidates stay as readable fallbacks before numeric suffixes.
      const named = [...new Set([sanitizeId(await repoName(checkout)), ...deriveSourceIdCandidates(input.url)])]
      const finalId = await this.pickSourceId(named, kind === 'local', kind === 'local' ? undefined : checkout)
      if (kind !== 'local' && finalId !== baseId) {
        const targetDir = sourceCheckoutDir(this.options.userRoot, finalId)
        await rename(checkout, targetDir)
        checkout = targetDir
      }
      source.id = finalId
      if (resolveSourceKind(source) === 'git') {
        const head = await tryHead(checkout)
        if (head !== undefined) this.headCache.set(source.id, head)
      }
      this.endSourceState()
      this.state = { ...this.state, sources: [...this.state.sources, source] }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
      return source
    })
  }

  /**
   * First candidate id whose `.sources/` checkout already exists and whose
   * `origin` remote matches the input URL (canonical-form equality) — the
   * signature of a manual clone of the very same repository. Registered ids
   * and checkouts of differently-origined directories never adopt.
   */
  private async findAdoptableCheckout(url: string, candidates: string[]): Promise<string | undefined> {
    const registered = new Set(this.state.sources.map(source => source.id))
    for (const candidate of candidates) {
      if (registered.has(candidate)) continue
      const dir = sourceCheckoutDir(this.options.userRoot, candidate)
      if (!(await isDirectory(dir))) continue
      let origin: string | undefined
      try {
        origin = await gitRemoteUrl(dir)
      } catch {
        continue
      }
      if (origin !== '' && canonicalGitUrl(origin) === canonicalGitUrl(url)) return candidate
    }
    return undefined
  }

  /** Register one unmanaged `.sources/` checkout as a source without touching its files. */
  async adoptSource(id: string): Promise<SourceRef> {
    return this.enqueue(async () => {
      if (this.state.sources.some(source => source.id === id)) throw new Error(`source "${id}" is already registered`)
      // The id becomes one path segment under `.sources/`: only flat safe
      // names qualify. Anything else (separators, `..`, leading dots) could
      // traverse out of the checkouts root and register an outside directory.
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id.includes('..')) {
        throw new Error(`invalid checkout id "${id}" — use letters, digits, dots, dashes, or underscores`)
      }
      const dir = sourceCheckoutDir(this.options.userRoot, id)
      if (!(await isDirectory(dir))) throw new Error(`no checkout directory at ${dir}`)
      let source: SourceRef
      try {
        const origin = await gitRemoteUrl(dir)
        source = { id, url: origin, kind: 'git', adopted: true }
        const head = await tryHead(dir)
        if (head !== undefined) this.headCache.set(id, head)
      } catch {
        // Not a git checkout: read it in place, like a local source.
        source = { id, url: dir, local: true, adopted: true }
      }
      this.state = { ...this.state, sources: [...this.state.sources, source] }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
      return source
    })
  }

  /** Unmanaged `.sources/` checkouts: present on disk, absent from state. */
  async unmanagedSources(): Promise<Array<{ id: string; url?: string }>> {
    const checkoutRoot = sourcesDir(this.options.userRoot)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(checkoutRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const registered = new Set(this.state.sources.map(source => source.id))
    const unmanaged: Array<{ id: string; url?: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || registered.has(entry.name)) continue
      const dir = join(checkoutRoot, entry.name)
      try {
        unmanaged.push({ id: entry.name, url: await gitRemoteUrl(dir) })
      } catch {
        unmanaged.push({ id: entry.name })
      }
    }
    return unmanaged
  }

  /** Progress snapshot of the source mutation currently in flight. */
  private currentSourceState: { sourceId: string; step: string; cloned: boolean; head?: string } | undefined

  /** Begin reporting progress for a source mutation. */
  beginSourceState(sourceId: string, step: string, cloned: boolean): void {
    this.currentSourceState = { sourceId, step, cloned }
  }

  /** Advance the in-flight source mutation step. */
  updateSourceStep(step: string): void {
    if (this.currentSourceState !== undefined) this.currentSourceState = { ...this.currentSourceState, step }
  }

  /** Stop reporting source mutation progress. */
  endSourceState(): void {
    this.currentSourceState = undefined
  }

  /** Progress snapshot for the progress route. */
  sourceProgress(): { active: boolean; sourceId: string; step: string } {
    const state = this.currentSourceState
    return state === undefined ? { active: false, sourceId: '', step: '' } : { active: true, sourceId: state.sourceId, step: state.step }
  }

  /**
   * First candidate id not claimed by a registered source; for git candidates
   * the checkout directory must also be free, so a stale or foreign directory
   * under `.sources/` is never cloned over (it would fail `git clone` with a
   * confusing "destination exists" error). `ownedCheckout` marks the directory
   * the in-flight mutation already controls, keeping a rename onto it legal.
   * Local sources skip the disk check: they read their own path in place and
   * never occupy `.sources/`.
   */
  private async pickSourceId(candidates: string[], skipDisk: boolean, ownedCheckout?: string): Promise<string> {
    const free = async (id: string): Promise<boolean> => {
      if (this.state.sources.some(source => source.id === id)) return false
      if (skipDisk) return true
      const dir = sourceCheckoutDir(this.options.userRoot, id)
      return dir === ownedCheckout || !(await pathExists(dir))
    }
    for (const candidate of candidates) {
      if (await free(candidate)) return candidate
    }
    for (let suffix = 2; ; suffix++) {
      const candidate = `${candidates[0]}-${suffix}`
      if (await free(candidate)) return candidate
    }
  }

  /** Update one source's URL, branch, kind, or archive digest. */
  async updateSource(sourceId: string, patch: { url?: string; branch?: string; local?: boolean; kind?: SourceKind; sha256?: string }): Promise<void> {
    return this.enqueue(async () => {
      const index = this.state.sources.findIndex(source => source.id === sourceId)
      if (index === -1) throw new Error(`unknown source "${sourceId}"`)
      const current = this.state.sources[index]!
      const nextLocal = patch.local !== undefined ? patch.local : current.local === true
      // A local source carries the legacy flag only; `kind` stays unwritten
      // so the persisted shape matches the pre-kind records.
      const nextKind: SourceKind | undefined = nextLocal ? undefined : (patch.kind ?? current.kind)
      const next: SourceRef = {
        id: sourceId,
        url: patch.url ?? current.url,
        ...(patch.branch !== undefined ? { branch: patch.branch } : current.branch === undefined ? {} : { branch: current.branch }),
        ...(nextLocal ? { local: true } : {}),
        ...(nextKind === undefined ? {} : { kind: nextKind }),
        ...(patch.sha256 !== undefined ? (patch.sha256 === '' ? {} : { sha256: patch.sha256 }) : current.sha256 === undefined ? {} : { sha256: current.sha256 }),
        ...(current.adopted === true ? { adopted: true } : {})
      }
      const urlChanged = patch.url !== undefined && patch.url !== current.url
      // A URL change invalidates the old checkout — except for adopted (user
      // cloned) and local sources, whose directories we never own.
      if (urlChanged && current.local !== true && current.adopted !== true) {
        this.headCache.delete(sourceId)
        await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      }
      this.state = { ...this.state, sources: this.state.sources.map((source, i) => (i === index ? next : source)) }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
    })
  }

  /** Remove a source, its install entries, and its managed checkout. */
  async removeSource(sourceId: string): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      this.state = {
        ...this.state,
        sources: this.state.sources.filter(entry => entry.id !== sourceId),
        installed: Object.fromEntries(Object.entries(this.state.installed).filter(([key]) => !key.startsWith(`${sourceId}/`)))
      }
      await saveState(this.statePath, this.state)
      this.headCache.delete(sourceId)
      // Adopted checkouts (manual clones) and local paths are user-owned
      // directories; only self-acquired checkouts are deleted.
      const userOwned = source !== undefined && (source.local === true || source.adopted === true)
      if (!userOwned) await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      await this.notifyChanged()
    })
  }

  /** Refresh one source checkout, or every source when sourceId is omitted. */
  async refreshSource(sourceId?: string): Promise<void> {
    return this.enqueue(async () => {
      const targets = sourceId === undefined ? this.state.sources : this.state.sources.filter(source => source.id === sourceId)
      for (const source of targets) {
        const kind = resolveSourceKind(source)
        if (kind === 'local') {
          if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
          continue
        }
        const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
        this.headCache.delete(source.id)
        if (kind === 'archive') {
          // Re-download and swap; the fresh digest becomes the lock value.
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
          continue
        }
        try {
          await gitHead(checkout)
        } catch {
          const lock = await this.acquire(source)
          if (lock !== undefined) {
            this.headCache.set(source.id, lock)
          } else {
            try {
              this.headCache.set(source.id, await gitHead(checkout))
            } catch {
              // A failed HEAD read means the next overview re-probes.
            }
          }
          continue
        }
        // Adopted checkouts are user-owned working trees: a `reset --hard`
        // would destroy uncommitted work, so they are left untouched (the
        // scan reads whatever state the user's checkout is in).
        if (source.adopted === true) {
          try {
            this.headCache.set(source.id, await gitHead(checkout))
          } catch {
            // A failed HEAD read means the next overview re-probes.
          }
          continue
        }
        // Shallow-friendly sync: fetch depth 1 into FETCH_HEAD, hard reset.
        const branch = source.branch ?? (await gitCurrentBranch(checkout).catch(() => undefined))
        await gitSync(checkout, branch, this.options.git ?? {})
        try {
          this.headCache.set(source.id, await gitHead(checkout))
        } catch {
          // A failed HEAD read means the next overview re-probes.
        }
      }
      await this.notifyChanged()
    })
  }

  /** Install a suite from a source and enable it. The client confirms the
   * injected surfaces (skills / MCP / hooks / commands) in a pre-install
   * dialog before this runs; disabling afterwards is always available. */
  async install(sourceId: string, suiteId: string): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
      const checkout = this.sourceCheckoutPath(source)
      let freshLock: string | undefined
      if (!(await isDirectory(checkout))) freshLock = await this.acquire(source)
      const suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.remote !== undefined) throw new Error(`suite "${suiteId}" is a remote reference (${suite.remote.url}); add its repository as a source before installing`)
      // Archive (or tarball-fallback) sources have no git HEAD; their digest
      // is the lock value.
      const lockCommit = (await tryHead(checkout)) ?? freshLock ?? this.headCache.get(sourceId)
      await this.setInstalled(sourceId, suiteId, { enabled: true, installedAt: new Date().toISOString(), lockCommit })
      await this.notifyChanged(true)
    })
  }

  /** Uninstall a suite while retaining the source checkout. */
  async uninstall(sourceId: string, suiteId: string): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      if (this.state.installed[key] === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      const rest = Object.fromEntries(Object.entries(this.state.installed).filter(([entryKey]) => entryKey !== key))
      this.state = { ...this.state, installed: rest }
      await saveState(this.statePath, this.state)
      await this.notifyChanged(true)
    })
  }

  /** Enable or disable an installed suite. */
  async setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      const entry = this.state.installed[key]
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      await this.setInstalled(sourceId, suiteId, { ...entry, enabled })
      await this.notifyChanged(true)
    })
  }

  /** Enable or disable one runtime surface of an installed suite. */
  async setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      const entry = this.state.installed[key]
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      if (!SUITE_SURFACE_KEYS.includes(surface as SuiteSurfaceKey)) throw new Error(`surface "${surface}" is not toggleable`)
      const surfaces: SurfaceOverrides = { ...(entry.surfaces ?? {}), [surface]: enabled }
      await this.setInstalled(sourceId, suiteId, { ...entry, surfaces })
      await this.notifyChanged(true)
    })
  }

  /** Append config-seeded sources missing from user state and persist them. */
  async mergeSources(sources: SourceRef[]): Promise<void> {
    const existing = new Set(this.state.sources.map(source => source.id))
    const additions = sources.filter(source => !existing.has(source.id))
    if (additions.length === 0) return
    this.state = { ...this.state, sources: [...this.state.sources, ...additions] }
    await saveState(this.statePath, this.state)
    // New sources change the fingerprint, but their content arrives through
    // an acquire, so mark the scan cache dirty conservatively.
    this.scanCacheDirty = true
    this.invalidateSnapshot(true)
  }

  private async setInstalled(sourceId: string, suiteId: string, entry: InstalledEntry): Promise<void> {
    this.state = { ...this.state, installed: { ...this.state.installed, [installKey(sourceId, suiteId)]: entry } }
    await saveState(this.statePath, this.state)
  }

  /**
   * Acquire one source's content by kind: clone (git), download+extract
   * (archive), or an in-place existence check (local). Returns a lock value
   * when the acquisition yields one (archive SHA-256, tarball fallback
   * digest); git HEAD is read separately by the callers.
   */
  private async acquire(source: SourceRef): Promise<string | undefined> {
    const kind = resolveSourceKind(source)
    if (kind === 'local') {
      if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
      return undefined
    }
    const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
    await mkdir(sourcesDir(this.options.userRoot), { recursive: true })
    if (kind === 'archive') {
      const { sha256 } = await archiveInstall(source.url, checkout, {
        ...(source.sha256 === undefined ? {} : { sha256: source.sha256 }),
        ...(this.options.git?.timeoutMs === undefined ? {} : { timeoutMs: this.options.git.timeoutMs }),
        ...(this.options.git?.allowHttpArchives === true ? { allowHttp: true } : {})
      })
      return sha256
    }
    try {
      // The region routes github.com clones through the China mirror prefix;
      // the proxied URL becomes `origin`, so refreshes follow the same route.
      const region = resolveRegion(await this.downloadRegionProvider(), await readLocalePreference())
      await gitClone(githubCloneUrl(region, source.url), source.branch, checkout, this.options.git ?? {})
      return undefined
    } catch (error) {
      if (this.options.git?.fallbackTarball !== true) throw error
      const tarballUrl = codeloadTarballUrl(source.url, source.branch)
      if (tarballUrl === undefined) throw error
      // The codeload URL ends in a branch path, not `.tar.gz`, so the format
      // must be stated explicitly — extension detection cannot see it.
      const { sha256 } = await archiveInstall(tarballUrl, checkout, {
        ...(this.options.git?.timeoutMs === undefined ? {} : { timeoutMs: this.options.git.timeoutMs }),
        format: 'targz'
      })
      return sha256
    }
  }

  /** The filesystem location of one source. */
  private sourceCheckoutPath(source: SourceRef): string {
    return source.local === true ? expandHome(source.url) : sourceCheckoutDir(this.options.userRoot, source.id)
  }

  private async buildSnapshot(state: SuiteState, dimension: SuiteDimension, dimensionRoot: string, skipScanCache = false): Promise<CatalogSnapshot> {
    const fingerprint = JSON.stringify([dimension, dimensionRoot, state.sources])
    const cached = this.scanCache.get(fingerprint)
    const cacheFresh = !skipScanCache && !this.scanCacheDirty && cached !== undefined && Date.now() - cached.at < Catalog.SCAN_CACHE_TTL_MS
    let discovered: Suite[]
    let scanNotes: Record<string, string[]>
    if (cacheFresh && cached !== undefined) {
      discovered = cached.discovered
      scanNotes = cached.scanNotes
    } else {
      const result = await discoverSourceListWithNotes(state.sources, dimension, dimensionRoot)
      discovered = result.suites
      scanNotes = result.scanNotes
      // The fresh scan satisfies the invalidation: content mutations mark the
      // cache dirty, and the next scan (this one) makes it clean again.
      this.scanCacheDirty = false
      if (this.scanCache.size >= Catalog.SCAN_CACHE_MAX_ENTRIES) this.scanCache.clear()
      this.scanCache.set(fingerprint, { at: Date.now(), discovered, scanNotes })
    }
    const suites = discovered.map(suite => {
      const installed = state.installed[installKey(suite.sourceId, suite.id)]
      // Native project layouts (`.claude/`, `.agents/`) are the repository's
      // own files read in place: they carry no install state and stay enabled.
      const enabled = suite.manifest.layout === 'project-native' || installed?.enabled === true
      return {
        ...suite,
        enabled,
        activeSurfaces: effectiveSurfaces(installed?.surfaces),
        ...(installed?.lockCommit === undefined ? {} : { lockCommit: installed.lockCommit }),
        ...(installed?.installedAt === undefined ? {} : { installedAt: installed.installedAt })
      }
    })
    return {
      revision: this.revision,
      sources: [...state.sources],
      suites,
      enabledSuites: suites.filter(suite => suite.enabled),
      ...(Object.keys(scanNotes).length > 0 ? { scanNotes } : {})
    }
  }

  private invalidateSnapshot(increment: boolean): void {
    if (increment) this.revision++
    this.userSnapshot = undefined
    this.userSnapshotExpiresAt = 0
    this.userSnapshotPromise = undefined
    this.projectSnapshots.clear()
  }

  /**
   * Invalidate snapshots and run the change pipeline. `keepScanCache` marks
   * state-only mutations (install, enable, surface toggles, MCP overrides)
   * whose inputs leave every checkout untouched, so the next snapshot
   * re-derives from cached discovery instead of rescanning the filesystem.
   */
  private async notifyChanged(keepScanCache = false): Promise<void> {
    if (!keepScanCache) this.scanCacheDirty = true
    this.invalidateSnapshot(true)
    await this.options.onChanged()
    for (const listener of this.listeners) listener()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.catch(() => {})
    return result
  }
}

function installKey(sourceId: string, suiteId: string): string {
  return `${sourceId}/${suiteId}`
}

/** Read a checkout's HEAD when it is a Git repository. */
async function tryHead(dir: string): Promise<string | undefined> {
  try {
    return await gitHead(dir)
  } catch {
    return undefined
  }
}

/**
 * The codeload tarball URL of a GitHub repository, or undefined for any
 * other host. `https://github.com/<owner>/<repo>` maps to
 * `https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<branch>`
 * (or `/tar.gz/HEAD` for the default branch) — the git-protocol fallback
 * when a clone cannot get through but plain HTTPS file download can.
 */
export function codeloadTarballUrl(url: string, branch: string | undefined): string | undefined {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (match === null) return undefined
  const [, owner, repo] = match
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${branch === undefined ? 'HEAD' : `refs/heads/${branch}`}`
}
