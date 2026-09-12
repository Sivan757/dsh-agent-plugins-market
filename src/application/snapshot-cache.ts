/**
 * Discovery caching: one scan cache shared by every dimension, plus a
 * freshness-bounded snapshot per dimension.
 *
 * Install / enable / surface toggles re-derive a snapshot from cached
 * discovery (a cheap mapping) instead of re-walking every checkout — a full
 * rescan of a 2,500-suite catalog costs ~1s and UI mutations happen in bursts.
 * Content-changing mutations (add / update / remove / adopt / refresh /
 * acquire) clear every cached discovery generation; the TTL bounds staleness
 * for in-place working-tree edits of local sources.
 */
import { join } from 'node:path'
import { resolveProjectRoot, STATE_FILE_NAME } from '../catalog/paths.js'
import { discoverSourceListWithNotes } from '../catalog/source-catalog.js'
import { loadState } from '../model/state.js'
import type { SourceRef, Suite, SuiteDimension, SuiteState } from '../model/types.js'

export const SCAN_CACHE_TTL_MS = 30_000
const SCAN_CACHE_MAX_ENTRIES = 8

/** A coherent discovered-and-installed view for one catalog dimension. */
export interface CatalogSnapshot {
  revision: number
  sources: SourceRef[]
  suites: Suite[]
  enabledSuites: Suite[]
  /** Per-source scan diagnostics (sourceId → notes), absent when clean. */
  scanNotes?: Record<string, string[]>
}

/** The state and generation counters a snapshot is built and validated against. */
export interface SnapshotHost {
  /** The persisted state the next snapshot is built from. */
  readonly state: SuiteState
  readonly userRoot: string
  readonly scanProjectLayouts: boolean
  /** Bumped by every mutation; a snapshot built at an older revision is not cached. */
  readonly revision: number
  /** Bumped by every content-changing mutation; an older scan never repopulates the cache. */
  readonly scanGeneration: number
  /** Apply the install state to freshly discovered suites. */
  project(discovered: readonly Suite[], state: SuiteState, dimension: SuiteDimension): Suite[]
}

export class SnapshotCache {
  private readonly scanCache = new Map<string, { at: number; discovered: Suite[]; scanNotes: Record<string, string[]> }>()
  private readonly scanPromises = new Map<string, Promise<{ suites: Suite[]; scanNotes: Record<string, string[]> }>>()
  private userSnapshot: CatalogSnapshot | undefined
  private userSnapshotExpiresAt = 0
  private userSnapshotPromise: Promise<CatalogSnapshot> | undefined
  /** Project-dimension snapshots keyed by project root, with TTL freshness. */
  private readonly projectSnapshots = new Map<string, { snapshot: CatalogSnapshot; expiresAt: number }>()
  private readonly projectSnapshotPromises = new Map<string, Promise<CatalogSnapshot>>()

  constructor(
    private readonly host: SnapshotHost,
    private readonly ttls: { user: number; project: number }
  ) {}

  /** Read one coherent user-dimension snapshot, reusing in-flight discovery. */
  async readUserCatalog(): Promise<CatalogSnapshot> {
    // TTL 0 disables snapshot caching: every read observes fresh discovery,
    // mirroring the project dimension's caching-disabled semantics.
    if (this.ttls.user <= 0) return this.build(this.host.state, 'user', this.host.userRoot)
    if (this.userSnapshot !== undefined && Date.now() < this.userSnapshotExpiresAt) return this.userSnapshot
    if (this.userSnapshotPromise !== undefined) return this.userSnapshotPromise
    const revision = this.host.revision
    const generation = this.host.scanGeneration
    const promise = this.build(this.host.state, 'user', this.host.userRoot)
      .then(snapshot => {
        if (revision === this.host.revision && generation === this.host.scanGeneration) {
          this.userSnapshot = snapshot
          this.userSnapshotExpiresAt = Date.now() + this.ttls.user
        }
        return snapshot
      })
      .finally(() => {
        if (this.userSnapshotPromise === promise) this.userSnapshotPromise = undefined
      })
    this.userSnapshotPromise = promise
    return promise
  }

