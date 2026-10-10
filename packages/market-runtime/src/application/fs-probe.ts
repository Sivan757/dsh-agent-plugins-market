/**
 * Structural filesystem questions, answered without trusting an error code.
 *
 * Operating systems disagree about which code a failed read carries: Windows
 * can report `ENOENT` for a child of a path that exists as a file, which a
 * code-only guard mistakes for a removed entry. A caller that tolerates "not
 * there yet" asks this module instead, so the decision comes from the path
 * shape rather than from the platform error vocabulary.
 */
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Stats } from 'node:fs'

/** One path's stat, or `undefined` when the path cannot be read. */
async function statOf(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/**
 * Whether a path is confirmed absent rather than unreadable.
 *
 * An error code alone cannot separate a removed entry from an unreadable
 * source, because a platform can report `ENOENT` for a child of a file. The
 * path ancestors answer the question instead: when the nearest existing
 * ancestor is a directory, the entry is genuinely gone, and when it is not a
 * directory, the source cannot be read and the caller must fail closed.
 * @param path - the path to classify.
 * @returns `true` only when the path is confirmed absent.
 */
export async function isAbsentPath(path: string): Promise<boolean> {
  let current = path
  for (;;) {
    const info = await statOf(current)
    if (info !== undefined) return current !== path && info.isDirectory()
    const parent = dirname(current)
    if (parent === current) return true
    current = parent
  }
}
