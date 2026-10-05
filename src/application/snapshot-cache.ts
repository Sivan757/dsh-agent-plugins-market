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
import { join, resolve } from 'node:path'
import { resolveProjectRoot, STATE_FILE_NAME } from '../catalog/paths.js'
import { discoverSourceListWithNotes } from '../catalog/source-catalog.js'
import { loadState } from './state/state-store.js'
import type { DiscoveredSuite, SourceRef, Suite, SuiteDimension, SuiteState } from '../model/types.js'

export const SCAN_CACHE_TTL_MS = 30_000
const SCAN_CACHE_MAX_ENTRIES = 8

/**
 * When the background refresh of the user snapshot runs, as a fraction of its
 * TTL. Refreshing before the snapshot expires is what keeps the TTL a
 * *staleness* bound rather than a cost every read pays: a read arriving after
 * the refresh lands is served from the cache, where it used to trigger the
 * whole discovery scan itself.
 */
const USER_REFRESH_LEAD_RATIO = 0.8

/**
 * How long the background refresh keeps running after the last user-dimension
 * read, in TTLs. The TTL exists to bound how long an out-of-band working-tree
 * edit stays invisible, so the refresh has to stay frequent while the catalog
 * is in use; this multiple is what stops it from scanning a 2,500-suite
 * catalog forever once nobody is reading. A read after the window pays exactly
 * one scan — the cost every read paid before the window existed — and warms
 * the cache up again.
 */
const USER_KEEP_WARM_TTL_MULTIPLE = 10

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
  project(discovered: readonly DiscoveredSuite[], state: SuiteState, dimension: SuiteDimension): Suite[]
}

export class SnapshotCache {
  private readonly scanCache = new Map<string, { at: number; discovered: DiscoveredSuite[]; scanNotes: Record<string, string[]> }>()
  private readonly scanPromises = new Map<string, Promise<{ suites: DiscoveredSuite[]; scanNotes: Record<string, string[]> }>>()
  private userSnapshot: CatalogSnapshot | undefined
  private userSnapshotExpiresAt = 0
  private userSnapshotPromise: Promise<CatalogSnapshot> | undefined
  /** The armed keep-warm refresh, or undefined when none is scheduled. */
  private userRefreshTimer: ReturnType<typeof setTimeout> | undefined
  /** Set by {@link dispose}: the keep-warm chain is over and never re-arms. */
  private disposed = false
  /** When the user dimension was last read; the keep-warm window closes from here. */
  private lastUserReadAt = 0
  /** Project-dimension snapshots keyed by project root, with TTL freshness. */
  private readonly projectSnapshots = new Map<string, { snapshot: CatalogSnapshot; expiresAt: number }>()
  private readonly projectSnapshotPromises = new Map<string, Promise<CatalogSnapshot>>()

  constructor(
    private readonly host: SnapshotHost,
    private readonly ttls: { user: number; project: number },
    /** Clock seam; tests drive TTL expiry, the scan cache, and the idle window through it. */
    private readonly now: () => number = Date.now
  ) {}

  /** Read one coherent user-dimension snapshot, reusing in-flight discovery. */
  async readUserCatalog(): Promise<CatalogSnapshot> {
    // TTL 0 disables snapshot caching: every read observes fresh discovery,
    // mirroring the project dimension's caching-disabled semantics.
    if (this.ttls.user <= 0) return this.build(this.host.state, 'user', this.host.userRoot)
    this.lastUserReadAt = this.now()
    const snapshot = await this.loadUserSnapshot(false)
    this.armUserRefresh()
    return snapshot
  }

  /**
   * Build the user snapshot, or join the build already in flight.
   *
   * `forceRescan` is the keep-warm refresh's entry point: it re-reads the
   * working tree even while the discovery cache would still answer, because
   * replaying that cache would let one scan outlive the freshness bound the
   * TTL states.
   */
  private loadUserSnapshot(forceRescan: boolean): Promise<CatalogSnapshot> {
    if (!forceRescan && this.userSnapshot !== undefined && this.now() < this.userSnapshotExpiresAt) return Promise.resolve(this.userSnapshot)
    if (this.userSnapshotPromise !== undefined) return this.userSnapshotPromise
    const revision = this.host.revision
    const generation = this.host.scanGeneration
    const promise = this.build(this.host.state, 'user', this.host.userRoot, forceRescan)
      .then(snapshot => {
        if (revision === this.host.revision && generation === this.host.scanGeneration) {
          this.userSnapshot = snapshot
          this.userSnapshotExpiresAt = this.now() + this.ttls.user
        }
        return snapshot
      })
      .finally(() => {
        if (this.userSnapshotPromise === promise) this.userSnapshotPromise = undefined
      })
    this.userSnapshotPromise = promise
    return promise
  }

