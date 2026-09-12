/**
 * The shared mutable core of one catalog: the persisted state, the serialized
 * mutation queue, the revision and scan generations, and the change pipeline
 * every mutation funnels through.
 *
 * The collaborators receive this object instead of reaching into each other,
 * so the invariants they share — one queue, one generation counter, one
 * notification path — have a single owner.
 */
import { join } from 'node:path'
import type { GitOptions } from '../catalog/git.js'
import { STATE_FILE_NAME } from '../catalog/paths.js'
import { EMPTY_STATE, loadState, saveState } from '../runtime/state-store.js'
import { effectiveSurfaces, type InstalledEntry, type Suite, type SuiteDimension, type SuiteState } from '../model/types.js'
import type { CatalogPortsOverride } from './ports.js'
import { SCAN_CACHE_TTL_MS, SnapshotCache, type SnapshotHost } from './snapshot-cache.js'

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
  /** Host seams; unwired members fall back to the defaults in `ports.ts`. */
  ports?: CatalogPortsOverride
  /**
   * Freshness window for cached project-dimension snapshots. The project
   * catalog sits on the skill-list hot path (every provider `list()` call),
   * and its inputs — the project's own files — change only through editor
   * saves; a short window keeps listing cheap without going stale. Defaults
   * to 5 seconds; 0 disables caching.
   */
  projectSnapshotTtlMs?: number
  /**
   * Freshness window for the cached user-dimension snapshot (defaults to the
   * scan-cache TTL). It bounds how long out-of-band edits to local sources
   * stay invisible; 0 disables snapshot caching. Tests pass a small value so
   * staleness regressions need no real sleeps.
   */
  userSnapshotTtlMs?: number
}

/** Key of one install entry in the persisted `installed` record. */
export function installKey(sourceId: string, suiteId: string): string {
  return `${sourceId}/${suiteId}`
}

export class CatalogContext implements SnapshotHost {
  private currentState: SuiteState = EMPTY_STATE
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private currentRevision = 0
  private currentScanGeneration = 0
  private scanProjectLayoutsEnabled = true

  readonly statePath: string
  readonly userRoot: string
  readonly dataRoot: string
  readonly git: CatalogGitOptions
  /** Discovery scans and dimension snapshots derived from {@link state}. */
  readonly snapshots: SnapshotCache
  private readonly onChanged: () => void | Promise<void>

  constructor(options: CatalogOptions) {
    this.statePath = join(options.userRoot, STATE_FILE_NAME)
    this.userRoot = options.userRoot
    this.dataRoot = options.dataRoot
    this.git = options.git ?? {}
    this.onChanged = options.onChanged
    this.snapshots = new SnapshotCache(this, {
      user: options.userSnapshotTtlMs ?? SCAN_CACHE_TTL_MS,
      project: options.projectSnapshotTtlMs ?? 5_000
    })
  }

  get state(): SuiteState {
    return this.currentState
  }

  /** Bumped by every mutation: a snapshot built at an older revision is never published. */
  get revision(): number {
    return this.currentRevision
  }

  /** Bumped by every content-changing mutation: a scan started earlier never repopulates its cache. */
  get scanGeneration(): number {
    return this.currentScanGeneration
  }

  /** Whether native project layouts (`.claude/`, `.agents/`) take part in discovery. */
  get scanProjectLayouts(): boolean {
    return this.scanProjectLayoutsEnabled
  }

  /** One install entry, or undefined when the suite is not installed. */
  installed(sourceId: string, suiteId: string): InstalledEntry | undefined {
    return this.currentState.installed[installKey(sourceId, suiteId)]
  }

  /** Load persisted user state once at plugin activation. */
  async load(): Promise<void> {
    this.currentState = await loadState(this.statePath)
    this.invalidateScans()
    this.invalidateSnapshot(false)
  }

  /** Replace the persisted state and write it out. */
  async commit(next: SuiteState): Promise<void> {
    this.currentState = next
    await saveState(this.statePath, next)
  }

  /** Apply the host's project-layout switch and invalidate every project snapshot. */
  async setScanProjectLayouts(enabled: boolean): Promise<void> {
    if (this.scanProjectLayoutsEnabled === enabled) return
    this.scanProjectLayoutsEnabled = enabled
    await this.notifyChanged()
  }

  /**
   * Apply the install state to freshly discovered suites: enablement, the
   * effective surface toggles, and the lock/install timestamps the market
   * cards report.
   */
  project(discovered: readonly Suite[], state: SuiteState, dimension: SuiteDimension): Suite[] {
    return discovered.map(suite => {
      const installed = state.installed[installKey(suite.sourceId, suite.id)]
      // Native project layouts (`.claude/`, `.agents/`) are the repository's
      // own files read in place: they carry no install state and stay enabled.
      const enabled = suite.manifest.layout === 'project-native' || installed?.enabled === true
      return {
        ...suite,
        enabled,
        activeSurfaces: {
          ...effectiveSurfaces(installed?.surfaces),
          ...(suite.manifest.layout === 'project-native' ? suite.activeSurfaces : {}),
          ...(dimension === 'project' ? { lsp: false } : {})
        },
        ...(installed?.lockCommit === undefined ? {} : { lockCommit: installed.lockCommit }),
        ...(installed?.installedAt === undefined ? {} : { installedAt: installed.installedAt })
      }
    })
  }

  /**
   * Invalidate snapshots and run the change pipeline. `keepScanCache` marks
   * state-only mutations (install, enable, surface toggles, MCP overrides)
   * whose inputs leave every checkout untouched, so the next snapshot
   * re-derives from cached discovery instead of rescanning the filesystem.
   */
  async notifyChanged(keepScanCache = false): Promise<void> {
    if (!keepScanCache) this.invalidateScans()
    this.invalidateSnapshot(true)
    await this.onChanged()
  }

  /** Drop every cached dimension snapshot; `increment` advances the revision. */
  invalidateSnapshot(increment: boolean): void {
    if (increment) this.currentRevision++
    this.snapshots.invalidateSnapshots()
  }

  /** Drop cached discovery and advance the generation a scan is validated against. */
  invalidateScans(): void {
    this.currentScanGeneration++
    this.snapshots.invalidateScans()
  }

  /** Serialize one mutation behind every mutation queued before it. */
  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.catch(() => {})
    return result
  }
}
