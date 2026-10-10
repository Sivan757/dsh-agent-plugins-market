import z from '@deepseek-ai/schemastery'
import { MARKET_SETTINGS_DEFAULTS } from '../../../market-contracts/src/contracts/settings.js'

/**
 * Schema of the market settings namespace: the switches this plugin's config
 * card serves, with the defaults declared to the host. The values themselves
 * belong to {@link MARKET_SETTINGS_DEFAULTS}; this schema states them, it does
 * not own them.
 *
 * `translationEnabled` deliberately declares no default. Its default follows
 * the interface language, and a declared default would be materialized into the
 * live config reference, where "the user never set this" and "the user turned it
 * off" would both read `false` — the distinction the derivation rests on. With
 * the field absent, the reference answers `undefined` until the user writes it,
 * and {@link resolveMarketSettings} fills the language's own default in.
 */
export const MarketSettingsFields = {
  mcpEnhanced: z.boolean().default(MARKET_SETTINGS_DEFAULTS.mcpEnhanced),
  scanProjectLayouts: z.boolean().default(MARKET_SETTINGS_DEFAULTS.scanProjectLayouts),
  downloadRegion: z.union([z.const('auto'), z.const('global'), z.const('china')]).default(MARKET_SETTINGS_DEFAULTS.downloadRegion),
  feedbackEnabled: z.boolean().default(MARKET_SETTINGS_DEFAULTS.feedbackEnabled),
  autoUpdateSources: z.boolean().default(MARKET_SETTINGS_DEFAULTS.autoUpdateSources),
  translationEnabled: z.boolean(),
  agentPresetsEnabled: z.boolean().default(MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled)
} as const

export const MarketSettingsSchema = z.object(MarketSettingsFields)
