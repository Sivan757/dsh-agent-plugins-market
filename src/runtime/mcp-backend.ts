/**
 * MCP backend selection: whether suite MCP servers mount through the
 * market's self-built bridge (default — stdio, Streamable HTTP with OAuth,
 * and legacy SSE) or through the host's `@deepseek-ai/dsh-mcp-client`
 * (compatibility mode: no OAuth, no SSE, but the host-native implementation).
 *
 * The choice persists as `mcpBackend` in `<dataRoot>/settings.json`; the
 * mount registry reads it through a provider so a switch takes effect at the
 * next reconcile pass.
 *
 * @module runtime/mcp-backend
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** The MCP mount backend the market uses for suite servers. */
export type McpBackend = 'builtin' | 'host'

export const MCP_BACKENDS: readonly McpBackend[] = ['builtin', 'host']

/** The persisted market settings document (deliberately small and additive). */
interface MarketSettings {
  mcpBackend?: McpBackend
}

/** Path of the persisted settings file under the plugin data root. */
export function marketSettingsPath(dataRoot: string): string {
  return join(dataRoot, 'settings.json')
}

/** Read the configured backend; absent or invalid values read as the default. */
export async function readMcpBackend(dataRoot: string): Promise<McpBackend> {
  try {
    const parsed = JSON.parse(await readFile(marketSettingsPath(dataRoot), 'utf8')) as MarketSettings
    return parsed.mcpBackend === 'host' ? 'host' : 'builtin'
  } catch {
    return 'builtin'
  }
}

/** Persist the backend choice; the next reconcile pass mounts through it. */
export async function writeMcpBackend(dataRoot: string, backend: McpBackend): Promise<void> {
  let settings: MarketSettings = {}
  try {
    settings = JSON.parse(await readFile(marketSettingsPath(dataRoot), 'utf8')) as MarketSettings
  } catch {
    // No settings yet (or unreadable): start from a fresh document.
  }
  settings.mcpBackend = backend
  const path = marketSettingsPath(dataRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
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
