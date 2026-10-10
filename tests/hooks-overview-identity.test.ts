/**
 * The settings Hooks page publishes each declared hook exactly once.
 *
 * The 2026-10-08 acceptance run read four rows from a two-declaration file: the
 * overview listed the Agent layout root's synthetic hook suite twice, because
 * `enabledUserSuites()` already carries that suite whenever it declares events.
 * Both copies built the same `hookResourceId`, so the page also collided ids,
 * React keys and `data-resource-id` values. These cases read through the real
 * catalog and through a catalog double that already carries the suite.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { readExtensionInventory } from '../packages/market-bundle/src/application/extension-inventory.js'
import { readHooksOverview } from '../packages/market-bundle/src/session-extension.js'
import { loadUserHooksSuite, USER_HOOKS_SOURCE } from '../packages/market-runtime/src/application/panels/user-hooks.js'
import { effectiveSurfaces, type Suite } from '../packages/market-contracts/src/model/types.js'
import type { ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'

/** The declaration file the acceptance run used: two events, one command each. */
const declarations = {
  hooks: {
    SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: 'printf "startup hook"', timeout: 12 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'printf "prompt hook"' }] }]
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One isolated Agent layout root holding the acceptance declaration file. */
async function layoutRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'market-hooks-overview-'))
  roots.push(root)
  const agentsRoot = join(root, 'agents')
  await mkdir(agentsRoot, { recursive: true })
  await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify(declarations))
  return agentsRoot
}

/** A real catalog over one isolated layout root, the composition the route uses. */
async function realCatalog(agentsRoot: string): Promise<Catalog> {
  const catalog = new Catalog({ onChanged: () => {}, userRoot: join(agentsRoot, '..', 'user'), dataRoot: join(agentsRoot, '..', 'data'), agentsRoot })
  await catalog.load()
  return catalog
}

const ids = (rows: readonly ExtensionResource[]): string[] => rows.map(row => row.id)
const ports = {
  catalog: {
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/tmp', data: '/tmp' } }),
    mcpStatus: async () => ({
      entries: [],
      observedAt: '',
      totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: false
    }),
    lspStatus: async () => ({ entries: [], observedAt: '', totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 }, hostMissing: false })
  },
  panels: { skills: { list: async () => [] }, commands: { list: async () => [] }, agents: { list: async () => [] } }
}

describe('hooks overview identity', () => {
  it('carries the Agent layout root suite once and publishes one row per declaration', async () => {
    const agentsRoot = await layoutRoot()
    const catalog = await realCatalog(agentsRoot)
    try {
      // The source list already holds the synthetic suite, so the overview must
      // not add it a second time.
      expect((await catalog.enabledUserSuites()).filter(suite => suite.sourceId === USER_HOOKS_SOURCE)).toHaveLength(1)

      const rows = (await readHooksOverview(catalog)).rows
      expect(rows.map(row => (row.detail.kind === 'hook' ? row.detail.event : ''))).toEqual(['SessionStart', 'UserPromptSubmit'])
      expect(ids(rows)).toEqual(['hooks:@user-hooks/user-hooks/SessionStart/0', 'hooks:@user-hooks/user-hooks/UserPromptSubmit/0'])
      expect(new Set(ids(rows)).size).toBe(rows.length)
      const [start, prompt] = rows
      expect(start).toMatchObject({ face: 'hooks', available: true, name: 'printf "startup hook"', source: 'user-hooks · startup|resume' })
      expect(start!.detail).toMatchObject({
        kind: 'hook',
        event: 'SessionStart',
        command: 'printf "startup hook"',
        matcher: 'startup|resume',
        timeoutSec: 12,
        provenance: 'user-hooks',
        support: 'supported'
      })
      expect(prompt).toMatchObject({ face: 'hooks', available: true, name: 'printf "prompt hook"', source: 'user-hooks' })
      expect(prompt!.detail).toMatchObject({ kind: 'hook', event: 'UserPromptSubmit', command: 'printf "prompt hook"', provenance: 'user-hooks', support: 'supported' })
    } finally {
      catalog.dispose()
    }
  })

  it('publishes one row per declaration when the catalog already carries the synthetic suite', async () => {
    const agentsRoot = await layoutRoot()
    const synthetic = await loadUserHooksSuite(agentsRoot)
    const catalog = {
      agentsRoot,
      enabledUserSuites: async () => [synthetic],
      overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/tmp', data: '/tmp' } }),
      mcpStatus: ports.catalog.mcpStatus,
      lspStatus: ports.catalog.lspStatus
    }
    const rows = (await readHooksOverview(catalog)).rows
    expect(rows).toHaveLength(2)
    expect(new Set(ids(rows)).size).toBe(2)
  })

  it('shows the collision a doubled suite list produces, which is why the suite enters once', async () => {
    const agentsRoot = await layoutRoot()
    const synthetic = await loadUserHooksSuite(agentsRoot)
    const rows = await readExtensionInventory(ports, { projectSuites: [synthetic, synthetic] })
    const hookRows = rows.filter(row => row.face === 'hooks')
    // Two copies of one suite publish four rows under two ids.
    expect(hookRows).toHaveLength(4)
    expect(new Set(ids(hookRows)).size).toBe(2)
  })
})

