/**
 * The connection supervisor publishes what it is doing.
 *
 * A server that dies used to leave two traces: a log line nobody reads and a
 * status row that still said "connected" because its tools were still
 * registered. The observations pinned here are the seam between the supervisor
 * and the status surface: every phase of one outage, the attempt it is on, when
 * the next try fires, and the error that ended the last one.
 *
 * @module test/mcp-connection-observations
 */
import { describe, expect, it } from 'vitest'
import { resolveReconnectPolicy, startConnection } from '../../../packages/market-mcp/src/runtime/mcp/bridge/connection.js'
import type { McpConnectionObservation } from '../../../packages/market-contracts/src/contracts/mcp-status.js'
import type { StdioConfig } from '../../../packages/market-mcp/src/application/mcp/mcp-bridge-config.js'
import type { ToolHost } from '../../../packages/market-mcp/src/runtime/mcp/bridge/host-contract.js'

const host: ToolHost = {
  logger: { error: () => {}, warn: () => {}, info: () => {} },
  tools: { register: () => () => {} }
}

/** A server that exits before the handshake can finish: one fast failure per attempt. */
const config: StdioConfig = {
  transport: 'stdio',
  serverName: 'observation-probe',
  command: process.execPath,
  args: ['-e', 'process.exit(1)'],
  env: {},
  cwd: process.cwd(),
  toolCallTimeoutMs: 1_000,
  startupTimeoutMs: 2_000,
  failOnStartupError: false
}

const policy = resolveReconnectPolicy({ initialDelayMs: 20, maxDelayMs: 40, maxAttempts: 2 }, 'test.reconnect')

/** Poll until the condition holds; the supervisor runs on timers, not on promises we hold. */
async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the supervisor')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('MCP connection observations', () => {
  it('reports each phase of one outage and names why it stopped', async () => {
    const seen: McpConnectionObservation[] = []
    const handle = startConnection(host, config, policy, undefined, undefined, observation => {
      seen.push(observation)
    })
    await handle.ready
    await waitFor(() => seen.some(observation => observation.phase === 'failed'))
    await handle.dispose()

    expect(seen[0]).toMatchObject({ serverName: 'observation-probe', phase: 'connecting', attempt: 1, maxAttempts: 2 })
    expect(seen.map(observation => observation.phase)).toEqual(['connecting', 'reconnecting', 'connecting', 'reconnecting', 'connecting', 'failed'])
    // Every retry edge names the attempt and the moment the next one fires.
    for (const observation of seen.filter(item => item.phase === 'reconnecting')) {
      expect(observation.retryAt).toBeGreaterThan(observation.since)
      expect(observation.attempt).toBeLessThanOrEqual(2)
    }
    // The stop is the third failure, which is past the two-attempt budget.
    expect(seen.at(-1)).toMatchObject({ phase: 'failed', attempt: 3, reason: 'gave-up' })
    // A failed spawn is recorded, so the row can say what went wrong.
    expect(seen.at(-1)?.error).toBeTruthy()
  })

  it('keeps the last error on a phase that stopped with reconnect disabled', async () => {
    const seen: McpConnectionObservation[] = []
    const handle = startConnection(host, config, resolveReconnectPolicy({ enabled: false }, 'test.reconnect'), undefined, undefined, observation => {
      seen.push(observation)
    })
    await handle.ready
    await waitFor(() => seen.some(observation => observation.phase === 'failed'))
    await handle.dispose()
    expect(seen.at(-1)).toMatchObject({ phase: 'failed', reason: 'reconnect-disabled' })
  })
})
