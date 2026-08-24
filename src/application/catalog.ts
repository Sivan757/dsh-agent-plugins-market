/**
 * Catalog application module: the host-authoritative owner of source state,
 * discovery, install mutations, and coherent suite snapshots.
 *
 * The module deliberately keeps the existing filesystem and Git operations
 * behind one interface while callers migrate from SuiteManager. User and
 * project snapshots use their own persisted state files and share the same
 * source-selection and suite-scanning rules.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { repoName } from '../catalog/manifests.js'
import { discoverSourceList } from '../catalog/source-catalog.js'
import { discoverSuitesInSource } from '../catalog/suite-scanner.js'
import { gitClone, gitHead, gitPull, gitRemove } from '../catalog/git.js'
import { buildMcpStatus, type McpToolSnapshot } from '../runtime/mcp-status.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { OverviewPayload, SkillContent, SourceOverview, SuiteDetail } from '../contracts/market.js'
import { buildSuiteDetail, readSkillContent } from './details.js'
import { deriveSourceId, expandHome, isDirectory, resolveProjectRoot, sanitizeId, sourceCheckoutDir, sourcesDir, STATE_FILE_NAME } from '../catalog/paths.js'
import { loadState, saveState, EMPTY_STATE } from '../model/state.js'
import {
  effectiveSurfaces,
  SUITE_SURFACE_KEYS,
  type InstalledEntry,
  type SourceRef,
  type Suite,
  type SuiteDimension,
  type SuiteState,
  type SuiteSurfaceKey,
  type SurfaceOverrides
} from '../model/types.js'

/** Dependencies and host callback used by the catalog application module. */
export interface CatalogOptions {
  userRoot: string
  dataRoot: string
  onChanged: () => void
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
}

export class Catalog {
  private state: SuiteState = EMPTY_STATE
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly statePath: string
  private readonly headCache = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private userSnapshot: CatalogSnapshot | undefined
  private userSnapshotPromise: Promise<CatalogSnapshot> | undefined
  /** Project-dimension snapshots keyed by project root, with TTL freshness. */
  private readonly projectSnapshots = new Map<string, { snapshot: CatalogSnapshot; expiresAt: number }>()
  private readonly projectSnapshotPromises = new Map<string, Promise<CatalogSnapshot>>()
  private readonly projectSnapshotTtlMs: number
  /** Latest MCP mount diagnostics (suiteId -> reasons), fed by host reconcile. */
  mcpDiagnostics: Array<{ suiteId: string; serverKey: string; reason: string }> = []
  private toolSnapshotProvider: () => readonly McpToolSnapshot[] = () => []

  constructor(private readonly options: CatalogOptions) {
    this.statePath = join(options.userRoot, STATE_FILE_NAME)
    this.projectSnapshotTtlMs = options.projectSnapshotTtlMs ?? 5_000
  }

  /** Install the host tool snapshot provider used by the MCP status surface. */
  setMcpToolSnapshotProvider(provider: () => readonly McpToolSnapshot[]): void {
    this.toolSnapshotProvider = provider
  }

  /** Subscribe to completed catalog mutations; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Build the flat MCP service inventory for the status surface. */
  async mcpStatus(): Promise<McpStatusPayload> {
    const snapshot = await this.readUserCatalog()
    return buildMcpStatus(snapshot.suites, this.mcpDiagnostics, this.toolSnapshotProvider())
  }

