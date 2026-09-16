/**
 * Browser-safe settings contract of the market's host settings namespace: the
 * namespace key, the fields with their defaults, and the one reader that turns
 * a stored section into resolved values.
 *
 * The defaults live here and nowhere else. The namespace schema declares them
 * to the host, the node half reads them back through {@link resolveMarketSettings},
 * and the browser half — which cannot import `src/runtime` — reads the same
 * resolved values off the settings snapshot it is handed. Changing a default is
 * therefore a one-line edit in this module.
 *
 * @module contracts/settings
 */

/** Settings namespace this plugin registers; the key the plugin-config tab pairs our card by. */
export const MARKET_SETTINGS_NAMESPACE = 'dsh-agent-plugins-market'

/** The persisted download-region setting: `auto` follows the interface language. */
export type DownloadRegionSetting = 'auto' | 'global' | 'china'

/** Every market setting with the value it resolves to when the document says nothing. */
export interface MarketSettings {
  /** ON = the built-in MCP bridge with OAuth and SSE; OFF = host client compat mode. */
  mcpEnhanced: boolean
  /** ON = native project Agent layouts (`.claude/`, `.agents/`) take part in discovery. */
  scanProjectLayouts: boolean
  /** Download region for GitHub acquisition. */
  downloadRegion: DownloadRegionSetting
  /** ON = the `report_market_issue` model tool is registered. */
  feedbackEnabled: boolean
  /** ON = every configured source refreshes in the background. */
  autoUpdateSources: boolean
}

/**
 * The default of every market setting — the single place one is written.
 *
 * These are user-visible behavior: a flip here is a behavior change that ships
 * with its documentation, not a private implementation detail.
 */
export const MARKET_SETTINGS_DEFAULTS: MarketSettings = {
  mcpEnhanced: true,
  scanProjectLayouts: false,
  downloadRegion: 'auto',
  feedbackEnabled: true,
  autoUpdateSources: false
}

/** Every field name the market's settings section carries. */
export type MarketSettingKey = keyof MarketSettings

/**
 * Narrow an untrusted stored region to a setting; anything else reads as the
 * declared default.
 * @param value - the stored `downloadRegion` value.
 * @param fallback - the value an unrecognized input reads as.
 */
export function narrowDownloadRegion(value: unknown, fallback: DownloadRegionSetting = MARKET_SETTINGS_DEFAULTS.downloadRegion): DownloadRegionSetting {
  return value === 'auto' || value === 'global' || value === 'china' ? value : fallback
}

/** One boolean field: a stored boolean, else the field's default. */
function narrowBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Resolve a stored settings section the way the host resolves it: each field
 * takes its stored value when it is one this field accepts, and its declared
 * default otherwise.
 *
 * The host hands the resolved section back on its own, but not every caller has
 * one — the plugin's own halves read a section they may not have received yet,
 * and a test hands in a bare literal. Funnelling all of them through this
 * function is what keeps a second reading of "what does missing mean" from
 * growing somewhere else.
 * @param section - the stored (or absent) namespace section, untrusted.
 */
export function resolveMarketSettings(section: unknown): MarketSettings {
  const stored = (typeof section === 'object' && section !== null ? section : {}) as Record<string, unknown>
  return {
    mcpEnhanced: narrowBoolean(stored['mcpEnhanced'], MARKET_SETTINGS_DEFAULTS.mcpEnhanced),
    scanProjectLayouts: narrowBoolean(stored['scanProjectLayouts'], MARKET_SETTINGS_DEFAULTS.scanProjectLayouts),
    downloadRegion: narrowDownloadRegion(stored['downloadRegion']),
    feedbackEnabled: narrowBoolean(stored['feedbackEnabled'], MARKET_SETTINGS_DEFAULTS.feedbackEnabled),
    autoUpdateSources: narrowBoolean(stored['autoUpdateSources'], MARKET_SETTINGS_DEFAULTS.autoUpdateSources)
  }
}
