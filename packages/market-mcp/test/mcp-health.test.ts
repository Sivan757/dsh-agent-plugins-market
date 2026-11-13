/**
 * The health fold over MCP connection phases.
 *
 * The supervisor publishes every edge; what a session needs is the handful of
 * transitions that change what it can do. These cases pin the announcement
 * threshold, the once-per-outage rule, the recovery that has to survive both a
 * bridge rebuild and a flap, and the containment that keeps a refused notice
 * from stopping the fold.
 *
 * Recovery is deferred behind an uptime window, so every case drives it through
 * an injected scheduler instead of waiting on wall-clock time.
 *
 * @module test/mcp-health
 */
import { describe, expect, it } from 'vitest'
import { McpHealthMonitor, MCP_HEALTH_MIN_ATTEMPTS } from '../src/application/mcp/mcp-health.js'
import type { McpHealthEvent } from '../../market-contracts/src/contracts/mcp-health.js'
import type { McpConnectionObservation } from '../../market-contracts/src/contracts/mcp-status.js'

const OWNER = { suiteId: '@user-mcp/user-mcp', serverKey: 'signoz' }

function observation(patch: Partial<McpConnectionObservation>): McpConnectionObservation {
  return { serverName: 'signoz', phase: 'reconnecting', since: 0, attempt: 1, maxAttempts: 10, ...patch }
}

/** A scheduler a test fires by hand, so the uptime window is not a wall-clock wait. */
function uptimeWindow() {
  const pending = new Map<number, () => void>()
  let next = 1
  return {
    schedule: (run: () => void, _delayMs: number): (() => void) => {
      const id = next++
      pending.set(id, run)
      return () => {
        pending.delete(id)
      }
    },
    /** Let the uptime window elapse for every connection waiting on it. */
    elapse(): void {
      for (const [id, run] of [...pending]) {
        pending.delete(id)
        run()
      }
    },
    pending: (): number => pending.size
  }
}

function monitorWith(events: McpHealthEvent[], options: { minAttempts?: number } = {}) {
  const window = uptimeWindow()
  const monitor = new McpHealthMonitor({
    owner: serverName => (serverName === 'signoz' ? OWNER : undefined),
    schedule: window.schedule,
    ...options
  })
  monitor.subscribe(event => events.push(event))
  return { monitor, window }
}

