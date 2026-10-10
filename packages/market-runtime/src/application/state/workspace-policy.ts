/** One persisted workspace policy and its atomic read-modify-write operation. */
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readJsonFile, writeJsonDocument } from '../../../../market-catalog/src/index.js'
import {
  ALL_SURFACES_ON,
  resolveSurfaceToggles,
  SURFACE_TOGGLE_KEYS,
  type SurfaceToggleKey,
  type SurfaceToggles
} from '../../../../market-contracts/src/contracts/surface-toggles.js'

export type FilterFace = SurfaceToggleKey
export interface ResourceFilters {
  toggles: SurfaceToggles
  offEntries: Partial<Record<FilterFace, string[]>>
}

export function allFiltersOn(): ResourceFilters {
  return { toggles: { ...ALL_SURFACES_ON }, offEntries: {} }
}

/** Preserve the existing workspace hash and file location. */
export function surfaceTogglesPath(dataRoot: string, workspace: string): string {
  const key = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
  return join(dataRoot, 'surface-toggles', key + '.json')
}

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

/** v1 and v2 share field names. Invalid JSON and access failures still reject. */
export async function loadResourceFilters(dataRoot: string, workspace: string): Promise<ResourceFilters> {
  const value = await readJsonFile(surfaceTogglesPath(dataRoot, workspace))
  if (value === undefined) return allFiltersOn()
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return { toggles: resolveSurfaceToggles(record.toggles), offEntries: resolveOffEntries(record.entries) }
}

/**
 * Re-read under the published host file lock, persist once, then return the committed snapshot.
 * The mutation stays synchronous; no runtime refresh or caller callback runs under the file lock.
 */
export async function mutateResourceFilters(dataRoot: string, workspace: string, mutate: (current: ResourceFilters) => ResourceFilters): Promise<ResourceFilters> {
  const path = surfaceTogglesPath(dataRoot, workspace)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    const next = mutate(await loadResourceFilters(dataRoot, workspace))
    await writeJsonDocument(path, { version: 2, workspace, toggles: next.toggles, entries: next.offEntries })
    return next
  })
}

/** Replace both policy sections as one transaction. */
export async function saveResourceFilters(dataRoot: string, workspace: string, filters: ResourceFilters): Promise<void> {
  const captured = structuredClone(filters)
  await mutateResourceFilters(dataRoot, workspace, () => captured)
}
