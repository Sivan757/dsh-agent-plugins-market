/** Narrow application interfaces consumed by the HTTP transport adapter. */
import type { McpStatusPayload } from './mcp/mcp-status.js'
import type { LspLegacySeamMigration, LspStatusPayload } from '../contracts/lsp-status.js'
import type { OverviewPayload, SkillContent, SourceProgress, SuiteDetail } from '../contracts/market.js'
import type { SourceRef, SuiteSurfaceKey } from '../model/types.js'
import type { McpServerOverride, McpSuiteOverrides } from './mcp/mcp-overrides.js'
import type { McpBackend } from '../contracts/mcp.js'
import type { McpImportResult } from './mcp/mcp-direct-config.js'
import type { ServerConfigPayload } from '../contracts/market.js'
import type { LspServerTable, McpBackendInfo, SourceInput, SourcePatch } from './ports.js'

/** Read-only market operations required by HTTP routes. */
export interface MarketQueries {
  serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload>
  readonly sources: SourceRef[]
  overview(): Promise<OverviewPayload>
  mcpStatus(): Promise<McpStatusPayload>
  lspStatus(): Promise<LspStatusPayload>
  lspServers(): Promise<LspServerTable>
  sourceProgress(): SourceProgress
  suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail>
  skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent>
  mcpOverrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides>
}

/** Mutating market operations required by HTTP routes. */
export interface MarketMutations {
  saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: unknown, policy?: unknown): Promise<void>
  addMcpServer(name: string, server: unknown): Promise<void>
  /** Import several pasted services in one write; each entry reports its own outcome. */
  importMcpServers(servers: unknown, overwrite: boolean): Promise<McpImportResult>
  addLspServer(name: string, config: unknown): Promise<void>
  addSource(input: SourceInput): Promise<SourceRef>
  updateSource(sourceId: string, patch: SourcePatch): Promise<void>
  /**
   * Remove a source registration; `deleteCheckout` also physically deletes
   * its managed `.sources/<id>` checkout. External local paths are never deleted.
   */
  removeSource(sourceId: string, deleteCheckout?: boolean): Promise<void>
  /** Register an unmanaged `.sources/` checkout in place (manual-clone repair). */
  adoptSource(id: string): Promise<SourceRef>
  refreshSource(sourceId?: string): Promise<void>
  install(sourceId: string, suiteId: string): Promise<void>
  uninstall(sourceId: string, suiteId: string): Promise<void>
  setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void>
  setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void>
  setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void>
  /** Enable or disable one declared MCP server by its source-qualified suite id. */
  setMcpServerEnabled(suiteKey: string, serverKey: string, enabled: boolean): Promise<void>
  /** Allow or deny one tool of a declared MCP server by its source-qualified suite id. */
  setMcpServerToolEnabled(suiteKey: string, serverKey: string, tool: string, enabled: boolean): Promise<void>
  /** Validate and persist the user's direct LSP server table. */
  setLspServers(raw: unknown): Promise<LspServerTable>
  setLspServerEnabled(id: string, enabled: boolean): Promise<void>
  /**
   * Remove the hand-written profile layer an earlier release told the user to
   * add for LSP; it now registers a seam this plugin owns.
   */
  migrateLegacyLspSeam(profile: string): Promise<LspLegacySeamMigration>
  /** Re-run the MCP reconcile pass: retries failed mounts and clears residual tools. */
  retryMounts(): Promise<void>
  reauthorizeMcpServer(serverName: string): Promise<void>
  mcpReauthorizeAvailable(): boolean
  /** The active MCP backend, host-client probe, and download region. */
  mcpBackendInfo(): Promise<McpBackendInfo>
  /** Switch the MCP mount backend and remount every suite server through it. */
  setMcpBackend(backend: McpBackend): Promise<void>
  /**
   * Panel change hook: the HTTP layer notifies after a user-panel mutation
   * (skills / commands / agent personas) so the runtime remounts commands
   * and the skill providers re-read their catalogs.
   */
  notifyPanelsChanged(): Promise<void>
}

/** Complete application surface required by the HTTP routes. */
export type MarketService = MarketQueries & MarketMutations
