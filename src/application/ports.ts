/**
 * The host seams a catalog consumes, in one declared place.
 *
 * Every seam is read at call time rather than captured at construction: the
 * credentials, tools and settings services resolve *after* `apply()` returns,
 * so a value snapshotted when the catalog is built would stay undefined for
 * the rest of the process. A composition root wires the seams it has;
 * {@link resolveCatalogPorts} fills in the rest from
 * {@link defaultCatalogPorts}, which keeps a bare `new Catalog({...})` — the
 * shape the tests build — fully functional.
 */
import type { LspServerSpec, SourceKind } from '../model/types.js'
import type { HostMcpClientProbe, McpBackend } from '../runtime/mcp-backend.js'
import type { LspMountStatusSource } from '../runtime/lsp-status.js'
import type { McpToolSnapshot } from '../runtime/mcp-status.js'
import type { DownloadRegionSetting, EffectiveRegion } from '../runtime/regions.js'

/** A new source: its location, optional branch, and acquisition kind. */
export interface SourceInput {
  url: string
  branch?: string
  local?: boolean
  kind?: SourceKind
  sha256?: string
}

/** A partial source update; omitted fields keep their persisted value. */
export interface SourcePatch {
  url?: string
  branch?: string
  local?: boolean
  kind?: SourceKind
  sha256?: string
}

/** The user's direct LSP server table, keyed by server name. */
export type LspServerTable = Record<string, LspServerSpec>

/** The MCP backend block the plugin-config card renders. */
export type McpBackendInfo = {
  backend: McpBackend
  hostClient: HostMcpClientProbe
  downloadRegion: { setting: DownloadRegionSetting; effective: EffectiveRegion }
}

/** Credential-store seam backing the MCP re-authorize action. */
export interface CredentialGrantStore {
  deleteGrantRecord(serverName: string): Promise<void>
}

/** The complete set of host seams a catalog needs; every member is resolved. */
export interface CatalogPorts {
  /** Live host MCP tool registry snapshot for the status surface. */
  mcpToolSnapshot(): readonly McpToolSnapshot[]
  /** Absent when the credentials service is not mounted in this composition. */
  credentialsStore: CredentialGrantStore | undefined
  /** Flags one mount key for an explicit rebuild on the next reconcile. */
  mcpRemount(suiteId: string, serverKey: string): void
  /** Resolves the mount key owning one derived serverName; undefined when not mounted. */
  mcpServerOwner(serverName: string): { suiteId: string; serverKey: string } | undefined
  /** Latest LSP mount diagnostics. */
  lspStatusSource: LspMountStatusSource
  /** The persisted MCP mount backend choice. */
  mcpBackend(): Promise<McpBackend>
  /** Persists an MCP mount backend choice. */
  setMcpBackend(backend: McpBackend): Promise<void>
  /** The persisted download-region setting. */
  downloadRegion(): Promise<DownloadRegionSetting>
}

/** The seams a composition root may wire; the rest fall back to the defaults. */
export type CatalogPortsOverride = Partial<CatalogPorts>

/**
 * The seams a catalog runs on when nothing is wired. The MCP backend writer
 * rejects rather than silently accepting a choice nothing can persist.
 */
export const defaultCatalogPorts: CatalogPorts = {
  mcpToolSnapshot: () => [],
  credentialsStore: undefined,
  mcpRemount: () => {},
  mcpServerOwner: () => undefined,
  lspStatusSource: { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => false },
  mcpBackend: async () => 'builtin',
  setMcpBackend: async () => {
    throw new Error('the settings service is not mounted')
  },
  downloadRegion: async () => 'auto'
}

/** Fill in every seam the composition root left unwired. */
export function resolveCatalogPorts(overrides: CatalogPortsOverride = {}): CatalogPorts {
  return { ...defaultCatalogPorts, ...overrides }
}
