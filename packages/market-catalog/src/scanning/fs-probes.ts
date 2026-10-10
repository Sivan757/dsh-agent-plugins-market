/**
 * Filesystem probes and directory listings shared by the discovery layer.
 *
 * Every probe is fail-closed: a missing or unreadable path answers `false`
 * (or an empty listing) instead of throwing, so a broken tree degrades into a
 * diagnostic rather than a failed scan.
 */
import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Dot-directories and dependency trees that never hold suite content. */
export const DOT_DIRS = new Set(['.git', '.github', '.claude', '.cursor', '.kimi', '.plugin', '.sources', 'node_modules'])

/** Whether `path` is an existing directory (symlinks followed for the final component). */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Whether `path` is an existing regular file. */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Whether any entry (file, directory, symlink) exists at `path`. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Absolute paths of the non-hidden child directories of `dir`, in readdir order. */
export async function listChildDirs(dir: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter(entry => entry.isDirectory() && !DOT_DIRS.has(entry.name) && !entry.name.startsWith('.')).map(entry => join(dir, entry.name))
}
