/** Browser-safe market wire records and route constants shared by host and client. */

/** Prefix for all Agent Plugins Market HTTP routes. */
export const MARKET_API_PREFIX = '/api/agent-plugins/' as const

/** Fixed Agent Plugins Market HTTP routes. */
export const MARKET_ROUTES = {
  overview: `${MARKET_API_PREFIX}overview`,
  surfaceToggles: `${MARKET_API_PREFIX}surface-toggles`,
  setSurfaceToggle: `${MARKET_API_PREFIX}surface-toggles/set`,
  mcpStatus: `${MARKET_API_PREFIX}mcp-status`,
  addMcpServer: `${MARKET_API_PREFIX}mcp-servers/add`,
  lspStatus: `${MARKET_API_PREFIX}lsp-status`,
  lspServers: `${MARKET_API_PREFIX}lsp-servers`,
  addLspServer: `${MARKET_API_PREFIX}lsp-servers/add`,
  migrateLspSeam: `${MARKET_API_PREFIX}lsp-servers/migrate-seam`,
  serverConfig: `${MARKET_API_PREFIX}server-config`,
  saveServerConfig: `${MARKET_API_PREFIX}server-config/save`,
  progress: `${MARKET_API_PREFIX}progress`,
  config: `${MARKET_API_PREFIX}config`,
  modelCatalog: `${MARKET_API_PREFIX}model-catalog`,
  suite: `${MARKET_API_PREFIX}suite`,
  /**
   * One suite document's authored text (GET). The query names the suite, the
   * surface, and the document — `{ sourceId, suiteId, kind, name }` — and the
   * body is read server-side when a reader opens the row, so the detail payload
   * never carries a document's bytes.
   */
  suiteDocument: `${MARKET_API_PREFIX}suite/document`,
  /**
   * One suite document's translation (POST). The body names the suite and the
   * document — `{ sourceId, suiteId, kind, name }` — and never carries text, so
   * this is the market detail page's counterpart of
   * {@link userPanelTranslationRoute}: the file is re-read server-side.
   */
  suiteDocumentTranslation: `${MARKET_API_PREFIX}suite/document/translation`,
  addSource: `${MARKET_API_PREFIX}sources/add`,
  updateSource: `${MARKET_API_PREFIX}sources/update`,
  adoptSource: `${MARKET_API_PREFIX}sources/adopt`,
  removeSource: `${MARKET_API_PREFIX}sources/remove`,
  refreshSource: `${MARKET_API_PREFIX}sources/refresh`,
  install: `${MARKET_API_PREFIX}install`,
  uninstall: `${MARKET_API_PREFIX}uninstall`,
  setEnabled: `${MARKET_API_PREFIX}set-enabled`,
  setSurface: `${MARKET_API_PREFIX}set-surface`,
  mcpOverrides: `${MARKET_API_PREFIX}mcp-overrides`,
  setMcpOverride: `${MARKET_API_PREFIX}set-mcp-override`,
  setMcpServerEnabled: `${MARKET_API_PREFIX}set-mcp-server-enabled`,
  setMcpServerTool: `${MARKET_API_PREFIX}set-mcp-server-tool`,
  mcpRetry: `${MARKET_API_PREFIX}mcp-retry`,
  mcpReauthorize: `${MARKET_API_PREFIX}mcp-reauthorize`,
  mcpBackend: `${MARKET_API_PREFIX}mcp-backend`,
  setMcpBackend: `${MARKET_API_PREFIX}set-mcp-backend`,
  userPanel: `${MARKET_API_PREFIX}user-panel`,
  menuRowFaces: `${MARKET_API_PREFIX}menu-row-faces`,
  clearTranslations: `${MARKET_API_PREFIX}translations/clear`
} as const

/** One timeout's three layers: the user's value, the suite declaration, and the value in force. */
export interface ServerTimeoutPolicy {
  /** The user's stored value; null when the user inherits. */
  user: number | null
  /** The suite's declared value; null when the suite declares none. */
  suite: number | null
  /** The value in force. */
  effective: number
  /** Which layer supplied `effective`. */
  source: 'user' | 'suite' | 'default'
}

/** One tool list's layers: what the user stored and what the suite declares. */
export interface ServerToolPolicy {
  /** The user's stored list; null when the user set none. */
  user: string[] | null
  /** The suite's declared list; null when the suite declares none. */
  suite: string[] | null
  /** The list in force. */
  effective: string[]
}

