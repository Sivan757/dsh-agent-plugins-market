/** Read-only project resources reuse the full user-facing detail and document readers. */
import type { CatalogPort as Catalog } from '../../../market-runtime/src/index.js'
import { createPanelResources } from '../../../market-runtime/src/index.js'
import { buildMcpStatus } from '../../../market-mcp/src/index.js'
import { buildLspStatus } from '../../../market-lsp/src/index.js'
import type { McpToolSnapshot } from '../../../market-contracts/src/ports/ports.js'
import type { McpMountDiagnostic } from '../../../market-contracts/src/contracts/mcp.js'
import type { Suite } from '../../../market-contracts/src/model/types.js'
import type { UserPanelKind } from '../../../market-contracts/src/contracts/market.js'
import { buildSuiteDetail } from './details.js'
import { USER_HOOKS_SOURCE, USER_HOOKS_SUITE, loadUserHooksSuite } from '../../../market-runtime/src/index.js'

/** What one session's workspace can read: the project suites plus the full user-facing detail readers. */
export type ProjectExtensionReader = ReturnType<typeof createProjectExtensionResources>

export function createProjectExtensionResources(catalog: Catalog, users: Parameters<typeof createPanelResources>[1], cwd: string) {
  const panels = createPanelResources(catalog, users, cwd)
  const suites = async (): Promise<Suite[]> => (await catalog.readProjectCatalog(cwd)).suites
  return {
    panels,
    suites,
    async suiteDetail(sourceId: string, suiteId: string) {
      // The user-hooks synthetic suite is a configuration row, not an install:
      // `enabledUserSuites` carries it only while it declares events, so the
      // detail reads the always-built suite and shows its diagnostics when the
      // configuration is empty or malformed instead of a 404.
      if (sourceId === USER_HOOKS_SOURCE && suiteId === USER_HOOKS_SUITE) {
        const hooks = await loadUserHooksSuite(catalog.agentsRoot)
        // The suite declares hooks only; an explicit empty resource list keeps the
        // detail from discovering the shared Agent layout root's commands and
        // agents directories as if they were this configuration's surfaces.
        return buildSuiteDetail({ ...hooks, resources: { commands: [], agents: [] } }, undefined, [], undefined)
      }
      const suite =
        (await suites()).find(row => row.sourceId === sourceId && row.id === suiteId) ??
        (await catalog.enabledUserSuites()).find(row => row.sourceId === sourceId && row.id === suiteId && row.sourceId === '@user-hooks')
      if (!suite) throw new Error('project suite not found')
      return buildSuiteDetail(suite, undefined, [], undefined)
    },
    /**
     * One document of this workspace's suite, on any of the three surfaces.
     *
     * The lookup stays in Catalog — one reader for skills, commands and agents — and
     * the project cwd only selects which snapshot answers. Re-scanning here would
     * duplicate the catalog's own identity handling.
     */
    async suiteDocument(sourceId: string, suiteId: string, kind: UserPanelKind, name: string) {
      return catalog.suiteDocument(sourceId, suiteId, kind, name, cwd)
    },
    /** The same document's translation, answered from this workspace's snapshot. */
    async suiteDocumentTranslation(sourceId: string, suiteId: string, kind: UserPanelKind, name: string) {
      return catalog.suiteDocumentTranslation(sourceId, suiteId, kind, name, cwd)
    },
    async mcpStatus(diagnostics: McpMountDiagnostic[] = [], observed: readonly McpToolSnapshot[] = []) {
      const declared = (await suites()).map(suite => ({ ...suite, installedAt: suite.installedAt ?? 'project' }))
      return buildMcpStatus(declared, diagnostics, observed, await catalog.allMcpOverrides(declared))
    },
    async lspStatus() {
      const declared = (await suites()).map(suite => ({ ...suite, installedAt: suite.installedAt ?? 'project' }))
      return buildLspStatus(declared, {
        hasLiveMounts: () => false,
        // Same shape the mount registry records: one row per suite, keyed by suite id,
        // with the suite's declared server keys joined as the registry joins them.
        diagnosticsSnapshot: () =>
          new Map(
            declared.flatMap(suite => {
              const servers = suite.lsp?.servers
              if (servers === undefined) return []
              const suiteId = suite.sourceId + '/' + suite.id
              return [[suiteId, { suiteId, serverKey: Object.keys(servers).join(','), code: 'mount-failed' as const, reason: 'project-lsp-unsupported' }] as const]
            })
          )
      })
    }
  }
}
