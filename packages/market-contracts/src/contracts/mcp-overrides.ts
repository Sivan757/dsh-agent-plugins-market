import type { McpServerSse, McpServerStreamableHttp, McpServerStdio } from '../model/types.js'

/** HTTP-shaped server sources (url + headers carriers) overrides can edit. */
type McpServerHttp = McpServerStreamableHttp | McpServerSse

/** The largest timeout a bridge config and the host timer can hold. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** Per-server override record; absent fields pass through from the source. */
export type McpServerOverride = {
  /** Validated complete user configuration, retaining source-owned identity. */
  config?: McpServerStdio | McpServerHttp
  /** Disabled servers are not mounted at all (default enabled). */
  enabled?: boolean
  /** Replaces the source URL (streamable-http only). */
  url?: string
  /** Replaces the whole header map (streamable-http only). */
  headers?: Record<string, string>
  /** Replaces the whole env map (stdio). */
  env?: Record<string, string>
  /** Replaces the whole args list (stdio). */
  args?: string[]
  /** Replaces the OAuth block (streamable-http only); `enabled: false` disables a source-declared flow. */
  auth?: { enabled: boolean; scope?: string }
  /** Per-tool-call timeout in milliseconds; absent inherits the suite's value or the bridge default. */
  toolCallTimeoutMs?: number
  /** Startup timeout in milliseconds; absent inherits the suite's value or the bridge default. */
  startupTimeoutMs?: number
  /** Tool names the user turned off; the suite's own deny list stays in force beside them. */
  disabledTools?: string[]
}

/** Timeout fields a policy save can set (`number`) or clear back to inheritance (`null`). */
export interface McpTimeoutPatch {
  toolCallTimeoutMs?: number | null
  startupTimeoutMs?: number | null
}

/** Overrides for one suite, keyed by mcp.json server key. */
export type McpSuiteOverrides = Record<string, McpServerOverride>
