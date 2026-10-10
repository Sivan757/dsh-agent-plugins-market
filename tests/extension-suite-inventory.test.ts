/**
 * Disabled but validated suite declarations become explicit preset choices.
 *
 * Two absences look alike on a status surface and must not be confused: a suite the
 * user turned off globally still validates, so its resources stay `available` with
 * `globalEnabled: false` — nameable by a saved preset — while a surface that failed
 * validation, an entry the declaration does not carry, or a project LSP declaration
 * is not selectable at all. The status layer only reports installed and globally
 * enabled suites, so rows it omits are synthesized from the validated declaration,
 * and rows it does report are corrected in place rather than duplicated.
 *
 * Reads run against the real inventory function; only catalog status payloads and
 * panel rows are fixtures.
 */
import { describe, expect, it } from 'vitest'
import { extensionResourceEnabled, readExtensionInventory } from '../packages/market-bundle/src/application/extension-inventory.js'
import { effectiveSurfaces, type Suite, type SuiteSurfaceKey } from '../packages/market-contracts/src/model/types.js'
import type { ExtensionSuiteCandidate } from '../packages/market-runtime/src/application/extension-suite-selection.js'
import type { McpSuiteOverrides } from '../packages/market-mcp/src/application/mcp/mcp-overrides.js'
import type { ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'
import type { McpStatusEntry } from '../packages/market-contracts/src/contracts/mcp-status.js'
import type { LspStatusEntry } from '../packages/market-contracts/src/contracts/lsp-status.js'

const suite = (overrides: Partial<Suite> = {}): Suite =>
  ({
    sourceId: 'demo',
    id: 'v1',
    root: '/tmp/demo',
    manifest: { layout: 'agent-plugin-v1', path: '/tmp/demo/plugin.json', id: 'v1', name: 'Demo', description: 'demo' },
    skills: [{ name: 'alpha', file: '/tmp/demo/skills/alpha/SKILL.md', description: 'alpha' }],
    resources: { commands: [{ name: 'deploy', file: '/tmp/demo/commands/deploy.md' }], agents: [] },
    surfaces: { skills: 1, mcp: 1, hooks: 0, commands: 1, agents: 0, lsp: 1 },
    dimension: 'user',
    enabled: false,
    activeSurfaces: effectiveSurfaces(undefined),
    errors: [],
    mcp: { schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', servers: { db: { type: 'stdio', command: './bin/db' } } },
    lsp: { servers: { typescript: { key: 'typescript', command: 'tsc', args: [], extensionToLanguage: { '.ts': 'typescript' } } } },
    ...overrides
  }) as Suite

const ALL_VALID: Record<SuiteSurfaceKey, boolean> = { skills: true, commands: true, agents: false, mcp: true, lsp: true, hooks: false }
const candidate = (overrides: Partial<ExtensionSuiteCandidate> = {}): ExtensionSuiteCandidate => ({ suite: suite(), validSurfaces: ALL_VALID, ...overrides })

/** An overview card for the same suite: the display authority the panel already has. */
const overviewCard = (overrides: Record<string, unknown> = {}) => ({
  sourceId: 'demo',
  suiteId: 'v1',
  name: 'Demo',
  description: 'translated description',
  keywords: [],
  surfaces: { skills: 1, mcp: 1, hooks: 0, commands: 1, agents: 0, lsp: 1 },
  enabled: false,
  installed: true,
  dimension: 'user',
  layout: 'agent-plugin-v1',
  errors: [],
  ...overrides
})

const mcpEntry = (overrides: Partial<McpStatusEntry> = {}): McpStatusEntry => ({
  id: 'plugin:demo/v1/db',
  name: 'db',
  kind: 'plugin',
  state: 'disabled',
  suiteId: 'demo/v1',
  serverKey: 'db',
  transport: 'stdio',
  tools: [],
  ...overrides
})

const lspEntry = (overrides: Partial<LspStatusEntry> = {}): LspStatusEntry => ({
  id: 'demo/v1/typescript',
  serverKey: 'typescript',
  suiteId: 'demo/v1',
  suiteName: 'Demo',
  sourceId: 'demo',
  kind: 'plugin',
  command: 'tsc',
  args: [],
  extensions: { '.ts': 'typescript' },
  state: 'disabled',
  ...overrides
})

const ports = (
  entries: { skills?: unknown[]; commands?: unknown[]; agents?: unknown[] } = {},
  status: { mcp?: McpStatusEntry[]; lsp?: LspStatusEntry[]; cards?: unknown[] } = {}
) =>
  ({
    catalog: {
      overview: async () => ({ sources: [], suites: status.cards ?? [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/tmp', data: '/tmp' } }),
      mcpStatus: async () => ({
        entries: status.mcp ?? [],
        observedAt: '1970-01-01T00:00:00.000Z',
        totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
        directObservationOnly: false
      }),
      lspStatus: async () => ({
        entries: status.lsp ?? [],
        observedAt: '1970-01-01T00:00:00.000Z',
        totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 },
        hostMissing: false
      })
    },
    panels: {
      skills: { list: async () => entries.skills ?? [] },
      commands: { list: async () => entries.commands ?? [] },
      agents: { list: async () => entries.agents ?? [] }
    }
  }) as unknown as Parameters<typeof readExtensionInventory>[0]

const panelEntry = (kind: string, name: string, disabled: boolean) => ({
  id: JSON.stringify(['demo', 'v1', kind, name]),
  name,
  description: name,
  origin: 'plugin' as const,
  suiteName: 'Demo',
  disabled,
  metadata: {},
  path: '/tmp/demo/' + name
})
const find = (rows: ExtensionResource[], id: string) => rows.find(row => row.id === id)
const count = (rows: ExtensionResource[], id: string) => rows.filter(row => row.id === id).length
/** The user's own `mcp.json`, which the composition root passes as a candidate. */
const ownedSentinel = (): ExtensionSuiteCandidate =>
  candidate({
    suite: suite({
      sourceId: '@user-mcp',
      id: 'user-mcp',
      manifest: { layout: 'agent-plugin-v1', path: '/tmp/agents/mcp.json', id: 'user-mcp', name: 'user-mcp' },
      skills: [],
      resources: { commands: [], agents: [] },
      surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
      lsp: undefined,
      mcp: { schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', servers: { db: { type: 'stdio', command: './bin/db' } } }
    }),
    validSurfaces: { skills: false, commands: false, agents: false, mcp: true, lsp: false, hooks: false }
  })
const noOverrides = new Map<string, McpSuiteOverrides>()
const noDisabledLsp = new Set<string>()
const candidateMode = (candidates: ExtensionSuiteCandidate[], extra: Record<string, unknown> = {}) => ({
  candidates,
  mcpOverrides: noOverrides,
  lspDisabledIds: noDisabledLsp,
  ...extra
})

describe('validated but globally disabled suite declarations', () => {
  it('classifies native project groups separately while preserving child authorization', async () => {
    const project = suite({ sourceId: 'native', id: 'agents-native', root: '/project/.agents', dimension: 'project', enabled: true })
    const child = { ...panelEntry('skills', 'alpha', false), id: JSON.stringify(['native', 'agents-native', 'skills', 'alpha']) }
    const rows = await readExtensionInventory(ports({ skills: [child] }), candidateMode([candidate({ suite: project })], { projectSuites: [project], sessionId: 'session' }))
    expect(find(rows, 'market:native/agents-native')).toMatchObject({ configuration: 'project', name: '.agents', available: true })
    const entry = find(rows, 'skills:' + child.id)!
    expect(entry.face).toBe('skills')
    expect(entry.suiteResourceId).toBe('market:native/agents-native')
    const selection = { presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: [entry.id] }
    // A configuration parent's child is selected by its own id; the parent id
    // derives its grant and no preset carries it.
    expect(extensionResourceEnabled(entry, selection, rows)).toBe(true)
    expect(rows.filter(row => row.face === 'market' && row.configuration === undefined)).toHaveLength(0)
  })
  it('classifies user hooks as local configuration, never a market offering', async () => {
    const hooks = suite({ sourceId: '@user-hooks', id: 'user-hooks', skills: [], mcp: undefined, lsp: undefined, enabled: true })
    const rows = await readExtensionInventory(
      ports(),
      candidateMode([candidate({ suite: hooks, validSurfaces: { skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: true } })], {
        projectSuites: [hooks]
      })
    )
    // The configuration suite publishes no market row at all: its hooks stay on
    // the Hooks face and their grant is derived from the selected hooks.
    expect(rows.filter(row => row.id === 'market:@user-hooks/user-hooks')).toHaveLength(0)
    expect(rows.filter(row => row.face === 'market')).toHaveLength(0)
  })

  it('keeps rejected user hook declarations disabled without a legacy duplicate', async () => {
    const hooks = suite({ sourceId: '@user-hooks', id: 'user-hooks', skills: [], mcp: undefined, lsp: undefined, enabled: true })
    const declaration = candidate({ suite: hooks, validSurfaces: { skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: false } })
    const rows = await readExtensionInventory(ports(), candidateMode([declaration], { projectSuites: [hooks] }))
    // A rejected declaration publishes no row of any face, so nothing can grant it.
    expect(rows.filter(row => row.id === 'market:@user-hooks/user-hooks')).toHaveLength(0)
    expect(rows.filter(row => row.face === 'hooks' && row.detail.kind === 'hook' && row.detail.sourceId === '@user-hooks')).toHaveLength(0)
  })
  it('lists a project suite only once when both discovery paths supply it', async () => {
    const project = suite({ sourceId: 'native', id: 'agents-native', dimension: 'project', enabled: false })
    const rows = await readExtensionInventory(ports(), candidateMode([candidate({ suite: project })], { projectSuites: [project], sessionId: 'session' }))
    expect(rows.filter(row => row.id === 'market:native/agents-native')).toHaveLength(1)
    expect(find(rows, 'market:native/agents-native')).toMatchObject({ available: true, globalEnabled: false })
  })

  it('does not let legacy project discovery override failed candidate validation', async () => {
    const project = suite({ sourceId: 'native', id: 'agents-native', dimension: 'project', enabled: true })
    const invalid = candidate({ suite: project, validSurfaces: { skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: false } })
    const rows = await readExtensionInventory(ports(), candidateMode([invalid], { projectSuites: [project] }))
    expect(rows.filter(row => row.id === 'market:native/agents-native')).toHaveLength(1)
    expect(find(rows, 'market:native/agents-native')).toMatchObject({ available: false, globalEnabled: false })
  })
  it('keeps one suite row when overview and candidate describe the same suite', async () => {
    const rows = await readExtensionInventory(ports({}, { cards: [overviewCard()] }), candidateMode([candidate()]))
    expect(count(rows, 'market:demo/v1')).toBe(1)
    const row = find(rows, 'market:demo/v1')!
    // Overview stays the display authority — its description is the translated text.
    expect(row.description).toBe('translated description')
    // The validated declaration supplies availability and the switch, in place.
    expect(row).toMatchObject({ available: true, globalEnabled: false })
  })

  it('carries both description texts so the panel can flip between them', async () => {
    // A translated card: the overview answers with the authored text and the
    // translation beside it, and the row must keep both — the manager's text
    // switch renders one or the other without another read.
    const card = overviewCard({ description: 'Authored text', translatedDescription: '翻译文本' })
    const rows = await readExtensionInventory(ports({}, { cards: [card] }), candidateMode([candidate()]))
    expect(find(rows, 'market:demo/v1')).toMatchObject({ description: 'Authored text', translatedDescription: '翻译文本' })

    // An untranslated card carries no second field, so the row falls back to
    // the authored text instead of rendering an empty translation.
    const plain = await readExtensionInventory(ports({}, { cards: [overviewCard()] }), candidateMode([candidate()]))
    expect(find(plain, 'market:demo/v1')).not.toHaveProperty('translatedDescription')

    // A panel entry travels the same way: the authored description stays the
    // row's own text and the translation rides beside it.
    const translated = { ...panelEntry('skills', 'alpha', false), description: 'Authored', translatedDescription: '译文' }
    const panelRows = await readExtensionInventory(ports({ skills: [translated] }))
    expect(panelRows.find(row => row.face === 'skills')).toMatchObject({ description: 'Authored', translatedDescription: '译文' })
  })

  it('reports a suite with no valid surface as unavailable rather than merely off', async () => {
    const invalid = candidate({ validSurfaces: { skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: false } })
    const rows = await readExtensionInventory(ports(), candidateMode([invalid]))
    expect(find(rows, 'market:demo/v1')).toMatchObject({ available: false, globalEnabled: false })
  })

  it('still exposes a validated system prompt when no surface validated', async () => {
    const promptOnly = candidate({
      suite: suite({ systemPrompt: 'instructions', skills: [], resources: { commands: [], agents: [] }, mcp: undefined, lsp: undefined }),
      validSurfaces: { skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: false }
    })
    const rows = await readExtensionInventory(ports(), candidateMode([promptOnly]))
    expect(find(rows, 'market:demo/v1')).toMatchObject({ available: true })
  })

  it('makes a globally disabled panel command selectable while an undeclared one is not', async () => {
    const rows = await readExtensionInventory(ports({ commands: [panelEntry('commands', 'deploy', true), panelEntry('commands', 'ghost', true)] }), candidateMode([candidate()]))
    expect(find(rows, 'commands:["demo","v1","commands","deploy"]')).toMatchObject({ available: true, globalEnabled: false })
    expect(find(rows, 'commands:["demo","v1","commands","ghost"]')).toMatchObject({ available: false })
  })

  it('makes a globally disabled skill selectable but not one whose surface failed validation', async () => {
    const rows = await readExtensionInventory(
      ports({ skills: [panelEntry('skills', 'alpha', true)] }),
      candidateMode([candidate({ validSurfaces: { ...ALL_VALID, skills: false } })])
    )
    expect(find(rows, 'skills:["demo","v1","skills","alpha"]')).toMatchObject({ available: false })
  })

  it('synthesizes the MCP row a disabled suite never reached the status layer for', async () => {
    const rows = await readExtensionInventory(ports(), candidateMode([candidate()]))
    expect(find(rows, 'mcp:plugin:demo/v1/db')).toMatchObject({ suiteResourceId: 'market:demo/v1', available: true, globalEnabled: false })
  })

  it('corrects a reported disabled MCP row in place, keyed by the qualified suite', async () => {
    // The status layer reported this row as disabled; the override map is keyed by
    // 'demo/v1', the identity the MCP layer itself uses.
    const overrides = new Map<string, McpSuiteOverrides>([['demo/v1', { db: { enabled: false } }]])
    const rows = await readExtensionInventory(ports({}, { mcp: [mcpEntry()] }), { candidates: [candidate()], mcpOverrides: overrides, lspDisabledIds: noDisabledLsp })
    expect(count(rows, 'mcp:plugin:demo/v1/db')).toBe(1)
    const row = find(rows, 'mcp:plugin:demo/v1/db')!
    // The declaration makes it selectable; the explicit override is what turns it off.
    expect(row).toMatchObject({ available: true, globalEnabled: false })
  })

  it('does not invent a switch for a server the override data does not mention', async () => {
    const overrides = new Map<string, McpSuiteOverrides>([['demo/v1', {}]])
    const rows = await readExtensionInventory(ports({}, { mcp: [mcpEntry()] }), { candidates: [candidate()], mcpOverrides: overrides, lspDisabledIds: noDisabledLsp })
    // Nothing stated: the composed suite switch answers, never an implicit enabled.
    expect(find(rows, 'mcp:plugin:demo/v1/db')?.globalEnabled).toBe(false)
  })

  it('synthesizes the LSP row and honours the explicit disabled id set', async () => {
    const rows = await readExtensionInventory(ports(), candidateMode([candidate()], { lspDisabledIds: new Set(['demo/v1/typescript']) }))
    expect(find(rows, 'lsp:demo/v1/typescript')).toMatchObject({ suiteResourceId: 'market:demo/v1', available: true, globalEnabled: false })
  })

  it('corrects a reported LSP row without duplicating it', async () => {
    const rows = await readExtensionInventory(ports({}, { lsp: [lspEntry()] }), candidateMode([candidate()]))
    expect(count(rows, 'lsp:demo/v1/typescript')).toBe(1)
    expect(find(rows, 'lsp:demo/v1/typescript')).toMatchObject({ available: true, globalEnabled: false })
  })

  it('never enables a project suite LSP declaration', async () => {
    const project = candidate({ suite: suite({ dimension: 'project' }), validSurfaces: { ...ALL_VALID, lsp: false } })
    const rows = await readExtensionInventory(ports(), candidateMode([project]))
    expect(find(rows, 'lsp:demo/v1/typescript')).toMatchObject({ available: false, globalEnabled: false })
  })

  it('marks a synthesized MCP row read-only when the host backend cannot scope it', async () => {
    const rows = await readExtensionInventory(ports(), candidateMode([candidate()], { mcpSessionControl: false }))
    const row = find(rows, 'mcp:plugin:demo/v1/db')!
    expect(row.control).toBe('global-only')
    expect(row.unavailableReason).toBe('host-mcp-uncontrolled')
  })

  it('refuses candidate mode without the override data a missing value would read as enabled', async () => {
    const bare = { candidates: [candidate()] } as unknown as Parameters<typeof readExtensionInventory>[1]
    await expect(readExtensionInventory(ports(), bare)).rejects.toThrow('extension-inventory-override-data-required')
  })

  it('keeps the legacy option behaviour unchanged when no candidate is supplied', async () => {
    const rows = await readExtensionInventory(ports(), { projectSuites: [suite({ enabled: true, dimension: 'project' })], sessionId: 'session' })
    expect(find(rows, 'market:demo/v1')).toMatchObject({ available: true })
    expect(find(rows, 'market:demo/v1')?.globalEnabled).toBeUndefined()
    expect(find(rows, 'mcp:plugin:demo/v1/db')).toBeUndefined()
  })
})

describe('user-owned declarations are resources, not market suites', () => {
  it('never invents a market parent row for the user MCP declaration', async () => {
    const rows = await readExtensionInventory(ports(), candidateMode([ownedSentinel()]))
    expect(find(rows, 'market:@user-mcp/user-mcp')).toBeUndefined()
  })

  it('keeps the managed direct server addressable with no suite parent', async () => {
    const rows = await readExtensionInventory(ports(), candidateMode([ownedSentinel()]))
    const row = find(rows, 'mcp:plugin:@user-mcp/user-mcp/db')!
    expect(row.suiteResourceId).toBeUndefined()
    // Its own declaration validated, so a preset can name it.
    expect(row.available).toBe(true)
  })

  it('does not duplicate a direct server the status layer already reported', async () => {
    const reported = mcpEntry({ id: 'plugin:@user-mcp/user-mcp/db', suiteId: '@user-mcp/user-mcp', serverKey: 'db' })
    const rows = await readExtensionInventory(ports({}, { mcp: [reported] }), candidateMode([ownedSentinel()]))
    expect(count(rows, 'mcp:plugin:@user-mcp/user-mcp/db')).toBe(1)
  })

  it('treats a disabled direct LSP server as a switch a preset can still turn on', async () => {
    const direct = lspEntry({ id: 'direct/ts', suiteId: 'direct', kind: 'direct', serverKey: 'ts', state: 'disabled' })
    const rows = await readExtensionInventory(ports({}, { lsp: [direct] }), candidateMode([]))
    const row = find(rows, 'lsp:direct/ts')!
    // Disabled here is the user's switch, not an unusable declaration.
    expect(row.available).toBe(true)
    expect(row.globalEnabled).toBe(true)
    expect(row.suiteResourceId).toBeUndefined()
  })

  it('reads the disabled id set as the direct LSP switch', async () => {
    const direct = lspEntry({ id: 'direct/ts', suiteId: 'direct', kind: 'direct', serverKey: 'ts', state: 'disabled' })
    const rows = await readExtensionInventory(ports({}, { lsp: [direct] }), candidateMode([], { lspDisabledIds: new Set(['direct/ts']) }))
    expect(find(rows, 'lsp:direct/ts')?.globalEnabled).toBe(false)
  })

  it('keeps a failed direct LSP mount out of reach', async () => {
    const direct = lspEntry({ id: 'direct/ts', suiteId: 'direct', kind: 'direct', serverKey: 'ts', state: 'failed' })
    const rows = await readExtensionInventory(ports({}, { lsp: [direct] }), candidateMode([]))
    expect(find(rows, 'lsp:direct/ts')?.available).toBe(false)
  })

  it('lets a preset name a native command the user switched off, but not a broken one', async () => {
    const nativeEntry = (name: string, metadata: Record<string, unknown>) => ({
      id: name,
      name,
      description: name,
      origin: 'user' as const,
      disabled: true,
      metadata,
      path: '/tmp/agents/commands/' + name
    })
    const rows = await readExtensionInventory(
      ports({ commands: [nativeEntry('deploy', {}), nativeEntry('broken', { validationError: 'missing frontmatter' })] }),
      candidateMode([])
    )
    expect(find(rows, 'commands:deploy')).toMatchObject({ available: true, globalEnabled: false })
    expect(find(rows, 'commands:broken')).toMatchObject({ available: false, globalEnabled: false })
  })

  it('lets a preset name a native agent the user switched off', async () => {
    const nativeAgent = { id: 'reviewer', name: 'reviewer', description: 'reviewer', origin: 'user' as const, disabled: true, metadata: {}, path: '/tmp/agents/agents/reviewer.md' }
    const rows = await readExtensionInventory(ports({ agents: [nativeAgent] }), candidateMode([]))
    expect(find(rows, 'agents:reviewer')).toMatchObject({ available: true, globalEnabled: false })
  })

  it('composes the parent switch into an entry the panel reports as enabled', async () => {
    // The panel reports this entry as not disabled, but its suite is off globally:
    // trusting the panel flag alone would publish it as globally enabled.
    const rows = await readExtensionInventory(ports({ commands: [panelEntry('commands', 'deploy', false)] }), candidateMode([candidate({ suite: suite({ enabled: false }) })]))
    const row = find(rows, 'commands:["demo","v1","commands","deploy"]')!
    expect(row.available).toBe(true)
    expect(row.globalEnabled).toBe(false)
  })

  it('keeps the legacy rule for a disabled direct LSP server', async () => {
    // Legacy mode carries no disabled-id switch, so a disabled direct row must stay
    // unavailable rather than being silently authorized.
    const direct = lspEntry({ id: 'direct/ts', suiteId: 'direct', kind: 'direct', serverKey: 'ts', state: 'disabled' })
    const rows = await readExtensionInventory(ports({}, { lsp: [direct] }), {})
    const row = find(rows, 'lsp:direct/ts')!
    expect(row.available).toBe(false)
    expect(row.globalEnabled).toBeUndefined()
  })
})
