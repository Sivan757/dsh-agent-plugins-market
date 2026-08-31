/** Browser-safe market wire records and route constants shared by host and client. */

/** Prefix for all Agent Plugins Market HTTP routes. */
export const MARKET_API_PREFIX = '/api/agent-plugins/' as const

/** Fixed Agent Plugins Market HTTP routes. */
export const MARKET_ROUTES = {
  overview: `${MARKET_API_PREFIX}overview`,
  mcpStatus: `${MARKET_API_PREFIX}mcp-status`,
  lspStatus: `${MARKET_API_PREFIX}lsp-status`,
  lspServers: `${MARKET_API_PREFIX}lsp-servers`,
  progress: `${MARKET_API_PREFIX}progress`,
  config: `${MARKET_API_PREFIX}config`,
  suite: `${MARKET_API_PREFIX}suite`,
  skill: `${MARKET_API_PREFIX}skill`,
  addSource: `${MARKET_API_PREFIX}sources/add`,
  updateSource: `${MARKET_API_PREFIX}sources/update`,
  removeSource: `${MARKET_API_PREFIX}sources/remove`,
  refreshSource: `${MARKET_API_PREFIX}sources/refresh`,
  install: `${MARKET_API_PREFIX}install`,
  uninstall: `${MARKET_API_PREFIX}uninstall`,
  setEnabled: `${MARKET_API_PREFIX}set-enabled`,
  setSurface: `${MARKET_API_PREFIX}set-surface`,
  mcpOverrides: `${MARKET_API_PREFIX}mcp-overrides`,
  setMcpOverride: `${MARKET_API_PREFIX}set-mcp-override`,
  mcpRetry: `${MARKET_API_PREFIX}mcp-retry`
} as const

/** A configured source row returned to the market client. */
export interface SourceOverview {
  id: string
  url: string
  branch?: string
  local?: boolean
  cloned: boolean
  lockCommit?: string
  error?: string
  suiteIds: string[]
}

/** Counts of runtime surfaces displayed on a suite card. */
export interface SuiteSurfaceCounts {
  skills: number
  mcp: number
  hooks: number
  commands: number
  agents: number
  lsp: number
}

/** Effective per-surface enablement of an installed suite. */
export interface SuiteSurfaceToggles {
  skills: boolean
  mcp: boolean
  hooks: boolean
  commands: boolean
  agents: boolean
  lsp: boolean
}

/** One server's persisted MCP override (wire shape mirrors runtime types). */
export type McpServerOverrideWire = {
  enabled?: boolean
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  args?: string[]
}

/** Overrides for one suite keyed by mcp.json server key. */
export type McpSuiteOverridesWire = Record<string, McpServerOverrideWire>

/** A normalized suite card returned by the overview route. */
export interface SuiteOverviewCard {
  sourceId: string
  suiteId: string
  name: string
  version?: string
  description?: string
  keywords: string[]
  surfaces: SuiteSurfaceCounts
  enabled: boolean
  installed: boolean
  /** Per-surface toggles; present on installed suites only. */
  surfaceToggles?: SuiteSurfaceToggles
  dimension: string
  layout: string
  remoteUrl?: string
  errors: string[]
  mcpErrors?: string[]
}

/** The market overview response. */
export interface OverviewPayload {
  sources: SourceOverview[]
  suites: SuiteOverviewCard[]
  totals: { all: number; installed: number; enabled: number }
  roots: { user: string; data: string }
}

/** Host-side progress of the source mutation currently in flight. */
export interface SourceProgress {
  active: boolean
  sourceId: string
  step: string
}

/** One skill's metadata inside a suite detail response. */
export interface SuiteSkillMeta {
  name: string
  description: string
  whenToUse?: string
  path: string
}

/** One command or agent preview in a suite detail response. */
export interface MarkdownPreview {
  name: string
  description?: string
  content: string
}

/** Claude Code command preview alias retained for feature-specific readability. */
export type CommandPreview = MarkdownPreview
/** Claude Code agent preview alias retained for feature-specific readability. */
export type AgentPreview = MarkdownPreview

/** One LSP definition preview in a suite detail response. */
export interface LspPreview {
  name: string
  content: string
}

/** One inline-declared LSP server in a suite detail response. */
export interface LspServerPreview {
  /** Server key from the declaring `lspServers` table. */
  key: string
  command: string
  args: string[]
  /** Lowercase leading-dot extension → LSP language id. */
  extensions: Record<string, string>
  env?: Record<string, string>
}

/** The suite's LSP surface: inline-declared servers plus directory definition files. */
export interface LspSurfaceDetail {
  servers: LspServerPreview[]
  raw: LspPreview[]
}

/** One flattened hook entry in a suite detail response. */
export interface HookPreview {
  event: string
  matcher?: string
  command: string
}

/** One validated MCP server detail in a suite detail response. */
export interface McpServerDetail {
  key: string
  type: string
  command?: string
  url?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  headers?: Record<string, string>
}

/** Full suite detail response served by the detail modal. */
export interface SuiteDetail {
  sourceId: string
  suiteId: string
  name: string
  version: string | null
  description: string | null
  author: string | null
  keywords: string[]
  layout: string
  dimension: string
  root: string
  remoteUrl: string | null
  installed: boolean
  enabled: boolean
  surfaceToggles: SuiteSurfaceToggles | null
  /** Persisted per-server MCP overrides (suite's mcp.json stays source-owned). */
  mcpOverrides?: McpSuiteOverridesWire
  skills: SuiteSkillMeta[]
  mcpServers: McpServerDetail[]
  hooks: { count: number; entries: HookPreview[] }
  commands: MarkdownPreview[]
  agents: MarkdownPreview[]
  lsp: LspSurfaceDetail
  errors: string[]
  mcpErrors: string[]
}

/** One skill's full file text served by the skill route. */
export interface SkillContent {
  name: string
  description: string
  content: string
  path: string
}

/** Build a suite-detail URL without duplicating route or query encoding logic. */
export function suiteRoute(sourceId: string, suiteId: string): string {
  return `${MARKET_ROUTES.suite}?sourceId=${encodeURIComponent(sourceId)}&suiteId=${encodeURIComponent(suiteId)}`
}

/** Build a skill-content URL without duplicating route or query encoding logic. */
export function skillRoute(sourceId: string, suiteId: string, skill: string): string {
  return `${MARKET_ROUTES.skill}?sourceId=${encodeURIComponent(sourceId)}&suiteId=${encodeURIComponent(suiteId)}&skill=${encodeURIComponent(skill)}`
}
