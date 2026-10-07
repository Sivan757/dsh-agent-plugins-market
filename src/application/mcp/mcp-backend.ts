/**
 * MCP backend selection: whether suite MCP servers mount through the
 * market's self-built bridge (default — stdio, Streamable HTTP with OAuth,
 * and legacy SSE) or through the host's `@deepseek-ai/dsh-mcp-client`
 * (compatibility mode: no OAuth, no SSE, but the host-native implementation).
 *
 * The choice is the `mcpEnhanced` field of the market's host settings
 * namespace (see `contracts/settings.ts`) registered by the plugin's node half:
 * the registration is what makes the host 插件配置 tab serve our card, the
 * client card binds it for state, and the node half watches it to remount
 * servers when the switch flips.
 *
 * @module application/mcp-backend
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import z from '@deepseek-ai/schemastery'
import { MARKET_SETTINGS_DEFAULTS } from '../../contracts/settings.js'

import type { McpBackend } from '../../contracts/mcp.js'

export type { McpBackend }

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

/** What the host client probe reports: resolvability plus its version. */
export interface HostMcpClientProbe {
  available: boolean
  version?: string
}

/**
 * Probe whether the host's `dsh-mcp-client` is resolvable from this plugin's
 * module context, and at which version. Best effort: any failure reads as
 * "unavailable", which the mount path surfaces as a per-server diagnostic
 * when the host backend is selected.
 */
export async function probeHostMcpClient(): Promise<HostMcpClientProbe> {
  try {
    const require = createRequire(import.meta.url)
    const manifestPath = require.resolve('@deepseek-ai/dsh-mcp-client/package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string }
    return { available: true, ...(manifest.version === undefined ? {} : { version: manifest.version }) }
  } catch {
    return { available: false }
  }
}
