/**
 * Root path resolution for the two install dimensions.
 *
 * User dimension: `~/.dsh/agent-plugins/` (or `$DSH_HOME/agent-plugins`).
 * Project dimension: `<projectRoot>/.dsh/agent-plugins/`, where the project
 * root is the nearest ancestor containing `.git`.
 *
 * Everything the plugin persists lives under one root per dimension —
 * `.sources/` (checkouts) and `state.json` (install state) alongside `data/`
 * (suite `${PLUGIN_DATA}` directories) and `overrides/` (MCP configuration
 * rewrites) — so no sibling `agent-plugins-data` root exists.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { stripArchiveSuffix } from '../model/types.js'

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

/** Resolve the canonical user-dimension root. Legacy overrides are migration inputs only. */
export function resolveUserRoot(_configUserRoot?: string): string {
  return join(resolveDshHome(), 'agent-plugins')
}

/**
 * Resolve the suite data root hosting `${PLUGIN_DATA}` directories and the
 * MCP overrides. Defaults under the user root so the whole plugin persists
 * into one directory. Legacy overrides are migration inputs only.
 */
export function resolveDataRoot(_configDataRoot?: string, _configUserRoot?: string): string {
  return join(resolveUserRoot(), 'data')
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

/** Directory holding every source checkout of one dimension root. */
export function sourcesDir(dimensionRoot: string): string {
  return join(dimensionRoot, SOURCES_DIR_NAME)
}

/** Checkout directory of one source inside a dimension root. */
export function sourceCheckoutDir(dimensionRoot: string, sourceId: string): string {
  return join(sourcesDir(dimensionRoot), sourceId)
}

/**
 * Suite-qualified key: `${sourceId}/${suiteId}`. Suite ids are unique within a
 * source only (two sources may both ship a suite named "utils"), so every
 * state, override, data-directory, and mount key must be source-scoped — a
 * bare suite id silently collides across sources.
 */
export function qualifiedSuiteId(sourceId: string, suiteId: string): string {
  return `${sourceId}/${suiteId}`
}

/**
 * Whether `candidate` is `root` itself or a path below it, compared lexically
 * on whole path segments so a sibling whose name merely starts with the root's
 * (`/a/bc` against `/a/b`) does not count as contained.
 */
export function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true
  return candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
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

/** Strip a trailing `.git` or archive suffix (`plugin-0.1.zip` → `plugin-0-1`). */
function stripSourceSuffix(base: string): string {
  const withoutGit = base.endsWith('.git') ? base.slice(0, -4) : base
  return stripArchiveSuffix(withoutGit)
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
  const base = stripSourceSuffix(trimmed.split(/[/\\]/).at(-1) ?? '')
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
