/** Resolve read-only project roles from the calling session, never from tool-supplied paths. */
import { defaultMarkdownResources, resourceText } from '../../../market-catalog/src/index.js'
import { pluginRootOf } from '../../../market-catalog/src/index.js'
import { suiteDataDir } from '../../../market-catalog/src/index.js'
import { parseAgentRole, type AgentRoleEntry } from './agent-roles.js'
import { isAbsentPath } from './fs-probe.js'
import type { CatalogPort as Catalog } from '../catalog-port.js'
import type { Suite } from '../../../market-contracts/src/model/types.js'

export interface ProjectAgentRoleOptions {
  /** Validated selected clones; absence preserves ordinary project discovery. */
  suites?: () => Promise<Suite[]>
  /** Current parent-scoped grant, checked after parsing each document. */
  selected?: (entry: AgentRoleEntry) => boolean
}

export async function projectAgentRoles(catalog: Catalog, parent: unknown, options: ProjectAgentRoleOptions = {}): Promise<AgentRoleEntry[]> {
  const cwd = (parent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return []
  const suites = options.suites ? await options.suites() : (await catalog.readProjectCatalog(cwd)).enabledSuites
  const entries: AgentRoleEntry[] = []
  for (const suite of suites) {
    if (suite.activeSurfaces.agents === false) continue
    const suiteRoot = pluginRootOf(suite)
    const suiteData = suiteRoot === undefined ? undefined : suiteDataDir(catalog.dataRoot, suite.sourceId, suite.id)
    for (const resource of suite.resources?.agents ?? (options.suites ? [] : await defaultMarkdownResources(suite.root, 'agents'))) {
      const path = resource.file
      const rawText = await resourceText(options.suites && resource.file !== suite.manifest.path ? { name: resource.name, file: resource.file } : resource).catch(async error => {
        // A vanished document is an ordinary removal; any other failure must not
        // silently drop a project role from the catalog.
        if (!(await isAbsentPath(path))) throw error
        return undefined
      })
      if (rawText === undefined) continue
      try {
        const policy = parseAgentRole(rawText)
        const entry: AgentRoleEntry = {
          name: JSON.stringify([suite.sourceId, suite.id, 'agents', resource.name]),
          path,
          rawText,
          title: policy.title ?? resource.name.replace(/\.agent$/, ''),
          description: policy.description ?? `${suite.manifest.name}: ${resource.name}`,
          disabled: policy.disabled,
          ...(suiteRoot === undefined ? {} : { suiteRoot }),
          ...(suiteData === undefined ? {} : { suiteData })
        }
        if (options.selected) {
          if (!options.selected(entry)) continue
          entry.selectionEnabled = true
        }
        entries.push(entry)
      } catch {
        // Malformed routing metadata cannot authorize a project role.
      }
    }
  }
  return entries
}
