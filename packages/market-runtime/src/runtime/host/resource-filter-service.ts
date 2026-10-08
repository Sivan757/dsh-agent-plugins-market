/** One live workspace policy snapshot. Publication follows successful persistence. */
import type { ResourceFace, ResourceFavoriteWire } from '../../../../market-contracts/src/contracts/resource-window.js'
import { SURFACE_TOGGLE_KEYS, type SurfaceToggleKey, type SurfaceToggles } from '../../../../market-contracts/src/contracts/surface-toggles.js'
import { allFiltersOn, loadResourceFilters, mutateResourceFilters, type ResourceFilters } from '../../application/state/workspace-policy.js'
import { deleteResourceFavorite, loadResourceFavorites, saveResourceFavorite } from '../../application/state/resource-favorites.js'
import type { ResourceFavoriteInput } from '../../../../market-contracts/src/contracts/resource-window.js'

export interface ResourceFilterHooks {
  onFiltersChanged(): Promise<void> | void
}

export class ResourceFilterService {
  private filters = allFiltersOn()
  private readonly workspace: string
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly dataRoot: string,
    workspace: string | undefined,
    private readonly hooks: ResourceFilterHooks
  ) {
    this.workspace = workspace ?? ''
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const running = this.tail.then(work)
    this.tail = running.then(
      () => {},
      () => {}
    )
    return running
  }

  /** Reload shares mutation ordering; an earlier read cannot overwrite a later write. */
  async reload(): Promise<void> {
    await this.enqueue(async () => {
      if (this.workspace !== '') this.filters = await loadResourceFilters(this.dataRoot, this.workspace)
    })
  }

  /** Callers receive detached data, never the owner's mutable snapshot. */
  currentFilters(): ResourceFilters {
    return structuredClone(this.filters)
  }

  currentToggles(): SurfaceToggles {
    return { ...this.filters.toggles }
  }

  allowsSurface(key: SurfaceToggleKey): boolean {
    return this.filters.toggles[key]
  }

  allowsEntry(face: ResourceFace, entryId: string): boolean {
    return !(this.filters.offEntries[face]?.includes(entryId) ?? false)
  }

  allows(face: ResourceFace, entryId: string): boolean {
    return this.allowsEntry(face, entryId)
  }

  offEntriesOf(face: ResourceFace): string[] {
    return [...(this.filters.offEntries[face] ?? [])]
  }

  private mutate(change: (current: ResourceFilters) => ResourceFilters): Promise<ResourceFilters> {
    return this.enqueue(async () => {
      const next = this.workspace === '' ? change(structuredClone(this.filters)) : await mutateResourceFilters(this.dataRoot, this.workspace, change)
      this.filters = next
      await this.hooks.onFiltersChanged()
      return this.currentFilters()
    })
  }

  async setSurface(key: SurfaceToggleKey, enabled: boolean): Promise<SurfaceToggles> {
    if (!SURFACE_TOGGLE_KEYS.includes(key)) return this.currentToggles()
    return (await this.mutate(current => ({ ...current, toggles: { ...current.toggles, [key]: enabled } }))).toggles
  }

  async setEntry(face: ResourceFace, entryId: string, enabled: boolean): Promise<ResourceFilters> {
    return this.mutate(current => {
      const entries = current.offEntries[face] ?? []
      const next = enabled ? entries.filter(id => id !== entryId) : entries.includes(entryId) ? entries : [...entries, entryId]
      const offEntries = next.length === 0 ? Object.fromEntries(Object.entries(current.offEntries).filter(([key]) => key !== face)) : { ...current.offEntries, [face]: next }
      return { ...current, offEntries }
    })
  }

  /** One complete commit and one refresh. Failed refresh does not roll back persisted state. */
  async applyFilters(toggles: SurfaceToggles, offEntries: Partial<Record<ResourceFace, string[]>>): Promise<ResourceFilters> {
    const captured = structuredClone({ toggles, offEntries })
    return this.mutate(() => captured)
  }

  async favorites(): Promise<ResourceFavoriteWire[]> {
    return loadResourceFavorites(this.dataRoot)
  }
  async saveFavorite(input: ResourceFavoriteInput): Promise<ResourceFavoriteWire> {
    return saveResourceFavorite(this.dataRoot, input)
  }
  async deleteFavorite(id: string): Promise<void> {
    await deleteResourceFavorite(this.dataRoot, id)
  }
}
