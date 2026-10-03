/** Browser-safe resource-window wire records and route constants. */

import { MARKET_API_PREFIX } from './market.js'
import { SURFACE_TOGGLE_KEYS, type SurfaceToggleKey } from './surface-toggles.js'

/** Fixed resource-window HTTP routes. */
export const RESOURCE_ROUTES = {
  inventory: `${MARKET_API_PREFIX}resource-window`,
  setEntry: `${MARKET_API_PREFIX}resource-window/entry`,
  applyFavorite: `${MARKET_API_PREFIX}resource-window/favorites/apply`,
  saveFavorite: `${MARKET_API_PREFIX}resource-window/favorites/save`,
  deleteFavorite: `${MARKET_API_PREFIX}resource-window/favorites/delete`
} as const

/**
 * The window's six tabs, each the facet of one switchable surface. Market rows
 * are installed suites; the other five list the entries that surface mounts.
 */
export type ResourceFace = SurfaceToggleKey

/** The tab order the window shows, matching the prototype. */
export const RESOURCE_FACE_ORDER: readonly ResourceFace[] = SURFACE_TOGGLE_KEYS

/** One inventory row: one already-installed resource this workspace mounts. */
export interface ResourceEntryWire {
  /** Stable id: `${face}:${entryKey}` — unique across tabs. */
  id: string
  face: ResourceFace
  /** Display name: suite name, skill/command/agent name, or server name. */
  name: string
  /** Version when the source declares one; absent otherwise. */
  version?: string
  /** One provenance word: the owning source, suite, or "direct". */
  source: string
  /** Description for the card view's body line. */
  description?: string
  /** Surface counts for the market tab's footer row; absent elsewhere. */
  counts?: Array<{ label: string; count: number }>
  /** Whether this workspace mounts the entry right now. */
  enabled: boolean
}

/** The workspace's installed inventory with per-entry filter state. */
export interface ResourceWindowPayload {
  workspace: string
  entries: ResourceEntryWire[]
  favorites: ResourceFavoriteWire[]
  /** The id of the favorite this workspace currently follows; null = custom. */
  activeFavoriteId: string | null
}

/** One cross-project favorite: a complete snapshot of every switch. */
export interface ResourceFavoriteWire {
  id: string
  name: string
  createdAt: string
  /** The six surface switches at save time. */
  surfaces: Record<SurfaceToggleKey, boolean>
  /** Entry ids turned off at save time, across all faces. */
  offEntries: string[]
}

/** The favorite payload the save route accepts and stores verbatim. */
export interface ResourceFavoriteInput {
  name: string
  surfaces: Record<SurfaceToggleKey, boolean>
  offEntries: string[]
}

/** Read one untrusted favorite input; unknown faces and non-strings drop out. */
export function resolveFavoriteInput(value: unknown): ResourceFavoriteInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name === '') return undefined
  const rawSurfaces = (typeof record.surfaces === 'object' && record.surfaces !== null ? record.surfaces : {}) as Record<string, unknown>
  const surfaces = {} as Record<SurfaceToggleKey, boolean>
  for (const key of SURFACE_TOGGLE_KEYS) surfaces[key] = rawSurfaces[key] === false ? false : true
  const offEntries = Array.isArray(record.offEntries) ? record.offEntries.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : []
  return { name, surfaces, offEntries }
}
