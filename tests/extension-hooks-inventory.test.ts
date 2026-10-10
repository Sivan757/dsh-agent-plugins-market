/**
 * The user's own hook declarations become Hooks-tab rows, one per command,
 * grouped by event and carrying the host's support verdict.
 *
 * The read runs against the real inventory function; catalog status payloads
 * and panel rows are fixtures, the same pattern extension-suite-inventory
 * uses. What these cases pin: a supported event's rows select like any other
 * resource; a partial or registered-only event's rows stay read-only with the
 * reason; a declaration the validator rejected (which exists only as a suite
 * diagnostic) still surfaces as one read-only row, so the Hooks tab registers
 * it instead of dropping it into the suite detail's error list. Each row opens
 * its own declaration: the detail names the event, the hook's position, the
 * command as authored, the declared matcher and timeout, the provenance and the
 * host support verdict the row already carries.
 */
import { describe, expect, it } from 'vitest'
import { readExtensionInventory } from '../packages/market-bundle/src/application/extension-inventory.js'
import { effectiveSurfaces, type ProjectHooks, type Suite } from '../packages/market-contracts/src/model/types.js'

/** The user-hooks synthetic suite, the shape loadUserHooksSuite always builds. */
const userHooksSuite = (overrides: { events?: ProjectHooks['events']; errors?: string[] }): Suite => ({
  sourceId: '@user-hooks',
  id: 'user-hooks',
  root: '/agents-root',
  manifest: { layout: 'agent-plugin-v1', path: '/agents-root/hooks/hooks.json', id: 'user-hooks', name: 'user-hooks' },
  skills: [],
  surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
  dimension: 'user',
  enabled: true,
  activeSurfaces: effectiveSurfaces({ skills: false, mcp: false, commands: false, agents: false, lsp: false }),
  installedAt: 'user',
  ...(overrides.events === undefined ? {} : { hooks: { events: overrides.events } }),
  errors: overrides.errors ?? []
})

/** One declared command hook; a declared timeout travels as the declaration's own field. */
const command = (text: string, timeout?: number): { type: 'command'; command: string; timeout?: number } => ({
  type: 'command',
  command: text,
  ...(timeout === undefined ? {} : { timeout })
})
const eventGroup = (...hooks: ReturnType<typeof command>[]) => [{ hooks }]
const eventGroupWithMatcher = (matcher: string, ...hooks: ReturnType<typeof command>[]) => [{ matcher, hooks }]

const ports = {
  catalog: {
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/tmp', data: '/tmp' } }),
    mcpStatus: async () => ({
      entries: [],
      observedAt: '',
      totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: false
    }),
    lspStatus: async () => ({ entries: [], totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 }, hostMissing: false })
  },
  panels: {
    skills: { list: async () => [] },
    commands: { list: async () => [] },
    agents: { list: async () => [] }
  }
} as unknown as Parameters<typeof readExtensionInventory>[0]

