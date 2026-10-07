/**
 * The user panels' last successful rows, one cache per kind.
 *
 * A panel is remounted on every tab switch — the workspace renders only the
 * active tab — so a mount that starts from nothing paints a spinner each visit
 * even when the rows the user saw a moment ago are still the right ones to
 * show. Keeping them module-level is what the market overview has always done,
 * and it is why that page opens instantly: paint what the last read returned,
 * revalidate behind it, and reserve the loading state for a genuine first
 * visit.
 *
 * Only the newest read may store its rows. Between a read starting and landing,
 * a mutation can have written the same panel, and the older read's answer was
 * derived before that write: letting it land would put pre-edit rows back in
 * front of the user. {@link loadUserPanel} therefore claims the cache when it
 * starts and the claim is checked when it resolves.
 * @module client/ui/user-panel-resource
 */
import { readUserPanel, type UserPanelEntry, type UserPanelKind } from '../api.js'

/** One panel read as the surface consumes it. */
export interface UserPanelRead {
  entries: UserPanelEntry[]
  translationPending: number
}

/** One kind's cached rows and the read that currently owns them. */
interface PanelSlot {
  rows: UserPanelEntry[] | undefined
  /** Bumped by every read; only the read holding the newest value may store. */
  generation: number
}

const slots = new Map<UserPanelKind, PanelSlot>()

function slotOf(kind: UserPanelKind): PanelSlot {
  let slot = slots.get(kind)
  if (slot === undefined) {
    slot = { rows: undefined, generation: 0 }
    slots.set(kind, slot)
  }
  return slot
}

/**
 * The rows a mount can paint before its own read answers.
 * @param kind - the panel directory the rows belong to.
 * @returns the last successful rows, or undefined when nothing is cached yet.
 */
export function cachedUserPanel(kind: UserPanelKind): UserPanelEntry[] | undefined {
  return slotOf(kind).rows
}

/**
 * Read one panel and cache the rows.
 *
 * Every call starts its own request: a read that could join one already in
 * flight would answer a refresh issued after a mutation with rows derived
 * before it. The host's own row cache is what keeps the extra read cheap.
 * @param kind - the panel directory to read.
 * @param force - ask for a genuine re-read, bypassing the host's row cache; the
 * Refresh button is the user asking for the working tree as it stands.
 * @returns the read's rows and its translation-pending count.
 */
export function loadUserPanel(kind: UserPanelKind, force = false): Promise<UserPanelRead> {
  const slot = slotOf(kind)
  const generation = ++slot.generation
  return readUserPanel(kind, force).then(data => {
    if (slot.generation === generation) slot.rows = data.entries
    return data
  })
}