  /** Read one coherent project-dimension snapshot for a workspace cwd. */
  async readProjectCatalog(cwd: string): Promise<CatalogSnapshot> {
    const projectRoot = await resolveProjectRoot(cwd)
    if (this.ttls.project <= 0) return this.buildProjectSnapshot(projectRoot)
    const cached = this.projectSnapshots.get(projectRoot)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.snapshot
    const inFlight = this.projectSnapshotPromises.get(projectRoot)
    if (inFlight !== undefined) return inFlight
    const revision = this.host.revision
    const generation = this.host.scanGeneration
    const promise = this.buildProjectSnapshot(projectRoot)
      .then(snapshot => {
        if (revision === this.host.revision && generation === this.host.scanGeneration) {
          this.projectSnapshots.set(projectRoot, { snapshot, expiresAt: Date.now() + this.ttls.project })
        }
        return snapshot
      })
      .finally(() => {
        if (this.projectSnapshotPromises.get(projectRoot) === promise) this.projectSnapshotPromises.delete(projectRoot)
      })
    this.projectSnapshotPromises.set(projectRoot, promise)
    return promise
  }

  /** One snapshot for a dimension root, reusing cached discovery when it is fresh. */
  async build(state: SuiteState, dimension: SuiteDimension, dimensionRoot: string, skipScanCache = false): Promise<CatalogSnapshot> {
    const fingerprint = JSON.stringify([dimension, dimensionRoot, state.sources, this.host.scanProjectLayouts])
    const cached = this.scanCache.get(fingerprint)
    // The user snapshot's TTL also bounds scan reuse: a snapshot rebuild that
    // replays a 30s scan cache would silently outlive its own staleness bound.
    const scanCacheTtl = dimension === 'user' ? Math.min(this.ttls.user, SCAN_CACHE_TTL_MS) : SCAN_CACHE_TTL_MS
    const cacheFresh = !skipScanCache && cached !== undefined && Date.now() - cached.at < scanCacheTtl
    let discovered: Suite[]
    let scanNotes: Record<string, string[]>
    if (cacheFresh && cached !== undefined) {
      discovered = cached.discovered
      scanNotes = cached.scanNotes
    } else {
      const generation = this.host.scanGeneration
      let pending = this.scanPromises.get(fingerprint)
      if (pending === undefined) {
        pending = discoverSourceListWithNotes(state.sources, dimension, dimensionRoot, this.host.scanProjectLayouts)
        this.scanPromises.set(fingerprint, pending)
      }
      let result: Awaited<typeof pending>
      try {
        result = await pending
      } finally {
        if (this.scanPromises.get(fingerprint) === pending) this.scanPromises.delete(fingerprint)
      }
      discovered = result.suites
      scanNotes = result.scanNotes
      // A scan started before a content mutation must not repopulate its cache.
      if (generation === this.host.scanGeneration) {
        if (this.scanCache.size >= SCAN_CACHE_MAX_ENTRIES) this.scanCache.clear()
        this.scanCache.set(fingerprint, { at: Date.now(), discovered, scanNotes })
      }
    }
    const suites = this.host.project(discovered, state, dimension)
    return {
      revision: this.host.revision,
      sources: [...state.sources],
      suites,
      enabledSuites: suites.filter(suite => suite.enabled),
      ...(Object.keys(scanNotes).length > 0 ? { scanNotes } : {})
    }
  }

  /** Drop every cached dimension snapshot and its in-flight dedupe slot. */
  invalidateSnapshots(): void {
    this.userSnapshot = undefined
    this.userSnapshotExpiresAt = 0
    this.userSnapshotPromise = undefined
    this.projectSnapshots.clear()
    this.projectSnapshotPromises.clear()
  }

  /** Drop cached discovery and its in-flight dedupe slots. */
  invalidateScans(): void {
    this.scanCache.clear()
    this.scanPromises.clear()
  }

  private async buildProjectSnapshot(projectRoot: string): Promise<CatalogSnapshot> {
    const state = await loadState(join(projectRoot, STATE_FILE_NAME))
    // TTL 0 means caching is disabled for this dimension: bypass the scan
    // cache so every read observes the working tree as it stands.
    return this.build(state, 'project', projectRoot, this.ttls.project <= 0)
  }
}