describe('user hook declarations as Hooks tab rows', () => {
  it('emits one selectable row per command hook of a supported event, grouped by event', async () => {
    const rows = await readExtensionInventory(ports, {
      projectSuites: [
        userHooksSuite({
          events: { PreToolUse: [...eventGroupWithMatcher('Edit', command('echo edit')), ...eventGroup(command('echo plain'))], SessionStart: eventGroup(command('echo start')) }
        })
      ]
    })
    const hookRows = rows.filter(row => row.face === 'hooks')
    expect(hookRows).toHaveLength(3)
    // The event name rides row.description, the field the Hooks tab groups its secondary tabs by.
    expect(hookRows.map(row => row.description)).toEqual(['PreToolUse', 'PreToolUse', 'SessionStart'])
    expect(hookRows.map(row => row.name)).toEqual(['echo edit', 'echo plain', 'echo start'])
    // A matcher other than the catch-all joins the provenance: source carries the configuration id plus the matcher.
    expect(hookRows.map(row => row.source)).toEqual(['user-hooks · Edit', 'user-hooks', 'user-hooks'])
    // Supported events select like any other resource and are globally on by default.
    for (const row of hookRows) expect(row).toMatchObject({ available: true, globalEnabled: true })
    expect(hookRows.some(row => row.control !== undefined)).toBe(false)
    // Every hook row addresses its own declaration, not the suite behind it.
    expect(hookRows.every(row => row.detail.kind === 'hook' && row.detail.sourceId === '@user-hooks' && row.detail.suiteId === 'user-hooks')).toBe(true)
  })

  it('describes one hook row with its own position, matcher and declared timeout', async () => {
    const rows = await readExtensionInventory(ports, {
      projectSuites: [
        userHooksSuite({
          events: {
            PreToolUse: [...eventGroupWithMatcher('Edit', command('echo edit', 12)), ...eventGroup(command('echo plain')), ...eventGroupWithMatcher('*', command('echo star'))]
          }
        })
      ]
    })
    const [edit, plain, star] = rows.filter(row => row.face === 'hooks')

    // Everything the surface shows about one hook comes from its scanned declaration.
    expect(edit!.detail).toEqual({
      kind: 'hook',
      sourceId: '@user-hooks',
      suiteId: 'user-hooks',
      event: 'PreToolUse',
      hookIndex: 0,
      command: 'echo edit',
      matcher: 'Edit',
      timeoutSec: 12,
      provenance: 'user-hooks',
      support: 'supported'
    })
    // A declaration carrying neither matcher nor timeout has neither field: the
    // detail states what was declared rather than inventing a default.
    expect(plain!.detail).toEqual({
      kind: 'hook',
      sourceId: '@user-hooks',
      suiteId: 'user-hooks',
      event: 'PreToolUse',
      hookIndex: 1,
      command: 'echo plain',
      provenance: 'user-hooks',
      support: 'supported'
    })
    // The position counts across matcher groups, as the row id always has, and a
    // declared catch-all stays visible even though the row's source omits it.
    expect(star!.detail).toMatchObject({ hookIndex: 2, matcher: '*' })
    expect(star!.source).toBe('user-hooks')
  })

  it('carries the rejection and the support verdict on a declared-event row, with no command or position', async () => {
    const rows = await readExtensionInventory(ports, {
      projectSuites: [
        userHooksSuite({
          events: { PreToolUse: eventGroup(command('echo ok')) },
          errors: ['hooks.json: unsupported hook event Notification', 'hooks.json: unsupported hook event PreCompact']
        })
      ]
    })

    expect(rows.find(row => row.id.endsWith('/Notification/declared'))!.detail).toEqual({
      kind: 'hook',
      sourceId: '@user-hooks',
      suiteId: 'user-hooks',
      event: 'Notification',
      provenance: 'user-hooks',
      support: 'supported-partial',
      diagnostic: 'hooks.json: unsupported hook event Notification'
    })
    const rejected = rows.find(row => row.id.endsWith('/PreCompact/declared'))!.detail
    expect(rejected).toMatchObject({ kind: 'hook', event: 'PreCompact', support: 'registered-only', diagnostic: 'hooks.json: unsupported hook event PreCompact' })
    // No admitted hook exists behind a rejected declaration, so neither field is claimed.
    expect(rejected).not.toHaveProperty('command')
    expect(rejected).not.toHaveProperty('hookIndex')
  })

  it('keeps partial and registered-only events read-only with their reason', async () => {
    const rows = await readExtensionInventory(ports, {
      projectSuites: [userHooksSuite({ events: { Notification: eventGroup(command('notify-me')), SessionEnd: eventGroup(command('on-end')) } })]
    })
    const notification = rows.find(row => row.id.endsWith('/Notification/0'))!
    expect(notification).toMatchObject({ available: false, control: 'global-only', unavailableReason: 'hook-event-partial' })
    const sessionEnd = rows.find(row => row.id.endsWith('/SessionEnd/0'))!
    expect(sessionEnd).toMatchObject({ available: false, control: 'global-only', unavailableReason: 'hook-event-unsupported' })
  })

  it('surfaces each rejected-event diagnostic as one read-only declared row', async () => {
    const rows = await readExtensionInventory(ports, {
      projectSuites: [
        userHooksSuite({
          events: { PreToolUse: eventGroup(command('echo ok')) },
          errors: ['hooks.json: unsupported hook event SessionEnd', 'hooks.json: unsupported hook event PreCompact']
        })
      ]
    })
    const declared = rows.filter(row => row.id.endsWith('/declared'))
    expect(declared.map(row => row.name)).toEqual(['SessionEnd', 'PreCompact'])
    for (const row of declared) {
      expect(row).toMatchObject({ face: 'hooks', description: row.name, available: false, control: 'global-only' })
      // SessionEnd and PreCompact are both registered-only in the host support map.
      expect(row.unavailableReason).toBe('hook-event-unsupported')
    }
    // The selectable row for the admitted event stays untouched beside the declared ones.
    expect(rows.find(row => row.id.endsWith('/PreToolUse/0'))).toMatchObject({ available: true })
  })

  it('contributes no Hooks rows when the configuration declares no events and carries no diagnostics', async () => {
    const rows = await readExtensionInventory(ports, { projectSuites: [userHooksSuite({})] })
    expect(rows.filter(row => row.face === 'hooks')).toHaveLength(0)
  })

  it('names no session on the detail address unless the read carries one', async () => {
    const withSession = await readExtensionInventory(ports, { projectSuites: [userHooksSuite({ events: { Stop: eventGroup(command('echo stop')) } })], sessionId: 'session-9' })
    expect(withSession.find(row => row.face === 'hooks')!.detail).toMatchObject({ kind: 'hook', sessionId: 'session-9' })
    const withoutSession = await readExtensionInventory(ports, { projectSuites: [userHooksSuite({ events: { Stop: eventGroup(command('echo stop')) } })] })
    expect(withoutSession.find(row => row.face === 'hooks')!.detail.sessionId).toBeUndefined()
  })
})