/** The OAuth opt-in's two layers. */
export interface ServerAuthPolicy {
  /** The user's stored value; null when the user set none. */
  user: boolean | null
  /** The suite's declared value; null when the suite declares none. */
  suite: boolean | null
  /** The value in force. */
  effective: boolean
}

/** The MCP per-server client policy as the service editor renders it. */
export interface ServerPolicyPayload {
  /** Per-tool-call timeout. */
  toolCallTimeout: ServerTimeoutPolicy
  /** Startup timeout. */
  startupTimeout: ServerTimeoutPolicy
  /** The tools the service denies. */
  deniedTools: ServerToolPolicy
  /** The OAuth opt-in. */
  auth: ServerAuthPolicy
}

/** Editable service configuration; masked values are preserved when unchanged. */
export interface ServerConfigPayload {
  kind: 'mcp' | 'lsp'
  id: string
  /** The declaration key this service carries, used to compose the document view. */
  key: string
  editable: boolean
  config: Record<string, unknown>
  /** The stored policy and the suite declaration behind it; present for MCP services. */
  policy?: ServerPolicyPayload
  /** The MCP mount backend; `host` cannot enforce startup timeouts or tool filters. */
  backend?: 'builtin' | 'host'
}

/** The policy a service-config save sets (`number`/value) or clears back to inheritance (`null`). */
export interface ServerPolicyRequest {
  toolCallTimeoutMs?: number | null
  startupTimeoutMs?: number | null
  /** The user's deny list; null clears it. The suite's own entries stay in force. */
  disabledTools?: string[] | null
  /** The user's OAuth opt-in; null clears it back to the suite's declaration. */
  auth?: { enabled: boolean } | null
}

/** One rejected value as the API reports it: the field it belongs to and why. */
export interface MarketFieldError {
  field: string
  message: string
}

/** Public model identities and exact-model reasoning options; never provider configuration. */
export interface ModelCatalogPayload {
  providers: Array<{ id: string; name: string }>
  models: Array<{ id: string; name: string }>
  reasoning?: { efforts: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string }
}

/**
 * Mutation routes carry their verb in the path because the host webserver
 * keys its exact table by pathname only — a second registration on the same
 * path throws `duplicate exact route` at mount. The read route keeps the
 * bare panel path; every write gets a distinct segment below it.
 */
export type UserPanelMutation = 'create' | 'update' | 'delete'

/** Build one user-panel list route URL (`GET`, no mutation). */
export function userPanelRoute(kind: UserPanelKind): string {
  return `${MARKET_ROUTES.userPanel}/${kind}`
}

/**
 * Build the document-translation route URL for one panel's entries (POST).
 *
 * It sits under the entry segment because it translates one entry's document,
 * and it is a POST because it queues provider work — the entry it names is the
 * only input, and the server re-reads that entry rather than trusting text
 * from the page.
 */
export function userPanelTranslationRoute(kind: UserPanelKind): string {
  return `${userPanelRoute(kind)}/entry/translation`
}

/** Build one user-panel mutation route URL (all POSTs). */
export function userPanelMutationRoute(kind: UserPanelKind, mutation: UserPanelMutation, name?: string): string {
  const base = `${userPanelRoute(kind)}/${mutation}`
  return name === undefined ? base : `${base}?name=${encodeURIComponent(name)}`
}

/** The MCP mount backend state reported to the settings page. */
export type McpBackendInfo = {
  backend: 'builtin' | 'host'
  /** Whether the host `dsh-mcp-client` resolves from the plugin context. */
  hostClient: { available: boolean; version?: string }
  /** Download region: the persisted setting and its locale-resolved route. */
  downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
}

/** One unmanaged `.sources/` checkout the user can adopt as a source. */
export interface UnmanagedSource {
  id: string
  /** The checkout's `origin` remote URL; absent for non-git directories. */
  url?: string
}