describe('MCP health monitor', () => {
  it('announces one outage twice at most: when a retry fails, and when the budget is spent', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ phase: 'connecting', attempt: 1 }))
    monitor.observe(observation({ attempt: 1, error: 'socket hang up' }))
    expect(events).toEqual([])

    monitor.observe(observation({ attempt: MCP_HEALTH_MIN_ATTEMPTS, error: 'socket hang up' }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'degraded', problem: { serverName: 'signoz', owner: OWNER } })

    monitor.observe(observation({ attempt: 3 }))
    monitor.observe(observation({ attempt: 4 }))
    expect(events).toHaveLength(1)

    monitor.observe(observation({ phase: 'failed', attempt: 4 }))
    expect(events.map(event => event.kind)).toEqual(['degraded', 'stopped'])
    monitor.observe(observation({ phase: 'failed', attempt: 4 }))
    expect(events).toHaveLength(2)

    monitor.observe(observation({ phase: 'connected', attempt: 0, retryAt: undefined }))
    // Back, but not yet confirmed: the section clears now, the notice waits.
    expect(monitor.unhealthy()).toEqual([])
    expect(events.map(event => event.kind)).toEqual(['degraded', 'stopped'])
    window.elapse()
    expect(events.map(event => event.kind)).toEqual(['degraded', 'stopped', 'recovered'])
  })

  it('stays quiet for a bounce that reconnects before the threshold', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ attempt: 1 }))
    monitor.observe(observation({ phase: 'connected', attempt: 0 }))
    window.elapse()
    expect(events).toEqual([])
    expect(monitor.unhealthy()).toEqual([])
  })

  it('announces a server that never came up as stopped, in one event', () => {
    const events: McpHealthEvent[] = []
    const { monitor } = monitorWith(events)

    monitor.observe(observation({ phase: 'failed', attempt: 0 }))
    expect(events.map(event => event.kind)).toEqual(['stopped'])
  })

  it('refreshes the attempt count of a listed outage when the next connect starts', () => {
    const events: McpHealthEvent[] = []
    const { monitor } = monitorWith(events)

    monitor.observe(observation({ attempt: 2 }))
    monitor.observe(observation({ phase: 'connecting', attempt: 3 }))
    expect(monitor.unhealthy()[0]?.observation).toMatchObject({ phase: 'connecting', attempt: 3 })
    // The new generation is not a recovery and does not re-announce.
    expect(events.map(event => event.kind)).toEqual(['degraded'])
  })

  it('lists a reconnecting server as unavailable before it is announced', () => {
    const events: McpHealthEvent[] = []
    const { monitor } = monitorWith(events)

    monitor.observe(observation({ attempt: 1 }))
    expect(monitor.unhealthy().map(problem => problem.observation.phase)).toEqual(['reconnecting'])
    expect(events).toEqual([])
  })

  it('does not confirm a recovery that dies inside the uptime window', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ attempt: 2 }))
    monitor.observe(observation({ phase: 'connected', attempt: 0 }))
    expect(window.pending()).toBe(1)

    // The reconnect lasts a moment and drops again: same outage, no new words.
    monitor.observe(observation({ attempt: 3 }))
    expect(window.pending()).toBe(0)
    window.elapse()
    expect(events.map(event => event.kind)).toEqual(['degraded'])
    expect(monitor.unhealthy()).toHaveLength(1)
  })

  it('confirms the recovery once the uptime window elapses', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ attempt: 2 }))
    monitor.observe(observation({ phase: 'connected', attempt: 0 }))
    window.elapse()
    expect(events.map(event => event.kind)).toEqual(['degraded', 'recovered'])
  })

  it('holds a recovery across the bridge rebuild that follows a stopped outage', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ phase: 'failed', attempt: 10 }))
    monitor.forget('signoz')
    // The mount is gone, so nothing is listed as missing.
    expect(monitor.unhealthy()).toEqual([])

    monitor.observe(observation({ phase: 'connecting', attempt: 1 }))
    monitor.observe(observation({ phase: 'connected', attempt: 0 }))
    window.elapse()
    expect(events.map(event => event.kind)).toEqual(['stopped', 'recovered'])
    expect(events[1]).toMatchObject({ serverName: 'signoz' })
  })

  it('does not report a recovery for a mount that is simply removed', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ phase: 'failed', attempt: 10 }))
    monitor.forget('signoz')
    window.elapse()
    expect(events.map(event => event.kind)).toEqual(['stopped'])
    expect(monitor.unhealthy()).toEqual([])
  })

  it('starts a new outage after a recovery, with its own announcement', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ attempt: 2 }))
    monitor.observe(observation({ phase: 'connected', attempt: 0 }))
    window.elapse()
    monitor.observe(observation({ attempt: 2 }))
    expect(events.map(event => event.kind)).toEqual(['degraded', 'recovered', 'degraded'])
  })

  it('drops every pending recovery check on disposal', () => {
    const events: McpHealthEvent[] = []
    const { monitor, window } = monitorWith(events)

    monitor.observe(observation({ attempt: 2 }))
    monitor.observe(observation({ phase: 'connected', attempt: 0 }))
    expect(window.pending()).toBe(1)
    monitor.dispose()
    expect(window.pending()).toBe(0)
    window.elapse()
    expect(events.map(event => event.kind)).toEqual(['degraded'])
  })

  it('orders the unavailable servers by name so a prompt render is stable', () => {
    const events: McpHealthEvent[] = []
    const { monitor } = monitorWith(events)

    monitor.observe({ ...observation({ phase: 'failed', attempt: 3 }), serverName: 'zeta' })
    monitor.observe({ ...observation({ phase: 'failed', attempt: 3 }), serverName: 'alpha' })
    expect(monitor.unhealthy().map(problem => problem.serverName)).toEqual(['alpha', 'zeta'])
  })

  it('contains a failing listener instead of losing the health record', () => {
    const events: McpHealthEvent[] = []
    const { monitor } = monitorWith(events)
    monitor.subscribe(() => {
      throw new Error('session refused the notice')
    })

    expect(() => monitor.observe(observation({ attempt: 2 }))).not.toThrow()
    expect(events.map(event => event.kind)).toEqual(['degraded'])
    expect(monitor.unhealthy()).toHaveLength(1)
  })

  it('omits the owner when the mount registry no longer knows the server', () => {
    const events: McpHealthEvent[] = []
    const { monitor } = monitorWith(events)

    monitor.observe({ ...observation({ phase: 'failed', attempt: 1 }), serverName: 'other' })
    expect(events[0]).toMatchObject({ kind: 'stopped', problem: { serverName: 'other' } })
    expect((events[0] as { problem: { owner?: unknown } }).problem.owner).toBeUndefined()
  })
})
