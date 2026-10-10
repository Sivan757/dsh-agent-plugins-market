/**
 * Structural filesystem questions, answered without trusting an error code.
 *
 * Operating systems disagree about which code a failed read carries: Windows
 * can report `ENOENT` for a path that exists as a file, which a code-only
 * guard mistakes for a missing path. A caller that tolerates "not there yet"
 * asks this module instead, so the decision comes from the path shape rather
 * than from the platform error vocabulary.
 */
import { stat } from 'node:fs/promises'

/** Whether a path is confirmed absent; every other failure stays a failure. */
export async function isAbsentPath(path: string): Promise<boolean> {
  try {
    await stat(path)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}
