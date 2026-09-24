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
 * servers when the switch flips. `readMcpBackend` remains only as the
 * one-time migration from the earlier data-root `settings.json` choice.
 *
 * @module runtime/mcp-backend
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { readJsonFile } from '../application/json-file.js'
import { MARKET_SETTINGS_DEFAULTS } from '../contracts/settings.js'

/** The MCP mount backend the market uses for suite servers. */
export type McpBackend = 'builtin' | 'host'

/**
 * Schema of the market settings namespace: the switches this plugin's config
 * card serves, with the defaults declared to the host. The values themselves
 * belong to {@link MARKET_SETTINGS_DEFAULTS}; this schema states them, it does
 * not own them.
 */
export const MarketSettingsFields = {
  mcpEnhanced: z.boolean().default(MARKET_SETTINGS_DEFAULTS.mcpEnhanced),
  scanProjectLayouts: z.boolean().default(MARKET_SETTINGS_DEFAULTS.scanProjectLayouts),
  downloadRegion: z.union([z.const('auto'), z.const('global'), z.const('china')]).default(MARKET_SETTINGS_DEFAULTS.downloadRegion),
  feedbackEnabled: z.boolean().default(MARKET_SETTINGS_DEFAULTS.feedbackEnabled),
  autoUpdateSources: z.boolean().default(MARKET_SETTINGS_DEFAULTS.autoUpdateSources)
} as const

export const MarketSettingsSchema = z.object(MarketSettingsFields)

/** Path of the legacy persisted settings file under the plugin data root. */
export function marketSettingsPath(dataRoot: string): string {
  return join(dataRoot, 'settings.json')
}

/** Read the legacy persisted backend; absent or invalid values read as the default. */
export async function readMcpBackend(dataRoot: string): Promise<McpBackend> {
  try {
    const parsed = (await readJsonFile(marketSettingsPath(dataRoot))) as { mcpBackend?: string } | undefined
    return parsed?.mcpBackend === 'host' ? 'host' : 'builtin'
  } catch {
    return 'builtin'
  }
}

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
