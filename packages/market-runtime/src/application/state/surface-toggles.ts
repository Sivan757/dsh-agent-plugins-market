/** Legacy surface view over the canonical workspace policy document. */
import type { SurfaceToggles } from '../../../../market-contracts/src/contracts/surface-toggles.js'
import { loadResourceFilters, mutateResourceFilters } from './workspace-policy.js'
export { surfaceTogglesPath } from './workspace-policy.js'

export async function loadSurfaceToggles(dataRoot: string, workspace: string): Promise<SurfaceToggles> {
  return (await loadResourceFilters(dataRoot, workspace)).toggles
}

/** Replace surface choices while preserving the latest committed entry choices. */
export async function saveSurfaceToggles(dataRoot: string, workspace: string, toggles: SurfaceToggles): Promise<void> {
  const captured = structuredClone(toggles)
  await mutateResourceFilters(dataRoot, workspace, current => ({ ...current, toggles: captured }))
}
