import type { McpStatusEntry } from '../../../contracts/mcp-status.js'

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
  return {
    retry: owned && (entry.state === 'failed' || entry.state === 'orphaned') && entry.code !== 'unsupported-transport',
    reauthorize: owned && entry.canReauthorize === true && !['disabled', 'foreign', 'orphaned', 'needs-credentials'].includes(entry.state)
  }
}
