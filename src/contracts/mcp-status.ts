/** Browser-safe MCP status records shared by host aggregation and client rendering. */

/** A tool observed in the host MCP tool registry. */
export interface McpStatusTool {
  name: string
  description?: string
  /** The advertised input schema, kept only while it stays small enough to transport; absent otherwise. */
  parameters?: unknown
}

/** Whether an MCP row comes from a suite or direct host observation. */
export type McpStatusKind = 'plugin' | 'direct'

/** Operational state rendered for an MCP row. `foreign` = mounted by another MCP client (informational). */
export type McpStatusState = 'connected' | 'degraded' | 'failed' | 'needs-credentials' | 'orphaned' | 'disabled' | 'foreign'

/** One MCP service row for the status surface. */
export interface McpStatusEntry {
  id: string
  name: string
  kind: McpStatusKind
  /** A direct service whose persisted configuration is owned by this plugin. */
  managed?: boolean
  /** The current backend and credential service support resetting this server's OAuth grant. */
  canReauthorize?: boolean
  state: McpStatusState
  source?: string
  suiteId?: string
  serverKey?: string
  transport: string
  endpoint?: string
  config?: Record<string, unknown>
  tools: McpStatusTool[]
  reason?: string
  /** Mount-path classification when a diagnostic produced this row. */
  code?: 'unsupported-transport' | 'missing-credential' | 'credential-error' | 'unmount-failed' | 'mount-failed' | 'foreign-mount' | 'duplicate-mount'
  /** Environment-variable credential references required by this server. */
  credentialRefs?: string[]
  /** Whether this server advertised zero tools at observation time. Zero-tool
   *  servers are legitimate, so the panel never treats `degraded` as broken. */
  advertisedTools?: boolean
  /** Whether a failed server will be retried automatically. */
  retryable?: boolean
  /** A remote server whose suite declares no `auth` block: the bridge still
   *  runs the OAuth flow when the server answers 401, which the redacted
   *  configuration alone cannot show. */
  oauthDefault?: boolean
  /** Suite allow-list for this server's tools; absent when the suite narrows nothing. */
  suiteEnabledTools?: string[]
  /** Tools the suite's own declaration leaves out. */
  suiteDisabledTools?: string[]
  /** Tools the user turned off through the panel. */
  userDisabledTools?: string[]
}

/** The MCP status response returned by the host. */
export interface McpStatusPayload {
  entries: McpStatusEntry[]
  observedAt: string
  totals: { all: number; connected: number; degraded: number; failed: number; needsCredentials: number; orphaned: number; disabled: number; foreign: number }
  directObservationOnly: boolean
  /** The mount backend the rows were observed under; `host` cannot enforce tool
   *  filters or startup timeouts, so the panel disables those controls. */
  backend?: 'builtin' | 'host'
}
