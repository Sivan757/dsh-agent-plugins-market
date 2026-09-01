/**
 * One-time migration from the pre-0.5.4 split layout, where suite data and
 * MCP overrides lived under a sibling `~/.dsh/agent-plugins-data` root: if
 * that root exists, its `data/` and `overrides/` subtrees move under the
 * user root and the emptied sibling is removed. Idempotent — a missing,
 * empty, or already-migrated legacy root is a no-op — and best-effort: a
 * filesystem failure leaves both trees in place for a manual move rather
 * than deleting user data.
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Migrate `data/` and `overrides/` from the legacy sibling root, if present. */
export async function migrateLegacyDataRoot(legacyRoot: string, userRoot: string): Promise<void> {
  if (!existsSync(legacyRoot)) return
  let entries: string[] = []
  try {
    entries = await readdir(legacyRoot)
  } catch {
    // Unreadable legacy root: leave everything for a manual move.
    return
  }
  for (const subtree of ['data', 'overrides']) {
    const from = join(legacyRoot, subtree)
    if (!entries.includes(subtree) || !existsSync(from)) continue
    const to = join(userRoot, subtree)
    if (existsSync(to)) {
      // Merge into an existing target: copy contents, then drop the source.
      await mkdir(to, { recursive: true })
      for (const entry of await readdir(from)) {
        await cp(join(from, entry), join(to, entry), { recursive: true, force: false, errorOnExist: false })
      }
      await rm(from, { recursive: true, force: true })
    } else {
      await mkdir(join(userRoot), { recursive: true })
      await cp(from, to, { recursive: true })
      await rm(from, { recursive: true, force: true })
    }
  }
  // Remove the legacy root only when nothing else remains inside it.
  const remaining = await readdir(legacyRoot).catch(() => ['keep'])
  if (remaining.length === 0) await rm(legacyRoot, { recursive: true, force: true })
}
