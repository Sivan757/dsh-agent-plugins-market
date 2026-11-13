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
 * spends its budget, and `recovered` once the server has served tools for
 * {@link MCP_HEALTH_MIN_UPTIME_MS} — even when the announcement was a
 * `stopped` one and the bridge was rebuilt before that. A connection that
 * comes back and dies again inside that window has not recovered: the outage
 * simply continues, which is what keeps a crash-looping server to one
 * announcement instead of one per flap. A mount that goes away without
 * recovering is never announced as a recovery.
 *
 * @module application/mcp/mcp-health
 */
import type { McpConnectionObservation } from '../../../../market-contracts/src/contracts/mcp-status.js'
import type { McpHealthEvent, McpHealthOwner, McpHealthProblem } from '../../../../market-contracts/src/contracts/mcp-health.js'

/** Attempts inside one outage before a reconnect becomes worth announcing. */
export const MCP_HEALTH_MIN_ATTEMPTS = 2

/**
 * How long a connection must serve tools before an announced outage counts as
 * recovered.
 *
 * A supervisor reconnects a crash-looping server successfully on every attempt,
 * and each of those connects is real — but announcing one recovery per flap
 * turns a single outage into a stream of contradictory messages. The window is
 * short enough to confirm an ordinary restart and long enough that a server
 * dying within it stays one outage.
 */
export const MCP_HEALTH_MIN_UPTIME_MS = 5_000

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
  /** Uptime that closes an outage; defaults to {@link MCP_HEALTH_MIN_UPTIME_MS}. */
  minUptimeMs?: number
  /**
   * Run one deferred recovery check.
   * @param run - the check to run once the delay passes.
   * @param delayMs - how long the connection must survive first.
   * @returns the canceller for this check.
   */
  schedule?: (run: () => void, delayMs: number) => () => void
}

/** How far one outage has already been announced. */
type Announced = 'degraded' | 'stopped'

/**
 * The default recovery timer: one unref'd timeout, so a pending check never
 * holds the host process open on its own.
 */
function scheduleTimer(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return () => clearTimeout(timer)
}

/**
 * Fold a stream of connection phases into the few transitions a session needs.
 *
 * The monitor is edge-driven: every decision comes from the observation the
 * supervisor just published. The one exception is the recovery check, a single
 * timer per announced outage that confirms the connection actually stayed up;
 * any later edge for that server cancels it.
 */
export class McpHealthMonitor {
  private readonly problems = new Map<string, McpHealthProblem>()
  private readonly announced = new Map<string, Announced>()
  /** Announced servers whose supervisor went away; a later connect is their recovery. */
  private readonly forgotten = new Map<string, McpHealthOwner | undefined>()
  private readonly listeners = new Set<(event: McpHealthEvent) => void>()
  /** Pending recovery checks, one per outage whose connection has come back. */
  private readonly timers = new Map<string, () => void>()
  private readonly minAttempts: number
  private readonly minUptimeMs: number
  private readonly schedule: (run: () => void, delayMs: number) => () => void

  /**
   * @param options - owner resolution, the announcement threshold, and the recovery window.
   */
  constructor(private readonly options: McpHealthMonitorOptions) {
    this.minAttempts = Math.max(1, Math.trunc(options.minAttempts ?? MCP_HEALTH_MIN_ATTEMPTS))
    this.minUptimeMs = Math.max(0, Math.trunc(options.minUptimeMs ?? MCP_HEALTH_MIN_UPTIME_MS))
    this.schedule = options.schedule ?? scheduleTimer
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
      this.problems.delete(serverName)
      this.cancelRecovery(serverName)
      if (!announced && !forgotten) return
      // The connection is back, so the section stops listing this server at
      // once. The announcement closes only after the uptime window, because a
      // reconnect that dies inside it was never a recovery.
      const owner = dropped ?? previous?.owner ?? this.options.owner(serverName)
      const cancel = this.schedule(() => {
        this.timers.delete(serverName)
        const wasAnnounced = this.announced.delete(serverName) || this.forgotten.delete(serverName)
        if (!wasAnnounced) return
        this.emit({ kind: 'recovered', serverName, ...(owner === undefined ? {} : { owner }) })
      }, this.minUptimeMs)
      this.timers.set(serverName, cancel)
      return
    }
    this.cancelRecovery(serverName)
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
    this.cancelRecovery(serverName)
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

  /** Drop every pending recovery check; the plugin's disposal path calls this. */
  dispose(): void {
    for (const cancel of this.timers.values()) cancel()
    this.timers.clear()
  }

  /**
   * Cancel the pending recovery check for one server, if any.
   * @param serverName - the supervisor's derived server name.
   */
  private cancelRecovery(serverName: string): void {
    const cancel = this.timers.get(serverName)
    if (cancel === undefined) return
    this.timers.delete(serverName)
    cancel()
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