/** A configured source row returned to the market client. */
export interface SourceOverview {
  id: string
  url: string
  branch?: string
  local?: boolean
  /** Acquisition kind (`git` / `local` / `archive`); `local` mirrors the legacy flag. */
  kind: string
  /** The checkout pre-existed (manually cloned or adopted); never deleted on removal. */
  adopted?: boolean
  cloned: boolean
  lockCommit?: string
  error?: string
  /** Scanner diagnostics for this source (dropped entries, fallbacks taken);
   *  absent when the scan completed with no notes. */
  scanNotes?: string[]
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
  toolCallTimeoutMs?: number
  startupTimeoutMs?: number
  disabledTools?: string[]
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
  /** The description translated for the panel's locale; absent means render `description`. */
  translatedDescription?: string
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
  /** Unmanaged `.sources/` checkouts (manual clones) available for adoption. */
  unmanaged?: UnmanagedSource[]
  /**
   * Translatable chunks still waiting for a translation, absent or 0 when none
   * are. One chunk counts once, so a card contributes one per chunk of its
   * description still in flight. The panel re-reads while this is non-zero so a
   * translated card replaces the original text without a manual refresh.
   */
  translationPending?: number
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

/**
 * One command or agent as the suite detail payload carries it: the identity its
 * row renders, never the body. The text is a separate read, made when a reader
 * opens that row.
 */
export interface SuiteDocumentMeta {
  name: string
  /** The document's frontmatter `description`, when it declares one. */
  description?: string
}

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
  /** External credential references used by env/header/argument placeholders. */
  credentialRefs: string[]
}

/** Full suite detail response served by the detail modal. */
export interface SuiteDetail {
  sourceId: string
  suiteId: string
  name: string
  version: string | null
  description: string | null
  /** The description translated for the panel's locale; absent means render `description`. */
  translatedDescription?: string
  author: string | null
  keywords: string[]
  /** Last modification of the suite checkout, as an ISO timestamp; null when it cannot be read. */
  updatedAt: string | null
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
  commands: SuiteDocumentMeta[]
  agents: SuiteDocumentMeta[]
  lsp: LspSurfaceDetail
  errors: string[]
  mcpErrors: string[]
}

/** One document's full authored text, served by the suite document route. */
export interface SuiteDocumentText {
  name: string
  content: string
}

/** A user panel entry (skills / commands / agent personas) over HTTP. */
export interface UserPanelEntryWire {
  /**
   * Entry name: the name its document declares, else its document name — the
   * file's base name, or, on a panel that reads subdirectories, the document's
   * path relative to the panel directory (`git/commit`).
   */
  name: string
  description: string
  /** The description translated for the panel's locale; absent means render `description`. */
  translatedDescription?: string
  disabled: boolean
  /** User entries are editable; suite-owned plugin entries answer only to the enable switch. */
  origin: 'user' | 'plugin'
  id?: string
  /**
   * The document's own text, exactly as authored. The list read omits it — it
   * was the bulk of the response and the client fetches the one entry it opens
   * — while the single-entry read and the raw user store always carry it.
   */
  rawText?: string
  /** Human-readable suite owner for a plugin-provided entry. */
  suiteName?: string
  metadata: Record<string, unknown>
  path: string
  /** The entry file's last modification, as an ISO timestamp. */
  updatedAt?: string | null
  /**
   * Frontmatter-stripped body. Supplied by the raw user store, which needs it
   * for a command's payload; the panel view deliberately omits it, because the
   * client renders `rawText` and sending both shipped the same document twice.
   */
  content?: string
  /** Suite checkout root of a plugin-provided file; runtime consumers resolve `${PLUGIN_ROOT}` against it. */
  suiteRoot?: string
  /** The suite's `${PLUGIN_DATA}` directory, for the same runtime resolution. */
  suiteData?: string
}

/** The `/` menu groups whose rows this plugin owns. */
export type MenuRowSource = 'commands' | 'skills'

/**
 * One localized `/` menu row face over HTTP.
 *
 * The row's identity fields never travel: the client matches on `source` +
 * `name` and the host row supplies everything else. Only the description is
 * translated — a name is an identifier the user types and matches against
 * upstream documentation, so no field here can override the host's title.
 */
export interface MenuRowFaceWire {
  /** Which menu group the row belongs to: the slash-command group or the skill group. */
  source: MenuRowSource
  /** Command call name or skill name, exactly as the menu row carries it. */
  name: string
  /** Translated description; absent when nothing was translated. */
  description?: string
}

/** The user panel surface the market exposes. */
export type UserPanelKind = 'skills' | 'commands' | 'agents'

/** Build a suite-detail URL without duplicating route or query encoding logic. */
export function suiteRoute(sourceId: string, suiteId: string): string {
  return `${MARKET_ROUTES.suite}?sourceId=${encodeURIComponent(sourceId)}&suiteId=${encodeURIComponent(suiteId)}`
}

/** Build a suite-document URL without duplicating route or query encoding logic. */
export function documentRoute(sourceId: string, suiteId: string, kind: UserPanelKind, name: string): string {
  return `${MARKET_ROUTES.suiteDocument}?sourceId=${encodeURIComponent(sourceId)}&suiteId=${encodeURIComponent(suiteId)}&kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`
}
