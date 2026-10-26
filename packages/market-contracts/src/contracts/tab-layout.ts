/** Per-workspace stow list for the workspace tab row: which tabs are out of the row. */

/**
 * The workspace tabs a workspace can stow, in display order.
 *
 * The client renders the row from its own display-order list and treats this
 * list as the stowable set, so the two must name the same tabs. The drift
 * assertion in `packages/market-ui/test/client-workspace-tab-stow.test.ts` fails
 * when a tab is added to one and not the other, which is the moment to extend
 * this list.
 */
export const WORKSPACE_TAB_KEYS = ['market', 'skills', 'commands', 'personas', 'mcp', 'lsp', 'hooks'] as const

/** One workspace tab. */
export type WorkspaceTabKey = (typeof WORKSPACE_TAB_KEYS)[number]

/**
 * The one tab that is never stowed.
 *
 * The workspace opens on it, and it is the only tab that stays when a user
 * stows everything else, so an empty tab row cannot exist in any state a file,
 * a request, or a client can reach.
 */
export const PINNED_TAB_KEY: WorkspaceTabKey = 'market'

/** Version of the persisted tab-layout document this release reads and writes. */
export const TAB_LAYOUT_VERSION = 1

/** One workspace's stowed tabs, as the host and the client exchange them. */
export interface TabLayoutWire {
  /** Stowed tab keys, in display order. */
  hidden: string[]
}

/** Nothing stowed: the all-visible default an absent file means. */
export function emptyTabLayout(): TabLayoutWire {
  return { hidden: [] }
}

/**
 * Read one stow list from an untrusted value.
 *
 * Unknown keys, the pinned tab, duplicates, and non-strings are dropped, and an
 * empty or unusable input reads as nothing stowed. The result is ordered the way
 * the row is, so one layout always writes the same bytes.
 *
 * The clamp lives here because both boundaries need it: the file is user-editable
 * and the request body is a remote caller's, so neither may leave the row empty.
 * Dropping the pinned key is the clamp: it is the tab that remains when every
 * other tab is stowed, so "nothing visible" has no representation this function
 * can return.
 * @param value - the untrusted `hidden` value from a file, a body, or a snapshot.
 * @returns the stowed keys in display order, never every tab.
 */
export function resolveHiddenTabs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const requested = new Set(value.filter((key): key is string => typeof key === 'string'))
  return WORKSPACE_TAB_KEYS.filter(key => key !== PINNED_TAB_KEY && requested.has(key))
}

/**
 * Whether one tab is stowed in a resolved layout.
 * @param layout - the resolved layout.
 * @param tab - the tab to test.
 * @returns whether the tab is stowed.
 */
export function isTabStowed(layout: TabLayoutWire, tab: string): boolean {
  return layout.hidden.includes(tab)
}

/**
 * The keys out of `order` the row must render for one active tab.
 *
 * A tab that is stowed still renders while it is the active one: a deep link
 * can select a stowed tab, and the panel below it must always have its own tab
 * in the row. The reveal is derived, never stored, so a link cannot change the
 * saved layout.
 * @param order - the display order.
 * @param layout - the resolved layout.
 * @param active - the tab the panel shows.
 * @returns the visible keys in display order, including `active`.
 */
export function visibleTabs<T extends string>(order: readonly T[], layout: TabLayoutWire, active: T): T[] {
  return order.filter(tab => tab === active || !isTabStowed(layout, tab))
}
