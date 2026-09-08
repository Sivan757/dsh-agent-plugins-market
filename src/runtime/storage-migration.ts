/** Consolidate plugin-owned storage before stores, routes, or providers are exposed. */
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { expandHome, resolveDataRoot, resolveDshHome, resolveUserRoot } from '../catalog/paths.js'

export interface StorageMigrationResult {
  /** Conflicting or symbolic-link entries retained at their original paths. */
  conflicts: string[]
}

async function info(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Move only successfully copied entries; never traverse links or overwrite a destination. */
export async function mergeStorageTree(from: string, to: string, result: StorageMigrationResult): Promise<void> {
  if (resolve(from) === resolve(to)) return
  const source = await info(from)
  if (source === undefined) return
  const destination = await info(to)
  if (source.isSymbolicLink() || destination?.isSymbolicLink() === true) {
    result.conflicts.push(from)
    return
  }
  if (source.isDirectory()) {
    if (destination !== undefined && !destination.isDirectory()) {
      result.conflicts.push(from)
      return
    }
    await mkdir(to, { recursive: true })
    for (const name of await readdir(from)) await mergeStorageTree(join(from, name), join(to, name), result)
    if ((await readdir(from)).length === 0) await rmdir(from)
    return
  }
  if (!source.isFile() || (destination !== undefined && !destination.isFile())) {
    result.conflicts.push(from)
    return
  }
  if (destination !== undefined) {
    if (!(await readFile(from)).equals(await readFile(to))) {
      result.conflicts.push(from)
      return
    }
  } else {
    await mkdir(dirname(to), { recursive: true })
    // COPYFILE_EXCL also protects against a destination created during migration.
    await copyFile(from, to, constants.COPYFILE_EXCL)
  }
  await unlink(from)
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && path !== '..' && !isAbsolute(path))
}

/**
 * Migrate former root overrides and data/user panels into the canonical root.
 * Unknown files in override directories remain untouched. Conflicts remain at
 * the old path and are returned to block activation; reruns are safe.
 */
export async function migratePluginStorage(config: { userRoot?: string; dataRoot?: string } = {}): Promise<StorageMigrationResult> {
  const userRoot = resolveUserRoot()
  const dataRoot = resolveDataRoot()
  const result: StorageMigrationResult = { conflicts: [] }
  for (const path of [resolveDshHome(), userRoot, dataRoot, join(userRoot, 'user'), join(userRoot, '.sources')]) {
    if ((await info(path))?.isSymbolicLink() === true) throw new Error(`Plugin storage cannot use a symbolic-link directory: ${path}`)
  }
  const legacyUserRoot = resolve(expandHome(config.userRoot ?? userRoot))
  const legacyDataRoot = resolve(expandHome(config.dataRoot ?? join(legacyUserRoot, 'data')))
  for (const path of new Set([legacyUserRoot, legacyDataRoot, join(resolveDshHome(), 'agent-plugins-data')])) {
    if ((await info(path))?.isSymbolicLink() === true) throw new Error(`Plugin storage migration cannot traverse a symbolic-link root: ${path}`)
  }
  if (legacyUserRoot !== userRoot) {
    if (contains(legacyUserRoot, userRoot) || contains(userRoot, legacyUserRoot)) throw new Error('Legacy userRoot overlaps canonical plugin storage')
    const legacySources = join(legacyUserRoot, '.sources')
    const sourceInfo = await info(legacySources)
    const sourceNames = sourceInfo?.isDirectory() === true ? await readdir(legacySources) : []
    const rootConflicts: string[] = []
    if (sourceInfo !== undefined && !sourceInfo.isDirectory()) rootConflicts.push(legacySources)
    for (const name of sourceNames) {
      if ((await info(join(userRoot, '.sources', name))) !== undefined) rootConflicts.push(join(legacySources, name))
      await collectUnsupportedEntries(join(legacySources, name), rootConflicts)
    }
    const legacyState = join(legacyUserRoot, 'state.json')
    const currentState = join(userRoot, 'state.json')
    const previous = await info(legacyState)
    const current = await info(currentState)
    // Validate before relocating any checkouts: malformed state must remain
    // beside its original sources so recovery does not require finding them.
    if (previous?.isFile() === true) JSON.parse(await readFile(legacyState, 'utf8'))
    if (previous !== undefined && (!previous.isFile() || (current !== undefined && (!current.isFile() || !(await readFile(legacyState)).equals(await readFile(currentState)))))) {
      rootConflicts.push(legacyState)
    }
    if (rootConflicts.length > 0) {
      // The install state and its checkouts are one ownership unit. Moving only
      // one half would orphan installs or make the retained state unusable.
      result.conflicts.push(...rootConflicts)
    } else {
      if (sourceInfo?.isDirectory() === true) {
        for (const name of sourceNames) await mergeStorageTree(join(legacySources, name), join(userRoot, '.sources', name), result)
        if ((await readdir(legacySources)).length === 0) await rmdir(legacySources)
      }
      await mergeStorageTree(legacyState, currentState, result)
      await relocateManagedSourceUrls(userRoot, legacyUserRoot)
    }
    for (const entry of ['data', 'user']) await mergeStorageTree(join(legacyUserRoot, entry), join(userRoot, entry), result)
  }
  for (const legacy of new Set([legacyDataRoot, join(resolveDshHome(), 'agent-plugins-data')])) {
    if (legacy === dataRoot) continue
    if (contains(legacy, dataRoot) || contains(dataRoot, legacy)) throw new Error('Legacy dataRoot overlaps canonical plugin data storage')
    for (const entry of ['data', 'overrides', 'user', 'settings.json', 'lsp-servers.json', 'feedback']) {
      await mergeStorageTree(join(legacy, entry), join(dataRoot, entry), result)
    }
  }
  await mergeStorageTree(join(dataRoot, 'user'), join(userRoot, 'user'), result)
  return result
}

/** Retain all state fields while rebasing adopted checkouts moved with a root. */
async function relocateManagedSourceUrls(userRoot: string, legacyUserRoot: string): Promise<void> {
  const path = join(userRoot, 'state.json')
  if ((await info(path)) === undefined) return
  const state: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (typeof state !== 'object' || state === null || !('sources' in state) || !Array.isArray(state.sources)) return
  let changed = false
  for (const source of state.sources as unknown[]) {
    if (typeof source !== 'object' || source === null || !('local' in source) || source.local !== true || !('url' in source) || typeof source.url !== 'string') continue
    const oldCheckout = join(legacyUserRoot, '.sources')
    if (!contains(oldCheckout, resolve(expandHome(source.url)))) continue
    source.url = join(userRoot, '.sources', relative(oldCheckout, resolve(expandHome(source.url))))
    changed = true
  }
  if (changed) {
    const temp = `${path}.migration-${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
    await rename(temp, path)
  }
}

async function collectUnsupportedEntries(path: string, conflicts: string[]): Promise<void> {
  const entry = await info(path)
  if (entry === undefined) return
  if (entry.isDirectory()) {
    for (const name of await readdir(path)) await collectUnsupportedEntries(join(path, name), conflicts)
  } else if (!entry.isFile()) conflicts.push(path)
}
