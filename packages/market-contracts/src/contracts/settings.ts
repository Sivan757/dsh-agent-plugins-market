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
 * One default is not a constant: `translationEnabled` follows the interface
 * language, so its reader takes the language as an argument and
 * {@link interfaceLanguageTranslates} answers that default only. An explicit
 * preference is independent of language. {@link resolveTranslationTarget}
 * selects the language of displayed translations, including English.
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
  /**
   * ON = suite, skill, command, agent, MCP and LSP text is localized for the
   * host locale. The stored value while the user has one, the interface
   * language's default otherwise.
   */
  translationEnabled: boolean
  /** ON = the composer carries the Agent preset manager entry (experimental). */
  agentPresetsEnabled: boolean
}

/**
 * The default of every market setting — the single place one is written.
 *
 * These are user-visible behavior: a flip here is a behavior change that ships
 * with its documentation, not a private implementation detail.
 *
 * `translationEnabled` is the one exception: the interface language decides it
 * (see {@link interfaceLanguageTranslates}), so this constant is not where its
 * effective default lives. It is what the browser store holds before the host
 * answers, and that pre-answer state deliberately withholds the translation
 * control rather than flashing it. The namespace schema declares no default for
 * the field at all, an absence that is load-bearing: a schema default would
 * reach the live config reference and erase the difference between "the user
 * never set this" and "the user turned it off".
 */
export const MARKET_SETTINGS_DEFAULTS: MarketSettings = {
  mcpEnhanced: true,
  scanProjectLayouts: false,
  downloadRegion: 'auto',
  feedbackEnabled: true,
  autoUpdateSources: false,
  // The browser-side value before the effective one is known — not the
  // effective default, which interfaceLanguageTranslates derives from the
  // interface language. Off here keeps a fresh install from spending a provider
  // request before the host has answered.
  translationEnabled: false,
  // Experimental capability: the manager stays hidden until the user opts in.
  agentPresetsEnabled: false
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
 * Whether one interface language renders the market's Chinese dictionary.
 *
 * This is the host's own rule rather than a second reading of it:
 * `bindHostLocale` (`runtime/host/host-locale.ts`) answers every preference
 * that is not English with the Chinese dictionary, so as far as the interface is
 * concerned everything that is not English is Chinese — an absent preference
 * included, which the host reads as zh.
 *
 * This determines only the default display preference: Chinese starts on and
 * English starts off. It must not gate an explicitly enabled translation.
 * @param localePreference - the host `locale.preference`, or undefined while nothing supplies one.
 */
export function interfaceLanguageTranslates(localePreference: string | undefined): boolean {
  return localePreference === undefined || !localePreference.toLowerCase().startsWith('en')
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
 * A stored boolean always wins: the user's own answer is never overridden by
 * the language. Only a section that says nothing about the field takes the
 * language's answer, which is what makes a language switch move the default for
 * a user who never set the field and leave every other user alone.
 * @param section - the stored (or absent) namespace section, untrusted.
 * @param localePreference - the host `locale.preference` the language-derived default follows.
 */
export function resolveMarketSettings(section: unknown, localePreference?: string): MarketSettings {
  const stored = (typeof section === 'object' && section !== null ? section : {}) as Record<string, unknown>
  return {
    mcpEnhanced: narrowBoolean(stored['mcpEnhanced'], MARKET_SETTINGS_DEFAULTS.mcpEnhanced),
    scanProjectLayouts: narrowBoolean(stored['scanProjectLayouts'], MARKET_SETTINGS_DEFAULTS.scanProjectLayouts),
    downloadRegion: narrowDownloadRegion(stored['downloadRegion']),
    feedbackEnabled: narrowBoolean(stored['feedbackEnabled'], MARKET_SETTINGS_DEFAULTS.feedbackEnabled),
    autoUpdateSources: narrowBoolean(stored['autoUpdateSources'], MARKET_SETTINGS_DEFAULTS.autoUpdateSources),
    translationEnabled: narrowBoolean(stored['translationEnabled'], interfaceLanguageTranslates(localePreference)),
    agentPresetsEnabled: narrowBoolean(stored['agentPresetsEnabled'], MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled)
  }
}
