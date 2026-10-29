/**
 * zh/en dictionaries for the project resource window.
 *
 * A separate dictionary module so the window's keys land without touching the
 * main locales.ts (which another work stream holds); index.ts merges both into
 * the one namespace the host binds. The six face tabs read the main
 * dictionary's workspaceTab* words so the window names each surface exactly
 * as the settings page does; this module carries only the window's own keys.
 */

/** Chinese is the source-of-truth key set; English mirrors it one for one. */
export const resourcesZh = {} as const

export type ResourceLocaleKey = keyof typeof resourcesZh

export const resourcesEn: Record<ResourceLocaleKey, string> = {}
