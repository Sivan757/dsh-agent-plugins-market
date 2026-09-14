/**
 * Path-variable expansion for author-written suite text.
 *
 * A suite authored for Claude Code or its dialects writes `${CLAUDE_PLUGIN_ROOT}`
 * (or the dialect's own spelling) into command bodies, agent personas, hook
 * commands, LSP declarations, startup instructions and skill prose, and uses
 * `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_SKILL_DIR}` the
 * same way. Its home ecosystem replaces those variables before the text reaches
 * the model or a process; every surface here has to do the same, or the command
 * runs with an empty path. One implementation keeps the surfaces agreeing on
 * what each spelling means.
 *
 * A variable whose value the calling layer does not hold is left exactly as
 * written: an author's `${NAME:-default}`-style intent is never silently
 * emptied, and a surface that cannot supply a session directory does not
 * invent one.
 */
import { PLUGIN_DATA_VARIABLES, PLUGIN_ROOT_VARIABLES, PROJECT_DIR_VARIABLES, SKILL_DIR_VARIABLE } from '../model/layouts.js'
import type { Suite } from '../model/types.js'

/** The absolute paths one expansion can supply; an absent entry leaves its variable verbatim. */
export interface PluginPathContext {
  /** Suite checkout root: `${PLUGIN_ROOT}` and its dialect aliases. */
  root?: string
  /** Per-suite data directory: `${PLUGIN_DATA}` and its aliases. */
  data?: string
  /** Directory holding the skill file: `${CLAUDE_SKILL_DIR}`. */
  skillDir?: string
  /** Calling session's project directory: `${CLAUDE_PROJECT_DIR}` and its aliases. */
  projectDir?: string
}

/** The suite root `${PLUGIN_ROOT}` and its dialect aliases resolve to. */
export function pluginRootOf(suite: Pick<Suite, 'manifest' | 'root'>): string | undefined {
  // Project-native directories are the repository's own files, read in place;
  // no plugin root exists for them, so the variable stays as the author wrote it.
  return suite.manifest.layout === 'project-native' ? undefined : suite.root
}

/** Replace every path variable the context can resolve; other text stays exactly as written. */
export function expandPluginPaths(text: string, context: PluginPathContext): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    if (PLUGIN_ROOT_VARIABLES.has(name)) return context.root ?? match
    if (PLUGIN_DATA_VARIABLES.has(name)) return context.data ?? match
    if (name === SKILL_DIR_VARIABLE) return context.skillDir ?? match
    if (PROJECT_DIR_VARIABLES.has(name)) return context.projectDir ?? match
    return match
  })
}
