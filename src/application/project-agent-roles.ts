/** Resolve read-only project roles from the calling session, never from tool-supplied paths. */
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { parseAgentRole, type AgentRoleEntry } from '../runtime/agent-role-router.js'
import type { Catalog } from './catalog.js'

export async function projectAgentRoles(catalog: Catalog, parent: unknown): Promise<AgentRoleEntry[]> {
  const cwd = (parent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return []
  const snapshot = await catalog.readProjectCatalog(cwd)
  const entries: AgentRoleEntry[] = []
  for (const suite of snapshot.enabledSuites) {
    if (suite.activeSurfaces.agents === false) continue
    for (const resource of suite.resources?.agents ?? (await defaultMarkdownResources(suite.root, 'agents'))) {
      const path = resource.file
      const rawText = await resourceText(resource).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return undefined
      })
      if (rawText === undefined) continue
      try {
        const policy = parseAgentRole(rawText)
        entries.push({
          name: JSON.stringify([suite.sourceId, suite.id, 'agents', resource.name]),
          path,
          rawText,
          title: policy.title ?? resource.name.replace(/\.agent$/, ''),
          description: policy.description ?? `${suite.manifest.name}: ${resource.name}`,
          disabled: policy.disabled
        })
      } catch {
        // Malformed routing metadata cannot authorize a project role.
      }
    }
  }
  return entries
}
