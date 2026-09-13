/** Pure market filtering and count derivation. */
import type { OverviewData, SuiteCardData } from '../../api.js'

/** Market status filter. */
export type MarketFilter = 'all' | 'installed' | 'uninstalled'
/** Market source scope; `all` selects every source. */
export type MarketCategory = string

/** Derived market view data used by the screen and its toolbar. */
export interface MarketViewModel {
  scopeTotals: { all: number; installed: number; enabled: number }
  filtered: SuiteCardData[]
}

interface SearchableSuite {
  suite: SuiteCardData
  haystack: string
}

const searchableCache = new WeakMap<OverviewData, SearchableSuite[]>()

/** Derive visible cards and scope counts in one pass over a normalized payload. */
export function deriveMarketViewModel(overview: OverviewData, search: string, filter: MarketFilter, category: MarketCategory): MarketViewModel {
  const searchable = searchableFor(overview)
  const needle = search.trim().toLowerCase()
  let all = 0
  let installed = 0
  let enabled = 0
  const visible: SuiteCardData[] = []

  for (const entry of searchable) {
    const suite = entry.suite
    if (category !== 'all' && suite.sourceId !== category) continue
    all++
    if (suite.installed) installed++
    if (suite.enabled) enabled++
    if (filter === 'installed' && !suite.installed) continue
    if (filter === 'uninstalled' && suite.installed) continue
    if (needle !== '' && !entry.haystack.includes(needle)) continue
    visible.push(suite)
  }

  return { scopeTotals: { all, installed, enabled }, filtered: visible }
}

function searchableFor(overview: OverviewData): SearchableSuite[] {
  const cached = searchableCache.get(overview)
  if (cached !== undefined) return cached
  const searchable = overview.suites.map(suite => ({
    suite,
    haystack: `${suite.name} ${suite.description ?? ''} ${suite.keywords.join(' ')}`.toLowerCase()
  }))
  searchableCache.set(overview, searchable)
  return searchable
}
