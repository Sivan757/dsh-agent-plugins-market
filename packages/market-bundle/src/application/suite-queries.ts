/**
 * Suite presentation queries: one suite's detail, one suite document, and that
 * document's translation.
 *
 * The three reads share one lookup — a source-qualified identity resolved in the
 * user snapshot, or in one project's when the caller names a workspace — and one
 * presentation composed over it. They live here rather than on the facade
 * because the facade composes collaborators and forwards, while these reads
 * carry the rule themselves: which snapshot answers, what the detail shows, and
 * how a document's translation is keyed.
 *
 * Every dependency arrives as a function on {@link SuiteQueryPorts}. The facade
 * passes closures, so a caller that replaces one of its own methods (a test
 * stubbing the localization callbacks or the user snapshot read) is still the
 * one called here.
 * @module application/suite-queries
 */
import { qualifiedSuiteId, stripFrontmatter, type CatalogSnapshot } from '../../../market-catalog/src/index.js'
import type { InstalledEntry, Suite } from '../../../market-contracts/src/model/types.js'
import type { McpMountDiagnostic } from '../../../market-contracts/src/contracts/mcp.js'
import type { SuiteDetail, SuiteDocumentText, UserPanelKind } from '../../../market-contracts/src/contracts/market.js'
import type { DocumentTranslation } from '../../../market-contracts/src/contracts/translation.js'
import type { LocalizeDocument, LocalizeFields } from '../../../market-contracts/src/ports/ports.js'
import { loadSuiteOverrides } from '../../../market-mcp/src/index.js'
import { pluginResourceId } from '../../../market-runtime/src/index.js'
import { buildSuiteDetail, readSuiteDocument } from './details.js'

/** The reads one suite query needs, each resolved per call. */
export interface SuiteQueryPorts {
  /** The user-dimension snapshot this deployment serves. */
  readUserCatalog(): Promise<CatalogSnapshot>
  /** One workspace's project snapshot. */
  readProjectCatalog(cwd: string): Promise<CatalogSnapshot>
  /** Install entry of one suite; undefined while it is not installed. */
  installed(sourceId: string, suiteId: string): InstalledEntry | undefined
  /** Plugin storage root holding per-suite overrides. */
  dataRoot(): string
  /** Live MCP mount diagnostics, as the mount registry last reported them. */
  mcpDiagnostics(): readonly McpMountDiagnostic[]
  /** The host locale preference this read resolves once. */
  localePreference(): string
  /** Resolve one entity's translated fields, on the facade's own callback. */
  translateFields: LocalizeFields
  /** Resolve one document body, on the facade's own callback. */
  translateDocument: LocalizeDocument
}

export class SuiteQueries {
  constructor(private readonly ports: SuiteQueryPorts) {}

  /** One suite's full detail for the market detail modal. */
  async suiteDetail(sourceId: string, suiteId: string, projectCwd?: string): Promise<SuiteDetail> {
    const suite = await this.suiteOf(sourceId, suiteId, projectCwd)
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    const detail = await buildSuiteDetail(suite, this.ports.installed(sourceId, suiteId), this.ports.mcpDiagnostics(), await loadSuiteOverrides(this.ports.dataRoot(), suiteKey))
    // The detail modal renders the same name and description as the card, so it
    // takes the same translations (and queues the same cache misses).
    const localized = this.ports.translateFields('market', suiteKey, { name: detail.name, description: detail.description ?? undefined }, this.ports.localePreference())
    return { ...detail, ...localized.fields, ...(localized.pending > 0 ? { translationPending: localized.pending } : {}) }
  }

  /**
   * One suite document's authored text for the market detail modal — a skill, a
   * command, or an agent, all through the one reader.
   *
   * The suite comes from the same snapshot {@link suiteDetail} answers from, and
   * the text is re-read from the checkout the scan found it in: the request
   * names an identity, never a path, so this route cannot be spent on a file of
   * a page's choosing.
   */
  async suiteDocument(sourceId: string, suiteId: string, kind: UserPanelKind, name: string, projectCwd?: string): Promise<SuiteDocumentText> {
    const suite = await this.suiteOf(sourceId, suiteId, projectCwd)
    return { name, content: await readSuiteDocument(suite, kind, name) }
  }

  /**
   * Translate one suite document for the market detail page.
   *
   * The suite comes from the same snapshot {@link suiteDetail} and
   * {@link suiteDocument} answer from, and the document is re-read from the
   * checkout the scan found it in: the request names an identity and never
   * carries text, so this path cannot be spent on content of a page's choosing.
   *
   * The translation is keyed exactly as the user panel keys the same file
   * ({@link pluginResourceId}, on the document's own surface), so one document
   * is one cache entry however it was opened — whichever surface translated it
   * first, the other reads it back without paying a provider again.
   *
   * Frontmatter is stripped for the reason the panel strips it: a provider
   * asked to translate YAML answers with YAML that no longer parses. The reader
   * still sees the authored block above the document, because the row renders
   * the file and this section renders only its translation.
   * @param sourceId - the source the suite belongs to.
   * @param suiteId - the suite's id inside that source.
   * @param kind - which document surface the name belongs to.
   * @param name - the document's name inside that surface.
   * @returns the assembled body and how many chunks are still in flight.
   */
  async suiteDocumentTranslation(sourceId: string, suiteId: string, kind: UserPanelKind, name: string, projectCwd?: string): Promise<DocumentTranslation> {
    const suite = await this.suiteOf(sourceId, suiteId, projectCwd)
    const text = await readSuiteDocument(suite, kind, name)
    return this.ports.translateDocument(kind, pluginResourceId(sourceId, suiteId, kind, name), stripFrontmatter(text), this.ports.localePreference())
  }

  /** The normalized suite a source-qualified identity names, or a miss. */
  private async suiteOf(sourceId: string, suiteId: string, projectCwd?: string): Promise<Suite> {
    const snapshot = projectCwd === undefined ? await this.ports.readUserCatalog() : await this.ports.readProjectCatalog(projectCwd)
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return suite
  }
}
