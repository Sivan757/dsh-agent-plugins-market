import type { McpStatusEntry } from '../../../contracts/mcp-status.js'

/** Actions describe different effects: retry preserves credentials; OAuth reset is explicit. */
export function mcpDetailActions(entry: McpStatusEntry) {
  const owned = entry.kind === 'plugin' || entry.managed === true
  return {
    retry: owned && (entry.state === 'failed' || entry.state === 'orphaned') && entry.code !== 'unsupported-transport',
    reauthorize: owned && entry.canReauthorize === true && !['disabled', 'foreign', 'orphaned', 'needs-credentials'].includes(entry.state)
  }
}
