/**
 * MCP backend selection: whether suite MCP servers mount through the
 * market's self-built bridge (default — stdio, Streamable HTTP with OAuth,
 * and legacy SSE) or through the host's `@deepseek-ai/dsh-mcp-client`
 * (compatibility mode: no OAuth, no SSE, but the host-native implementation).
 *
 * The choice is a host settings namespace (`dsh-agent-plugins-market`,
 * `mcpEnhanced: boolean`, default true) registered by the plugin's node half:
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

/** The MCP mount backend the market uses for suite servers. */
export type McpBackend = 'builtin' | 'host'

export const MCP_BACKENDS: readonly McpBackend[] = ['builtin', 'host']

/** Settings namespace this plugin registers; the key the plugin-config tab pairs our card by. */
export const MCP_SETTINGS_NAMESPACE = 'dsh-agent-plugins-market'

/** Schema of the market settings namespace: the MCP enhancement switch and the download region. */
export const MarketSettingsSchema = z.object({
  /** ON (default) = the built-in bridge with OAuth and SSE; OFF = host client compat mode. */
  mcpEnhanced: z.boolean().default(true),
  /** Download region for GitHub acquisition; `auto` follows the interface language. */
  downloadRegion: z.union([z.const('auto'), z.const('global'), z.const('china')]).default('auto')
})

/** Path of the legacy persisted settings file under the plugin data root. */
export function marketSettingsPath(dataRoot: string): string {
  return join(dataRoot, 'settings.json')
}

/** Read the legacy persisted backend; absent or invalid values read as the default. */
export async function readMcpBackend(dataRoot: string): Promise<McpBackend> {
  try {
    const parsed = JSON.parse(await readFile(marketSettingsPath(dataRoot), 'utf8')) as { mcpBackend?: string }
    return parsed.mcpBackend === 'host' ? 'host' : 'builtin'
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
