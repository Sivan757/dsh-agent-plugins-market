/** Browser-safe MCP status records shared by host aggregation and client rendering. */

/** A tool observed in the host MCP tool registry. */
export interface McpStatusTool {
  /** The tool's call name, as the server advertises it; never translated. */
  name: string
  description?: string
  /** The description translated for the panel's locale; absent means render `description`. */
  translatedDescription?: string
  /** The advertised input schema, kept only while it stays small enough to transport; absent otherwise. */
  parameters?: unknown
}

/** Whether an MCP row comes from a suite or direct host observation. */
export type McpStatusKind = 'plugin' | 'direct'

/** Operational state rendered for an MCP row. `foreign` = mounted by another MCP client (informational). */
export type McpStatusState = 'connected' | 'degraded' | 'failed' | 'needs-credentials' | 'orphaned' | 'disabled' | 'foreign'

/** Where one MCP server's live connection stands, as its supervisor observes it. */
export type McpConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'failed'

/** Why the supervisor left the connected phase, so the row can say what happened. */
export type McpConnectionLossReason = 'transport-closed' | 'attempt-failed' | 'authorization-pending' | 'reconnect-disabled' | 'transport-stuck' | 'gave-up'

/**
 * One supervisor's observation of a server's connection.
 *
 * Mount diagnostics say why a server never came up. This record says what a
 * server that did come up is doing now — reconnecting after its process died,
 * waiting out the next backoff, or stopped for good. Without it a dead
 * connection reads as a healthy row with stale tools.
 */
export interface McpConnectionObservation {
  serverName: string
  phase: McpConnectionPhase
  /** Epoch ms at which this phase began. */
  since: number
  /** 1-based attempt within the current outage; 0 while connected. */
  attempt: number
  /** Attempts one outage may use before the supervisor stops. */
  maxAttempts: number
  /** Epoch ms of the next scheduled attempt; present only while reconnecting. */
  retryAt?: number
  /** Redacted message from the transport or the failed attempt. */
  error?: string
  /** Why this phase was entered. */
  reason?: McpConnectionLossReason
}

/**
 * Why a row carries a reason. The mount failures explain a failed connection;
 * the remaining entries are the states that have something to say without
 * being broken, and each one has its own wording in the panel.
 */
export type McpStatusCode =
  | 'unsupported-transport'
  | 'missing-credential'
  | 'credential-error'
  | 'unmount-failed'
  | 'mount-failed'
  | 'foreign-mount'
  | 'duplicate-mount'
  /** Tools are still registered although the surface that declared them is gone. */
  | 'orphaned-tools'
  /** Switched off through an override record, and still mounted because the active session selection demands it. */
  | 'preset-demand'
  /** Switched off through this plugin's own override record. */
  | 'disabled-override'
  /** A stored override changed the configuration the suite declares. */
  | 'modified-override'
  /** The server connected once, dropped, and the supervisor is retrying. */
  | 'reconnecting'
  /** The supervisor used its attempt budget or was told not to retry. */
  | 'reconnect-stopped'

/**
 * One MCP suite/server pair a live session's selection keeps mounted.
 *
 * The mount pass merges session demand into the overrides as `enabled: true`,
 * so a pair listed here is live whatever its stored switch says. The status
 * surface reads the list to name that cause instead of reporting orphaned
 * tools.
 */
export interface McpDemandedMount {
  /** Source-qualified suite id, as the status rows carry it. */
  suiteId: string
  /** The server's key inside that suite's declaration. */
  serverKey: string
}

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
  /** The one-line diagnostic this row reports, in the words of the layer that failed. */
  reason?: string
  /** How long the last mount attempt took, in milliseconds, when one was recorded. */
  mountMs?: number
  /** Why this row carries a reason; also the key the panel localizes it by. */
  code?: McpStatusCode
  /**
   * The messages under the failure's `cause` chain, outermost first. A wrapper
   * sentence such as `initial connection … failed` names no cause by itself, so
   * the detail that points at the real problem travels beside it.
   */
  causes?: string[]
  /** Environment-variable credential references required by this server. */
  credentialRefs?: string[]
  /** Whether this server advertised zero tools at observation time. Zero-tool
   *  servers are legitimate, so the panel never treats `degraded` as broken. */
  advertisedTools?: boolean
  /** Whether a failed server will be retried automatically. */
  retryable?: boolean
  /** The live connection's phase while a supervisor watches this server. */
  connection?: McpConnectionObservation
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
  /**
   * Descriptions this read queued that have not landed yet; absent means the
   * text is settled. The panel re-reads while it is non-zero, so translated
   * text appears without the user pressing refresh.
   */
  translationPending?: number
}
