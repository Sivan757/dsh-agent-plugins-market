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
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { expandHomePath, resolveAgentsHome, resolveDshHome as resolveHarnessHome } from '@deepseek-ai/dsh-home-paths'
import { stripArchiveSuffix } from '../../../market-contracts/src/model/types.js'

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
 * declarations the user authors by hand.
 *
 * The harness helper owns the rule, so this plugin reads the root exactly as
 * the harness's own instruction and skill loaders do: precedence, tilde
 * expansion, normalization, and the blank-override-is-unset case.
 */
export function resolveAgentsRoot(): string {
  return resolveAgentsHome()
}

/**
 * Resolve the suite data root hosting `${PLUGIN_DATA}` directories and the
 * MCP overrides. Defaults under the user root so the whole plugin persists
 * into one directory. Legacy overrides are migration inputs only.
 */
export function resolveDataRoot(_configDataRoot?: string, _configUserRoot?: string): string {
  return join(resolveUserRoot(), 'data')
}

/** Directory entries that identify a project root while walking upward. */
export const PROJECT_ROOT_MARKERS = ['.git'] as const

/** Whether one path error means "not there" rather than "cannot tell". */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/**
 * Resolve a project root from a workspace cwd: the nearest ancestor holding any
 * project root marker, or the cwd itself when none exists.
 *
 * One owner, here in the lowest package that needs the climb, so the catalog's
 * project dimension and the instructions page cannot start from different
 * directories. A probe that fails for any reason other than absence propagates,
 * so a caller reports the reason instead of inventing a root.
 * @param cwd - the absolute directory to start from.
 * @returns the absolute project root.
 */
export async function projectRootOf(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        await stat(join(current, marker))
        return current
      } catch (error) {
        if (!isMissingPathError(error)) throw error
      }
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/** Resolve the project-dimension suite root for a workspace cwd. */
export async function resolveProjectRoot(cwd: string): Promise<string> {
  return join(await projectRootOf(cwd), '.dsh', 'agent-plugins')
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
 * The data directory `${PLUGIN_DATA}` resolves to for one suite: a
 * source-qualified directory under the plugin storage root, shared by every
 * surface of that suite so MCP servers, skills and commands see one location.
 */
export function suiteDataDir(dataRoot: string, sourceId: string, suiteId: string): string {
  return `${dataRoot.replace(/[\\/]$/, '')}/${qualifiedSuiteId(sourceId, suiteId)}`
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

/**
 * Drop every trailing slash in one pass.
 *
 * The anchored regex this replaces scanned the run once from each starting
 * position, which is quadratic on a URL that ends in many slashes; a source URL
 * comes from marketplace data, so the count is not bounded by us.
 *
 * @param value - the URL or path to trim.
 * @returns the same string without trailing `/` characters.
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1
  return end === value.length ? value : value.slice(0, end)
}

/** Strip a trailing `.git` or archive suffix (`plugin-0.1.zip` → `plugin-0-1`). */
function stripSourceSuffix(base: string): string {
  const withoutGit = base.endsWith('.git') ? base.slice(0, -4) : base
  return stripArchiveSuffix(withoutGit)
}

/**
 * The owner and the repository a remote URL names.
 *
 * The owner is the directory above the repository (`jeecgboot` for
 * `github.com/jeecgboot/skills`); the repository keeps its own name without a
 * `.git` or archive suffix.
 */
export interface RemoteRepository {
  /** The directory the repository sits in. */
  owner: string
  /** The repository's own name. */
  base: string
}

/**
 * The owner and the repository a remote URL names, or undefined when the URL
 * is a local path.
 *
 * Both the owner-prefixed source id and the qualified display name read this
 * one parse, so the two cannot drift apart over what a URL says.
 *
 * @param url - a git URL or a local path.
 * @returns the owner and repository, or undefined for a local path.
 */
export function parseRemoteRepository(url: string): RemoteRepository | undefined {
  const trimmed = trimTrailingSlashes(url.trim())
  const isRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^[\w.-]+@[\w.-]+:/.test(trimmed)
  if (!isRemote) return undefined
  const hostPath = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[\w.-]+@([\w.-]+):/, '$1/')
  const segments = hostPath.split(/[/\\]/).filter(Boolean)
  const owner = segments.at(-2)
  const baseSegment = segments.at(-1)
  if (owner === undefined || baseSegment === undefined) return undefined
  const base = stripSourceSuffix(baseSegment)
  if (owner === '' || base === '') return undefined
  return { owner, base }
}

/**
 * Derive candidate source ids from a git URL or local path, most preferred
 * first: the sanitized basename, then an owner-prefixed variant (`owner-repo`)
 * for remote URLs so same-named repositories from different owners
 * (`cloudflare/skills`, `mattpocock/skills`) degrade to readable ids instead
 * of numeric suffixes. Local paths yield the basename only.
 */
export function deriveSourceIdCandidates(url: string): string[] {
  const trimmed = trimTrailingSlashes(url.trim())
  const base = stripSourceSuffix(trimmed.split(/[/\\]/).at(-1) ?? '')
  const primary = sanitizeId(base)
  const candidates = [primary]
  const remote = parseRemoteRepository(url)
  if (remote !== undefined) {
    const owner = sanitizeId(remote.owner)
    if (owner !== '' && owner !== primary) candidates.push(`${owner}-${primary}`)
  }
  return [...new Set(candidates)]
}
