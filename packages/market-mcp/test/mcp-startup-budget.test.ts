/**
 * The budget one connection attempt may spend mounting a server.
 *
 * The bridge bounds every mount attempt so an unreachable server fails
 * visibly instead of holding its process, transport and browser leg until the
 * MCP SDK's own 60-second request default expires. The budget therefore has to
 * cover a public server's handshake and tool listing, and stay inside what the
 * host tolerates for a single call against a server that already answered.
 *
 * @module test/mcp-startup-budget
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_STARTUP_TIMEOUT_MS, DEFAULT_TOOL_CALL_TIMEOUT_MS } from '../../../packages/market-mcp/src/application/mcp/mcp-bridge-config.js'

describe('the MCP mount startup budget', () => {
  it('gives a server thirty seconds to mount', () => {
    expect(DEFAULT_STARTUP_TIMEOUT_MS).toBe(30_000)
  })

  it('stays inside the host tolerance for one tool call', () => {
    expect(DEFAULT_STARTUP_TIMEOUT_MS).toBeLessThan(DEFAULT_TOOL_CALL_TIMEOUT_MS)
  })
})
