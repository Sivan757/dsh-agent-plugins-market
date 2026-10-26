/** One live workspace policy snapshot. Publication follows successful persistence. */
import type { ResourceFace, ResourceFavoriteWire } from '../../../../market-contracts/src/contracts/resource-window.js'
import { SURFACE_TOGGLE_KEYS, type SurfaceToggleKey, type SurfaceToggles } from '../../../../market-contracts/src/contracts/surface-toggles.js'
import { allFiltersOn, loadResourceFilters, mutateResourceFilters, type ResourceFilters } from '../../application/state/workspace-policy.js'
import { settlesWithin, SWITCH_SETTLE_MS } from '../../../../market-catalog/src/index.js'
import { deleteResourceFavorite, loadResourceFavorites, saveResourceFavorite } from '../../application/state/resource-favorites.js'
import type { ResourceFavoriteInput } from '../../../../market-contracts/src/contracts/resource-window.js'

export interface ResourceFilterHooks {
  onFiltersChanged(): Promise<void> | void
  /** Report a change pipeline that outlived the switch budget or failed after the write landed. */
  onPipelineReport?(message: string): void
}

export class ResourceFilterService {
  private filters = allFiltersOn()
  private readonly workspace: string
  private tail: Promise<void> = Promise.resolve()

  /**
   * @param dataRoot - the plugin data root the workspace policy is stored under.
   * @param workspace - the workspace this policy belongs to; empty means memory only.
   * @param hooks - the change pipeline this service schedules and reports on.
   * @param settleMs - how long one write waits for that pipeline before
   *   answering anyway; `0` answers immediately. Resolved from configuration by
   *   the composition root through `resolveSwitchSettleMs`, so this class never
   *   decides a deployment's budget itself.
   */
  constructor(
    private readonly dataRoot: string,
    workspace: string | undefined,
    private readonly hooks: ResourceFilterHooks,
    private readonly settleMs: number = SWITCH_SETTLE_MS
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
      await this.settle()
      return this.currentFilters()
    })
  }

  /**
   * Wait for the change pipeline this write scheduled, within the switch budget.
   *
   * The write above is the request's durability point: it is on disk and in the
   * published snapshot before this runs, and the pipeline cannot undo it.
   *
   * A pass that settles inside the budget keeps the previous contract: its
   * failure reaches the caller, which is how a broken refresh is reported. A
   * pass still running at the budget does not hold the switch, because it is
   * mounting and unmounting servers and one server can spend its whole startup
   * timeout. Its overrun, and a failure that lands after the answer, are
   * reported instead, and the pass itself is never cancelled.
   */
  private async settle(): Promise<void> {
    let failure: { error: unknown } | undefined
    const pipeline = Promise.resolve()
      .then(() => this.hooks.onFiltersChanged())
      .then(
        () => undefined,
        (error: unknown) => {
          failure = { error }
        }
      )
    if (this.settleMs <= 0) {
      // A zero budget is the explicit "never wait" setting, so the pipeline is
      // observed only for reporting and its result never reaches the caller.
      void pipeline.then(() => {
        if (failure !== undefined) this.reportLateFailure(failure.error)
      })
      return
    }
    if (await settlesWithin(pipeline, this.settleMs)) {
      if (failure !== undefined) throw failure.error
      return
    }
    this.hooks.onPipelineReport?.('the mount pass is still running after ' + String(this.settleMs) + 'ms; the switch answered and the pass continues')
    void pipeline.then(() => {
      if (failure !== undefined) this.reportLateFailure(failure.error)
    })
  }

  /** Report a pipeline failure that arrived after the switch already answered. */
  private reportLateFailure(error: unknown): void {
    this.hooks.onPipelineReport?.('the mount pass failed after the switch answered: ' + (error instanceof Error ? error.message : String(error)))
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
