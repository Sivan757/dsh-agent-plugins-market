/**
 * Persisted per-workspace resource filters under the plugin data root.
 *
 * v2 of the surface-toggles document adds `entries`: the per-entry deny set
 * the project resource window writes. The v1 shape (a workspace with only
 * surface opinions) keeps loading unchanged; `saveSurfaceFilters` upgrades
 * the document in place, and the resolve hook degrades a hand-edited file to
 * the known faces the same way `resolveSurfaceToggles` does.
 *
 * @module application/state/resource-filters
 */
import { readJsonFile, writeJsonDocument } from '../json-file.js'
import { surfaceTogglesPath } from './surface-toggles.js'
import { ALL_SURFACES_ON, resolveSurfaceToggles, SURFACE_TOGGLE_KEYS, type SurfaceToggleKey, type SurfaceToggles } from '../../contracts/surface-toggles.js'

/** Every face that may carry per-entry filters, in contract order. */
export type FilterFace = SurfaceToggleKey

/** The resolved per-workspace filter state: six surface switches plus entry denials. */
export interface ResourceFilters {
  toggles: SurfaceToggles
  /** Entry ids turned off; absent faces mean "nothing filtered". */
  offEntries: Partial<Record<FilterFace, string[]>>
}

/** The all-on, nothing-filtered default. */
export function allFiltersOn(): ResourceFilters {
  return { toggles: { ...ALL_SURFACES_ON }, offEntries: {} }
}

/** Read one untrusted `entries` record keeping only string arrays on known faces. */
export function resolveOffEntries(value: unknown): Partial<Record<FilterFace, string[]>> {
  if (typeof value !== 'object' || value === null) return {}
  const record = value as Record<string, unknown>
  const out: Partial<Record<FilterFace, string[]>> = {}
  for (const face of SURFACE_TOGGLE_KEYS) {
    const raw = record[face]
    if (!Array.isArray(raw)) continue
    const ids = raw.filter((id): id is string => typeof id === 'string' && id !== '')
    if (ids.length > 0) out[face] = ids
  }
  return out
}

/** Load one workspace's filters; an absent or malformed file means all-on. */
export async function loadResourceFilters(dataRoot: string, workspace: string): Promise<ResourceFilters> {
  const value = await readJsonFile(surfaceTogglesPath(dataRoot, workspace))
  if (value === undefined) return allFiltersOn()
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    toggles: resolveSurfaceToggles(record.toggles),
    offEntries: resolveOffEntries(record.entries)
  }
}

interface FilterDocument {
  version: 2
  workspace: string
  toggles: SurfaceToggles
  entries: Partial<Record<FilterFace, string[]>>
}

/** Persist one workspace's filters atomically, upgrading the document to v2. */
export async function saveResourceFilters(dataRoot: string, workspace: string, filters: ResourceFilters): Promise<void> {
  const document: FilterDocument = {
    version: 2,
    workspace,
    toggles: filters.toggles,
    entries: filters.offEntries
  }
  await writeJsonDocument(surfaceTogglesPath(dataRoot, workspace), document)
}
