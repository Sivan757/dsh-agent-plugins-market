/** Dimension snapshots derived from per-source discovery indexes and the current install policy. */
import { join, resolve } from 'node:path'
import { resolveProjectRoot, STATE_FILE_NAME } from '../scanning/paths.js'
import { configuredSourceCheckout, discoverSourceListWithNotes } from '../scanning/source-catalog.js'
import { loadState } from './state/state-store.js'
import { SourceIndexStore } from './source-index.js'
import type { DiscoveredSuite, SourceRef, Suite, SuiteDimension, SuiteState } from '../../../market-contracts/src/model/types.js'

/** Maximum age of an on-demand read of a mutable user source; managed indexes do not expire. */
export const LOCAL_SOURCE_TTL_MS = 30_000
const MAX_SNAPSHOTS = 64

/** A coherent discovered-and-installed view for one catalog dimension. */
export interface CatalogSnapshot {
  revision: number
  sources: SourceRef[]
  suites: Suite[]
  enabledSuites: Suite[]
  /** Per-source scan diagnostics (sourceId → notes), absent when clean. */
  scanNotes?: Record<string, string[]>
  /** Earliest mutable-source expiry; deriving another view cannot extend this bound. */
  freshUntil?: number
}

/** The state and generation counters a snapshot is built and validated against. */
export interface SnapshotHost {
  readonly state: SuiteState
  readonly userRoot: string
  readonly dataRoot: string
  readonly scanProjectLayouts: boolean
  readonly revision: number
  readonly scanGeneration: number
  project(discovered: readonly DiscoveredSuite[], state: SuiteState, dimension: SuiteDimension): Suite[]
}

export class SnapshotCache {
  private readonly indexes: SourceIndexStore
  private readonly snapshots = new Map<string, { snapshot: CatalogSnapshot; expiresAt: number }>()
  private readonly pending = new Map<string, Promise<CatalogSnapshot>>()
  private readonly reads = new Set<Promise<CatalogSnapshot>>()
  private disposed = false

  constructor(
    private readonly host: SnapshotHost,
    private readonly ttls: { user: number; project: number },
    private readonly now: () => number = Date.now
  ) {
    this.indexes = new SourceIndexStore(host.dataRoot, now)
  }

  /** Market discovery reads managed indexes and observes mutable sources on demand. No read arms a timer. */
  async readUserCatalog(): Promise<CatalogSnapshot> {
    return this.read(this.host.state, 'user', this.host.userRoot, 'market')
  }

  /** Runtime declarations include installed suites even when their global enable switch is off. */
  async readInstalledCatalog(enabledOnly = false): Promise<CatalogSnapshot> {
    const state = this.host.state
    const installed = enabledOnly ? Object.fromEntries(Object.entries(state.installed).filter(([, install]) => install.enabled)) : state.installed
    const sourceIds = new Set(Object.keys(installed).map(key => key.slice(0, key.indexOf('/'))))
    const sources = state.sources.filter(source => sourceIds.has(source.id))
    return this.read(
      { ...state, sources, installed },
      'user',
      this.host.userRoot,
      enabledOnly ? 'enabled' : 'installed',
      snapshot => {
        const suites = snapshot.suites.filter(suite => state.installed[`${suite.sourceId}/${suite.id}`] !== undefined && (!enabledOnly || suite.enabled))
        return { ...snapshot, suites, enabledSuites: suites.filter(suite => suite.enabled) }
      },
      true
    )
  }

