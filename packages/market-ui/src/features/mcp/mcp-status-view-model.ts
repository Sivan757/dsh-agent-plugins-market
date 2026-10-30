/** Pure MCP status filtering: the predicate the shared renderer counts tabs through. */
import type { McpStatusEntry } from '../../api.js'

/** MCP status list filter; `disabled` isolates the rows the user switched off. */
export type McpStatusFilter = 'all' | 'plugin' | 'direct' | 'disabled'

/** Filter tabs in display order: scope first, the switched-off rows last. */
export const MCP_FILTERS: readonly McpStatusFilter[] = ['all', 'direct', 'plugin', 'disabled']

/**
 * Whether one row belongs to a filter.
 *
 * The shared renderer counts each tab through this predicate, so a tab's number
 * is always the number of rows clicking it shows. A switched-off row keeps its
 * own scope, so it is reachable both through `plugin`/`direct` and through
 * `disabled`.
 *
 * @param entry - the status row.
 * @param filter - the tab in force.
 * @returns whether the row belongs to that tab.
 */
export function matchesMcpFilter(entry: McpStatusEntry, filter: McpStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'disabled') return entry.state === 'disabled'
  return entry.kind === filter
}

/** One row of the detail dialog's tool list. */
export interface McpToolRow {
  name: string
  /** The tool registers on the next mount. */
  allowed: boolean
  /** The suite's own declaration leaves the tool out, so the user cannot open it. */
  suiteLimited: boolean
  description?: string
  /** The description translated for the panel's locale; absent means render `description`. */
  translatedDescription?: string
  /** The advertised input schema, so the row can show what the tool takes. */
  parameters?: unknown
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
  const observed = new Map(entry.tools.map(tool => [tool.name, tool]))
  return [...names].sort().map(name => {
    const suiteLimited = (allowedNames !== undefined && !allowedNames.includes(name)) || suiteDenied.has(name)
    const tool = observed.get(name)
    return {
      name,
      allowed: !suiteLimited && !userDenied.has(name),
      suiteLimited,
      ...(tool?.description === undefined ? {} : { description: tool.description }),
      ...(tool?.translatedDescription === undefined ? {} : { translatedDescription: tool.translatedDescription }),
      ...(tool?.parameters === undefined ? {} : { parameters: tool.parameters })
    }
  })
}
