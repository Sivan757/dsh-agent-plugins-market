/**
 * Shared shapes for the dsh-agent-plugins-market Agent Plugins manager.
 *
 * A suite is the portable Agent Plugins package defined by the
 * agent-plugins.org v1.0.0 specification, plus the two dialect layouts this
 * manager normalizes as inputs (Claude Code `.claude-plugin/plugin.json` and
 * Codex `.codex-plugin/plugin.json`). Discovery maps every layout onto this
 * internal shape; runtime injection consumes only the internal shape.
 */

/** One configured repository source. */
export interface SourceRef {
  /** Stable local id; `[a-z0-9][a-z0-9-]*`, unique across sources. */
  id: string
  /** Git URL to clone, or a local directory path when `local` is set. */
  url: string
  /** Optional branch to pin (git sources only). */
  branch?: string
  /** Read the source directory directly instead of cloning it. */
  local?: boolean
}

/** The manifest layout a suite root was discovered under. */
export type SuiteLayoutKind = 'agent-plugin-v1' | 'universal' | 'claude-code' | 'cursor' | 'kimi' | 'codex' | 'skill-collection' | 'remote' | 'project-native'

/** Normalized suite manifest fields. */
export interface SuiteManifest {
  layout: SuiteLayoutKind
  /** Absolute manifest file path. */
  path: string
  /** Suite id derived from the manifest name or its root directory, sanitized to `[a-z0-9-]`. */
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  keywords?: string[]
  /** For agent-plugin-v1: the recognized `$schema` identifier. */
  schemaVersion?: string
}

/** One skill shipped inside a suite (`<suiteRoot>/skills/<name>/SKILL.md`). */
export interface SuiteSkill {
  /** Skill directory name; validated kebab-case. */
  name: string
  /** Absolute skill directory. */
  directory: string
  /** Absolute SKILL.md path. */
  file: string
  /** Frontmatter description, required for model catalogs. */
  description: string
  /** Optional extra routing guidance from frontmatter. */
  whenToUse?: string
  /** Invocation policy parsed from frontmatter with fail-closed semantics. */
  invocation: { modelInvocable: boolean; userInvocable: boolean }
}

/** Counted surface tags rendered on market cards. */
export interface SuiteSurfaceCounts {
  skills: number
  mcp: number
  hooks: number
  commands: number
  agents: number
  lsp: number
}

/** agent-plugins.org v1 `mcp.json` server variants. */
export interface McpServerStdio {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpServerStreamableHttp {
  type: 'streamable-http'
  url: string
  headers?: Record<string, string>
}

export interface McpServerSse {
  type: 'sse'
  url: string
  headers?: Record<string, string>
}

export type McpServer = McpServerStdio | McpServerStreamableHttp | McpServerSse

/** Parsed and validated `mcp.json` content. */
export interface McpSuiteConfig {
  schema: string
  servers: Record<string, McpServer>
}

/** Install dimension of a suite. */
export type SuiteDimension = 'user' | 'project'

/** One discovered suite with runtime-relevant fields resolved. */
export interface Suite {
  sourceId: string
  id: string
  root: string
  manifest: SuiteManifest
  skills: SuiteSkill[]
  /** Validated mcp.json content; absent when the file is missing or invalid. */
  mcp?: McpSuiteConfig
  surfaces: SuiteSurfaceCounts
  dimension: SuiteDimension
  enabled: boolean
  lockCommit?: string
  installedAt?: string
  /** Remote marketplace reference (not cloned): the source URL plus the
   *  marketplace entry metadata; no local content is available. */
  remote?: { url: string }
  /** Discovery/validation failures for this suite; skills of a suite with a
   * broken manifest are still exposed when they parse, per spec §7.1. */
  errors: string[]
}

/** Persisted install entry, keyed `${sourceId}/${suiteId}`. */
export interface InstalledEntry {
  enabled: boolean
  lockCommit?: string
  installedAt: string
}

/** The persisted suite state file (`<dimensionRoot>/state.json`). */
export interface SuiteState {
  version: 1
  sources: SourceRef[]
  installed: Record<string, InstalledEntry>
}

/** Browser-safe market records are shared from the transport contracts. */
export type { OverviewPayload, SourceOverview, SuiteOverviewCard } from '../contracts/market.js'
