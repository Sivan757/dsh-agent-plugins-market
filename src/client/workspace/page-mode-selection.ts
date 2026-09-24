/** Pure capability decision for the legacy page-mode fallback. */

/**
 * Use the DOM page fallback only when the host has no settings page and does
 * expose a page shell for the fallback to mount into.
 *
 * @param settingsSurfaceAvailable - whether `settings.section` is live.
 * @param pageShellAvailable - whether the sidebar/conversation shell exists.
 * @returns true when the fallback is the only available market surface.
 */
export function shouldUseLegacyPageMode(settingsSurfaceAvailable: boolean, pageShellAvailable: boolean): boolean {
  return !settingsSurfaceAvailable && pageShellAvailable
}
