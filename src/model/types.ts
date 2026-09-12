/**
 * Shared shapes for the dsh-agent-plugins-market Agent Plugins manager.
 *
 * A suite is the portable Agent Plugins package defined by the
 * agent-plugins.org v1.0.0 specification, plus the two dialect layouts this
 * manager normalizes as inputs (Claude Code `.claude-plugin/plugin.json` and
 * Codex `.codex-plugin/plugin.json`). Discovery maps every layout onto this
 * internal shape; runtime injection consumes only the internal shape.
 */

/** How a source's content is acquired. */
export type SourceKind = 'git' | 'local' | 'archive'

/** One configured repository source. */
export interface SourceRef {
  /** Stable local id; `[a-z0-9][a-z0-9-]*`, unique across sources. */
  id: string
  /** Git URL, archive (zip / tar.gz) URL, or a local directory path. */
  url: string
  /** Optional branch to pin (git sources only). */
  branch?: string
  /** Read the source directory directly instead of cloning it (legacy flag; `kind: 'local'`). */
  local?: boolean
  /** Acquisition kind; inferred from the URL shape when omitted. */
  kind?: SourceKind
  /** Expected SHA-256 of an archive download (archive sources only). */
  sha256?: string
  /** The checkout pre-existed (manually cloned or adopted); never deleted on source removal. */
  adopted?: boolean
}

/**
 * Archive URL suffixes with the payload kind each names, longest suffix first
 * so `.tar.gz` wins over `.tar`. Source-kind inference, source-id derivation,
 * and archive extraction all read this one table.
 */
export const ARCHIVE_SUFFIXES = [
  ['.tar.gz', 'targz'],
  ['.tgz', 'targz'],
  ['.zip', 'zip'],
  ['.tar', 'tar']
] as const

/** Payload kind of an archive source. */
export type ArchiveFormat = (typeof ARCHIVE_SUFFIXES)[number][1]

/** The archive suffix `url` ends with, or undefined when it names no known payload. */
function matchArchiveSuffix(url: string): (typeof ARCHIVE_SUFFIXES)[number] | undefined {
  const clean = url.trim().toLowerCase()
  return ARCHIVE_SUFFIXES.find(([suffix]) => clean.endsWith(suffix))
}

/** Classify an archive URL by extension; undefined when unsupported. */
export function archiveFormatOf(url: string): ArchiveFormat | undefined {
  return matchArchiveSuffix(url)?.[1]
}

/** Whether a URL points at a downloadable archive. */
export function isArchiveUrl(url: string): boolean {
  return matchArchiveSuffix(url) !== undefined
}

/** Drop a trailing archive suffix (`plugin-0.1.zip` → `plugin-0.1`); other values pass through. */
export function stripArchiveSuffix(value: string): string {
  const suffix = matchArchiveSuffix(value)?.[0]
  return suffix === undefined ? value : value.slice(0, -suffix.length)
}

/**
 * Effective acquisition kind of a source: the explicit `kind` wins, the
 * legacy `local` flag maps to `'local'`, archive-shaped URLs infer
 * `'archive'`, and everything else stays `'git'`.
 */
export function resolveSourceKind(source: Pick<SourceRef, 'url' | 'local' | 'kind'>): SourceKind {
  if (source.local === true || source.kind === 'local') return 'local'
  if (source.kind === 'git' || source.kind === 'archive') return source.kind
  return isArchiveUrl(source.url) ? 'archive' : 'git'
}

/** The manifest layout a suite root was discovered under. */
export type SuiteLayoutKind = import('./layouts.js').ManifestKind | 'skill-collection' | 'remote' | 'project-native'

