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
  it('isolates the rows that need a click, and the rows the user switched off', () => {
    // A status surface earns its tabs from states, not from who declared the
    // row: the declaring suite is a chip the row already prints.
    const ids = (filter: McpStatusFilter): string[] => mcpStatus.entries.filter(entry => matchesMcpFilter(entry, filter)).map(entry => entry.id)
    expect(ids('all')).toEqual(['plugin:one', 'direct:two', 'disabled:three'])
    // `direct:two` is the failed row; a connected one and a switched-off one stay out.
    expect(ids('attention')).toEqual(['direct:two'])
    expect(ids('disabled')).toEqual(['disabled:three'])
    // The renderer's own "all" tab has no filter definition, and every row is
    // reachable from it.
    expect(mcpStatus.entries.length).toBe(3)
  })
})
