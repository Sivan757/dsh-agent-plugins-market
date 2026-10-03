/**
 * One delegation surface per deployment.
 *
 * A deployment that activates Agent Teams replaces the host's delegation and
 * coordination tools with its own, and those answer in the Team identity
 * namespace where a role child has no name. The seat therefore withdraws the
 * role surface whenever the Team service is present.
 *
 * Presence is not knowable once at mount time: the deployment loads its bundles
 * independently, so the Team service can register from a sibling fiber at any
 * point in the boot. These cases mount the real fiber topology — a reader at
 * this plugin's seat, a sibling that publishes the service later — because a
 * stub that only reads a property cannot fail the way a late registration does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { agentTeamsActive, mountUnlessAgentTeams } from '../src/runtime/agents/agent-teams-seat.js'

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

/** Let the mounted fibers activate: Cordis loads one on a later tick. */
const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Mount a plugin and remember its fiber for teardown. */
function mount(ctx: Context, plugin: Plugin): Fiber {
  const fiber = ctx.plugin(plugin)
  cleanups.push(() => fiber.dispose())
  return fiber
}

/** The Agent Teams service, published by whichever fiber a test mounts it on. */
class FakeAgentTeams extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agentTeams')
  }
}

/** A service that is not Agent Teams, used to prove the seat ignores other registrations. */
class FakeOther extends Service {
  constructor(ctx: Context) {
    super(ctx, 'unrelated')
  }
}

/** Mount a surface and record its mount/withdraw edges. */
function recorder() {
  const events: string[] = []
  const mountSurface = (): (() => void) => {
    events.push('mounted')
    return () => events.push('withdrawn')
  }
  return { events, mountSurface }
}

describe('agent teams seat', () => {
  it('reports absence without the service and presence with it', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    expect(agentTeamsActive(root)).toBe(false)
    mount(root, FakeAgentTeams)
    await settled()
    expect(agentTeamsActive(root)).toBe(true)
  })

  it('mounts the surface when no Agent Teams service exists', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    const { events, mountSurface } = recorder()
    cleanups.push(mountUnlessAgentTeams(root, mountSurface))
    expect(events).toEqual(['mounted'])
  })

  it('withdraws the surface when the service registers from a sibling fiber after mount', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    const { events, mountSurface } = recorder()
    cleanups.push(mountUnlessAgentTeams(root, mountSurface))
    expect(events).toEqual(['mounted'])

    // The deployment's own bundle publishes the service later, as it does at boot.
    mount(root, FakeAgentTeams)
    await settled()
    expect(events).toEqual(['mounted', 'withdrawn'])
  })

  it('never mounts when the service is already present at mount time', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    mount(root, FakeAgentTeams)
    await settled()
    const { events, mountSurface } = recorder()
    cleanups.push(mountUnlessAgentTeams(root, mountSurface))
    expect(events).toEqual([])
  })

  it('restores the surface if the service goes away again', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    const { events, mountSurface } = recorder()
    cleanups.push(mountUnlessAgentTeams(root, mountSurface))
    const team = mount(root, FakeAgentTeams)
    await settled()
    expect(events).toEqual(['mounted', 'withdrawn'])

    await team.dispose()
    await settled()
    expect(events).toEqual(['mounted', 'withdrawn', 'mounted'])
  })

  it('ignores registrations that are not Agent Teams', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    const { events, mountSurface } = recorder()
    cleanups.push(mountUnlessAgentTeams(root, mountSurface))
    mount(root, FakeOther)
    await settled()
    expect(events).toEqual(['mounted'])
  })

  it('mounts and withdraws through the registration event at a nested inject seat', async () => {
    // The production seat is an `inject` child of the entry fiber, and Cordis
    // resolves a sibling's service by walking ancestors: a listener registered
    // there must still observe the registration.
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    class FakeTools extends Service {
      constructor(ctx: Context) {
        super(ctx, 'tools')
      }
    }
    mount(root, FakeTools)
    await settled()

    const { events, mountSurface } = recorder()
    let disposeSeat: (() => void) | undefined
    const entry = root.plugin({
      name: 'entry',
      apply(ctx: Context) {
        ctx.inject(['tools'], (hostCtx: Context) => {
          disposeSeat = mountUnlessAgentTeams(hostCtx, mountSurface)
        })
      }
    })
    cleanups.push(() => entry.dispose())
    cleanups.push(() => disposeSeat?.())
    await settled()
    expect(events).toEqual(['mounted'])

    mount(root, FakeAgentTeams)
    await settled()
    expect(events).toEqual(['mounted', 'withdrawn'])
  })

  it('stops observing once the returned disposer runs', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    const { events, mountSurface } = recorder()
    const dispose = mountUnlessAgentTeams(root, mountSurface)
    expect(events).toEqual(['mounted'])

    dispose()
    expect(events).toEqual(['mounted', 'withdrawn'])

    // A later registration must not re-mount a surface this plugin has dropped.
    mount(root, FakeAgentTeams)
    await settled()
    expect(events).toEqual(['mounted', 'withdrawn'])
  })

  it('logs the withdrawal with the surface name', async () => {
    const root = new Context()
    cleanups.push(() => root.fiber.dispose())
    const info = vi.fn()
    ;(root as unknown as { logger: unknown }).logger = { info, warn: vi.fn(), error: vi.fn() }
    const { mountSurface } = recorder()
    cleanups.push(mountUnlessAgentTeams(root, mountSurface))
    mount(root, FakeAgentTeams)
    await settled()
    expect(info).toHaveBeenCalledTimes(1)
    const [message] = info.mock.calls[0] as [string]
    expect(message).toMatch(/subagent_role stands down/)
  })
})
