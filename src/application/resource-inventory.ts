/**
 * The project resource window's installed inventory.
 *
 * One aggregation over the data planes that already exist — the market
 * overview (installed suites), the three user panels (skills, commands,
 * agents), the MCP status surface, and the LSP status surface — assembled
 * here into the row shape the window renders. No second scan pipeline runs:
 * every row cites the source of truth that already feeds the settings panels,
 * and the per-entry enable flags come from the workspace filter state.
 *
 * @module application/resource-inventory
 */
import type { Catalog } from './catalog.js'
import type { PanelResourceStore } from './panel-resources.js'
import type { ResourceEntryWire, ResourceFace, ResourceFavoriteWire, ResourceWindowPayload } from '../contracts/resource-window.js'
import type { ResourceFilters } from './state/resource-filters.js'
import type { UserPanelKind } from '../contracts/market.js'

/** Structural catalog surface the inventory reads. */
interface InventoryCatalog {
  overview(): Promise<import('../contracts/market.js').OverviewPayload>
  mcpStatus(): Promise<import('../contracts/mcp-status.js').McpStatusPayload>
  lspStatus(): Promise<import('../contracts/lsp-status.js').LspStatusPayload>
}

/** Structural filter state the inventory reads (implemented by the runtime service). */
export interface InventoryFilterSource {
  currentFilters(): ResourceFilters
  favorites(): Promise<ResourceFavoriteWire[]>
}

/** The stores and services one inventory read needs. */
export interface ResourceInventoryDeps {
  catalog: InventoryCatalog | Catalog
  panels: { skills: PanelResourceStore; commands: PanelResourceStore; agents: PanelResourceStore }
  filters: InventoryFilterSource
  /** The workspace label the header chip shows; defaults to the process cwd. */
  workspace?: string
}

const PANEL_FACE: Record<UserPanelKind, ResourceFace> = { skills: 'skills', commands: 'commands', agents: 'agents' }

/** Build one window payload from the live stores. */
export async function buildResourceWindow(deps: ResourceInventoryDeps): Promise<ResourceWindowPayload> {
  const [overview, mcp, lsp, skills, commands, agents, favorites] = await Promise.all([
    deps.catalog.overview(),
    deps.catalog.mcpStatus(),
    deps.catalog.lspStatus(),
    deps.panels.skills.list(),
    deps.panels.commands.list(),
    deps.panels.agents.list(),
    deps.filters.favorites()
  ])
  const filters = deps.filters.currentFilters()
  // The row state is the conjunction of the two levels: the user-level
  // (global) state the settings pages control, and this workspace's own
  // filter. The window mirrors global while it follows it and can only
  // filter further, never re-enable what the user level turned off.
  const enabled = (face: ResourceFace, entryId: string): boolean => !(filters.offEntries[face]?.includes(entryId) ?? false)

  const entries: ResourceEntryWire[] = []

  // Market tab: installed suites (user dimension), one row per suite.
  for (const suite of overview.suites) {
    if (!suite.installed || suite.dimension !== 'user') continue
    const id = `market:${suite.sourceId}/${suite.suiteId}`
    entries.push({
      id,
      face: 'market',
      name: suite.name,
      ...(suite.version === undefined ? {} : { version: suite.version }),
      source: suite.sourceId,
      description: suite.description,
      counts: [
        { label: 'skills', count: suite.surfaces.skills },
        { label: 'mcp', count: suite.surfaces.mcp },
        { label: 'hooks', count: suite.surfaces.hooks },
        { label: 'commands', count: suite.surfaces.commands },
        { label: 'agents', count: suite.surfaces.agents },
        { label: 'lsp', count: suite.surfaces.lsp }
      ].filter(count => count.count > 0),
      enabled: enabled('market', id) && suite.enabled !== false,
      ...(suite.enabled === false ? { globalDisabled: true } : {})
    })
  }

  // Panel faces: user entries plus suite-provided entries, one row each.
  const panelRows = (kind: UserPanelKind, rows: Awaited<ReturnType<PanelResourceStore['list']>>): void => {
    for (const entry of rows) {
      const id = `${PANEL_FACE[kind]}:${entry.origin === 'plugin' ? (entry.id ?? entry.name) : entry.name}`
      const duplicate = entries.some(existing => existing.id === id)
      if (duplicate) continue
      entries.push({
        id,
        face: PANEL_FACE[kind],
        name: entry.name,
        source: entry.origin === 'plugin' ? (entry.suiteName ?? 'plugin') : 'user',
        description: entry.description,
        enabled: enabled(PANEL_FACE[kind], id) && !entry.disabled,
        ...(entry.disabled === true ? { globalDisabled: true } : {})
      })
    }
  }
  panelRows('skills', skills)
  panelRows('commands', commands)
  panelRows('agents', agents)

  // MCP tab: every row the status surface reports (suite and direct).
  for (const row of mcp.entries) {
    const id = `mcp:${row.name}`
    entries.push({
      id,
      face: 'mcp',
      name: row.name,
      source: row.source ?? 'direct',
      description: row.transport,
      enabled: enabled('mcp', id) && row.state !== 'disabled',
      ...(row.state === 'disabled' ? { globalDisabled: true } : {})
    })
  }

  // LSP tab: every row the LSP status surface reports (suite and direct).
  for (const row of lsp.entries) {
    const id = `lsp:${row.id}`
    entries.push({
      id,
      face: 'lsp',
      name: row.serverKey,
      source: row.kind === 'direct' ? 'direct' : row.suiteName,
      description: row.command,
      enabled: enabled('lsp', id) && row.state !== 'disabled',
      ...(row.state === 'disabled' ? { globalDisabled: true } : {})
    })
  }

  return {
    workspace: deps.workspace ?? process.cwd(),
    entries,
    favorites
  }
}