/** Normalized suite manifest fields. */
export interface SuiteManifest {
  components?: SuiteComponents
  skillInstructions?: string
  startupSkill?: string
  systemPrompt?: string
  systemPromptPath?: string
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

/** Raw layout declarations are resolved once by the catalog into runtime resources. */
export interface SuiteComponents {
  skills?: unknown
  commands?: unknown
  agents?: unknown
  hooks?: unknown
  mcpServers?: unknown
  lspServers?: unknown
}

export interface SuiteMarkdownResource {
  name: string
  file: string
  /** Inline resources retain their manifest as provenance, with content separate from its JSON file. */
  content?: string
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
export interface McpServerPolicy {
  enabledTools?: string[]
  disabledTools?: string[]
  startupTimeoutMs?: number
  toolCallTimeoutMs?: number
}

export interface McpServerStdio extends McpServerPolicy {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpServerStreamableHttp extends McpServerPolicy {
  type: 'streamable-http'
  url: string
  headers?: Record<string, string>
  /** Opt in to OAuth 2.1 authorization for servers that answer `401` with a challenge (on by default; `enabled: false` opts out). */
  auth?: { enabled: boolean; scope?: string }
}

export interface McpServerSse extends McpServerPolicy {
  type: 'sse'
  url: string
  headers?: Record<string, string>
  /** OAuth 2.1 authorization, mirroring the streamable-http semantics. */
  auth?: { enabled: boolean; scope?: string }
}

export type McpServer = McpServerStdio | McpServerStreamableHttp | McpServerSse

/** Parsed and validated `mcp.json` content. */
export interface McpSuiteConfig {
  /** Native project commands resolve from the project, not the agent configuration directory. */
  root?: string
  schema: string
  servers: Record<string, McpServer>
}

/** One normalized inline LSP server declaration (`lspServers` table entry). */
export interface LspServerSpec {
  /** Server key from the declaring table (e.g. `typescript`). */
  key: string
  /** Executable to spawn (resolved on PATH by the LSP host). */
  command: string
  /** Arguments passed to the executable. Default `[]`. */
  args: string[]
  /** Lowercase leading-dot extension → LSP language id. */
  extensionToLanguage: Record<string, string>
  /** Extra env vars merged over the ambient env. */
  env?: Record<string, string>
  /** Static `initialize` options forwarded to the server. */
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. */
  configuration?: unknown
}

/** Parsed inline `lspServers` declarations of one suite. */
export interface LspSuiteConfig {
  servers: Record<string, LspServerSpec>
}

/** Install dimension of a suite. */
export type SuiteDimension = 'user' | 'project'

/** One discovered suite with runtime-relevant fields resolved. */
export interface Suite {
  resources?: { commands: SuiteMarkdownResource[]; agents: SuiteMarkdownResource[] }
  systemPrompt?: string
  /** Validated native settings hooks; serialized only into a runtime-owned temporary file. */
  hooks?: ProjectHooks
  sourceId: string
  id: string
  root: string
  manifest: SuiteManifest
  skills: SuiteSkill[]
  /** Validated mcp.json content; absent when the file is missing or invalid. */
  mcp?: McpSuiteConfig
  /** Parsed inline `lspServers` declarations; absent when the suite declares none. */
  lsp?: LspSuiteConfig
  surfaces: SuiteSurfaceCounts
  dimension: SuiteDimension
  enabled: boolean
  /** Effective per-surface enablement (overrides merged over enabled defaults). */
  activeSurfaces?: Record<SuiteSurfaceKey, boolean>
  lockCommit?: string
  installedAt?: string
  /** Remote marketplace reference (not cloned): the source URL plus the
   *  marketplace entry metadata; no local content is available. */
  remote?: { url: string }
  /** Surface diagnostics on a surviving suite; invalid declared manifests are rejected before discovery returns a suite. */
  errors: string[]
}

export interface ProjectHooks {
  projectRoot: string
  events: Record<string, Array<{ matcher?: string; hooks: Array<{ type: 'command'; command: string; timeout?: number }> }>>
}

/** Runtime surfaces that can be selectively enabled per installed suite. */
export type SuiteSurfaceKey = 'skills' | 'mcp' | 'hooks' | 'commands' | 'agents' | 'lsp'

/** Per-surface user overrides; absent keys default to enabled. */
export type SurfaceOverrides = Partial<Record<SuiteSurfaceKey, boolean>>

/** The full set of toggleable surfaces, in display order. */
export const SUITE_SURFACE_KEYS: readonly SuiteSurfaceKey[] = ['skills', 'mcp', 'hooks', 'commands', 'agents', 'lsp']

/** Merge user overrides over the enabled default into the effective surface set. */
export function effectiveSurfaces(overrides: SurfaceOverrides | undefined): Record<SuiteSurfaceKey, boolean> {
  return {
    skills: overrides?.skills !== false,
    mcp: overrides?.mcp !== false,
    hooks: overrides?.hooks !== false,
    commands: overrides?.commands !== false,
    agents: overrides?.agents !== false,
    lsp: overrides?.lsp !== false
  }
}

/** Persisted install entry, keyed `${sourceId}/${suiteId}`. */
export interface InstalledEntry {
  enabled: boolean
  lockCommit?: string
  installedAt: string
  /** Per-surface enable overrides; absent keys default to enabled. */
  surfaces?: SurfaceOverrides
}

/** The persisted suite state file (`<dimensionRoot>/state.json`). */
export interface SuiteState {
  version: 1
  sources: SourceRef[]
  installed: Record<string, InstalledEntry>
}
