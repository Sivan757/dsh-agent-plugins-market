import type { ExtensionSelection } from '../../../market-contracts/src/contracts/extension-presets.js'
import type { Suite, SuiteSurfaceKey } from '../../../market-contracts/src/model/types.js'
import { admitsAnyHook, exposesIndividualHooks } from './extension-hook-selection.js'
import { pluginResourceId } from './panel-resources.js'

export interface ExtensionSuiteCandidate {
  /** Already installed/local declarations, including parser-validated system prompts and materialized valid markdown lists. */
  suite: Suite
  /** Evidence from the existing parse owner, not global toggles or an all-true fallback. Unknown/invalid surfaces are false. */
  validSurfaces: Readonly<Record<SuiteSurfaceKey, boolean>>
}

export interface ExtensionSuiteProjection {
  suite: Suite
  globalEnabled: boolean
  globalSurfaces: Record<SuiteSurfaceKey, boolean>
}

/**
 * Project validated declarations without scanning, mounting, or changing global defaults.
 * Callers retain credential, tool-policy and execution checks; this is not shared-service union ownership.
 * Unmaterialized markdown is empty rather than a request for downstream filesystem discovery.
 * Surface counts remain declaration metadata; activeSurfaces and filtered tables govern execution.
 */
export function projectExtensionSuites(candidates: readonly ExtensionSuiteCandidate[], selection: ExtensionSelection): ExtensionSuiteProjection[] {
  const selected = new Set(selection.enabledIds)
  return candidates
    .filter(({ suite }) => selected.has('market:' + suite.sourceId + '/' + suite.id))
    .map(({ suite: original, validSurfaces }) => {
      const suite = structuredClone(original)
      const key = suite.sourceId + '/' + suite.id
      const entrySelected = (kind: 'skills' | 'commands' | 'agents', name: string) =>
        validSurfaces[kind] === true && selected.has(kind + ':' + pluginResourceId(suite.sourceId, suite.id, kind, name))
      suite.skills = suite.skills.filter(skill => entrySelected('skills', skill.name))
      suite.resources = {
        commands: (suite.resources?.commands ?? []).filter(row => entrySelected('commands', row.name)),
        agents: (suite.resources?.agents ?? []).filter(row => entrySelected('agents', row.name))
      }
      if (suite.mcp)
        suite.mcp.servers = Object.fromEntries(Object.entries(suite.mcp.servers).filter(([name]) => validSurfaces.mcp === true && selected.has('mcp:plugin:' + key + '/' + name)))
      if (suite.lsp)
        suite.lsp.servers = Object.fromEntries(
          Object.entries(suite.lsp.servers).filter(([, spec]) => suite.dimension !== 'project' && validSurfaces.lsp === true && selected.has('lsp:' + key + '/' + spec.key))
        )
      // A hook answers to its own row only where the inventory publishes one, and the
      // declaration is never compacted: dropping one hook would renumber every hook
      // after it and desynchronize the runtime from the identity already published.
      if (validSurfaces.hooks !== true || (exposesIndividualHooks(suite) && !admitsAnyHook(suite, suite.hooks, selection.enabledIds))) delete suite.hooks
      if (!suite.skills.some(skill => skill.name === suite.manifest.startupSkill)) delete suite.manifest.startupSkill
      suite.enabled = true
      suite.activeSurfaces = {
        skills: suite.skills.length > 0,
        commands: suite.resources.commands.length > 0,
        agents: suite.resources.agents.length > 0,
        mcp: Object.keys(suite.mcp?.servers ?? {}).length > 0,
        lsp: Object.keys(suite.lsp?.servers ?? {}).length > 0,
        hooks: validSurfaces.hooks === true && Object.keys(suite.hooks?.events ?? {}).length > 0
      }
      return { suite, globalEnabled: original.enabled, globalSurfaces: { ...original.activeSurfaces } }
    })
}
