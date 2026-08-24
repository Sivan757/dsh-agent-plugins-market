/**
 * Select source checkouts for a catalog dimension.
 *
 * User catalogs include only configured sources. Project catalogs additionally
 * retain unmanaged checkout ids because project install state can authorize
 * them without duplicating source configuration, and discover the project's
 * native agent directories (`.claude/`, `.agents/`) in place so repositories
 * migrating from other coding agents need no file copying.
 */
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expandHome, isDirectory, sourcesDir } from './paths.js'
import type { SourceRef, Suite, SuiteDimension } from '../model/types.js'
import { discoverSuitesInSource } from './suite-scanner.js'
import { discoverNativeProjectSuites } from './native-project.js'

/** Discover suites from the selected configured or project checkouts. */
export async function discoverSourceList(sources: SourceRef[], dimension: SuiteDimension, dimensionRoot: string): Promise<Suite[]> {
  const checkoutRoot = sourcesDir(dimensionRoot)
  const listed = new Set(sources.map(source => source.id))
  const checkouts = sources.map(source => ({
    sourceId: source.id,
    checkout: source.local === true ? expandHome(source.url) : join(checkoutRoot, source.id)
  }))
  if (dimension === 'project') {
    try {
      for (const entry of await readdir(checkoutRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || listed.has(entry.name)) continue
        checkouts.push({ sourceId: entry.name, checkout: join(checkoutRoot, entry.name) })
      }
    } catch {
      // A missing project checkout root has no unmanaged project sources.
    }
  }
  const discovered = await Promise.all(
    checkouts.map(async ({ sourceId, checkout }) => {
      if (!(await isDirectory(checkout))) return []
      return discoverSuitesInSource(checkout, sourceId, dimension)
    })
  )
  const suites = discovered.flat()
  if (dimension === 'project') {
    // Native project directories live two levels above the dimension root
    // (`<projectRoot>/.dsh/agent-plugins`); read them in place.
    suites.push(...(await discoverNativeProjectSuites(dirname(dirname(dimensionRoot)), dimension)))
  }
  return suites
}