  /**
   * Keep the user snapshot warm while the catalog is in use.
   *
   * Without this, the first read after the TTL lapses pays the full discovery
   * scan — the normal case for a panel opened minutes apart. The refresh runs
   * {@link USER_REFRESH_LEAD_RATIO} of the TTL before the snapshot expires, so
   * a read never waits for it, and it is armed by reads: the chain ends
   * {@link USER_KEEP_WARM_TTL_MULTIPLE} TTLs after the last one.
   */
  private armUserRefresh(): void {
    if (this.disposed || this.ttls.user <= 0 || this.userRefreshTimer !== undefined) return
    const delay = Math.max(1, Math.round(this.ttls.user * USER_REFRESH_LEAD_RATIO))
    const timer = setTimeout(() => {
      if (this.userRefreshTimer === timer) this.userRefreshTimer = undefined
      this.refreshUserSnapshot()
    }, delay)
    // A waiting refresh must not hold the host process open.
    timer.unref?.()
    this.userRefreshTimer = timer
  }

  /** Run one background refresh unless the catalog has been idle past its window. */
  private refreshUserSnapshot(): void {
    if (this.disposed || this.now() - this.lastUserReadAt > this.ttls.user * USER_KEEP_WARM_TTL_MULTIPLE) return
    void this.loadUserSnapshot(true)
      .catch(() => undefined)
      .finally(() => this.armUserRefresh())
  }

  /** Read one coherent project-dimension snapshot for a workspace cwd. */
  async readProjectCatalog(cwd: string): Promise<CatalogSnapshot> {
    const projectRoot = await resolveProjectRoot(cwd)
    // A cwd with no `.git` ancestor resolves to itself as its own project root,
    // so a session started in the harness home lands on the user dimension root.
    // That directory is the user's catalog, not a project's: reading it would
    // present every user-level suite as a project suite of that one session.
    if (resolve(projectRoot) === resolve(this.host.userRoot)) {
      return { revision: this.host.revision, sources: [], suites: [], enabledSuites: [] }
    }
    if (this.ttls.project <= 0) return this.buildProjectSnapshot(projectRoot)
    const cached = this.projectSnapshots.get(projectRoot)
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.snapshot
    const inFlight = this.projectSnapshotPromises.get(projectRoot)
    if (inFlight !== undefined) return inFlight
    const revision = this.host.revision
    const generation = this.host.scanGeneration
    const promise = this.buildProjectSnapshot(projectRoot)
      .then(snapshot => {
        if (revision === this.host.revision && generation === this.host.scanGeneration) {
          this.projectSnapshots.set(projectRoot, { snapshot, expiresAt: this.now() + this.ttls.project })
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
    const cacheFresh = !skipScanCache && cached !== undefined && this.now() - cached.at < scanCacheTtl
    let discovered: DiscoveredSuite[]
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
        this.scanCache.set(fingerprint, { at: this.now(), discovered, scanNotes })
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

  /**
   * End the keep-warm refresh for good.
   *
   * Clearing the armed timer is not enough on its own: a refresh already in
   * flight re-arms through its own `.finally()`, so a teardown landing while
   * one runs would leave the chain scanning the whole catalog every 0.8 TTL
   * with nobody reading it. Disposal is therefore terminal — the chain end is
   * checked before it arms and before it runs — and reads after it still answer
   * from the cache or rebuild one, they just no longer keep it warm.
   */
  dispose(): void {
    this.disposed = true
    if (this.userRefreshTimer !== undefined) {
      clearTimeout(this.userRefreshTimer)
      this.userRefreshTimer = undefined
    }
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
