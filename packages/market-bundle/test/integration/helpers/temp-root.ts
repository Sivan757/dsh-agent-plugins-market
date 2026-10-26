import { rm } from 'node:fs/promises'

/**
 * Remove one per-test temporary root.
 *
 * `mkdtemp` roots hold the plugin data tree the entry writes into: MCP
 * `${PLUGIN_DATA}` directories, hook configuration, the workspace policy. Every
 * one of those writers closes a file or a child process handle and the removal
 * can run while the operating system is still releasing it. Windows deletes a
 * file whose handle is open by marking it delete-pending, which leaves its
 * directory entry in place for a moment; `rmdir` then reports `ENOTEMPTY` for a
 * directory the same call just emptied.
 *
 * `fs.rm` retries exactly this class of failure (with linear backoff) when given
 * a budget, so the budget is what makes teardown stop depending on timing. The
 * retry is sized to the observed contention, not to hide a missing teardown: a
 * writer that outlives the fiber is a product defect and still fails this call
 * after the budget runs out.
 *
 * `force` is kept for the one case it covers: Node ignores only `ENOENT`, so a
 * root a case already removed is not a teardown failure, while a permission
 * error still rejects.
 *
 * @param path - a directory created by `mkdtemp` for one test.
 * @returns fulfillment once the root is gone, or the original failure.
 */
export function removeTempRoot(path: string): Promise<void> {
  return rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
}
