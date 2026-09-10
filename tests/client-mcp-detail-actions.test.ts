import { describe, expect, it } from 'vitest'
import { mcpDetailActions } from '../src/client/features/mcp-status/detail-actions.js'
import type { McpStatusEntry } from '../src/contracts/mcp-status.js'

const entry: McpStatusEntry = { id: 'plugin:source/suite/key', name: 'server', kind: 'plugin', transport: 'stdio', state: 'failed', tools: [] }
describe('MCP detail action policy', () => {
  it('retries failures without offering OAuth for stdio or unsupported transports', () => {
    expect(mcpDetailActions(entry)).toEqual({ retry: true, reauthorize: false })
    expect(mcpDetailActions({ ...entry, code: 'unsupported-transport' }).retry).toBe(false)
  })
  it('does not treat zero-tool, healthy, disabled or foreign servers as reconnect failures', () => {
    for (const state of ['connected', 'degraded', 'disabled', 'foreign', 'needs-credentials'] as const) expect(mcpDetailActions({ ...entry, state }).retry).toBe(false)
  })
  it('only shows reauthorization when supported, owned and actionable', () => {
    expect(mcpDetailActions({ ...entry, state: 'connected', canReauthorize: true }).reauthorize).toBe(true)
    for (const state of ['disabled', 'foreign', 'orphaned', 'needs-credentials'] as const)
      expect(mcpDetailActions({ ...entry, state, canReauthorize: true }).reauthorize).toBe(false)
    expect(mcpDetailActions({ ...entry, kind: 'direct', canReauthorize: true })).toEqual({ retry: false, reauthorize: false })
    expect(mcpDetailActions({ ...entry, kind: 'direct', managed: true })).toEqual({ retry: true, reauthorize: false })
  })
})
