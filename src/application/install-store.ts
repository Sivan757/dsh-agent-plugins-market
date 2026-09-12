/**
 * Install-state mutations over the persisted record: which suites are
 * installed and enabled, which of their surfaces are on, and the config-seeded
 * sources merged in at activation.
 *
 * The checkout a suite is read from stays source-owned: installing writes an
 * entry, never a file inside the source.
 */
import { isDirectory } from '../catalog/fs-probes.js'
import { discoverSuitesInSource } from '../catalog/suite-scanner.js'
import { SUITE_SURFACE_KEYS, type InstalledEntry, type SourceRef, type SuiteSurfaceKey, type SurfaceOverrides } from '../model/types.js'
import { installKey, type CatalogContext } from './catalog-context.js'
import { tryHead, type SourceStore } from './source-store.js'

export class InstallStore {
  constructor(
    private readonly context: CatalogContext,
    private readonly sources: SourceStore
  ) {}

  /** Install a suite from a source and enable it. The client confirms the
   * injected surfaces (skills / MCP / hooks / commands) in a pre-install
   * dialog before this runs; disabling afterwards is always available. */
  async install(sourceId: string, suiteId: string): Promise<void> {
    return this.context.enqueue(async () => {
      const source = this.context.state.sources.find(entry => entry.id === sourceId)
      if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
      const checkout = this.sources.checkoutPath(source)
      let freshLock: string | undefined
      if (!(await isDirectory(checkout))) freshLock = await this.sources.acquire(source)
      const suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.remote !== undefined) throw new Error(`suite "${suiteId}" is a remote reference (${suite.remote.url}); add its repository as a source before installing`)
      // Archive (or tarball-fallback) sources have no git HEAD; their digest
      // is the lock value.
      const lockCommit = (await tryHead(checkout)) ?? freshLock ?? this.sources.knownHead(sourceId)
      await this.setInstalled(sourceId, suiteId, { enabled: true, installedAt: new Date().toISOString(), lockCommit })
      await this.context.notifyChanged(true)
    })
  }

  /** Uninstall a suite while retaining the source checkout. */
  async uninstall(sourceId: string, suiteId: string): Promise<void> {
    return this.context.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      if (this.context.state.installed[key] === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      const rest = Object.fromEntries(Object.entries(this.context.state.installed).filter(([entryKey]) => entryKey !== key))
      await this.context.commit({ ...this.context.state, installed: rest })
      await this.context.notifyChanged(true)
    })
  }

  /** Enable or disable an installed suite. */
  async setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void> {
    return this.context.enqueue(async () => {
      const entry = this.context.installed(sourceId, suiteId)
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      await this.setInstalled(sourceId, suiteId, { ...entry, enabled })
      await this.context.notifyChanged(true)
    })
  }

  /** Enable or disable one runtime surface of an installed suite. */
  async setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void> {
    return this.context.enqueue(async () => {
      const entry = this.context.installed(sourceId, suiteId)
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      if (!SUITE_SURFACE_KEYS.includes(surface)) throw new Error(`surface "${surface}" is not toggleable`)
      const surfaces: SurfaceOverrides = { ...(entry.surfaces ?? {}), [surface]: enabled }
      await this.setInstalled(sourceId, suiteId, { ...entry, surfaces })
      await this.context.notifyChanged(true)
    })
  }

  /** Append config-seeded sources missing from user state and persist them. */
  async mergeSources(sources: SourceRef[]): Promise<void> {
    const existing = new Set(this.context.state.sources.map(source => source.id))
    const additions = sources.filter(source => !existing.has(source.id))
    if (additions.length === 0) return
    await this.context.commit({ ...this.context.state, sources: [...this.context.state.sources, ...additions] })
    // New sources change the fingerprint, but their content arrives through
    // an acquire, so mark the scan cache dirty conservatively.
    this.context.invalidateScans()
    this.context.invalidateSnapshot(true)
  }

  private async setInstalled(sourceId: string, suiteId: string, entry: InstalledEntry): Promise<void> {
    await this.context.commit({ ...this.context.state, installed: { ...this.context.state.installed, [installKey(sourceId, suiteId)]: entry } })
  }
}
