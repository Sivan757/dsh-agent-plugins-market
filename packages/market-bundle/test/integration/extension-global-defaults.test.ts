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
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { readExtensionInventory } from '../../../../packages/market-bundle/src/application/extension-inventory.js'
import { ExtensionRuntime } from '../../../../packages/market-runtime/src/runtime/host/extension-runtime.js'
import type { UserPanelEntryWire } from '../../../../packages/market-contracts/src/contracts/market.js'
import { removeTempRoot } from './helpers/temp-root.js'

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
  cleanups.push(() => removeTempRoot(root))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  // The applied selection is what every injection is built from: record it.
  const applied: string[][] = []
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    inventory,
    applySelection: async (_agent, selection) => {
      applied.push([...selection.enabledIds])
    },
    eligible: agent => {
      const cwd = agent.session.header.cwd
      // Any absolute cwd, not only a POSIX one: a Windows temp dir does not
      // start with `/`, and this stub is what makes the runtime ready.
      return typeof cwd === 'string' && cwd.length > 0 && isAbsolute(cwd)
    }
  })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const create = async (id: string) => (await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root }, agentOptions: { provider: 'mock', model: 'test' } })).agent
  return { runtime, create, applied }
}

describe('a session on the default selection follows the catalog', () => {
  it('grants and injects a resource the catalog gains, without a preset switch', async () => {
    // The core promise: installing a suite or a skill shows up in the running session on
    // the next read. The default selection is a snapshot of ids, and a snapshot cannot
    // contain a resource that did not exist when it was taken; the update has to come from
    // the selection following the live catalog instead.
    const { runtime, create, applied } = await setup()
    const agent = await create('follows-catalog')
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true), { timeout: 10_000 })
    expect((await runtime.window(agent.id)).state.selection.enabledIds).toEqual([ENABLED])

    // A new skill lands in the user's layout root: the inventory reads one row more.
    skillRows.push(entry('delta', false))
    try {
      runtime.invalidate()
      await runtime.refreshAll()
      await vi.waitFor(() => expect(runtime.allows(agent, 'skills:delta')).toBe(true), { timeout: 10_000 })
      expect((await runtime.window(agent.id)).state.selection.enabledIds).toEqual([ENABLED, 'skills:delta'])
      // The pass that granted it also handed it to the injection path.
      expect(applied.at(-1)).toContain('skills:delta')
    } finally {
      skillRows.splice(
        skillRows.findIndex(row => row.name === 'delta'),
        1
      )
    }
  })
})

describe('a session on a preset keeps the preset', () => {
  it('does not let the catalog add a resource to a preset selection', async () => {
    // The default follows the catalog because the catalog is what it means. A preset is a
    // choice: a suite installed later does not join it behind the reader's back.
    const { runtime, create } = await setup()
    const agent = await create('preset-list')
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true), { timeout: 10_000 })
    const library = (await runtime.window(agent.id)).library
    await runtime.create(agent.id, library.revision, { name: 'pinned', enabledIds: [ENABLED] })
    const preset = (await runtime.window(agent.id)).library.presets.find(row => row.name === 'pinned')
    expect(preset).toBeDefined()
    await runtime.select(agent.id, (await runtime.window(agent.id)).state.revision, preset!.id)

    skillRows.push(entry('delta', false))
    try {
      runtime.invalidate()
      await runtime.refreshAll()
      // The new row exists in the inventory...
      await vi.waitFor(async () => expect((await runtime.window(agent.id)).resources.some(row => row.id === 'skills:delta')).toBe(true), { timeout: 10_000 })
      // ...but the preset still names what it names, so the row is not granted.
      expect(runtime.allows(agent, 'skills:delta')).toBe(false)
      expect((await runtime.window(agent.id)).state.selection.enabledIds).toEqual([ENABLED])
    } finally {
      skillRows.splice(
        skillRows.findIndex(row => row.name === 'delta'),
        1
      )
    }
  })
})

describe('globally disabled capabilities are never a session default', () => {
  it('keeps a globally disabled but valid resource available and out of the default selection', async () => {
    const { runtime, create } = await setup()
    const agent = await create('defaults')
    // A bounded wait, generous for a loaded runner, that still fails when the
    // runtime never becomes ready.
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true), { timeout: 10_000 })
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
    // A bounded wait, generous for a loaded runner, that still fails when the
    // runtime never becomes ready.
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true), { timeout: 10_000 })
    const before = await runtime.window(agent.id)
    await runtime.select(agent.id, before.state.revision, null)
    const after = await runtime.window(agent.id)
    expect(after.state.selection.enabledIds).toEqual([ENABLED])
    expect(runtime.allows(agent, OFF)).toBe(false)
  })

  it('lets a saved preset name the globally disabled resource explicitly', async () => {
    const { runtime, create } = await setup()
    const agent = await create('opt-in')
    // A bounded wait, generous for a loaded runner, that still fails when the
    // runtime never becomes ready.
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true), { timeout: 10_000 })
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
