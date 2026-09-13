/**
 * Root path resolution for the two install dimensions plus the shared
 * user-level Agent layout root.
 *
 * User dimension: `~/.dsh/agent-plugins/` (or `$DSH_HOME/agent-plugins`) —
 * `.sources/` (checkouts), `state.json` (install state), and `data/`
 * (`overrides/`, suite `${PLUGIN_DATA}` directories, and the LSP enable set
 * with the feedback rate-limit stamp).
 * Project dimension: `<projectRoot>/.dsh/agent-plugins/`, where the project
 * root is the nearest ancestor containing `.git`.
 *
 * Content the user authors, and the services they declare by hand, live in the
 * cross-tool Agent layout root instead: `~/.agents/{skills,commands,agents}/`
 * and `~/.agents/{mcp,lsp}.json`. That is the same directory shape the plugin
 * already reads from a project's `.agents/`, so user-authored resources are
 * plain Markdown and ordinary JSON that other Agent tools can consume too.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { expandHomePath, resolveDshHome as resolveHarnessHome } from '@deepseek-ai/dsh-home-paths'
import { stripArchiveSuffix } from '../model/types.js'

/** Source checkouts live under `<dimensionRoot>/.sources/<sourceId>/`. */
export const SOURCES_DIR_NAME = '.sources'

export const STATE_FILE_NAME = 'state.json'

/**
 * Expand a leading `~`, `~/`, or `~\` to the OS home; other values pass
 * through. The harness helper owns the platform rules, so a configured path is
 * read back the same way on every host.
 */
export const expandHome = expandHomePath

/**
 * Resolve the harness home (`$DSH_HOME` or `~/.dsh`) through the harness
 * helper: precedence and tilde expansion stay the harness's, and a blank
 * `$DSH_HOME` reads as unset rather than resolving the home to the current
 * working directory.
 */
export function resolveDshHome(): string {
  return resolveHarnessHome()
}

/** Resolve the canonical user-dimension root. Legacy overrides are migration inputs only. */
export function resolveUserRoot(_configUserRoot?: string): string {
  return join(resolveDshHome(), 'agent-plugins')
}

/**
 * Resolve the shared user-level Agent layout root (`$DSH_AGENTS_HOME` or
 * `~/.agents`): where this plugin stores the resources and service
 * declarations the user authors by hand. A blank override reads as unset, the
 * same rule the harness applies to its own home.
 */
export function resolveAgentsRoot(): string {
  const configured = process.env.DSH_AGENTS_HOME
  return configured === undefined || configured.trim().length === 0 ? join(homedir(), '.agents') : resolve(expandHome(configured))
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

/** The slice of a `node:path` implementation a containment test needs. */
export interface PathFlavor {
  relative(from: string, to: string): string
  isAbsolute(path: string): boolean
  sep: string
}

/**
 * Whether `candidate` is `root` itself or a path below it, compared on whole
 * path segments by `flavor`'s rules so a sibling whose name merely starts with
 * the root's (`/a/bc` against `/a/b`) does not count as contained.
 *
 * `relative` resolves both operands with those rules before comparing, so the
 * answer never depends on how each side was spelled: a checkout read from
 * configuration as `C:/x/y` and an entry resolved to `C:\x\y\plugins\a` stay
 * contained, Windows compares drive letters and segments case-insensitively,
 * and an unnormalized `..` inside the candidate is resolved rather than
 * trusted as text. On POSIX a backslash stays the ordinary filename character
 * it is — folding separators there would invent containment that does not
 * exist.
 *
 * `flavor` is injectable so the win32 rules stay covered by a POSIX test run.
 */
export function isWithinUnder(flavor: PathFlavor, root: string, candidate: string): boolean {
  const rel = flavor.relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${flavor.sep}`) && rel !== '..' && !flavor.isAbsolute(rel))
}

/** Whether `candidate` is `root` itself or a path below it, by the host's path rules. */
export function isWithin(root: string, candidate: string): boolean {
  return isWithinUnder({ relative, isAbsolute, sep }, root, candidate)
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
    const ownerSegment = segments.at(-2)
    if (ownerSegment !== undefined) {
      const owner = sanitizeId(ownerSegment)
      if (owner !== '' && owner !== primary) candidates.push(`${owner}-${primary}`)
    }
  }
  return [...new Set(candidates)]
}