  /** Read one coherent project-dimension snapshot for a workspace cwd. */
  async readProjectCatalog(cwd: string): Promise<CatalogSnapshot> {
    if (this.disposed) throw new Error('catalog is disposed')
    const projectRoot = await resolveProjectRoot(cwd)
    if (resolve(projectRoot) === resolve(this.host.userRoot)) return { revision: this.host.revision, sources: [], suites: [], enabledSuites: [] }
    const key = JSON.stringify(['project', projectRoot])
    const cached = this.snapshots.get(key)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      this.snapshots.delete(key)
      this.snapshots.set(key, cached)
      return cached.snapshot
    }
    const existing = this.pending.get(key)
    if (existing !== undefined) return existing
    return this.remember(key, this.ttls.project, async () => this.build(await loadState(join(projectRoot, STATE_FILE_NAME)), 'project', projectRoot, this.ttls.project <= 0))
  }

  /** Re-derive policy from source-owned indexes; filesystem discovery is confined to index misses and mutable reads. */
  build(state: SuiteState, dimension: SuiteDimension, dimensionRoot: string, force = false, installedOnly = false): Promise<CatalogSnapshot> {
    if (this.disposed) return Promise.reject(new Error('catalog is disposed'))
    const read = this.buildSnapshot(state, dimension, dimensionRoot, force, installedOnly).finally(() => {
      this.reads.delete(read)
    })
    this.reads.add(read)
    return read
  }

  private async buildSnapshot(state: SuiteState, dimension: SuiteDimension, dimensionRoot: string, force: boolean, installedOnly: boolean): Promise<CatalogSnapshot> {
    const ttl = dimension === 'user' ? this.ttls.user : this.ttls.project
    const {
      suites: discovered,
      scanNotes,
      expiresAt
    } = dimension === 'user' && state.sources.length === 0
      ? { suites: [] as DiscoveredSuite[], scanNotes: {} as Record<string, string[]>, expiresAt: undefined }
      : await discoverSourceListWithNotes(state.sources, dimension, dimensionRoot, this.host.scanProjectLayouts, (entry, selectedDimension) =>
          this.indexes.read(
            entry,
            selectedDimension,
            dimensionRoot,
            ttl,
            force,
            installedOnly
              ? Object.keys(state.installed)
                  .filter(key => key.startsWith(entry.sourceId + '/'))
                  .map(key => key.slice(entry.sourceId.length + 1))
              : undefined
          )
        )
    const sourceIds = new Set(state.sources.map(source => source.id))
    const found = new Set(discovered.map(suite => `${suite.sourceId}/${suite.id}`))
    for (const key of Object.keys(state.installed)) {
      const slash = key.indexOf('/')
      const sourceId = key.slice(0, slash)
      if (sourceIds.has(sourceId) && !found.has(key))
        (scanNotes[sourceId] ??= []).push(
          `installed suite "${key.slice(slash + 1)}" is missing from this source; refresh the source or reinstall the suite; its install record is retained`
        )
    }
    const suites = this.host.project(discovered, state, dimension)
    return {
      revision: this.host.revision,
      sources: [...state.sources],
      suites,
      enabledSuites: suites.filter(suite => suite.enabled),
      ...(Object.keys(scanNotes).length === 0 ? {} : { scanNotes }),
      ...(expiresAt === undefined ? {} : { freshUntil: expiresAt })
    }
  }

  /** Hold affected-source readers while the mutation owner changes content and rebuilds indexes. */
  async changeSources<T>(sourceIds: readonly string[], action: () => Promise<T>): Promise<T> {
    this.invalidateSnapshots()
    return this.indexes.change(sourceIds, 'user', this.host.userRoot, action)
  }

  async refreshSources(sources: readonly SourceRef[]): Promise<void> {
    await Promise.all(sources.map(async source => this.indexes.refresh(configuredSourceCheckout(source, this.host.userRoot), 'user', this.host.userRoot, this.ttls.user)))
  }

  /** Drop policy snapshots while keeping content indexes shared by every query. */
  invalidateSnapshots(): void {
    this.snapshots.clear()
    this.pending.clear()
  }

  /** Join the discovery reads and durable writes before storage teardown. */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled([...this.pending.values(), ...this.reads])
    await this.indexes.dispose()
    this.snapshots.clear()
  }

  private async read(
    state: SuiteState,
    dimension: SuiteDimension,
    dimensionRoot: string,
    scope: string,
    select: (snapshot: CatalogSnapshot) => CatalogSnapshot = snapshot => snapshot,
    installedOnly = false
  ): Promise<CatalogSnapshot> {
    if (this.disposed) throw new Error('catalog is disposed')
    const ttl = dimension === 'user' ? this.ttls.user : this.ttls.project
    if (ttl <= 0) return select(await this.build(state, dimension, dimensionRoot, true, installedOnly))
    const key = JSON.stringify([dimension, dimensionRoot, scope])
    const cached = this.snapshots.get(key)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      this.snapshots.delete(key)
      this.snapshots.set(key, cached)
      return cached.snapshot
    }
    const existing = this.pending.get(key)
    if (existing !== undefined) return existing
    return this.remember(key, ttl, async () => select(await this.build(state, dimension, dimensionRoot, false, installedOnly)))
  }

  private remember(key: string, ttl: number, build: () => Promise<CatalogSnapshot>): Promise<CatalogSnapshot> {
    if (this.disposed) return Promise.reject(new Error('catalog is disposed'))
    const revision = this.host.revision
    const generation = this.host.scanGeneration
    const promise = build()
      .then(snapshot => {
        if (!this.disposed && revision === this.host.revision && generation === this.host.scanGeneration) {
          this.snapshots.delete(key)
          this.snapshots.set(key, { snapshot, expiresAt: Math.min(this.now() + ttl, snapshot.freshUntil ?? Infinity) })
          while (this.snapshots.size > MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!)
        }
        return snapshot
      })
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key)
      })
    this.pending.set(key, promise)
    return promise
  }
}
