/**
 * Native project-layout discovery: read a coding agent's own project-local
 * directories (`.claude/`, `.agents/`) in place as read-only suites.
 *
 * Migrating a repository from Claude Code / Codex / Cursor should not
 * require copying files into `.dsh/agent-plugins/`. For the layouts with a
 * project-local convention (Claude Code `.claude/`, agent-plugins
 * `.agents/`), the project dimension discovers each content-carrying child
 * as one synthetic suite so skills and agents reuse the ordinary injection
 * pipeline. The directories are the repository's own: they are never
 * installed, uninstalled, or mutated by this manager.
 */
import { join } from 'node:path'
import { isDirectory, sanitizeId } from './paths.js'
import type { Suite, SuiteDimension, SuiteManifest } from '../model/types.js'
import { countSurfaces, discoverSkills } from './surfaces.js'

/**
 * Project-local directory conventions, in precedence order. Each entry maps
 * one agent convention onto the content subdirectories it owns.
 */
export const NATIVE_PROJECT_DIRS: readonly NativeProjectDir[] = [
  { dirName: '.claude', label: 'Claude Code', subdirs: ['skills', 'agents', 'commands'] },
  { dirName: '.agents', label: 'agents', subdirs: ['skills', 'agents', 'commands'] }
]

export interface NativeProjectDir {
  dirName: string
  label: string
  subdirs: readonly string[]
}

/** A native project directory that carries no relevant content is skipped. */
async function carriesContent(dir: NativeProjectDir, projectRoot: string): Promise<boolean> {
  for (const subdir of dir.subdirs) {
    const path = join(projectRoot, dir.dirName, subdir)
    if (await isDirectory(path)) return true
  }
  return false
}

/**
 * Discover native project-layout suites under a project root. Each
 * convention directory that carries content becomes one synthetic suite;
 * empty or absent directories contribute nothing.
 */
export async function discoverNativeProjectSuites(projectRoot: string, dimension: SuiteDimension): Promise<Suite[]> {
  const suites: Suite[] = []
  for (const native of NATIVE_PROJECT_DIRS) {
    if (!(await isDirectory(join(projectRoot, native.dirName)))) continue
    if (!(await carriesContent(native, projectRoot))) continue
    const root = join(projectRoot, native.dirName)
    const id = sanitizeId(`${native.dirName}-native`)
    const manifest: SuiteManifest = {
      layout: 'project-native' as SuiteManifest['layout'],
      path: join(root, 'native'),
      id,
      name: `${native.label} project files`,
      description: `Skills and agents read in place from the project's ${native.dirName}/ directory.`
    }
    const errors: string[] = []
    // Skills live in `<dir>/skills/<name>/SKILL.md` — the same shape as the
    // ordinary skills container; agents/commands only surface as counts here
    // and are read by the runtime providers directly from the same files.
    const skills = await discoverSkills(root, errors, 'skills')
    const surfaces = await countSurfaces(root, skills, undefined)
    suites.push({
      sourceId: 'native',
      id,
      root,
      manifest,
      skills,
      surfaces,
      dimension,
      enabled: true,
      errors
    })
  }
  return suites
}
