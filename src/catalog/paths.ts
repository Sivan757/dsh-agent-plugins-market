/**
 * Root path resolution for the two install dimensions.
 *
 * User dimension: `~/.dsh/agent-plugins/` (or `$DSH_HOME/agent-plugins`).
 * Project dimension: `<projectRoot>/.dsh/agent-plugins/`, where the project
 * root is the nearest ancestor containing `.git`.
 */
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Source checkouts live under `<dimensionRoot>/.sources/<sourceId>/`. */
export const SOURCES_DIR_NAME = '.sources'

/** Per-suite mutable data directory (the `${PLUGIN_DATA}` placeholder). */
export const DATA_DIR_NAME = 'data'

export const STATE_FILE_NAME = 'state.json'

/** Expand a leading `~/` (or `~\` on Windows) to the home directory; other values pass through. */
export function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** Resolve the harness home (`$DSH_HOME` or `~/.dsh`). */
export function resolveDshHome(): string {
  return process.env.DSH_HOME === undefined ? join(homedir(), '.dsh') : resolve(process.env.DSH_HOME)
}

/** Resolve the user-dimension suite root. */
export function resolveUserRoot(configUserRoot?: string): string {
  return resolve(expandHome(configUserRoot ?? join(resolveDshHome(), 'agent-plugins')))
}

/** Resolve the suite data root hosting `${PLUGIN_DATA}` directories. */
export function resolveDataRoot(configDataRoot?: string): string {
  return resolve(expandHome(configDataRoot ?? join(resolveDshHome(), 'agent-plugins-data')))
}

/** Resolve a project root from a workspace cwd: nearest ancestor with `.git`. */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/** Resolve the project-dimension suite root for a workspace cwd. */
export async function resolveProjectRoot(cwd: string): Promise<string> {
  return join(await findProjectRoot(cwd), '.dsh', 'agent-plugins')
}

/** Source checkout directory for one source id. */
export function sourcesDir(dimensionRoot: string): string {
  return join(dimensionRoot, SOURCES_DIR_NAME)
}

/** Source checkout directory for one source id. */
export function sourceCheckoutDir(dimensionRoot: string, sourceId: string): string {
  return join(sourcesDir(dimensionRoot), sourceId)
}

/** Per-suite data directory for `${PLUGIN_DATA}`. */
export function suiteDataDir(dataRoot: string, suiteId: string): string {
  return join(dataRoot, DATA_DIR_NAME, suiteId)
}

/** Async existence probe that follows symlinks for a final component. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/** Async existence probe for any entry (file, directory, symlink). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Sanitize a plugin or server id into `[a-z0-9-]` (lowercased). */
export function sanitizeId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/-{2,}/g, '-')
  return cleaned === '' ? 'unnamed' : cleaned
}

/** Derive a source id from a repository URL or local path: last path segment, `.git` stripped. */
export function deriveSourceId(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  let base = trimmed.split(/[/\\]/).at(-1) ?? ''
  if (base.endsWith('.git')) base = base.slice(0, -4)
  return sanitizeId(base)
}

/**
 * Derive candidate source ids from a git URL or local path, most preferred
 * first: the sanitized basename, then an owner-prefixed variant (`owner-repo`)
 * for remote URLs so same-named repositories from different owners
 * (`cloudflare/skills`, `mattpocock/skills`) degrade to readable ids instead
 * of numeric suffixes. Local paths yield the basename only.
 */
export function deriveSourceIdCandidates(url: string): string[] {
  const trimmed = url.trim().replace(/\/+$/, '')
  let base = trimmed.split(/[/\\]/).at(-1) ?? ''
  if (base.endsWith('.git')) base = base.slice(0, -4)
  const primary = sanitizeId(base)
  const isRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^[\w.-]+@[\w.-]+:/.test(trimmed)
  const candidates = [primary]
  if (isRemote) {
    const hostPath = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[\w.-]+@([\w.-]+):/, '$1/')
    const segments = hostPath.split(/[/\\]/).filter(Boolean)
    if (segments.length >= 2) {
      const owner = sanitizeId(segments[segments.length - 2]!)
      if (owner !== '' && owner !== primary) candidates.push(`${owner}-${primary}`)
    }
  }
  return [...new Set(candidates)]
}
