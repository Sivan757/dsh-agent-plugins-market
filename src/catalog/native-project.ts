/**
 * Native project-layout discovery: read a coding agent's own project-local
 * directories from the shared layout registry in place as read-only suites.
 *
 * Migrating a repository from Claude Code / Codex / Cursor should not
 * require copying files into `.dsh/agent-plugins/`. For the layouts with a
 * project-local convention, the project dimension discovers each content-carrying directory
 * as one synthetic suite so skills and agents reuse the ordinary injection
 * pipeline. The directories are the repository's own: they are never
 * installed, uninstalled, or mutated by this manager.
 */
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { sanitizeId } from './paths.js'
import type { Suite, SuiteDimension, SuiteManifest } from '../model/types.js'
import { countSurfaces, discoverSkills } from './surfaces.js'
import { PROJECT_LAYOUTS, type ProjectLayout } from '../model/layouts.js'
import { discoverProjectMcp } from './project-config.js'
import { discoverProjectHooks } from './project-hooks.js'
import { discoverMarkdownResources } from './component-files.js'

/**
 * Project-local directory conventions, in precedence order. Each entry maps
 * one agent convention onto the content subdirectories it owns.
 */
export const NATIVE_PROJECT_DIRS: readonly NativeProjectDir[] = PROJECT_LAYOUTS

export type NativeProjectDir = ProjectLayout

/**
 * Discover native project-layout suites under a project root. Each
 * convention directory that carries content becomes one synthetic suite;
 * empty or absent directories contribute nothing.
 */
export async function discoverNativeProjectSuites(projectRoot: string, dimension: SuiteDimension): Promise<Suite[]> {
  const suites: Suite[] = []
  for (const native of NATIVE_PROJECT_DIRS) {
    const root = join(projectRoot, native.dirName)
    const id = sanitizeId(`${native.dirName}-native`)
    const manifest: SuiteManifest = {
      layout: 'project-native',
      path: join(root, 'native'),
      id,
      name: `${native.label} project files`,
      description: `Skills and agents read in place from the project's ${native.dirName}/ directory.`
    }
    const errors: string[] = []
    const lspFiles = [join(native.dirName, 'lsp.json'), join(native.dirName, '.lsp.json')]
    if (native.dirName === '.claude') lspFiles.push('.lsp.json')
    if (native.dirName === '.github') lspFiles.push('lsp.json')
    for (const path of lspFiles) {
      if ((await stat(join(projectRoot, path)).catch(() => undefined))?.isFile()) {
        errors.push(`${path}: project LSP configuration is not mounted; the host LSP registry does not isolate projects`)
      }
    }
    // Skills live in `<dir>/skills/<name>/SKILL.md` — the same shape as the
    // ordinary skills container; agents/commands only surface as counts here
    // and are read by the runtime providers directly from the same files.
    const skills = await discoverSkills(root, errors)
    const mcp = await discoverProjectMcp(projectRoot, native.mcpFiles ?? [], errors, native.mcpFormat)
    const hooks = await discoverProjectHooks(projectRoot, native.hookFiles ?? [], errors, native.hookFormat)
    const resources = {
      commands: native.subdirs.includes('commands') ? await discoverMarkdownResources(root, 'commands', undefined, manifest.path, errors) : [],
      agents: native.subdirs.includes('agents') ? await discoverMarkdownResources(root, 'agents', undefined, manifest.path, errors) : []
    }
    const surfaces = await countSurfaces(root, skills, mcp)
    surfaces.commands = resources.commands.length
    surfaces.agents = resources.agents.length
    surfaces.hooks = Object.values(hooks?.events ?? {}).reduce((total, groups) => total + groups.reduce((count, group) => count + group.hooks.length, 0), 0)
    surfaces.lsp = 0
    if (Object.values(surfaces).every(count => count === 0) && errors.length === 0) continue
    suites.push({
      sourceId: 'native',
      id,
      root,
      manifest,
      skills,
      resources,
      ...(mcp === undefined ? {} : { mcp }),
      ...(hooks === undefined ? {} : { hooks }),
      surfaces,
      dimension,
      enabled: true,
      activeSurfaces: {
        skills: true,
        commands: native.subdirs.includes('commands'),
        agents: native.subdirs.includes('agents'),
        mcp: mcp !== undefined,
        hooks: hooks !== undefined,
        lsp: false
      },
      errors
    })
  }
  return suites
}
