/** Compatibility migration for the pre-0.5.4 sibling data directory. */
import { readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { mergeStorageTree } from './storage-migration.js'

/** Move owned data subtrees without overwriting or deleting conflicting files. */
export async function migrateLegacyDataRoot(legacyRoot: string, dataRoot: string): Promise<void> {
  const result = { conflicts: [] as string[] }
  for (const subtree of ['data', 'overrides']) await mergeStorageTree(join(legacyRoot, subtree), join(dataRoot, subtree), result)
  if ((await readdir(legacyRoot).catch(() => ['keep'])).length === 0) await rmdir(legacyRoot)
}
