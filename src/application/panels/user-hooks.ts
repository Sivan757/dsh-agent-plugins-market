/**
 * Direct user configuration for command hooks: the Agent layout root's own
 * hook files, mounted through the same bridge lifecycle a suite's hooks use.
 *
 * The files live at `~/.agents/hooks/hooks.json` and `~/.agents/hooks.json`
 * and are read in that order, merged additively exactly like the project
 * `.agents` layout reads them. A malformed file fails the suite closed with a
 * diagnostic, never a thrown discovery, and the hooks carry no
 * `projectRoot`: the bridge defaults `${CLAUDE_PROJECT_DIR}` to the calling
 * session's workspace.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeHookDocuments, standaloneHookDocument } from '../../catalog/project-hooks.js'
import { effectiveSurfaces, type ProjectHooks, type Suite } from '../../model/types.js'

export const USER_HOOKS_SOURCE = '@user-hooks'
export const USER_HOOKS_SUITE = 'user-hooks'

/**
 * The Agent layout root's hook documents, relative to that root and read in
 * order. Later files merge additively over earlier ones, the same order and
 * semantics the project `.agents` layout applies. The first entry is also the
 * suite's manifest path and the file a suite with no documents is addressed by.
 */
export const USER_HOOK_FILES: readonly [string, string] = [join('hooks', 'hooks.json'), 'hooks.json']

/** Resolve one Agent-layout-relative hook document against the layout root. */
export function userHookPath(agentsRoot: string, file: string): string {
  return join(agentsRoot, file)
}

/**
 * Load the user's Agent layout hooks as one synthetic suite.
 *
 * The suite is always built, so one call answers with both the events and the
 * reasons a document was rejected: an absent, malformed, or event-free set of
 * hook files leaves `surfaces.hooks` at 0 and carries the diagnostics.
 * {@link ../application/catalog.ts} merges the suite into the enabled set only
 * when it declares events.
 */
export async function loadUserHooksSuite(agentsRoot: string): Promise<Suite> {
  const errors: string[] = []
  const documents: Array<{ file: string; settings: Record<string, unknown> }> = []
  for (const file of USER_HOOK_FILES) {
    const settings = await readHookDocument(agentsRoot, file, errors)
    // A malformed file fails the whole set closed, the same way one malformed
    // project hook layer drops every hook the layout declared.
    if (settings === null) return userHooksSuite(agentsRoot, undefined, errors)
    // A standalone hook file may carry the bare event table; the shared rule
    // that recognizes it is the same one the project `.agents` layout applies.
    if (settings !== undefined) documents.push({ file, settings: standaloneHookDocument(settings) })
  }
  return userHooksSuite(agentsRoot, normalizeHookDocuments(undefined, documents, errors), errors)
}

/** One synthetic suite for the Agent layout root's hook files. */
function userHooksSuite(agentsRoot: string, hooks: ProjectHooks | undefined, errors: string[]): Suite {
  return {
    sourceId: USER_HOOKS_SOURCE,
    id: USER_HOOKS_SUITE,
    root: agentsRoot,
    manifest: { layout: 'agent-plugin-v1', path: userHookPath(agentsRoot, USER_HOOK_FILES[0]), id: USER_HOOKS_SUITE, name: USER_HOOKS_SUITE },
    skills: [],
    ...(hooks === undefined ? {} : { hooks }),
    surfaces: { skills: 0, mcp: 0, hooks: hookCount(hooks), commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    // The suite declares hooks only; the other surfaces would otherwise make
    // the command and LSP registries read this root a second time.
    activeSurfaces: effectiveSurfaces({ skills: false, mcp: false, commands: false, agents: false, lsp: false }),
    installedAt: 'user',
    errors
  }
}

/** One hook file's parsed document: absent is undefined, malformed is null plus a diagnostic. */
async function readHookDocument(agentsRoot: string, file: string, errors: string[]): Promise<Record<string, unknown> | undefined | null> {
  let text: string
  try {
    text = await readFile(userHookPath(agentsRoot, file), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    errors.push(`${file}: hook file is unreadable`)
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    errors.push(`${file}: hook file is invalid JSON`)
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`${file}: hook file must be an object`)
    return null
  }
  return raw as Record<string, unknown>
}

/** Declared hook commands, the same count a native suite reports for `surfaces.hooks`. */
function hookCount(hooks: ProjectHooks | undefined): number {
  return Object.values(hooks?.events ?? {}).reduce((total, groups) => total + groups.reduce((count, group) => count + group.hooks.length, 0), 0)
}
