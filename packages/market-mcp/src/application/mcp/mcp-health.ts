/**
 * The health state machine over one process's MCP connection phases.
 *
 * The supervisor publishes every phase edge; this module decides which edges a
 * session should hear about. It exists because the phases alone are too noisy to
 * broadcast (a server that bounces once and reconnects is not news) and because
 * the same outage must not be announced twice as it backs off.
 *
 * One outage is announced once. `degraded` fires when a reconnect outlives
 * {@link MCP_HEALTH_MIN_ATTEMPTS} attempts, `stopped` when the supervisor
 * spends its budget, and `recovered` when the server serves tools again — even
 * when the announcement was a `stopped` one and the bridge was rebuilt before
 * that. A mount that goes away without recovering is not announced as a
 * recovery: its server is no longer part of the tool set at all.
 *
 * @module application/mcp/mcp-health
 */
import type { McpConnectionObservation } from '../../../../market-contracts/src/contracts/mcp-status.js'
import type { McpHealthEvent, McpHealthOwner, McpHealthProblem } from '../../../../market-contracts/src/contracts/mcp-health.js'

/** Attempts inside one outage before a reconnect becomes worth announcing. */
export const MCP_HEALTH_MIN_ATTEMPTS = 2

/** What the monitor reads and where it sends transitions. */
export interface McpHealthMonitorOptions {
  /**
   * Resolve the suite and declaration that mounted one server name.
   * @param serverName - the derived name the supervisor publishes under.
   * @returns the owner, or `undefined` when the registry forgot it.
   */
  owner(serverName: string): McpHealthOwner | undefined
  /** Attempt count at which a reconnect is announced; defaults to {@link MCP_HEALTH_MIN_ATTEMPTS}. */
  minAttempts?: number
}

/** How far one outage has already been announced. */
type Announced = 'degraded' | 'stopped'

/**
 * Fold a stream of connection phases into the few transitions a session needs.
 *
 * The monitor holds no timers: every decision is made from the observation the
 * supervisor just published, so a host that stops publishing simply stops
 * producing events.
 */
export class McpHealthMonitor {
  private readonly problems = new Map<string, McpHealthProblem>()
  private readonly announced = new Map<string, Announced>()
  /** Announced servers whose supervisor went away; a later connect is their recovery. */
  private readonly forgotten = new Map<string, McpHealthOwner | undefined>()
  private readonly listeners = new Set<(event: McpHealthEvent) => void>()
  private readonly minAttempts: number

  /**
   * @param options - owner resolution and the announcement threshold.
   */
  constructor(private readonly options: McpHealthMonitorOptions) {
    this.minAttempts = Math.max(1, Math.trunc(options.minAttempts ?? MCP_HEALTH_MIN_ATTEMPTS))
  }

  /**
   * Observe every transition, in publication order.
   * @param listener - receives each transition; a throw is contained so one
   *   observer cannot stop another or the supervisor's publication.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: (event: McpHealthEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Fold one published phase edge.
   * @param observation - the phase and attempt count the supervisor just reached.
   */
  observe(observation: McpConnectionObservation): void {
    const serverName = observation.serverName
    if (observation.phase === 'connected') {
      const previous = this.problems.get(serverName)
      const announced = this.announced.has(serverName)
      const forgotten = this.forgotten.has(serverName)
      const dropped = this.forgotten.get(serverName)
      this.announced.delete(serverName)
      this.forgotten.delete(serverName)
      this.problems.delete(serverName)
      if (!announced && !forgotten) return
      const owner = dropped ?? previous?.owner ?? this.options.owner(serverName)
      this.emit({ kind: 'recovered', serverName, ...(owner === undefined ? {} : { owner }) })
      return
    }
    if (observation.phase === 'connecting') {
      // A fresh generation is starting. An outage that was listed stays listed,
      // with its attempt count refreshed: a connect that never settles is not a
      // recovery, and a second announcement would only repeat the first.
      const existing = this.problems.get(serverName)
      if (existing !== undefined) this.problems.set(serverName, { ...existing, observation })
      return
    }
    // Any other phase begins or continues an outage, so a pending recovery is
    // superseded: the server has not reached a connected phase since.
    this.forgotten.delete(serverName)
    const owner = this.options.owner(serverName)
    const problem: McpHealthProblem = { serverName, ...(owner === undefined ? {} : { owner }), observation }
    this.problems.set(serverName, problem)
    const announced = this.announced.get(serverName)
    if (observation.phase === 'failed') {
      if (announced === 'stopped') return
      this.announced.set(serverName, 'stopped')
      this.emit({ kind: 'stopped', problem })
      return
    }
    if (announced !== undefined) return
    if (observation.attempt < this.minAttempts) return
    this.announced.set(serverName, 'degraded')
    this.emit({ kind: 'degraded', problem })
  }

  /**
   * Forget one server because its supervisor went away.
   *
   * The mount is gone, so the server is no longer listed among missing
   * capabilities. An outage that had been announced keeps a marker: rebuilding
   * the bridge and connecting is still the recovery the session was promised.
   * @param serverName - the supervisor's derived server name.
   */
  forget(serverName: string): void {
    const announced = this.announced.get(serverName)
    const problem = this.problems.get(serverName)
    this.announced.delete(serverName)
    this.problems.delete(serverName)
    if (announced === undefined) return
    this.forgotten.set(serverName, problem?.owner)
  }

  /**
   * The servers that cannot serve their tools right now, ordered by name so the
   * rendered prompt is stable across reads.
   * @returns one record per unavailable server; empty when every mount is healthy.
   */
  unhealthy(): readonly McpHealthProblem[] {
    return [...this.problems.values()].sort((left, right) => left.serverName.localeCompare(right.serverName))
  }

  /**
   * Publish one transition to every listener.
   * @param event - the transition.
   */
  private emit(event: McpHealthEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // A session-facing listener runs inside the supervisor's publication
        // path; a message the host refuses must not undo the health record.
      }
    }
  }
}
