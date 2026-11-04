/**
 * The one tab layout both market surfaces render.
 *
 * The workspace row and the preset manager list the same collection, and they
 * sit on the same screen: opening the manager is a click inside the workspace,
 * so both are mounted at once. Holding the layout in each component's own state
 * would let them disagree about the order and about what is stowed, and a write
 * from one would be invisible to the other until a remount.
 *
 * The state therefore lives here, outside React, and both surfaces subscribe.
 * A write is applied optimistically and persisted behind the paint, exactly as
 * the single-surface version did: a local file write is fast enough that waiting
 * for it would only make the row feel late, and a failed write restores the
 * confirmed layout and reports why.
 * @module client/workspace/tab-layout-store
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { defaultTabLayout, moveTab, resolveHiddenTabs, type TabLayoutWire } from '../../../market-contracts/src/contracts/tab-layout.js'
import { loadTabLayout, saveTabLayout, saveTabOrder } from '../api.js'

/** What both surfaces read: the layout, whether a write is in flight, and the last failure. */
export interface TabLayoutState {
  /** The layout the rows render. Optimistic while a write is in flight. */
  layout: TabLayoutWire
  /** Whether a write is in flight, so a control can refuse a second one. */
  busy: boolean
  /** A failed load or write, already resolved into a message. */
  error: string | undefined
}

let state: TabLayoutState = { layout: defaultTabLayout(), busy: false, error: undefined }
const listeners = new Set<() => void>()
/** The last layout the server confirmed, which a failed write restores. */
let confirmed: TabLayoutWire = defaultTabLayout()
/** One load per session: both surfaces ask, and only the first request goes out. */
let loading: Promise<void> | undefined

function publish(next: Partial<TabLayoutState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/**
 * Subscribe to layout changes.
 * @param listener - called after every published change.
 * @returns the unsubscribe function React expects.
 */
export function subscribeTabLayout(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The current layout state.
 * @returns the same object until something publishes, which `useSyncExternalStore` requires.
 */
export function tabLayoutSnapshot(): TabLayoutState {
  return state
}

/**
 * Read the stored layout once, and report a failure where the controls are.
 * @param formatError - builds the localized message from the thrown error.
 * @returns a promise that settles after the first load attempt.
 */
export function ensureTabLayoutLoaded(formatError: (error: unknown) => string): Promise<void> {
  loading ??= loadTabLayout()
    .then(stored => {
      confirmed = stored
      publish({ layout: stored })
    })
    .catch((error: unknown) => {
      // A failed read costs the user their layout, never the surfaces: every
      // tab stays visible and the reason appears beside the controls.
      publish({ error: formatError(error) })
    })
  return loading
}

/**
 * Persist one layout change, painting it first.
 * @param next - the layout to show immediately.
 * @param write - the request that makes it durable, resolving to what the server stored.
 * @param formatError - builds the localized message from a failed write.
 * @returns a promise that settles when the write does.
 */
async function commit(next: TabLayoutWire, write: () => Promise<TabLayoutWire>, formatError: (error: unknown) => string): Promise<void> {
  publish({ layout: next, busy: true, error: undefined })
  try {
    const stored = await write()
    confirmed = stored
    publish({ layout: stored })
  } catch (error) {
    publish({ layout: confirmed, error: formatError(error) })
  } finally {
    publish({ busy: false })
  }
}

/**
 * Replace the stow list. Resolved here, so both surfaces store the same shape.
 * @param next - the keys to stow, in any order.
 * @param formatError - builds the localized message from a failed write.
 * @returns a promise that settles when the write does.
 */
export function applyStow(next: readonly string[], formatError: (error: unknown) => string): Promise<void> {
  const resolved: TabLayoutWire = { hidden: resolveHiddenTabs(next), order: state.layout.order }
  return commit(resolved, () => saveTabLayout(resolved.hidden), formatError)
}

/**
 * Move one tab to another tab's position, in the shared order.
 * @param from - the key being moved.
 * @param to - the key whose position it takes.
 * @param formatError - builds the localized message from a failed write.
 * @returns a promise that settles when the write does.
 */
export function applyTabMove(from: string, to: string, formatError: (error: unknown) => string): Promise<void> {
  if (from === to) return Promise.resolve()
  const order = moveTab(state.layout.order, state.layout.order.indexOf(from as TabLayoutWire['order'][number]), state.layout.order.indexOf(to as TabLayoutWire['order'][number]))
  const next: TabLayoutWire = { hidden: state.layout.hidden, order }
  return commit(next, () => saveTabOrder(order), formatError)
}

/** The two messages a surface supplies, because failure during a read and during a write read differently. */
export interface TabLayoutMessages {
  /** Built from a failed read. */
  load: (error: unknown) => string
  /** Built from a failed write. */
  write: (error: unknown) => string
}

/**
 * One surface's view of the shared layout.
 * @param messages - the two localized failure messages this surface renders.
 * @returns the state and the two writers, stable across renders.
 */
export function useTabLayout(messages: TabLayoutMessages): {
  state: TabLayoutState
  stow: (next: readonly string[]) => void
  move: (from: string, to: string) => void
} {
  const snapshot = useSyncExternalStore(subscribeTabLayout, tabLayoutSnapshot, tabLayoutSnapshot)
  const load = messages.load
  const write = messages.write
  useEffect(() => {
    void ensureTabLayoutLoaded(load)
  }, [load])
  const stow = useCallback((next: readonly string[]) => void applyStow(next, write), [write])
  const move = useCallback((from: string, to: string) => void applyTabMove(from, to, write), [write])
  return { state: snapshot, stow, move }
}

/** Reset the store between tests, so one case cannot seed the next. */
export function resetTabLayoutStore(): void {
  state = { layout: defaultTabLayout(), busy: false, error: undefined }
  confirmed = defaultTabLayout()
  loading = undefined
  for (const listener of listeners) listener()
}
