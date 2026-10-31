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
export const WORKSPACE_TAB_KEYS = ['market', 'skills', 'personas', 'commands', 'mcp', 'lsp', 'instructions', 'outputStyles', 'hooks'] as const

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

/**
 * Version of the persisted tab-layout document this release reads and writes.
 *
 * Version 2 changed the display order itself, so an order recorded under version 1
 * names a sequence this release no longer starts from. Those documents keep their
 * stow list and read their order from the display order, which is what a reader of
 * that file would have seen anyway.
 */
export const TAB_LAYOUT_VERSION = 3

/** The display order version 1 shipped with. */
export const LEGACY_DISPLAY_ORDER = ['market', 'instructions', 'outputStyles', 'skills', 'commands', 'personas', 'mcp', 'lsp', 'hooks'] as const

/**
 * Display orders earlier versions shipped with.
 *
 * A stored order that still equals one of these sequences is a default nobody edited, so
 * it migrates to the current display order. An order that differs is someone's own
 * arrangement and survives the migration untouched.
 *
 * Version 2 moved the authoring tabs up; version 3 put the two service surfaces next to
 * each other, because both answer "what is mounted and why did it fail".
 */
export const LEGACY_DISPLAY_ORDERS: readonly (readonly WorkspaceTabKey[])[] = [
  LEGACY_DISPLAY_ORDER,
  ['market', 'skills', 'personas', 'commands', 'mcp', 'instructions', 'outputStyles', 'hooks', 'lsp']
]

/** One workspace's tab row, as the host and the client exchange them. */
export interface TabLayoutWire {
  /** Stowed tab keys, in display order. */
  hidden: string[]
  /**
   * The complete row order, every tab exactly once.
   *
   * Always present and always whole, so a reader never has to merge a partial
   * order with the default one. A document that predates ordering reads as the
   * display order, which is what it rendered before. The pinned tab stays first.
   */
  order: WorkspaceTabKey[]
}

/**
 * The tabs a workspace starts with stowed.
 *
 * Three surfaces answer a question most sessions never ask: the AGENTS.md chain,
 * the language servers, and the hook declarations. Opening the workspace with
 * them in the row spends scarce width on tabs a person rarely needs, so a
 * workspace that has never recorded an opinion starts with them stowed. They
 * stay one action away from the row's own entry, and the first edit replaces
 * this default with whatever the person chose.
 */
export const DEFAULT_STOWED_TABS = [] as const

/**
 * The layout a workspace with no usable document gets.
 *
 * Deliberately not an empty stow list: "no opinion yet" and "I chose
 * everything visible" are different facts, and only the second one is a user
 * decision this plugin must preserve. The pinned tab cannot appear in
 * {@link DEFAULT_STOWED_TABS}, so this default can never empty the row.
 * @returns the starting stow list.
 */
export function defaultTabLayout(): TabLayoutWire {
  return { hidden: resolveHiddenTabs([...DEFAULT_STOWED_TABS]), order: [...WORKSPACE_TAB_KEYS] }
}

/**
 * Read one row order from an untrusted value.
 *
 * The returned list is always a complete permutation: known keys in the authored
 * order, then every remaining key in display order. That keeps the row renderable
 * from one array, so a file that names four tabs cannot hide the other five. The
 * pinned tab always lands first, which is the same clamp the stow list uses.
 * @param value - the untrusted `order` value from a file, a body, or a snapshot.
 * @returns every tab exactly once, pinned first.
 */
export function resolveTabOrder(value: unknown): WorkspaceTabKey[] {
  const authored = Array.isArray(value) ? value.filter((key): key is WorkspaceTabKey => typeof key === 'string' && (WORKSPACE_TAB_KEYS as readonly string[]).includes(key)) : []
  const seen = new Set<WorkspaceTabKey>()
  const ordered: WorkspaceTabKey[] = []
  for (const key of authored) {
    if (seen.has(key)) continue
    seen.add(key)
    ordered.push(key)
  }
  for (const key of WORKSPACE_TAB_KEYS) {
    if (!seen.has(key)) ordered.push(key)
  }
  return [PINNED_TAB_KEY, ...ordered.filter(key => key !== PINNED_TAB_KEY)]
}

/**
 * Move one tab to another index of the row.
 *
 * Indexes are positions in the resolved order, so a caller that just rendered
 * the row can pass what it sees. The pinned tab cannot move and no move can
 * displace it: the result goes back through {@link resolveTabOrder}, which
 * restores it to the front whatever the request asked for.
 * @param order - the current resolved order.
 * @param from - the index of the tab to move.
 * @param to - the index it should land on.
 * @returns the new complete order.
 */
export function moveTab(order: readonly WorkspaceTabKey[], from: number, to: number): WorkspaceTabKey[] {
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return resolveTabOrder(order)
  const moving = order[from]
  if (moving === undefined || moving === PINNED_TAB_KEY) return resolveTabOrder(order)
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, moving)
  return resolveTabOrder(next)
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
