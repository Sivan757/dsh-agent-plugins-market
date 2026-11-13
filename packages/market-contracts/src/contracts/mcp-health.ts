/**
 * Portable health records for MCP servers that are not serving their tools
 * right now.
 *
 * A mount diagnostic explains why a server never came up. These records
 * describe a server that did come up and then lost its connection — the case
 * nothing else reports: the supervisor keeps the tools registered while it
 * retries, the host's tool registry carries no provenance, and the failure is
 * otherwise visible only in the process log.
 *
 * @module contracts/mcp-health
 */
import type { McpConnectionObservation } from './mcp-status.js'

/** The suite and declaration one live mount belongs to. */
export interface McpHealthOwner {
  /** Source-qualified suite id, as the status rows carry it. */
  suiteId: string
  /** The server's key inside that suite's declaration. */
  serverKey: string
}

/** One server that is not serving its tools right now. */
export interface McpHealthProblem {
  /** The derived server name that namespaces every model-facing tool of this server. */
  serverName: string
  /** Where the mount came from; absent when the registry no longer knows the owner. */
  owner?: McpHealthOwner
  /** What the supervisor last published, including the attempt budget and the last error. */
  observation: McpConnectionObservation
}

/**
 * One transition a session is told about.
 *
 * `degraded` is the first announcement of an outage that outlived a single
 * retry; `stopped` is the supervisor spending its whole attempt budget on the
 * same outage, which is what turns a reconnect into a missing capability;
 * `recovered` closes an announced outage and is the only event carrying no
 * observation, because the connection is healthy again.
 */
export type McpHealthEvent =
  { kind: 'degraded'; problem: McpHealthProblem } | { kind: 'stopped'; problem: McpHealthProblem } | { kind: 'recovered'; serverName: string; owner?: McpHealthOwner }
