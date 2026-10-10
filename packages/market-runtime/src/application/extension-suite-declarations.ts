/** Validate local suite declarations without applying global enablement or mutating source files. */
import type { Suite, SuiteMarkdownResource } from '../../../market-contracts/src/model/types.js'
import { resourceText } from '../../../market-catalog/src/index.js'
import { parseAgentRole } from './agent-roles.js'
import { parseCommandResource } from './command-resources.js'
import type { ExtensionSuiteCandidate } from './extension-suite-selection.js'

async function validMarkdown(resources: readonly SuiteMarkdownResource[], kind: 'commands' | 'agents'): Promise<SuiteMarkdownResource[]> {
  const valid: SuiteMarkdownResource[] = []
  for (const resource of resources) {
    let text: string
    try {
      text = await resourceText(resource)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    try {
      if (kind === 'commands') {
        if (!parseCommandResource(resource, text, { includeDisabled: true })) continue
      } else {
        parseAgentRole(text)
      }
    } catch {
      continue
    }
    valid.push({ ...resource, content: text })
  }
  return valid
}

/**
 * Callers supply installed/local suites from catalog snapshots with validated skill, MCP, LSP and hook declarations.
 * Markdown is revalidated from explicit resource lists; absent lists never trigger discovery.
 * Returns detached declarations with valid disabled entries retained. Missing files and invalid markdown are omitted;
 * other I/O failures reject the read rather than publishing a partial replacement.
 */
export async function readExtensionSuiteDeclarations(suites: readonly Suite[]): Promise<ExtensionSuiteCandidate[]> {
  return Promise.all(
    suites
      .filter(suite => suite.remote === undefined && suite.manifest.layout !== 'remote')
      .map(async original => {
        const suite = structuredClone(original)
        const [commands, agents] = await Promise.all([validMarkdown(suite.resources?.commands ?? [], 'commands'), validMarkdown(suite.resources?.agents ?? [], 'agents')])
        suite.resources = { commands, agents }
        return {
          suite,
          validSurfaces: {
            skills: suite.skills.length > 0,
            commands: commands.length > 0,
            agents: agents.length > 0,
            mcp: Object.keys(suite.mcp?.servers ?? {}).length > 0,
            lsp: suite.dimension !== 'project' && Object.keys(suite.lsp?.servers ?? {}).length > 0,
            hooks: Object.values(suite.hooks?.events ?? {}).some(groups => groups.some(group => group.hooks.length > 0))
          }
        }
      })
  )
}
