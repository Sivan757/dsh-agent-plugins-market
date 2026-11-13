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
import { expandHome, sourcesDir } from './paths.js'
import { isDirectory } from './fs-probes.js'
import type { DiscoveredSuite, SourceRef, SuiteDimension } from '../../../market-contracts/src/model/types.js'
import { scanSource as scanSourceWithNotes } from './suite-scanner.js'
import { discoverNativeProjectSuites } from './native-project.js'
import type { ScanResult } from './scan-pipeline.js'

/** One configured or unmanaged checkout selected for a dimension. */
export interface SourceCheckout {
  sourceId: string
  checkout: string
  sourceUrl?: string
  source?: SourceRef
}

/** Resolve the source-owned checkout once for both import jobs and catalog queries. */
export function configuredSourceCheckout(source: SourceRef, dimensionRoot: string): SourceCheckout {
  return {
    source,
    sourceId: source.id,
    checkout: source.local === true || source.kind === 'local' ? expandHome(source.url) : join(sourcesDir(dimensionRoot), source.id),
    sourceUrl: source.url
  }
}

/** A discovery reader can reuse a versioned source index instead of walking the checkout. */
export type SourceCheckoutReader = (
  checkout: SourceCheckout,
  dimension: SuiteDimension
) => Promise<Pick<ScanResult, 'suites' | 'notes' | 'marketplacePath' | 'bindings'> & { expiresAt?: number }>

export const scanSourceCheckout: SourceCheckoutReader = async (entry, dimension) => {
  if (!(await isDirectory(entry.checkout))) return { suites: [], notes: [] }
  const { suites, notes, marketplacePath, bindings } = await scanSourceWithNotes(entry.checkout, entry.sourceId, dimension, entry.sourceUrl)
  return { suites, notes, ...(marketplacePath === undefined ? {} : { marketplacePath }), ...(bindings === undefined ? {} : { bindings }) }
}

/**
 * Discover suites plus per-source scan diagnostics for one dimension.
 * @param scanProjectLayouts - whether the project's own native Agent directories
 *   join the scan. Required on purpose: the switch has one owner (the host
 *   settings document), so a default here would be a second copy of it.
 */
export async function discoverSourceListWithNotes(
  sources: SourceRef[],
  dimension: SuiteDimension,
  dimensionRoot: string,
  scanProjectLayouts: boolean,
  readCheckout: SourceCheckoutReader = scanSourceCheckout
): Promise<{ suites: DiscoveredSuite[]; scanNotes: Record<string, string[]>; expiresAt?: number }> {
  const checkoutRoot = sourcesDir(dimensionRoot)
  const listed = new Set(sources.map(source => source.id))
  const checkouts = sources.map(source => configuredSourceCheckout(source, dimensionRoot))
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
    checkouts.map(async checkout => {
      const result = await readCheckout(checkout, dimension)
      return { sourceId: checkout.sourceId, suites: result.suites, notes: result.notes, expiresAt: result.expiresAt }
    })
  )
  const suites = discovered.flatMap(entry => entry.suites.map(suite => ({ ...suite, errors: [...suite.errors] })))
  const scanNotes: Record<string, string[]> = {}
  for (const entry of discovered) {
    if (entry.notes.length > 0) scanNotes[entry.sourceId] = [...entry.notes]
  }
  if (dimension === 'project' && scanProjectLayouts) {
    // Native project directories live two levels above the dimension root
    // (`<projectRoot>/.dsh/agent-plugins`); read them in place.
    const native = await discoverNativeProjectSuites(dirname(dirname(dimensionRoot)), dimension)
    suites.push(...native)
    const errors = [...new Set(native.flatMap(suite => suite.errors))]
    if (errors.length > 0) scanNotes.native = errors
  }
  if (dimension === 'project') {
    for (const suite of suites) {
      if (suite.lsp === undefined) continue
      const note = `suite ${suite.id}: project LSP declarations are not mounted; the host LSP registry does not isolate projects`
      suite.errors.push(note)
      ;(scanNotes[suite.sourceId] ??= []).push(note)
    }
  }
  const expiresAt = Math.min(...discovered.map(entry => entry.expiresAt ?? Infinity))
  return { suites, scanNotes, ...(Number.isFinite(expiresAt) ? { expiresAt } : {}) }
}
