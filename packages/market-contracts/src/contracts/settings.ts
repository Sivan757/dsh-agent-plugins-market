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
 * Every default is a plain boolean or word, so this module alone answers a
 * section that says nothing. {@link resolveTranslationTarget} still selects the
 * language translations are written in; that choice is independent of whether
 * translations are displayed.
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
  /** ON = suite, skill, command, agent, MCP and LSP text is localized for the host locale. */
  translationEnabled: boolean
  /** ON = the composer carries the Agent preset manager entry. */
  agentPresetsEnabled: boolean
}

/**
 * The default of every market setting — the single place one is written.
 *
 * These are user-visible behavior: a flip here is a behavior change that ships
 * with its documentation, not a private implementation detail.
 *
 * `translationEnabled` is the one field the namespace schema declares no
 * default for. The field stays absent until the user writes it, which is what
 * lets the card tell "never set" from an explicit value, and this constant
 * answers the absent case. A schema default would reach the live config
 * reference and erase that difference.
 */
export const MARKET_SETTINGS_DEFAULTS: MarketSettings = {
  mcpEnhanced: true,
  scanProjectLayouts: false,
  downloadRegion: 'auto',
  feedbackEnabled: true,
  autoUpdateSources: false,
  // On for every interface language: a fresh install translates without
  // visiting the settings page, and a stored false turns it off.
  translationEnabled: true,
  // On by default: the preset manager entry shows without an opt-in step, and a
  // stored false hides it.
  agentPresetsEnabled: true
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
 * The language the interface renders, as the translation chain names it.
 *
 * The target follows the dictionary, not the preference tag. The market ships
 * exactly one non-English dictionary and {@link bindHostLocale}'s counterpart
 * resolves every preference that is not English to it, so a `ja` or `zh-Hant`
 * reader is surrounded by Simplified Chinese copy: translating upstream text
 * into Japanese, or into Traditional, would put the one part of the page the
 * layer owns into a language nothing around it is written in. `zh` is the tag
 * both machine endpoints already map to Simplified Chinese
 * (`runtime/host/machine-translator.ts`) and the one the model hop names
 * "Simplified Chinese"; a second dictionary would add a case here rather than a
 * second reading of the preference somewhere else.
 *
 * Target selection is independent of whether translations are displayed.
 * @param localePreference - the host `locale.preference`, or undefined while nothing supplies one.
 * @returns the language rendered by the interface.
 */
export function resolveTranslationTarget(localePreference: string | undefined): 'zh' | 'en' {
  return localePreference?.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/**
 * Resolve a stored settings section the way the host resolves it: each field
 * takes its stored value when it is one this field accepts, and its default
 * otherwise.
 *
 * The host hands the resolved section back on its own, but not every caller has
 * one — the plugin's own halves read a section they may not have received yet,
 * and a test hands in a bare literal. Funnelling all of them through this
 * function is what keeps a second reading of "what does missing mean" from
 * growing somewhere else.
 *
 * A stored value always wins: the user's own answer is never overridden by a
 * default. Only a section that says nothing about the field takes the value in
 * {@link MARKET_SETTINGS_DEFAULTS}.
 * @param section - the stored (or absent) namespace section, untrusted.
 */
export function resolveMarketSettings(section: unknown): MarketSettings {
  const stored = (typeof section === 'object' && section !== null ? section : {}) as Record<string, unknown>
  return {
    mcpEnhanced: narrowBoolean(stored['mcpEnhanced'], MARKET_SETTINGS_DEFAULTS.mcpEnhanced),
    scanProjectLayouts: narrowBoolean(stored['scanProjectLayouts'], MARKET_SETTINGS_DEFAULTS.scanProjectLayouts),
    downloadRegion: narrowDownloadRegion(stored['downloadRegion']),
    feedbackEnabled: narrowBoolean(stored['feedbackEnabled'], MARKET_SETTINGS_DEFAULTS.feedbackEnabled),
    autoUpdateSources: narrowBoolean(stored['autoUpdateSources'], MARKET_SETTINGS_DEFAULTS.autoUpdateSources),
    translationEnabled: narrowBoolean(stored['translationEnabled'], MARKET_SETTINGS_DEFAULTS.translationEnabled),
    agentPresetsEnabled: narrowBoolean(stored['agentPresetsEnabled'], MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled)
  }
}
