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
import { scanSource as scanSourceWithNotes } from './suite-scanner.js'
import { discoverNativeProjectSuites } from './native-project.js'

/** Discover suites from the selected configured or project checkouts. */
export async function discoverSourceList(sources: SourceRef[], dimension: SuiteDimension, dimensionRoot: string): Promise<Suite[]> {
  return (await discoverSourceListWithNotes(sources, dimension, dimensionRoot)).suites
}

/** Discover suites plus per-source scan diagnostics for one dimension. */
export async function discoverSourceListWithNotes(
  sources: SourceRef[],
  dimension: SuiteDimension,
  dimensionRoot: string
): Promise<{ suites: Suite[]; scanNotes: Record<string, string[]> }> {
  const checkoutRoot = sourcesDir(dimensionRoot)
  const listed = new Set(sources.map(source => source.id))
  const checkouts: Array<{ sourceId: string; checkout: string; sourceUrl?: string }> = sources.map(source => ({
    sourceId: source.id,
    checkout: source.local === true ? expandHome(source.url) : join(checkoutRoot, source.id),
    // The configured URL drives marketplace-entry self-reference resolution:
    // an entry pointing back at this very source (Claude Code ships
    // `{ source: 'github', repo: <own repo> }`) scans the local checkout.
    sourceUrl: source.url
  }))
  if (dimension === 'project') {
    try {
      for (const entry of await readdir(checkoutRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || listed.has(entry.name)) continue
        checkouts.push({ sourceId: entry.name, checkout: join(checkoutRoot, entry.name), sourceUrl: undefined })
      }
    } catch {
      // A missing project checkout root has no unmanaged project sources.
    }
  }
  const discovered = await Promise.all(
    checkouts.map(async ({ sourceId, checkout, sourceUrl }) => {
      if (!(await isDirectory(checkout))) return { sourceId, suites: [] as Suite[], notes: [] as string[] }
      const result = await scanSourceWithNotes(checkout, sourceId, dimension, sourceUrl)
      return { sourceId, suites: result.suites, notes: result.notes }
    })
  )
  const suites = discovered.flatMap(entry => entry.suites)
  const scanNotes: Record<string, string[]> = {}
  for (const entry of discovered) {
    if (entry.notes.length > 0) scanNotes[entry.sourceId] = entry.notes
  }
  if (dimension === 'project') {
    // Native project directories live two levels above the dimension root
    // (`<projectRoot>/.dsh/agent-plugins`); read them in place.
    suites.push(...(await discoverNativeProjectSuites(dirname(dirname(dimensionRoot)), dimension)))
  }
  return { suites, scanNotes }
}
