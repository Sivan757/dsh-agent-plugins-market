/**
 * Persisted per-workspace surface toggles under the plugin data root.
 *
 * The state lives globally (never inside the project) because it is this
 * user's opinion about that project, not a fact the project should carry in
 * its tree. The workspace absolute path is hashed into the file name so two
 * checkouts of the same repo keep independent opinions and no path can leak
 * into a file name.
 *
 * @module application/state/surface-toggles
 */
import { createHash } from 'node:crypto'
import { readJsonFile, writeJsonDocument } from '../json-file.js'
import { ALL_SURFACES_ON, resolveSurfaceToggles, type SurfaceToggles } from '../../contracts/surface-toggles.js'

interface SurfaceTogglesDocument {
  version: 1
  workspace: string
  toggles: SurfaceToggles
}

/** The toggles directory inside the plugin data root. */
function togglesRoot(dataRoot: string): string {
  return `${dataRoot}/surface-toggles`
}

/** One workspace's cache file path inside the plugin data root. */
export function surfaceTogglesPath(dataRoot: string, workspace: string): string {
  const key = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
  return `${togglesRoot(dataRoot)}/${key}.json`
}

/** Read one workspace's toggles; an absent or malformed file means all-on. */
export async function loadSurfaceToggles(dataRoot: string, workspace: string): Promise<SurfaceToggles> {
  const value = await readJsonFile(surfaceTogglesPath(dataRoot, workspace))
  if (value === undefined) return { ...ALL_SURFACES_ON }
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return resolveSurfaceToggles(record.toggles)
}

/** Persist one workspace's toggles atomically. */
export async function saveSurfaceToggles(dataRoot: string, workspace: string, toggles: SurfaceToggles): Promise<void> {
  const document: SurfaceTogglesDocument = { version: 1, workspace, toggles }
  await writeJsonDocument(surfaceTogglesPath(dataRoot, workspace), document)
}
