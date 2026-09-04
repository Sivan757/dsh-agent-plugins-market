/**
 * Configuration types for the market's self-built MCP client bridge. One
 * bridge instance connects to one MCP server; mounts are built
 * programmatically by `mcp-config.ts`, so there is no Schemastery schema —
 * every field the supervisor relies on is re-judged at load
 * (`resolveReconnectPolicy`, serverName pattern) and misconfiguration fails
 * that instance loudly instead of being normalized silently.
 *
 * @module runtime/mcp-client/config
 */

import type { ReconnectConfig } from './connection.js'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.js'
export { RECONNECT_DEFAULTS } from './connection.js'

/** Default timeout for individual MCP tool calls (ms). */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Valid `serverName`, kept below the public tool-name budget. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Loopback callback tuning for the OAuth browser leg. The redirect listener
 * binds `127.0.0.1`; port `0` (the default) picks an ephemeral port, which
 * RFC 8252 §7.3 loopback redirects permit.
 */
export interface OAuthStorageConfig {
  /** Fixed loopback port for the authorization redirect; `0` picks one ephemally. */
  callbackPort?: number
}

/**
 * OAuth 2.1 authorization config for a Streamable HTTP (or legacy SSE)
 * server. The MCP authorization flow (RFC 9728 discovery, dynamic client
 * registration, PKCE, refresh) is performed by the SDK: on the server's `401`
 * challenge the transport opens a loopback browser authorization, and granted
 * tokens persist through the credentials service when one is mounted.
 *
 * Defaults to enabled — servers that never challenge are unaffected (the
 * provider only activates on a `401`), so a suite needs no OAuth declaration
 * for the flow to work.
 */
export interface OAuthConfig {
  /** Enable the OAuth flow (default `true`; set `false` to opt out explicitly). */
  enabled?: boolean
  /** Space-separated scope string requested during authorization, when the server needs one. */
  scope?: string
  /** Loopback callback tuning; omission uses an ephemeral port and the defaults. */
  storage?: OAuthStorageConfig
}

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live bridge instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP. */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /** Stable local namespace — see {@link StdioConfig.serverName}. */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** OAuth 2.1 authorization (default enabled — see {@link OAuthConfig}); set `enabled: false` to opt out. */
  auth?: OAuthConfig
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/**
 * Config for connecting to an MCP server over the legacy HTTP+SSE transport
 * (the pre-Streamable-HTTP protocol some older servers still speak). The SDK
 * owns the protocol pairing; OAuth semantics mirror the Streamable HTTP case.
 */
export interface SseConfig {
  /** Selects the legacy HTTP+SSE transport. */
  transport: 'sse'
  /** Stable local namespace — see {@link StdioConfig.serverName}. */
  serverName: string
  /** SSE endpoint URL the server advertises. */
  url: string
  /** Additional headers attached to both the SSE stream and endpoint requests. */
  headers: Record<string, string>
  /** OAuth 2.1 authorization (default enabled — see {@link OAuthConfig}). */
  auth?: OAuthConfig
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Configuration for one stdio, Streamable HTTP, or legacy SSE MCP server. */
export type Config = StdioConfig | StreamableHttpConfig | SseConfig

/** All transports carry these fields; narrows the union without a switch. */
interface ConfigFields {
  serverName: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect?: ReconnectConfig
}

/**
 * Validate one programmatically-built config. Programmatic construction
 * bypasses any schema layer, so every invariant the bridge relies on is
 * re-judged here — a misconfiguration rejects the mount with an actionable
 * error before any connection is attempted.
 * @param config - raw bridge config built by `mcp-config.ts`.
 * @returns the same config, narrowed to the validated shape.
 */
export function validateConfig(config: Config): Config {
  const fields = config as ConfigFields
  if (!SERVER_NAME_PATTERN.test(config.serverName)) {
    throw new Error(`bridge config serverName "${config.serverName}" must match ${String(SERVER_NAME_PATTERN)}`)
  }
  if (!Number.isFinite(fields.toolCallTimeoutMs) || fields.toolCallTimeoutMs <= 0) {
    throw new Error(`bridge config toolCallTimeoutMs must be a positive finite number`)
  }
  if (typeof fields.failOnStartupError !== 'boolean') {
    throw new Error('bridge config failOnStartupError must be a boolean')
  }
  if (config.transport === 'stdio' && (typeof config.command !== 'string' || config.command === '')) {
    throw new Error('bridge stdio config requires a command')
  }
  if (config.transport !== 'stdio' && (typeof config.url !== 'string' || config.url === '')) {
    throw new Error(`bridge ${config.transport} config requires a url`)
  }
  return config
}