  /** Load persisted user state once at plugin activation. */
  async load(): Promise<void> {
    this.state = await loadState(this.statePath)
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
    if (this.userSnapshot !== undefined) return this.userSnapshot
    this.userSnapshotPromise ??= this.buildSnapshot(this.state, 'user', this.options.userRoot)
      .then(snapshot => {
        this.userSnapshot = snapshot
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
    return this.buildSnapshot(state, 'project', projectRoot)
  }

  /** One suite's full detail for the market detail modal. */
  async suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return buildSuiteDetail(suite, this.state.installed[installKey(sourceId, suiteId)], this.mcpDiagnostics)
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
      let cloned = false
      let lockCommit: string | undefined
      let error: string | undefined
      if (source.local === true) {
        cloned = await isDirectory(checkout)
        if (!cloned) error = `local source directory ${checkout} is missing`
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
      sourceRows.push({
        id: source.id,
        url: source.url,
        ...(source.branch === undefined ? {} : { branch: source.branch }),
        ...(source.local === true ? { local: true } : {}),
        cloned,
        ...(lockCommit === undefined ? {} : { lockCommit }),
        ...(error === undefined ? {} : { error }),
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
      roots: { user: this.options.userRoot, data: this.options.dataRoot }
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

  /** Add a source and clone it immediately. */
  async addSource(input: { url: string; branch?: string; local?: boolean }): Promise<SourceRef> {
    return this.enqueue(async () => {
      const baseId = this.uniqueSourceId(deriveSourceId(input.url))
      const source: SourceRef = {
        id: baseId,
        url: input.url,
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(input.local === true ? { local: true } : {})
      }
      const checkout = this.sourceCheckoutPath(source)
      if (input.local === true) {
        if (!(await isDirectory(checkout))) throw new Error(`local source directory ${checkout} is missing`)
      } else {
        this.beginSourceState(baseId, 'cloning', false)
        try {
          await this.ensureClone(source)
        } catch (error) {
          this.endSourceState()
          throw error
        }
        this.updateSourceStep('reading')
      }
      source.id = this.uniqueSourceId(sanitizeId(await repoName(checkout)))
      const head = await tryHead(checkout)
      if (head !== undefined) this.headCache.set(source.id, head)
      this.endSourceState()
      this.state = { ...this.state, sources: [...this.state.sources, source] }
      await saveState(this.statePath, this.state)
      this.notifyChanged()
      return source
    })
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

  private uniqueSourceId(derived: string): string {
    if (!this.state.sources.some(source => source.id === derived)) return derived
    for (let suffix = 2; ; suffix++) {
      const candidate = `${derived}-${suffix}`
      if (!this.state.sources.some(source => source.id === candidate)) return candidate
    }
  }

  /** Update one source's URL, branch, or local flag. */
  async updateSource(sourceId: string, patch: { url?: string; branch?: string; local?: boolean }): Promise<void> {
    return this.enqueue(async () => {
      const index = this.state.sources.findIndex(source => source.id === sourceId)
      if (index === -1) throw new Error(`unknown source "${sourceId}"`)
      const current = this.state.sources[index]!
      const next: SourceRef = {
        id: sourceId,
        url: patch.url ?? current.url,
        ...(patch.branch !== undefined ? { branch: patch.branch } : current.branch === undefined ? {} : { branch: current.branch }),
        ...(patch.local !== undefined ? { local: patch.local } : current.local === undefined ? {} : { local: current.local })
      }
      if (current.local !== true && patch.url !== undefined && patch.url !== current.url) {
        this.headCache.delete(sourceId)
        await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      }
      this.state = { ...this.state, sources: this.state.sources.map((source, i) => (i === index ? next : source)) }
      await saveState(this.statePath, this.state)
      this.notifyChanged()
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
      if (source === undefined || source.local !== true) await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      this.notifyChanged()
    })
  }

  /** Refresh one source checkout, or every source when sourceId is omitted. */
  async refreshSource(sourceId?: string): Promise<void> {
    return this.enqueue(async () => {
      const targets = sourceId === undefined ? this.state.sources : this.state.sources.filter(source => source.id === sourceId)
      for (const source of targets) {
        if (source.local === true) {
          if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
          continue
        }
        const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
        this.headCache.delete(source.id)
        try {
          await gitHead(checkout)
        } catch {
          await this.ensureClone(source)
          try {
            this.headCache.set(source.id, await gitHead(checkout))
          } catch {
            // A failed HEAD read means the next overview re-probes.
          }
          continue
        }
        await gitPull(checkout)
        try {
          this.headCache.set(source.id, await gitHead(checkout))
        } catch {
          // A failed HEAD read means the next overview re-probes.
        }
      }
      this.notifyChanged()
    })
  }

  /** Install a suite from a source and enable it. */
  async install(sourceId: string, suiteId: string): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
      const checkout = this.sourceCheckoutPath(source)
      if (!(await isDirectory(checkout))) await this.ensureClone(source)
      const suites = await discoverSuitesInSource(checkout, sourceId, 'user')
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.remote !== undefined) throw new Error(`suite "${suiteId}" is a remote reference (${suite.remote.url}); add its repository as a source before installing`)
      await this.setInstalled(sourceId, suiteId, { enabled: true, installedAt: new Date().toISOString(), lockCommit: await tryHead(checkout) })
      this.notifyChanged()
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
      this.notifyChanged()
    })
  }

  /** Enable or disable an installed suite. */
  async setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      const entry = this.state.installed[key]
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      await this.setInstalled(sourceId, suiteId, { ...entry, enabled })
      this.notifyChanged()
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
      this.notifyChanged()
    })
  }

  /** Append config-seeded sources missing from user state and persist them. */
  async mergeSources(sources: SourceRef[]): Promise<void> {
    const existing = new Set(this.state.sources.map(source => source.id))
    const additions = sources.filter(source => !existing.has(source.id))
    if (additions.length === 0) return
    this.state = { ...this.state, sources: [...this.state.sources, ...additions] }
    await saveState(this.statePath, this.state)
    this.invalidateSnapshot(true)
  }

  private async setInstalled(sourceId: string, suiteId: string, entry: InstalledEntry): Promise<void> {
    this.state = { ...this.state, installed: { ...this.state.installed, [installKey(sourceId, suiteId)]: entry } }
    await saveState(this.statePath, this.state)
  }

  private async ensureClone(source: SourceRef): Promise<void> {
    if (source.local === true) {
      if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
      return
    }
    const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
    await mkdir(sourcesDir(this.options.userRoot), { recursive: true })
    await gitClone(source.url, source.branch, checkout)
  }

  /** The filesystem location of one source. */
  private sourceCheckoutPath(source: SourceRef): string {
    return source.local === true ? expandHome(source.url) : sourceCheckoutDir(this.options.userRoot, source.id)
  }

  private async buildSnapshot(state: SuiteState, dimension: SuiteDimension, dimensionRoot: string): Promise<CatalogSnapshot> {
    const discovered = await discoverSourceList(state.sources, dimension, dimensionRoot)
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
      enabledSuites: suites.filter(suite => suite.enabled)
    }
  }

  private invalidateSnapshot(increment: boolean): void {
    if (increment) this.revision++
    this.userSnapshot = undefined
    this.userSnapshotPromise = undefined
    this.projectSnapshots.clear()
  }

  private notifyChanged(): void {
    this.invalidateSnapshot(true)
    this.options.onChanged()
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
