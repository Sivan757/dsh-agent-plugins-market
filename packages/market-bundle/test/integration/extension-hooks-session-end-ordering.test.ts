/**
 * The grant must still be open when the hook bridge closes.
 *
 * SessionEnd is the one hook event that runs from disposal. The bridge reaches
 * every suite through the closure the owner supplies, and that closure reads the
 * mount's `active` flag. Production closes the flag before the fiber unwinds, so
 * an owner that let the fiber do the hook teardown would run SessionEnd against a
 * closed grant and silently fire nothing while the catalog advertises the event
 * as runnable.
 *
 * The real `ExtensionHooks` runs here, over a fake scope and a fake shell, so the
 * assertion is about the ordering rather than about a stub's bookkeeping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Suite } from '../../../../packages/market-contracts/src/model/types.js'
import { effectiveSurfaces } from '../../../../packages/market-contracts/src/model/types.js'
import { captureExtensionSelection } from '../../../../packages/market-contracts/src/contracts/extension-presets.js'
import { ScopedExtensionContributors } from '../../../../packages/market-runtime/src/runtime/host/scoped-contributors.js'
import { createMcpMount } from '../../../../packages/market-bundle/src/runtime-adapters.js'

vi.mock('../../../../packages/market-runtime/src/runtime/surfaces/skills-provider.js', () => ({ SuiteSkillProvider: class {} }))
vi.mock('../../../../packages/market-runtime/src/runtime/panels/user-panels.js', () => ({ UserPanelSkillProvider: class {} }))
vi.mock('../../../../packages/market-runtime/src/runtime/surfaces/commands-mounts.js', () => ({
  CommandMountRegistry: class {
    setSelectionPolicy() {}
    async reconcile() {
      return []
    }
    disposeAll() {}
  }
}))
vi.mock('../../../../packages/market-runtime/src/runtime/panels/user-commands.js', () => ({
  UserCommandMountRegistry: class {
    setSelectionPolicy() {}
    async reconcile() {
      return []
    }
    disposeAll() {}
  }
}))
vi.mock('../../../../packages/market-runtime/src/runtime/surfaces/project-runtime.js', () => ({ suiteInstructions: async () => ({ text: '' }) }))
vi.mock('../../../../packages/market-mcp/src/runtime/mcp/mcp-mounts.js', () => ({
  McpMountRegistry: class {
    setBackendProvider() {}
    setOverridesProvider() {}
    async reconcile() {
      return []
    }
    async disposeAll() {}
    toolOwnership() {
      return []
    }
  }
}))

const SUITE_ID = 'market:source/hooked'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

/** One suite declaring the closing event, the shape the catalog now admits. */
const hookedSuite = (): Suite => ({
  sourceId: 'source',
  id: 'hooked',
  dimension: 'user',
  root: '/suite',
  manifest: { layout: 'claude-code', id: 'hooked', name: 'hooked', path: '/suite/plugin.json' },
  skills: [],
  enabled: true,
  errors: [],
  surfaces: { skills: 0, commands: 0, agents: 0, hooks: 1, mcp: 0, lsp: 0 },
  activeSurfaces: effectiveSurfaces(undefined),
  hooks: { events: { SessionEnd: [{ hooks: [{ type: 'command', command: 'on-end' }] }] } }
})

/**
 * A scope with the hook services and an effect registry that runs in reverse
 * order, the way cordis unwinds a fiber. Disposing the returned fiber is what a
 * real agent-context teardown does.
 */
function scope(shell: { execute(request: { command?: string }): Promise<{ result(): Promise<unknown> }> }) {
  const effects: Array<() => unknown> = []
  const fibers: Array<{ dispose(): Promise<void> }> = []
  const node = {
    logger: { warn() {}, info() {} },
    shell,
    sessionProjections: { stateOf: () => ({ lastTurn: 1, openTurnStartSeq: null }) },
    get: () => undefined,
    on: () => () => {},
    effect: (create: () => () => unknown) => {
      effects.push(create())
    },
    inject: (_dependencies: string[], apply: (scope: unknown) => void) => {
      apply(node)
      const fiber = {
        dispose: async () => {
          for (const dispose of effects.splice(0).reverse()) await dispose()
        }
      }
      fibers.push(fiber)
      return fiber
    },
    skills: { registerProvider: () => () => {} },
    systemPrompt: { section: () => () => {} }
  }
  return { node, fibers }
}

function harness() {
  const commands: string[] = []
  const shell = {
    resolve: (request: { command?: string }) => request,
    execute: async (request: { command?: string }) => {
      commands.push(request.command ?? '')
      return { result: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) }
    }
  }
  // The user's own grant. It stays true through teardown: the flag that closes
  // belongs to the mount, inside the owner under test.
  const grants = new Set<string>([SUITE_ID])
  const closing = scope(shell)
  const agent = {
    id: 'a',
    ctx: closing.node,
    session: { header: { id: 'a', cwd: '/work' }, append: () => {} },
    inject: () => {},
    steer: () => {},
    cancel: () => {}
  } as unknown as Agent
  const contributors = new ScopedExtensionContributors({
    dataRoot: '/data',
    catalog: { enabledUserSuites: async () => [hookedSuite()], readProjectCatalog: async () => ({ enabledSuites: [] }), mcpBackend: async () => 'plugin' } as never,
    suites: async () => [hookedSuite()],
    shell: () => undefined,
    allows: (_agent, resourceId) => grants.has(resourceId),
    mcpMounts: createMcpMount,
    panels: { commands: { list: async () => [] } as never }
  })
  cleanups.push(async () => {
    await contributors.disposeAll()
  })
  return {
    commands,
    contributors,
    agent,
    fibers: closing.fibers,
    /** The production teardown: the owner's dispose closes the mount flag itself. */
    close: () => {}
  }
}

describe('SessionEnd runs before the grant closes', () => {
  it('runs the closing hook when the owner disposes the bridge, as production teardown does', async () => {
    const h = harness()
    await h.contributors.reconcile(h.agent, captureExtensionSelection(null, [SUITE_ID]))
    expect(h.commands).toEqual([])
    // The production ordering: the owner disposes the hook bridge first, and the
    // grant only closes on the fiber that follows.
    h.close()
    await h.contributors.dispose(h.agent)
    expect(h.commands).toEqual(['on-end'])
  })

  it('runs the closing hook when the agent context unwinds the mount fiber', async () => {
    const h = harness()
    await h.contributors.reconcile(h.agent, captureExtensionSelection(null, [SUITE_ID]))
    expect(h.commands).toEqual([])
    // A context teardown unwinds the fibers this owner created, without the
    // owner's own dispose. The scope effect is the only place hooks close on
    // that path, so it must close them before the flag it owns.
    // The outer mount fiber plus the nested hook fiber it created.
    expect(h.fibers.length).toBeGreaterThan(0)
    for (const fiber of [...h.fibers].reverse()) await fiber.dispose()
    expect(h.commands).toEqual(['on-end'])
  })
})
