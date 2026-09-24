/** Pure LSP status filtering, severity ordering, and count derivation. */
import type { LspStatusEntry, LspStatusPayload, LspStatusState } from '../../api.js'

/** LSP status list filter; `disabled` isolates the rows the user switched off. */
export type LspStatusFilter = 'all' | 'plugin' | 'direct' | 'disabled'

/** Derived LSP list data used by the status screen. */
export interface LspStatusViewModel {
  /** Rows matching the active filter and search, worst state first. */
  filtered: LspStatusEntry[]
  filterCounts: Record<LspStatusFilter, number>
}

/** Filter tabs in display order: scope first, the switched-off rows last. */
export const LSP_FILTERS: readonly LspStatusFilter[] = ['all', 'direct', 'plugin', 'disabled']

/**
 * Derive per-filter counts and the visible rows in one pass over the payload.
 *
 * One predicate decides both the counts and the visible rows, so a tab's number
 * is always the number of rows clicking it shows. Visible rows are ordered so
 * the languages a user must act on come first.
 */
export function deriveLspStatusViewModel(payload: LspStatusPayload, filter: LspStatusFilter, search: string): LspStatusViewModel {
  const needle = search.trim().toLowerCase()
  const filterCounts: Record<LspStatusFilter, number> = { all: 0, plugin: 0, direct: 0, disabled: 0 }
  const filtered: LspStatusEntry[] = []

  for (const entry of payload.entries) {
    for (const key of LSP_FILTERS) {
      if (matchesLspFilter(entry, key)) filterCounts[key]++
    }
    if (!matchesLspFilter(entry, filter)) continue
    if (needle !== '' && !searchableText(entry).includes(needle)) continue
    filtered.push(entry)
  }

  filtered.sort((left, right) => severity(left.state) - severity(right.state))
  return { filtered, filterCounts }
}

/**
 * Whether one row belongs to a filter.
 *
 * A switched-off row keeps its own scope, so it is reachable both through
 * `plugin`/`direct` and through `disabled`.
 */
export function matchesLspFilter(entry: LspStatusEntry, filter: LspStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'disabled') return entry.state === 'disabled'
  return entry.kind === filter
}

function searchableText(entry: LspStatusEntry): string {
  return `${entry.serverKey} ${entry.suiteName} ${entry.command}`.toLowerCase()
}

/** Rank of a state for display order: the failures that need action rank first. */
function severity(state: LspStatusState): number {
  if (state === 'failed') return 0
  if (state === 'conflict') return 1
  if (state === 'host-missing') return 2
  if (state === 'starting') return 3
  if (state === 'disabled') return 4
  return 5
}
