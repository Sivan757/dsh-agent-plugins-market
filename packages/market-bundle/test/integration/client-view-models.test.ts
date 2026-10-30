// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { matchesMcpFilter, type McpStatusFilter } from '../../../../packages/market-ui/src/features/mcp/mcp-status-view-model.js'
import type { McpStatusPayload } from '../../../../packages/market-contracts/src/contracts/mcp-status.js'

// The renderer derives the visible rows and each tab's count from the same
// predicate, so a filter is the only thing a surface still supplies.
const mcpStatus: McpStatusPayload = {
  entries: [
    { id: 'plugin:one', name: 'one', kind: 'plugin', state: 'connected', transport: 'stdio', tools: [] },
    { id: 'direct:two', name: 'two', kind: 'direct', state: 'failed', transport: 'observed', tools: [], endpoint: 'https://two' },
    { id: 'disabled:three', name: 'three', kind: 'plugin', state: 'disabled', transport: 'stdio', tools: [] }
  ],
  observedAt: '',
  totals: { all: 3, connected: 1, degraded: 0, failed: 1, needsCredentials: 0, orphaned: 0, disabled: 1, foreign: 0 },
  directObservationOnly: true
}

describe('client MCP filters', () => {
  it('filters MCP rows by scope, keeping switched-off rows reachable', () => {
    const ids = (filter: McpStatusFilter): string[] => mcpStatus.entries.filter(entry => matchesMcpFilter(entry, filter)).map(entry => entry.id)
    expect(ids('all')).toEqual(['plugin:one', 'direct:two', 'disabled:three'])
    expect(ids('direct')).toEqual(['direct:two'])
    // A switched-off row keeps its own scope as well as the switched-off tab.
    expect(ids('plugin')).toEqual(['plugin:one', 'disabled:three'])
    expect(ids('disabled')).toEqual(['disabled:three'])
  })
})
