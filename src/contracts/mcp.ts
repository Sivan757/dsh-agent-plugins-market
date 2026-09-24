/**
 * MCP wire vocabulary shared by the host surface, the application services and
 * the runtime mounts: the backend selector and the diagnostic shape the status
 * payload carries. Contracts import nothing; these are data only. The mount
 * registries narrow `code` to their own failure-code unions at the source.
 * @module contracts/mcp
 */
import type { McpStatusCode } from './mcp-status.js'

/** The MCP mount backend the market uses for suite servers. */
export type McpBackend = 'builtin' | 'host'

/** One MCP mount failure as the registries record it for the status surface. */
export interface McpMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: McpStatusCode
  /** The messages under the failure's `cause` chain, outermost first. */
  causes?: string[]
  credentialRefs?: string[]
}
