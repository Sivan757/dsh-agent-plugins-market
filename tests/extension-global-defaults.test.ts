/**
 * A global switch being off must never become a session default.
 *
 * The native inventory separates two absences that look alike on the wire: a
 * skill the user disabled globally is still `available` and only carries
 * `globalEnabled: false`, while one that failed validation is `available: false`.
 * Only the second is unusable. The first must stay out of every implicit
 * selection — the daemon start, an unselected session, `select(null)` — and stay
 * reachable exclusively through a saved preset that names it.
 *
 * Both halves run against the real derivation: the runtime's inventory port is
 * `readExtensionInventory` reading real panel rows, so nothing here restates the
 * globalEnabled rule in its own fixture.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { readExtensionInventory } from '../src/application/extension-inventory.js'
import { ExtensionRuntime } from '../src/runtime/host/extension-runtime.js'
import type { UserPanelEntryWire } from '../src/contracts/market.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}

const ENABLED = 'skills:alpha'
const OFF = 'skills:beta'
const BROKEN = 'skills:gamma'

/** Enabled, globally disabled, and validation-broken: the three native shapes. */
const entry = (name: string, disabled: boolean, metadata: Record<string, unknown> = {}): UserPanelEntryWire => ({
  name,
  description: name,
  disabled,
  origin: 'user',
  metadata,
  path: '/tmp/' + name + '/SKILL.md'
})
const skillRows: UserPanelEntryWire[] = [entry('alpha', false), entry('beta', true), entry('gamma', true, { validationError: 'missing YAML frontmatter' })]

/** Read through the production inventory path: panel rows in, resources out. */
const inventory = (): ReturnType<typeof readExtensionInventory> =>
  readExtensionInventory({
    catalog: {
      overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/tmp', data: '/tmp' } }),
      mcpStatus: async () => ({
        entries: [],
        observedAt: '1970-01-01T00:00:00.000Z',
        totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
        directObservationOnly: false
      }),
      lspStatus: async () => ({
        entries: [],
        observedAt: '1970-01-01T00:00:00.000Z',
        totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 },
        hostMissing: false
      })
    },
    panels: {
      skills: { list: async () => skillRows },
      commands: { list: async () => [] },
      agents: { list: async () => [] }
    }
  })

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-global-defaults-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    inventory,
    applySelection: async () => {},
    eligible: agent => {
      const cwd = agent.session.header.cwd
      return typeof cwd === 'string' && cwd.length > 0 && cwd.startsWith('/')
    }
  })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const create = async (id: string) => (await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root }, agentOptions: { provider: 'mock', model: 'test' } })).agent
  return { runtime, create }
}

describe('globally disabled capabilities are never a session default', () => {
  it('keeps a globally disabled but valid resource available and out of the default selection', async () => {
    const { runtime, create } = await setup()
    const agent = await create('defaults')
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true))
    const window = await runtime.window(agent.id)
    // The three states the inventory must distinguish.
    expect(window.resources.find(row => row.id === OFF)).toMatchObject({ available: true, globalEnabled: false })
    expect(window.resources.find(row => row.id === BROKEN)).toMatchObject({ available: false })
    // Valid-and-enabled is selected; the globally disabled one is not silently granted.
    expect(window.state.selection.enabledIds).toEqual([ENABLED])
    expect(runtime.allows(agent, OFF)).toBe(false)
  })

  it('does not grant a globally disabled resource when a session selects no preset', async () => {
    const { runtime, create } = await setup()
    const agent = await create('explicit-none')
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true))
    const before = await runtime.window(agent.id)
    await runtime.select(agent.id, before.state.revision, null)
    const after = await runtime.window(agent.id)
    expect(after.state.selection.enabledIds).toEqual([ENABLED])
    expect(runtime.allows(agent, OFF)).toBe(false)
  })

  it('lets a saved preset name the globally disabled resource explicitly', async () => {
    const { runtime, create } = await setup()
    const agent = await create('opt-in')
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true))
    await runtime.create(agent.id, (await runtime.window(agent.id)).library.revision, { name: 'opt-in', enabledIds: [OFF] })
    const preset = (await runtime.window(agent.id)).library.presets.find(row => row.name === 'opt-in')
    expect(preset).toBeDefined()
    await runtime.select(agent.id, (await runtime.window(agent.id)).state.revision, preset!.id)
    const selection = runtime.state.read(agent)?.selection
    // The preset path, not the global default path, is what granted it.
    expect(selection?.presetId).toBe(preset!.id)
    expect(selection?.enabledIds).toEqual([OFF])
    expect(runtime.allows(agent, OFF)).toBe(true)
  })
})