/** One installed user-dimension suite: a supported event and a registered-only one. */
const installedSuite = (): Suite => ({
  sourceId: 'demo',
  id: 'v1',
  root: '/suites/demo',
  manifest: { layout: 'agent-plugin-v1', path: '/suites/demo/plugin.json', id: 'v1', name: 'Demo' },
  skills: [],
  surfaces: { skills: 0, mcp: 0, hooks: 2, commands: 0, agents: 0, lsp: 0 },
  dimension: 'user',
  enabled: true,
  activeSurfaces: effectiveSurfaces({ skills: false, mcp: false, commands: false, agents: false, lsp: false }),
  installedAt: 'user',
  hooks: {
    events: {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'echo installed' }] }],
      Notification: [{ hooks: [{ type: 'command', command: 'notify-me' }] }]
    }
  },
  errors: []
})

describe('hooks overview follows-suite rows', () => {
  it('carries the flag on installed hooks, adds no switch, and keeps the control-derived filter state', async () => {
    const agentsRoot = await layoutRoot()
    const synthetic = await loadUserHooksSuite(agentsRoot)
    const catalog = {
      agentsRoot,
      enabledUserSuites: async () => [installedSuite(), synthetic],
      overview: ports.catalog.overview,
      mcpStatus: ports.catalog.mcpStatus,
      lspStatus: ports.catalog.lspStatus
    }
    const rows = (await readHooksOverview(catalog)).rows
    const installed = rows.filter(row => row.detail.kind === 'hook' && row.detail.sourceId === 'demo')
    expect(ids(installed)).toEqual(['hooks:demo/v1/PreToolUse/0', 'hooks:demo/v1/Notification/0'])
    // The panel is read-only; the flag explains the absent switch instead of
    // adding one, so the supported row keeps its selectable shape...
    expect(installed[0]).toMatchObject({ followsSuite: true, available: true, globalEnabled: true })
    expect(installed[0]).not.toHaveProperty('control')
    // ...and the limited row keeps control, the field the filter and card state read.
    expect(installed[1]).toMatchObject({ followsSuite: true, available: false, control: 'global-only', unavailableReason: 'hook-event-partial' })
    // The user's own declarations stay individually addressed.
    const userRows = rows.filter(row => row.detail.kind === 'hook' && row.detail.sourceId === USER_HOOKS_SOURCE)
    expect(userRows.length).toBeGreaterThan(0)
    for (const row of userRows) expect(row).not.toHaveProperty('followsSuite')
  })
})
