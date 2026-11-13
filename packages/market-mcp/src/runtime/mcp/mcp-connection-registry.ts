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
 * The same publication feeds {@link observeMcpConnections}: the health monitor
 * folds these edges into the few transitions a session is told about, so a
 * server that dies silently reaches the model and the user.
 *
 * @module runtime/mcp/connection-registry
 */
import type { McpConnectionObservation } from '../../../../market-contracts/src/contracts/mcp-status.js'

/** One supervisor's lifecycle edges, observed rather than polled. */
export interface McpConnectionListener {
  /**
   * A supervisor published its current phase.
   * @param observation - the phase, attempt count, and last error at this moment.
   */
  observed?(observation: McpConnectionObservation): void
  /**
   * A supervisor went away; its phase is no longer current.
   * @param serverName - the derived serverName whose bridge was disposed.
   */
  forgotten?(serverName: string): void
}

/** Latest observation per serverName; a later edge for the same server replaces it. */
const observations = new Map<string, McpConnectionObservation>()

/** Live subscribers; a set because a reload can attach a newer monitor first. */
const listeners = new Set<McpConnectionListener>()

/**
 * Record one supervisor's current phase.
 * @param observation - the phase, attempt count, and last error at this moment.
 */
export function recordMcpConnection(observation: McpConnectionObservation): void {
  observations.set(observation.serverName, observation)
  for (const listener of [...listeners]) {
    try {
      listener.observed?.(observation)
    } catch {
      // Observers run inside the supervisor's publication path. A failing one
      // must not cost the server its connection or the next observer its edge.
    }
  }
}

/**
 * Forget one server's phase, on bridge disposal.
 * @param serverName - the derived serverName whose bridge went away.
 */
export function forgetMcpConnection(serverName: string): void {
  observations.delete(serverName)
  for (const listener of [...listeners]) {
    try {
      listener.forgotten?.(serverName)
    } catch {
      // Same containment as record: publication is not a delivery contract.
    }
  }
}

/**
 * Observe every published edge from now on.
 * @param listener - receives observations and disposals until the returned disposer runs.
 * @returns the disposer removing this listener.
 */
export function observeMcpConnections(listener: McpConnectionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The live phases, for the status payload.
 * @returns one observation per connected, reconnecting, or stopped server.
 */
export function mcpConnectionSnapshot(): readonly McpConnectionObservation[] {
  return [...observations.values()]
}
