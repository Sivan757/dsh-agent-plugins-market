/**
 * One project-dimension reader per workspace, shared by every session in it.
 *
 * A reader owns three panel stores, and each store owns the row cache that
 * collapses repeated scans of the same documents. Keying the reader by session
 * gave every session its own copy of that cache, so two sessions opened in one
 * workspace scanned the same files twice and shared nothing. The workspace is
 * the only input that varies, so the workspace is what keys the map.
 *
 * The map holds one entry per workspace that a live agent names. Creating is
 * lazy because a reader is only built when something reads a panel, so a session
 * that never opens one costs nothing.
 * @module application/project-readers
 */

/** What one workspace's reader must offer the callers that share it. */
export interface ProjectReaderCache<Reader> {
  /**
   * The reader for one agent's workspace.
   *
   * Two agents in the same workspace receive the same instance, which is what
   * makes their scans shared. The returned reader is the one a caller reads
   * through, so holding it across reads keeps the cache warm.
   * @param workspace - the absolute project directory the agent works in.
   * @returns the reader for that workspace.
   */
  reader(workspace: string): Reader
  /**
   * Forget a workspace once no live agent names it.
   *
   * Called when a session ends, so a closed session cannot pin its scans for the
   * life of the process. A workspace another agent still uses is kept.
   * @param workspace - the workspace the departing session worked in.
   * @param stillUsed - whether any other live agent names that workspace.
   */
  release(workspace: string, stillUsed: boolean): void
  /** Drop every reader; used when the whole extension tears down. */
  clear(): void
  /** How many workspaces currently hold a reader. Read by tests and diagnostics. */
  readonly size: number
}

/**
 * Build a per-workspace reader cache.
 * @param create - builds one workspace's reader; called at most once per
 *   workspace while that workspace stays live.
 * @returns the cache.
 */
export function createProjectReaderCache<Reader>(create: (workspace: string) => Reader): ProjectReaderCache<Reader> {
  const readers = new Map<string, Reader>()
  return {
    reader(workspace) {
      const existing = readers.get(workspace)
      if (existing === undefined) {
        const created = create(workspace)
        readers.set(workspace, created)
        return created
      }
      // Re-insert so iteration order is least-recently-used, which is what makes
      // the first key the right one to drop when a workspace closes.
      readers.delete(workspace)
      readers.set(workspace, existing)
      return existing
    },
    release(workspace, stillUsed) {
      if (!stillUsed) readers.delete(workspace)
    },
    clear() {
      readers.clear()
    },
    get size() {
      return readers.size
    }
  }
}
