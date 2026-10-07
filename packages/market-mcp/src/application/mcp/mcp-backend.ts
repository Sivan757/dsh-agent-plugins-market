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

import type { McpBackend } from '../../../../market-contracts/src/contracts/mcp.js'

export type { McpBackend }

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
