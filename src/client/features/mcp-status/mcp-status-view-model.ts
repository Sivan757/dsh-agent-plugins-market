/** Pure MCP status filtering and count derivation. */
import type { McpStatusEntry, McpStatusPayload } from '../../api.js'

/** MCP status list filter; `disabled` isolates the rows the user switched off. */
export type McpStatusFilter = 'all' | 'plugin' | 'direct' | 'disabled'

/** Derived MCP list data used by the status screen. */
export interface McpStatusViewModel {
  /** Every row the payload carries, switched-off ones included. */
  activeEntries: McpStatusEntry[]
  filtered: McpStatusEntry[]
  filterCounts: Record<McpStatusFilter, number>
}

/** Filter tabs in display order: scope first, the switched-off rows last. */
export const MCP_FILTERS: readonly McpStatusFilter[] = ['all', 'direct', 'plugin', 'disabled']

interface SearchableEntry {
  entry: McpStatusEntry
  haystack: string
}

const searchableCache = new WeakMap<McpStatusPayload, SearchableEntry[]>()

/**
 * Derive the rows, the per-filter counts, and the visible rows in one pass.
 *
 * One predicate decides both the counts and the visible rows, so a tab's number
 * is always the number of rows clicking it shows.
 */
export function deriveMcpStatusViewModel(payload: McpStatusPayload, filter: McpStatusFilter, search: string): McpStatusViewModel {
  const searchable = searchableFor(payload)
  const activeEntries = searchable.map(item => item.entry)
  const filterCounts: Record<McpStatusFilter, number> = { all: 0, plugin: 0, direct: 0, disabled: 0 }
  const filtered: McpStatusEntry[] = []
  const needle = search.trim().toLowerCase()

  for (const item of searchable) {
    const entry = item.entry
    for (const key of MCP_FILTERS) {
      if (matchesMcpFilter(entry, key)) filterCounts[key]++
    }
    if (!matchesMcpFilter(entry, filter)) continue
    if (needle !== '' && !item.haystack.includes(needle)) continue
    filtered.push(entry)
  }

  return {
    activeEntries,
    filtered,
    filterCounts
  }
}

/**
 * Whether one row belongs to a filter.
 *
 * A switched-off row keeps its own scope, so it is reachable both through
 * `plugin`/`direct` and through `disabled`.
 */
export function matchesMcpFilter(entry: McpStatusEntry, filter: McpStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'disabled') return entry.state === 'disabled'
  return entry.kind === filter
}

function searchableFor(payload: McpStatusPayload): SearchableEntry[] {
  const cached = searchableCache.get(payload)
  if (cached !== undefined) return cached
  const searchable = payload.entries.map(entry => ({
    entry,
    haystack: `${entry.name} ${entry.source ?? ''} ${entry.endpoint ?? ''} ${entry.transport} ${entry.reason ?? ''} ${(entry.credentialRefs ?? []).join(' ')}`.toLowerCase()
  }))
  searchableCache.set(payload, searchable)
  return searchable
}

/** One row of the detail dialog's tool list. */
export interface McpToolRow {
  name: string
  /** The tool registers on the next mount. */
  allowed: boolean
  /** The suite's own declaration leaves the tool out, so the user cannot open it. */
  suiteLimited: boolean
  description?: string
}

/**
 * Every tool worth listing: what the server registered, plus every name the
 * suite or the user mentions.
 *
 * A denied tool leaves the live registry, so the stored lists are the only
 * thing keeping it on screen and available to switch back on. The suite's
 * allow-list and deny list both read as suite-limited; the user's own denials
 * stay selectable.
 */
export function mcpToolRows(entry: McpStatusEntry): McpToolRow[] {
  const allowedNames = entry.suiteEnabledTools
  const suiteDenied = new Set(entry.suiteDisabledTools ?? [])
  const userDenied = new Set(entry.userDisabledTools ?? [])
  const names = new Set<string>([...entry.tools.map(tool => tool.name), ...(allowedNames ?? []), ...suiteDenied, ...userDenied])
  const descriptions = new Map(entry.tools.map(tool => [tool.name, tool.description]))
  return [...names].sort().map(name => {
    const suiteLimited = (allowedNames !== undefined && !allowedNames.includes(name)) || suiteDenied.has(name)
    const description = descriptions.get(name)
    return {
      name,
      allowed: !suiteLimited && !userDenied.has(name),
      suiteLimited,
      ...(description === undefined ? {} : { description })
    }
  })
}
