/** Pure LSP status filtering, severity ordering, and count derivation. */
import type { LspStatusEntry, LspStatusPayload, LspStatusState } from '../../api.js'

/** LSP status list filter. */
export type LspStatusFilter = 'all' | 'plugin' | 'direct'

/** Derived LSP list data used by the status screen. */
export interface LspStatusViewModel {
  /** Rows matching the active filter and search, worst state first. */
  filtered: LspStatusEntry[]
  filterCounts: Record<LspStatusFilter, number>
}

/** Filter tabs in display order. */
export const LSP_FILTERS: readonly LspStatusFilter[] = ['all', 'plugin', 'direct']

/**
 * Derive per-filter counts and the visible rows in one pass over the payload.
 *
 * Visible rows are ordered so the languages a user must act on come first.
 */
export function deriveLspStatusViewModel(payload: LspStatusPayload, filter: LspStatusFilter, search: string): LspStatusViewModel {
  const needle = search.trim().toLowerCase()
  const filterCounts: Record<LspStatusFilter, number> = { all: 0, plugin: 0, direct: 0 }
  const filtered: LspStatusEntry[] = []

  for (const entry of payload.entries) {
    for (const key of LSP_FILTERS) {
      if (matches(entry, key)) filterCounts[key]++
    }
    if (!matches(entry, filter)) continue
    if (needle !== '' && !searchableText(entry).includes(needle)) continue
    filtered.push(entry)
  }

  filtered.sort((left, right) => severity(left.state) - severity(right.state))
  return { filtered, filterCounts }
}

function matches(entry: LspStatusEntry, filter: LspStatusFilter): boolean {
  return filter === 'all' || entry.kind === filter
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
