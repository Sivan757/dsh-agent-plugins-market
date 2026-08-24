/**
 * Maps one validated suite `mcp.json` onto `dsh-mcp-client` config rows.
 *
 * The portable format is translated, not executed directly: stdio commands
 * resolve against the suite root (spec §7.2.1), `${PLUGIN_ROOT}` /
 * `${PLUGIN_DATA}` expand against the suite root and its data directory, and
 * `${NAME}` expands from the process environment (documented extension over
 * the portable format, matching how hook commands already consume ambient
 * env). Legacy HTTP+SSE servers have no transport in the dsh MCP client and
 * are skipped with a per-server reason.
 */
import { createHash } from 'node:crypto'
import type { StdioConfig, StreamableHttpConfig } from '@deepseek-ai/dsh-mcp-client'
import { expandPlaceholders, resolveCwd } from '../catalog/validate.js'
import { applyOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import type { McpServer, McpServerSse, McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'

/** The max length `dsh-mcp-client` accepts for a serverName. */
const SERVER_NAME_MAX = 32

export interface McpMountRequest {
  suiteId: string
  serverKey: string
  config: StdioConfig | StreamableHttpConfig
}

export interface McpMountFailure {
  serverKey: string
  reason: string
}

/**
 * Build one mount request per supported mcp.json server.
 * @param overrides user-owned per-server overrides (url/headers/env/args
 *   replacement plus enable/disable); applied after source expansion, before
 *   mount. Disabled servers are omitted from the result entirely.
 * @returns mount requests plus per-server failures (unsupported transport,
 *   invalid server key, or derived serverName collision candidates are
 *   checked by the mount registry, not here).
 */
export function toMcpMounts(suite: Suite, pluginDataRoot: string, overrides: McpSuiteOverrides = {}): { mounts: McpMountRequest[]; failures: McpMountFailure[] } {
  if (suite.mcp === undefined) return { mounts: [], failures: [] }
  const mounts: McpMountRequest[] = []
  const failures: McpMountFailure[] = []
  for (const [serverKey, source] of Object.entries(suite.mcp.servers)) {
    const override = overrides[serverKey]
    if (override?.enabled === false) continue
    const request = toMount(suite, serverKey, applyOverride(source as McpServerStdio | McpServerStreamableHttp, override), pluginDataRoot)
    if (request === undefined) {
      failures.push({ serverKey, reason: transportReason(source) })
    } else {
      mounts.push(request)
    }
  }
  return { mounts, failures }
}

function toMount(suite: Suite, serverKey: string, server: McpServer, pluginDataRoot: string): McpMountRequest | undefined {
  const serverName = deriveServerName(suite.id, serverKey)
  if (server.type === 'stdio') return { suiteId: suite.id, serverKey, config: toStdio(serverName, suite, server, pluginDataRoot) }
  if (server.type === 'streamable-http') return { suiteId: suite.id, serverKey, config: toHttp(serverName, suite, server, pluginDataRoot) }
  return undefined
}

function toStdio(serverName: string, suite: Suite, server: McpServerStdio, pluginDataRoot: string): StdioConfig {
  const command = server.command.startsWith('./') ? joinInside(suite.root, server.command.slice(2)) : server.command
  const pluginData = joinInside(pluginDataRoot, suite.id)
  const args = (server.args ?? []).map(arg => expandPlaceholders(arg, suite.root, pluginData))
  const env = Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, expandPlaceholders(value, suite.root, pluginData)]))
  const cwd = server.cwd === undefined ? suite.root : resolveCwd(expandPlaceholders(server.cwd, suite.root, pluginData), suite.root, pluginData)
  return {
    transport: 'stdio',
    serverName,
    command,
    args,
    env,
    cwd,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false
  }
}

function toHttp(serverName: string, suite: Suite, server: McpServerStreamableHttp, pluginDataRoot: string): StreamableHttpConfig {
  const pluginData = joinInside(pluginDataRoot, suite.id)
  const headers = Object.fromEntries(Object.entries(server.headers ?? {}).map(([key, value]) => [key, expandPlaceholders(value, suite.root, pluginData)]))
  return {
    transport: 'streamable-http',
    serverName,
    url: server.url,
    headers,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false
  }
}

function transportReason(server: McpServer): string {
  if ((server as McpServerSse).type === 'sse') return 'legacy HTTP+SSE transport is not supported by the dsh MCP client'
  return 'unsupported mcp.json server shape'
}

function joinInside(root: string, segment: string): string {
  return `${root.replace(/[\\/]$/, '')}/${segment}`
}

/** Sanitize one token into `[A-Za-z0-9_-]`. */
function sanitizeToken(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned === '' ? 'server' : cleaned
}

/**
 * Derive a stable, unique-ish `dsh-mcp-client` serverName from the suite and
 * server ids: `${suiteId}__${serverKey}` sanitized, truncated to 32 chars
 * with a deterministic 12-hex suffix when the join exceeds the budget (the
 * same deterministic-hash policy the MCP client uses for long tool names).
 */
export function deriveServerName(suiteId: string, serverKey: string): string {
  const candidate = `${sanitizeToken(suiteId)}__${sanitizeToken(serverKey)}`
  if (candidate.length <= SERVER_NAME_MAX) return candidate
  const hash = createHash('sha256').update(`${suiteId}\u0000${serverKey}`).digest('hex').slice(0, 12)
  return `${candidate.slice(0, SERVER_NAME_MAX - 13)}-${hash}`
}
