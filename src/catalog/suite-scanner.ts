/**
 * Scan one source checkout into normalized suites.
 *
 * The actual discovery lives in the strategy chain (`scan-pipeline.ts` +
 * `scan-resolvers.ts`); this module is the compatibility facade that keeps
 * the historical imports (`discoverSuitesInSource`, `repoName`,
 * `listMdFiles`, `LspEntry`) stable for callers and tests.
 */
import type { Suite, SuiteDimension } from '../model/types.js'
import { scanSource } from './scan-resolvers.js'

export {
  repoName,
  listMdFiles,
  discoverLspEntries,
  scanSource,
  canonicalGitUrl,
  resolveMarketplaceEntry,
  defaultScanFilters,
  MarketplaceStrategy,
  RootedStrategy,
  FlatCollectionsStrategy
} from './scan-resolvers.js'
export type { MarketplaceEntry, EntryResolution, EntryHandler, SuiteHint } from './scan-resolvers.js'
export type { LspEntry } from './surfaces.js'
export { runScanChain } from './scan-pipeline.js'
export type { ScanContext, ScanFilter, ScanChain, ScanResolution, ScanAttempt, ScanResult } from './scan-pipeline.js'

/** Discover every suite under one source checkout. */
export async function discoverSuitesInSource(checkoutDir: string, sourceId: string, dimension: SuiteDimension, sourceUrl?: string): Promise<Suite[]> {
  return scanSource(checkoutDir, sourceId, dimension, sourceUrl).then(result => result.suites)
}
