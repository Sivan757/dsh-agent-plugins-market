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
import type { MenuRowSource } from '../contracts/market.js'
export type { McpBackendInfo } from '../contracts/market.js'
import type { DownloadRegionSetting } from '../contracts/settings.js'
import type { McpBackend } from '../contracts/mcp.js'
import type { LspMountDiagnostic } from '../contracts/lsp.js'
import type { DocumentTranslation, TranslationFields, TranslationSurfaceKind } from '../contracts/translation.js'
import type { TranslationProvider } from './translation/chain.js'

/**
 * One localization read: the fields resolved now, and how many of them this
 * read queued and has not seen land yet. A surface reports the count so its
 * reader can re-read until the translations arrive instead of staying on the
 * authored text.
 */
export interface LocalizeResult {
  fields: TranslationFields
  pending: number
}

/**
 * Resolve one entity's translatable fields for a surface.
 *
 * `locale` is required: the caller resolved the host preference once for the
 * read it is serving. Resolving it is not free — the host projects every active
 * profile entry's live configuration to answer it — so there is deliberately no
 * default and no omitted form here: a resolver that fell back to resolving the
 * preference itself made a read's cost scale with its entity count.
 */
export type LocalizeFields = (
  surface: TranslationSurfaceKind,
  id: string,
  fields: { name?: string | undefined; description?: string | undefined },
  locale: string
) => LocalizeResult

/**
 * Resolve one document body for a surface, chunk by chunk.
 *
 * A document is not a field: it is longer than any single provider request may
 * carry, so the resolver splits it, queues what is missing, and answers with
 * whatever is ready. The same "never wait, report pending" contract as
 * {@link LocalizeFields} holds, and for the same reason — a reader must be able
 * to open a document without a provider round trip standing between it and the
 * page.
 *
 * `locale` is required for the reason {@link LocalizeFields} documents.
 */
export type LocalizeDocument = (surface: TranslationSurfaceKind, id: string, text: string, locale: string) => DocumentTranslation

/**
 * One read's localization: the host locale, and the resolver that applies it.
 *
 * The two travel together because resolving the locale is a whole-profile
 * projection, never a per-entity question. A surface that walks entities — the
 * MCP and LSP status inventories — receives the pair from the caller that owns
 * the read instead of resolving anything itself.
 */
export interface Localization {
  locale: string
  localizeFields: LocalizeFields
}

/** One MCP tool observed from the host tool registry (structural). */
export interface McpToolSnapshot {
  name: string
  description?: string
  /** The input schema the server advertised, when the host exposes it. */
  parameters?: unknown
}

/** The LSP mount-registry surface the aggregator consumes (structural, for tests). */
export interface LspMountStatusSource {
  diagnosticsSnapshot(): Map<string, LspMountDiagnostic>
  hasLiveMounts(): boolean
  disabledServers?(): Set<string>
}

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

/** Credential-store seam backing the MCP re-authorize action. */
export interface CredentialGrantStore {
  deleteGrantRecord(serverName: string): Promise<void>
}

/**
 * One menu row this plugin owns, paired with the panel identity that
 * translates it.
 *
 * The runtime half of the join lives behind this record because only the
 * registries know the call name a command actually got, while only the panels
 * know the id and authored text a translation is cached under. The catalog
 * joins them without importing either.
 */
export interface MenuRowIdentity {
  /** Which `/` menu group the row belongs to. */
  readonly source: MenuRowSource
  /** The name the menu row carries — the allocated call name for a command. */
  readonly name: string
  /** The identity the panel translates the entry under; the same id means the same cache entry. */
  readonly id: string
  /** The authored name the panel handed to the translator. */
  readonly authoredName: string
  /** The authored description the panel handed to the translator; absent when it had none. */
  readonly authoredDescription?: string
}

/** The complete set of host seams a catalog needs; every member is resolved. */
export interface CatalogPorts {
  /** Live host MCP tool registry snapshot for the status surface. */
  mcpToolSnapshot(): readonly McpToolSnapshot[]
  /** Absent when the credentials service is not mounted in this composition. */
  credentialsStore: CredentialGrantStore | undefined
  /** Flags one mount key for an explicit rebuild on the next reconcile. */
  mcpRemount(suiteId: string, serverKey: string): void
  /** Flags every live mount for an explicit rebuild on the next reconcile. */
  mcpRemountAll(): void
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
  /** The host locale preference ('zh' default when unset). */
  localePreference(): string
  /**
   * Every `/` menu row this plugin currently owns, with the panel identity it
   * translates as. Empty when nothing is registered.
   */
  menuRowIdentities(): Promise<readonly MenuRowIdentity[]>
  /**
   * The ordered translation chain, best provider first. An empty array means
   * this deployment translates nothing and every surface renders the upstream
   * text as authored.
   */
  translationProviders?: readonly TranslationProvider[] | undefined
  /**
   * Whether translation is switched on, read per call.
   *
   * The chain above is built once, while the user's switch can flip at any
   * time, so the switch is a live read rather than a second captured value.
   * Absent means on, so a composition that omits it keeps translating.
   */
  translationEnabled?: (() => boolean) | undefined
  /**
   * Stable identity of the current chain, folded into every cache key.
   *
   * A deployment that changes engines must miss the entries the previous chain
   * filled rather than serve its output as if the new chain had produced it.
   */
  translationProviderIdentity?: (() => string) | undefined
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
  mcpRemountAll: () => {},
  mcpServerOwner: () => undefined,
  lspStatusSource: { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => false },
  mcpBackend: async () => 'builtin',
  localePreference: () => 'zh',
  menuRowIdentities: async () => [],
  translationProviders: [],
  translationProviderIdentity: () => 'none',
  setMcpBackend: async () => {
    throw new Error('the settings service is not mounted')
  },
  downloadRegion: async () => 'auto'
}

/** Fill in every seam the composition root left unwired. */
export function resolveCatalogPorts(overrides: CatalogPortsOverride = {}): CatalogPorts {
  return { ...defaultCatalogPorts, ...overrides }
}
