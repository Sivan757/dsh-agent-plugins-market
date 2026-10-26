/**
 * One live workspace tab layout: the stowed tabs the tab row answers to.
 *
 * A sibling of `ResourceFilterService` rather than a member of it. Each owns one
 * document, and a shared writer would let one surface's save overwrite the
 * other's. The lifetime rules match: mutations are serialized on a tail promise,
 * publication follows successful persistence, and `currentLayout` hands out a
 * detached snapshot.
 * @module runtime/host/tab-layout-service
 */
import { loadTabLayout, saveTabLayout, type TabLayout } from '../../application/state/tab-layout.js'
import { emptyTabLayout, resolveHiddenTabs, type TabLayoutWire } from '../../../../market-contracts/src/contracts/tab-layout.js'

export type { TabLayout }

export class TabLayoutService {
  private layout: TabLayout = emptyTabLayout()
  private readonly workspace: string
  private tail: Promise<void> = Promise.resolve()

  /**
   * @param dataRoot - the plugin data root the layout is stored under.
   * @param workspace - the workspace this layout belongs to. Empty means memory
   *   only: a composition without a workspace path still answers reads and
   *   applies writes for the life of the process instead of failing every call.
   */
  constructor(
    private readonly dataRoot: string,
    workspace: string | undefined
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

  /** Reload shares mutation ordering, so an earlier read cannot undo a later write. */
  async reload(): Promise<void> {
    await this.enqueue(async () => {
      if (this.workspace !== '') this.layout = await loadTabLayout(this.dataRoot, this.workspace)
    })
  }

  /** The live layout as a value no caller can mutate. */
  currentLayout(): TabLayoutWire {
    return { hidden: [...this.layout.hidden] }
  }

  /**
   * Replace the stow list and publish it.
   *
   * The request is resolved through the same clamp the document parser uses, so
   * a caller that asks to stow every tab gets nothing stowed rather than a row
   * the workspace cannot render.
   * @param hidden - the requested stow list from a request body or another caller.
   * @returns the committed layout.
   */
  async setHidden(hidden: unknown): Promise<TabLayoutWire> {
    const requested = resolveHiddenTabs(hidden)
    return this.enqueue(async () => await this.commit(requested))
  }

  /** Show every tab again. */
  async showAll(): Promise<TabLayoutWire> {
    return this.enqueue(async () => await this.commit([]))
  }

  /**
   * Persist the requested list, then publish the committed one.
   *
   * A failed write throws before publication, so the live layout stays at its
   * previous value and the caller can report the failure while the row keeps
   * matching what is stored.
   */
  private async commit(requested: readonly string[]): Promise<TabLayoutWire> {
    const stored = this.workspace === '' ? { hidden: [...requested] } : await saveTabLayout(this.dataRoot, this.workspace, requested)
    this.layout = { hidden: resolveHiddenTabs(stored.hidden) }
    return this.currentLayout()
  }
}
