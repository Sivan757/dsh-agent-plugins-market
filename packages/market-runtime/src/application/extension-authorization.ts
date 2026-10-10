import type { ExtensionResource, ExtensionSelection } from '../../../market-contracts/src/contracts/extension-presets.js'
import { CONFIGURATION_PARENT_IDS } from '../../../market-contracts/src/contracts/extension-presets.js'

/**
 * A resource must remain available and its suite must also be selected.
 *
 * A configuration parent (a `configuration` row, or any id in
 * CONFIGURATION_PARENT_IDS) publishes no card anywhere, so a preset never
 * carries its id: the grant is derived instead. When the row in question is
 * the parent itself, any selected child grants it; when the row's parent is a
 * configuration parent, the parent's availability and selection halves are
 * skipped and the child's own id alone decides.
 */
export function extensionResourceEnabled(resource: ExtensionResource, selection: ExtensionSelection, resources: readonly ExtensionResource[]): boolean {
  if (resource.control === 'global-only' || !resource.available || !selection.enabledIds.includes(resource.id)) return false
  const parentIsConfiguration = resource.configuration !== undefined || CONFIGURATION_PARENT_IDS.has(resource.id)
  if (!parentIsConfiguration) {
    if (resource.suiteResourceId === undefined) return true
    if (CONFIGURATION_PARENT_IDS.has(resource.suiteResourceId)) return true
    return selection.enabledIds.includes(resource.suiteResourceId) && resources.some(row => row.id === resource.suiteResourceId && row.available)
  }
  // The row is a configuration parent: no card can render for it, so its
  // grant is derived from the children it owns rather than from its own id.
  const owner = resource.suiteResourceId ?? resource.id
  return resources.some(row => row !== resource && row.suiteResourceId === owner && row.available && selection.enabledIds.includes(row.id))
}
