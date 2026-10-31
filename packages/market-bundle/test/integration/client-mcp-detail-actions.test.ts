// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mcpDetailActions } from '../../../../packages/market-ui/src/features/mcp/detail-actions.js'
import { mcpConnectionNote } from '../../../../packages/market-ui/src/features/mcp/state-helpers.js'
import type { McpStatusEntry } from '../../../../packages/market-contracts/src/contracts/mcp-status.js'

const t = ((key: string, params?: Record<string, string>) => (params === undefined ? key : [key, ...Object.values(params)].join(' '))) as unknown as Parameters<
  typeof mcpConnectionNote
>[0]

const entry: McpStatusEntry = { id: 'plugin:source/suite/key', name: 'server', kind: 'plugin', transport: 'stdio', state: 'failed', tools: [] }
describe('MCP detail action policy', () => {
  it('retries failures without offering OAuth for stdio or unsupported transports', () => {
    expect(mcpDetailActions(entry)).toEqual({ retry: true, reauthorize: false })
    expect(mcpDetailActions({ ...entry, code: 'unsupported-transport' }).retry).toBe(false)
  })
  it('does not treat zero-tool, healthy, disabled or foreign servers as reconnect failures', () => {
    for (const state of ['connected', 'degraded', 'disabled', 'foreign', 'needs-credentials'] as const) expect(mcpDetailActions({ ...entry, state }).retry).toBe(false)
  })
  it('offers a retry whenever a live connection has dropped', () => {
    // The row is only "degraded" while its supervisor backs off, but retrying
    // now is exactly the action that shortens the wait.
    const connection = { serverName: 'server', phase: 'reconnecting' as const, since: 1, attempt: 2, maxAttempts: 10, retryAt: 5 }
    expect(mcpDetailActions({ ...entry, state: 'degraded', connection }).retry).toBe(true)
    expect(mcpDetailActions({ ...entry, state: 'connected', connection }).retry).toBe(true)
    // No observation means no claim about the connection, so a degraded row
    // keeps its old reading.
    expect(mcpDetailActions({ ...entry, state: 'degraded' }).retry).toBe(false)
  })
  it('only shows reauthorization when supported, owned and actionable', () => {
    expect(mcpDetailActions({ ...entry, state: 'connected', canReauthorize: true }).reauthorize).toBe(true)
    for (const state of ['disabled', 'foreign', 'orphaned', 'needs-credentials'] as const)
      expect(mcpDetailActions({ ...entry, state, canReauthorize: true }).reauthorize).toBe(false)
    expect(mcpDetailActions({ ...entry, kind: 'direct', canReauthorize: true })).toEqual({ retry: false, reauthorize: false })
    expect(mcpDetailActions({ ...entry, kind: 'direct', managed: true })).toEqual({ retry: true, reauthorize: false })
  })
})

describe('the connection sentence', () => {
  it('names the attempt the user is waiting on and the last error', () => {
    const note = mcpConnectionNote(t, {
      ...entry,
      state: 'degraded',
      connection: { serverName: 'server', phase: 'reconnecting', since: 1, attempt: 2, maxAttempts: 10, retryAt: 5, error: 'read ECONNRESET' }
    })
    expect(note).toContain('mcpReconnecting')
    expect(note).toContain('2 10')
    expect(note).toContain('read ECONNRESET')
  })
  it('reports a stopped supervisor, and stays quiet when the connection is fine', () => {
    expect(
      mcpConnectionNote(t, { ...entry, state: 'failed', connection: { serverName: 'server', phase: 'failed', since: 1, attempt: 11, maxAttempts: 10, reason: 'gave-up' } }, 1)
    ).toBe('mcpReconnectStopped')
    for (const phase of ['connected'] as const) {
      expect(mcpConnectionNote(t, { ...entry, connection: { serverName: 'server', phase, since: 1, attempt: 0, maxAttempts: 10 } }, 1)).toBeUndefined()
    }
    expect(mcpConnectionNote(t, entry)).toBeUndefined()
  })
})
