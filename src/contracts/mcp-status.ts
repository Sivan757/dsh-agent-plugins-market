/** Browser-safe MCP status records shared by host aggregation and client rendering. */

/** A tool observed in the host MCP tool registry. */
export interface McpStatusTool {
  name: string
  description?: string
}

/** Whether an MCP row comes from a suite or direct host observation. */
export type McpStatusKind = 'plugin' | 'direct'

/** Operational state rendered for an MCP row. */
export type McpStatusState = 'connected' | 'degraded' | 'failed' | 'needs-credentials' | 'orphaned' | 'disabled'

/** One MCP service row for the status surface. */
export interface McpStatusEntry {
  id: string
  name: string
  kind: McpStatusKind
  state: McpStatusState
  source?: string
  suiteId?: string
  serverKey?: string
  transport: string
  endpoint?: string
  config?: Record<string, unknown>
  tools: McpStatusTool[]
  reason?: string
  /** Environment-variable credential references required by this server. */
  credentialRefs?: string[]
  /** Whether this server advertised zero tools at observation time. Zero-tool
   *  servers are legitimate, so the panel never treats `degraded` as broken. */
  advertisedTools?: boolean
  /** Whether a failed server will be retried automatically. */
  retryable?: boolean
}

/** The MCP status response returned by the host. */
export interface McpStatusPayload {
  entries: McpStatusEntry[]
  observedAt: string
  totals: { all: number; connected: number; degraded: number; failed: number; needsCredentials: number; orphaned: number; disabled: number }
  directObservationOnly: boolean
}
