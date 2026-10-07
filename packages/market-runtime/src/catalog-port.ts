/** Read-only product queries required by session and content contributors. */
import type { CatalogSnapshot } from '../../market-catalog/src/index.js'
import type { Suite } from '../../market-contracts/src/model/types.js'
import type { OverviewPayload, SuiteDocumentText, UserPanelKind } from '../../market-contracts/src/contracts/market.js'
import type { McpStatusPayload } from '../../market-contracts/src/contracts/mcp-status.js'
import type { LspStatusPayload } from '../../market-contracts/src/contracts/lsp-status.js'
import type { McpBackend } from '../../market-contracts/src/contracts/mcp.js'
import type { LocalizeFields, LocalizeDocument } from '../../market-contracts/src/ports/ports.js'
import type { DocumentTranslation } from '../../market-contracts/src/contracts/translation.js'
import type { McpSuiteOverrides } from '../../market-contracts/src/contracts/mcp-overrides.js'

export interface CatalogPort {
  readonly userRoot: string
  readonly dataRoot: string
  readonly agentsRoot: string
  readonly localePreference: string
  now(): number
  isInstalled(sourceId: string, suiteId: string): boolean
  readUserCatalog(): Promise<CatalogSnapshot>
  readProjectCatalog(cwd: string): Promise<CatalogSnapshot>
  enabledUserSuites(): Promise<Suite[]>
  overview(): Promise<OverviewPayload>
  mcpStatus(): Promise<McpStatusPayload>
  lspStatus(): Promise<LspStatusPayload>
  mcpBackend(): Promise<McpBackend>
  allMcpOverrides(suites?: readonly Suite[]): Promise<Map<string, McpSuiteOverrides>>
  translateFields: LocalizeFields
  translateDocument: LocalizeDocument
  suiteDocument(sourceId: string, suiteId: string, kind: UserPanelKind, name: string, cwd?: string): Promise<SuiteDocumentText>
  suiteDocumentTranslation(sourceId: string, suiteId: string, kind: UserPanelKind, name: string, cwd?: string): Promise<DocumentTranslation>
}
