import type { McpStatusEntry } from '../../../../market-contracts/src/contracts/mcp-status.js'

/** Which recovery actions the detail dialog offers for one entry. */
export interface McpDetailActions {
  /** Re-run the mount, keeping stored credentials. */
  retry: boolean
  /** Drop the OAuth grant and authorize again. */
  reauthorize: boolean
}

/** Actions describe different effects: retry preserves credentials; OAuth reset is explicit. */
export function mcpDetailActions(entry: McpStatusEntry): McpDetailActions {
  const owned = entry.kind === 'plugin' || entry.managed === true
  // A live connection that dropped is retryable whatever the row state says:
  // the supervisor may still be backing off, and "retry now" is the one action
  // that shortens the wait.
  const lost = entry.connection !== undefined && entry.connection.phase !== 'connected'
  return {
    retry: owned && (entry.state === 'failed' || entry.state === 'orphaned' || lost) && entry.code !== 'unsupported-transport',
    reauthorize: owned && entry.canReauthorize === true && !['disabled', 'foreign', 'orphaned', 'needs-credentials'].includes(entry.state)
  }
}
