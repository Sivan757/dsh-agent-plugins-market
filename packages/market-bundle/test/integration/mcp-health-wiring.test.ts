/**
 * The seam from a supervisor's phase edge to what a session is told.
 *
 * The registry, the fold, the prompt section and the notice delivery live in
 * three packages; each has its own unit test. This case drives the real chain
 * end to end on one synthetic outage, so a wiring change that leaves any link
 * unsubscribed fails here rather than in a running host.
 *
 * @module test/mcp-health-wiring
 */
import { afterEach, describe, expect, it } from 'vitest'
import { McpHealthMonitor, observeMcpConnections } from '../../../../packages/market-mcp/src/index.js'
import { forgetMcpConnection, mcpConnectionSnapshot, recordMcpConnection } from '../../../../packages/market-mcp/src/runtime/mcp/mcp-connection-registry.js'
import { mountMcpHealthNotices, mountMcpHealthSection } from '../../../../packages/market-runtime/src/index.js'
import type { McpConnectionObservation } from '../../../../packages/market-contracts/src/contracts/mcp-status.js'

const NOW = 1_760_000_000_000
const owner = { suiteId: '@user-mcp/user-mcp', serverKey: 'signoz' }

function observation(patch: Partial<McpConnectionObservation>): McpConnectionObservation {
  return { serverName: 'signoz', phase: 'reconnecting', since: NOW, attempt: 1, maxAttempts: 10, ...patch }
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('MCP health wiring', () => {
  it('turns one published outage into a notice, a prompt section, and a recovery', () => {
    const monitor = new McpHealthMonitor({ owner: serverName => (serverName === 'signoz' ? owner : undefined) })
    cleanups.push(observeMcpConnections({ observed: item => monitor.observe(item), forgotten: name => monitor.forget(name) }))

    const sections: Array<{ name: string; text: () => string }> = []
    const prompt = {
      section(section: { name: string; order: number; interpolate?: boolean; text: () => string }) {
        sections.push(section)
        return () => {}
      },
      getSectionOrder: () => 3100
    }
    cleanups.push(
      mountMcpHealthSection(
        { get: () => prompt } as never,
        () => monitor.unhealthy(),
        () => NOW
      )
    )

    const messages: Array<{ content: readonly { text?: string }[]; source: Record<string, unknown> }> = []
    const source = { subscribe: (listener: (event: never) => void) => monitor.subscribe(listener as never) }
    cleanups.push(
      mountMcpHealthNotices({ agents: { list: () => [{ inject: (message: never) => messages.push(message) }] } } as never, source, {
        locale: () => 'en',
        now: () => NOW
      })
    )

    recordMcpConnection(observation({ attempt: 1 }))
    expect(sections[0]?.text()).toContain('signoz')
    expect(messages).toHaveLength(0)

    recordMcpConnection(observation({ attempt: 2, retryAt: NOW + 2_000, error: 'socket hang up' }))
    expect(messages).toHaveLength(1)
    expect(messages[0]?.source).toMatchObject({ kind: 'plugin-market-mcp', form: 'notice' })
    expect(messages[0]?.content[0]?.text).toContain('MCP server signoz')
    expect(sections[0]?.text()).toContain('reconnecting (attempt 2/10')

    recordMcpConnection(observation({ phase: 'connected', attempt: 0, retryAt: undefined }))
    expect(messages).toHaveLength(2)
    expect(messages[1]?.content[0]?.text).toContain('connected again')
    expect(sections[0]?.text()).toBe('')
    expect(mcpConnectionSnapshot().find(item => item.serverName === 'signoz')?.phase).toBe('connected')

    forgetMcpConnection('signoz')
    expect(mcpConnectionSnapshot()).toEqual([])
  })
})
