/** Narrow application interfaces consumed by the HTTP transport adapter. */
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { OverviewPayload, SkillContent, SourceProgress, SuiteDetail } from '../contracts/market.js'
import type { SourceRef, SuiteSurfaceKey } from '../model/types.js'
import type { McpServerOverride, McpSuiteOverrides } from '../runtime/mcp-overrides.js'
import type { HostMcpClientProbe, McpBackend } from '../runtime/mcp-backend.js'

/** Read-only market operations required by HTTP routes. */
export interface MarketQueries {
  readonly sources: SourceRef[]
  overview(): Promise<OverviewPayload>
  mcpStatus(): Promise<McpStatusPayload>
  lspStatus(): Promise<LspStatusPayload>
  lspServers(): Promise<Record<string, import('../model/types.js').LspServerSpec>>
  sourceProgress(): SourceProgress
  suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail>
  skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent>
  mcpOverrides(suiteId: string): Promise<McpSuiteOverrides>
}

/** Mutating market operations required by HTTP routes. */
export interface MarketMutations {
  addSource(input: { url: string; branch?: string; local?: boolean; kind?: 'git' | 'local' | 'archive'; sha256?: string }): Promise<SourceRef>
  updateSource(sourceId: string, patch: { url?: string; branch?: string; local?: boolean; kind?: 'git' | 'local' | 'archive'; sha256?: string }): Promise<void>
  removeSource(sourceId: string): Promise<void>
  /** Register an unmanaged `.sources/` checkout in place (manual-clone repair). */
  adoptSource(id: string): Promise<SourceRef>
  refreshSource(sourceId?: string): Promise<void>
  install(sourceId: string, suiteId: string): Promise<void>
  uninstall(sourceId: string, suiteId: string): Promise<void>
  setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void>
  setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void>
  setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void>
  /** Validate and persist the user's direct LSP server table. */
  setLspServers(raw: unknown): Promise<Record<string, import('../model/types.js').LspServerSpec>>
  /** Re-run the MCP reconcile pass: retries failed mounts and clears residual tools. */
  retryMounts(): Promise<void>
  reauthorizeMcpServer(serverName: string): Promise<void>
  mcpReauthorizeAvailable(): boolean
  /** The active MCP backend, host-client probe, and download region. */
  mcpBackendInfo(): Promise<{
    backend: McpBackend
    hostClient: HostMcpClientProbe
    downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
  }>
  /** Switch the MCP mount backend and remount every suite server through it. */
  setMcpBackend(backend: McpBackend): Promise<void>
}

/** Complete application surface required by the HTTP routes. */
export type MarketService = MarketQueries & MarketMutations
