/**
 * The live MCP connection phases, one entry per serverName.
 *
 * A bridge plugin instance lives inside the host's plugin tree, while the
 * status surface is built by the application layer — they share no object. This
 * module is that seam: each supervisor publishes its lifecycle edges here, and
 * the status builder reads the snapshot when it composes a row. Entries are
 * keyed by the derived serverName, the same identity the status rows carry, and
 * they disappear when the bridge is disposed, so a torn-down mount cannot leave
 * a stale "reconnecting" behind.
 *
 * @module runtime/mcp/connection-registry
 */
import type { McpConnectionObservation } from '../../../../market-contracts/src/contracts/mcp-status.js'

/** Latest observation per serverName; a later edge for the same server replaces it. */
const observations = new Map<string, McpConnectionObservation>()

/**
 * Record one supervisor's current phase.
 * @param observation - the phase, attempt count, and last error at this moment.
 */
export function recordMcpConnection(observation: McpConnectionObservation): void {
  observations.set(observation.serverName, observation)
}

/**
 * Forget one server's phase, on bridge disposal.
 * @param serverName - the derived serverName whose bridge went away.
 */
export function forgetMcpConnection(serverName: string): void {
  observations.delete(serverName)
}

/**
 * The live phases, for the status payload.
 * @returns one observation per connected, reconnecting, or stopped server.
 */
export function mcpConnectionSnapshot(): readonly McpConnectionObservation[] {
  return [...observations.values()]
}
