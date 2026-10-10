import type { ExtensionSelection } from '../../../market-contracts/src/contracts/extension-presets.js'
import { CONFIGURATION_PARENT_IDS } from '../../../market-contracts/src/contracts/extension-presets.js'
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
 * Whether one resource id belongs to this suite's own selectable surface.
 *
 * The inventory addresses a suite's children with these exact spellings, so
 * this one predicate decides both "the suite is selected" (the parent id, or
 * any child id for a configuration parent whose card no client renders) and
 * "this child is selected". It is the single derivation point the session
 * selection and the shared reconciler share.
 */
export function suiteOwnsResourceId(suite: Pick<Suite, 'sourceId' | 'id'>, resourceId: string): boolean {
  const key = suite.sourceId + '/' + suite.id
  const parent = 'market:' + key
  if (resourceId === parent) return true
  if (CONFIGURATION_PARENT_IDS.has(parent)) {
    if (resourceId.startsWith('hooks:' + key + '/')) return true
    if (resourceId.startsWith('mcp:plugin:' + key + '/') || resourceId.startsWith('lsp:' + key + '/')) return true
    for (const kind of ['skills', 'commands', 'agents'] as const) {
      // pluginResourceId spells the panel id as a JSON tuple; match by the
      // spelled prefix instead of re-serializing every candidate name.
      if (resourceId.startsWith(kind + ':')) {
        try {
          const [sourceId, suiteId] = JSON.parse(resourceId.slice(kind.length + 1)) as unknown[]
          if (sourceId === suite.sourceId && suiteId === suite.id) return true
        } catch {
          // A non-tuple id (a user-authored entry) belongs to no suite.
        }
      }
    }
  }
  return false
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
    .filter(
      ({ suite }) =>
        // An explicit parent id selects as before; a configuration parent whose
        // id no preset carries is selected through any of its children.
        selected.has('market:' + suite.sourceId + '/' + suite.id) || selection.enabledIds.some(id => suiteOwnsResourceId(suite, id))
    )
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
