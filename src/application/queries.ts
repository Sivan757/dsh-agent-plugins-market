/** Narrow application interfaces consumed by the HTTP transport adapter. */
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { OverviewPayload, SkillContent, SourceProgress, SuiteDetail } from '../contracts/market.js'
import type { SourceRef, SuiteSurfaceKey } from '../model/types.js'
import type { McpServerOverride, McpSuiteOverrides } from '../runtime/mcp-overrides.js'

/** Read-only market operations required by HTTP routes. */
export interface MarketQueries {
  readonly sources: SourceRef[]
  overview(): Promise<OverviewPayload>
  mcpStatus(): Promise<McpStatusPayload>
  sourceProgress(): SourceProgress
  suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail>
  skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent>
  mcpOverrides(suiteId: string): Promise<McpSuiteOverrides>
}

/** Mutating market operations required by HTTP routes. */
export interface MarketMutations {
  addSource(input: { url: string; branch?: string; local?: boolean }): Promise<SourceRef>
  updateSource(sourceId: string, patch: { url?: string; branch?: string; local?: boolean }): Promise<void>
  removeSource(sourceId: string): Promise<void>
  refreshSource(sourceId?: string): Promise<void>
  install(sourceId: string, suiteId: string): Promise<void>
  uninstall(sourceId: string, suiteId: string): Promise<void>
  setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void>
  setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void>
  setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void>
}

/** Complete application surface required by the HTTP routes. */
export type MarketService = MarketQueries & MarketMutations
