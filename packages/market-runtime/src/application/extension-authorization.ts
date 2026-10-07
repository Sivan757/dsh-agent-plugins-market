import type { ExtensionResource, ExtensionSelection } from '../../../market-contracts/src/contracts/extension-presets.js'

/** A resource must remain available and its suite must also be selected. */
export function extensionResourceEnabled(resource: ExtensionResource, selection: ExtensionSelection, resources: readonly ExtensionResource[]): boolean {
  if (resource.control === 'global-only' || !resource.available || !selection.enabledIds.includes(resource.id)) return false
  if (resource.suiteResourceId === undefined) return true
  return selection.enabledIds.includes(resource.suiteResourceId) && resources.some(row => row.id === resource.suiteResourceId && row.available)
}
