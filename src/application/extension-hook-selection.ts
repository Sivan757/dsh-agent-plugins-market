/**
 * Which suites answer for their hooks individually, and which hook a selection admits.
 *
 * The session inventory publishes one selectable row per command hook for the
 * suites {@link exposesIndividualHooks} answers for. Those suites are the ones a
 * user can switch hook by hook, so exactly those suites admit a hook through its
 * own id rather than through the parent grant. A suite with no individual row
 * keeps the parent contract: a control that is not presented must not be
 * required, or its hooks would become unreachable.
 *
 * Enforcement never compacts the declaration. Removing a hook would renumber
 * every hook after it, and the numbering is the identity the inventory already
 * published, so a suite keeps or loses its whole declaration here and the
 * runtime decides hook by hook against the untouched positions.
 */
import { hookResourceId } from '../contracts/extension-presets.js'
import type { ProjectHooks, Suite } from '../model/types.js'
import { USER_HOOKS_SOURCE, USER_HOOKS_SUITE } from './panels/user-hooks.js'

/**
 * The suites whose session inventory exposes one selectable row per command hook.
 *
 * Project-dimension suites and the user hooks configuration suite are the ones
 * the session window lists hook rows for. An installed suite publishes no
 * individual row, so its hooks stay governed by the parent suite grant.
 * @param suite - the suite to classify.
 * @returns whether this suite's hooks are addressed individually.
 */
export function exposesIndividualHooks(suite: Pick<Suite, 'sourceId' | 'id' | 'dimension'>): boolean {
  return suite.dimension === 'project' || (suite.sourceId === USER_HOOKS_SOURCE && suite.id === USER_HOOKS_SUITE)
}

/**
 * Whether one declaration admits any hook under the exact published identities.
 *
 * A stale identity — an event the declaration no longer carries, or a position
 * past the end of its hook list — admits nothing, so a preset saved against an
 * older declaration grants no capability it does not name.
 * @param suite - the suite whose declaration is being projected.
 * @param hooks - the validated declaration, when it has one.
 * @param enabledIds - the session selection's resource ids.
 * @returns whether at least one command hook of the declaration is named.
 */
export function admitsAnyHook(suite: Pick<Suite, 'sourceId' | 'id'>, hooks: ProjectHooks | undefined, enabledIds: readonly string[]): boolean {
  const events = hooks?.events
  if (events === undefined) return false
  for (const [event, groups] of Object.entries(events)) {
    let index = 0
    for (const group of groups) {
      for (let hook = 0; hook < group.hooks.length; hook += 1) {
        if (enabledIds.includes(hookResourceId(suite.sourceId, suite.id, event, index))) return true
        index += 1
      }
    }
  }
  return false
}