/** One suite declaring command hooks, in the dimension the case needs. */
const declaredSuite = (overrides: { sourceId: string; id: string; dimension: 'user' | 'project'; events?: ProjectHooks['events']; errors?: string[] }): Suite => ({
  sourceId: overrides.sourceId,
  id: overrides.id,
  root: '/suite-root',
  manifest: { layout: 'agent-plugin-v1', path: '/suite-root/plugin.json', id: overrides.id, name: overrides.id },
  skills: [],
  surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
  dimension: overrides.dimension,
  enabled: true,
  activeSurfaces: effectiveSurfaces({ skills: false, mcp: false, commands: false, agents: false, lsp: false }),
  installedAt: 'user',
  ...(overrides.events === undefined ? {} : { hooks: { events: overrides.events } }),
  errors: overrides.errors ?? []
})

const hookRowsOf = (rows: readonly { face: string; name: string }[]): { face: string; name: string }[] => rows.filter(row => row.face === 'hooks')
const hookRowOfSuite = (rows: Awaited<ReturnType<typeof readExtensionInventory>>, suiteId: string) =>
  rows.filter(row => row.face === 'hooks' && row.detail.kind === 'hook' && row.detail.suiteId === suiteId)

describe('installed suite hooks follow their suite', () => {
  const installed = declaredSuite({
    sourceId: 'demo',
    id: 'v1',
    dimension: 'user',
    events: { PreToolUse: eventGroup(command('echo installed')), UserPromptSubmit: eventGroup(command('echo prompt')) }
  })
  const project = declaredSuite({ sourceId: 'native', id: 'agents-native', dimension: 'project', events: { PreToolUse: eventGroup(command('echo project')) } })
  const userHooks = userHooksSuite({ events: { PreToolUse: eventGroup(command('echo user')) } })

  it('stamps followsSuite on every hook row of an installed suite the dedicated list carries', async () => {
    const rows = await readExtensionInventory(ports, { hookSuites: [project, installed, userHooks] })
    const installedRows = hookRowOfSuite(rows, 'v1')
    expect(installedRows.map(row => row.name)).toEqual(['echo installed', 'echo prompt'])
    // An installed suite publishes no per-hook switch: every row follows the parent grant.
    for (const row of installedRows) expect(row.followsSuite).toBe(true)
    // The support verdict alone decides selectability, exactly as before.
    expect(installedRows.map(row => row.available)).toEqual([true, true])
  })

  it('leaves followsSuite absent on project and @user-hooks rows', async () => {
    const rows = await readExtensionInventory(ports, { hookSuites: [project, installed, userHooks] })
    expect(hookRowOfSuite(rows, 'agents-native')[0]).not.toHaveProperty('followsSuite')
    expect(hookRowOfSuite(rows, 'user-hooks')[0]).not.toHaveProperty('followsSuite')
  })

  it('stamps the same verdict when the installed suite arrives through projectSuites', async () => {
    // The rule is the suite's, not the caller's: the settings overview's global
    // read carries the same flag, so the card explains why no switch appears.
    const rows = await readExtensionInventory(ports, { projectSuites: [installed] })
    for (const row of hookRowOfSuite(rows, 'v1')) expect(row.followsSuite).toBe(true)
  })

  it('stamps a follows-suite row that exists only as a validator diagnostic', async () => {
    const broken = declaredSuite({
      sourceId: 'demo',
      id: 'v1',
      dimension: 'user',
      events: { PreToolUse: eventGroup(command('echo ok')) },
      errors: ['plugin.json: unsupported hook event SessionEnd']
    })
    const rows = await readExtensionInventory(ports, { hookSuites: [broken] })
    expect(rows.find(row => row.id.endsWith('/declared'))).toMatchObject({ followsSuite: true, available: false, control: 'global-only' })
  })

  it('falls back to projectSuites as the hook source when the dedicated list is absent', async () => {
    const rows = await readExtensionInventory(ports, { projectSuites: [userHooks] })
    expect(hookRowsOf(rows)).toHaveLength(1)
    expect(rows.find(row => row.face === 'hooks')).not.toHaveProperty('followsSuite')
  })
})
