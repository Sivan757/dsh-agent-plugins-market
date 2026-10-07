/**
 * The runtime's single owner of per-workspace entry filters.
 *
 * The six surface switches keep flowing through {@link SurfaceToggleService};
 * this service extends that state with the per-entry deny sets the project
 * resource window writes. Both live in the same per-workspace document (see
 * `application/state/resource-filters`), so one file still answers "what does
 * this workspace mount" — the service here adds the entry-level questions the
 * mount contributors ask and the one write path the routes call.
 *
 * The favorite side is global state (cross-project by design) and lives in
 * `application/state/resource-favorites`; this service only applies one
 * favorite by rewriting the workspace document, so there is exactly one
 * writer of per-workspace truth.
 *
 * @module runtime/host/resource-filter-service
 */
import type { ResourceFace } from '../../../../market-contracts/src/contracts/resource-window.js'
import type { SurfaceToggleKey } from '../../../../market-contracts/src/contracts/surface-toggles.js'
import type { ResourceFavoriteWire } from '../../../../market-contracts/src/contracts/resource-window.js'
import { allFiltersOn, loadResourceFilters, saveResourceFilters, type ResourceFilters } from '../../application/state/resource-filters.js'
import { deleteResourceFavorite, loadResourceFavorites, saveResourceFavorite } from '../../application/state/resource-favorites.js'
import type { ResourceFavoriteInput } from '../../../../market-contracts/src/contracts/resource-window.js'

/** What a filter change asks the runtime to do: the standard refresh chain. */
export interface ResourceFilterHooks {
  onFiltersChanged(): Promise<void> | void
}

export class ResourceFilterService {
  private filters: ResourceFilters
  private readonly workspace: string

  constructor(
    private readonly dataRoot: string,
    workspace: string | undefined,
    private readonly hooks: ResourceFilterHooks
  ) {
    this.workspace = workspace ?? ''
    this.filters = allFiltersOn()
  }

  /** Load the persisted state for this workspace into memory. */
  async reload(): Promise<void> {
    if (this.workspace === '') return
    this.filters = await loadResourceFilters(this.dataRoot, this.workspace)
  }

  /** The live per-entry deny sets (read by the mount contributors). */
  currentFilters(): ResourceFilters {
    return this.filters
  }

  /** Whether one entry may mount right now. Unknown ids are never filtered. */
  allowsEntry(face: ResourceFace, entryId: string): boolean {
    return !(this.filters.offEntries[face]?.includes(entryId) ?? false)
  }

  /** Structural alias the mount registries' entry-filter setters consume. */
  allows(face: ResourceFace, entryId: string): boolean {
    return this.allowsEntry(face, entryId)
  }

  /** The deny set of one face; an undefined face has nothing denied. */
  offEntriesOf(face: ResourceFace): string[] {
    return this.filters.offEntries[face] ?? []
  }

  /** Flip one entry, persist, and ask the runtime to reconcile. */
  async setEntry(face: ResourceFace, entryId: string, enabled: boolean): Promise<ResourceFilters> {
    const current = this.filters.offEntries[face] ?? []
    const next = enabled ? current.filter(id => id !== entryId) : current.includes(entryId) ? current : [...current, entryId]
    const offEntries =
      next.length === 0 ? Object.fromEntries(Object.entries(this.filters.offEntries).filter(([key]) => key !== face)) : { ...this.filters.offEntries, [face]: next }
    this.filters = { ...this.filters, offEntries }
    if (this.workspace !== '') await saveResourceFilters(this.dataRoot, this.workspace, this.filters)
    await this.hooks.onFiltersChanged()
    return this.filters
  }

  /** Overwrite the deny sets from one favorite, persist, and reconcile. */
  async applyFilters(toggles: Record<SurfaceToggleKey, boolean>, offEntries: Partial<Record<ResourceFace, string[]>>): Promise<ResourceFilters> {
    this.filters = { toggles, offEntries }
    if (this.workspace !== '') await saveResourceFilters(this.dataRoot, this.workspace, this.filters)
    await this.hooks.onFiltersChanged()
    return this.filters
  }

  /** List the global favorites (cross-project snapshots). */
  async favorites(): Promise<ResourceFavoriteWire[]> {
    return loadResourceFavorites(this.dataRoot)
  }

  /** Append one favorite snapshot to the global file. */
  async saveFavorite(input: ResourceFavoriteInput): Promise<ResourceFavoriteWire> {
    return saveResourceFavorite(this.dataRoot, input)
  }

  /** Drop one favorite from the global file. */
  async deleteFavorite(id: string): Promise<void> {
    await deleteResourceFavorite(this.dataRoot, id)
  }
}
