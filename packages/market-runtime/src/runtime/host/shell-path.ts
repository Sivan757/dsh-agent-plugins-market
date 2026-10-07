/**
 * Login-shell command resolution for bare commands a suite declares
 * (`npx`, `uvx`, a language-server bare name…).
 *
 * The desktop Host starts from Finder/Dock, so its `PATH` comes from launchd
 * and holds only the system directories; the user's toolchain (`npx`, `uvx`,
 * language servers) lives in directories a login shell adds. The plugin
 * therefore probes the user's login shell once, lazily, and appends the
 * directories the current `PATH` lacks — after the current entries, never
 * before, so no existing priority changes. Nothing here rewrites a declared
 * command: the bare name stays the command and the child inherits a `PATH`
 * that can find it.
 *
 * The probe is deliberately narrow: only `darwin`, only the user's own login
 * shell, and only when a first resolution against the current environment
 * failed. A healthy environment therefore behaves exactly as before; only a
 * command that would fail with `ENOENT` today takes the extra step. Every
 * failure falls back to the unmodified environment and leaves a diagnostic
 * line behind, so a resolution that still fails can explain what was searched.
 *
 * @module runtime/shell-path
 */
import { execFile } from 'node:child_process'
import { delimiter, isAbsolute } from 'node:path'
import { SubprocessExecutableNotFoundError, scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { optionalService } from '../core/context.js'

/** Unique line a login shell prints before the `PATH` it resolved. */
const PATH_MARKER = '__DSH_MARKET_LOGIN_PATH__'

/** How long the login-shell probe may take before it is abandoned. */
const PROBE_TIMEOUT_MS = 3_000

/**
 * In-process memo of the login-shell probe. A spawn resolution can run on
 * every reconcile pass, but the user's shell environment does not change
 * within one Host process, so the shell is asked at most once. The promise
 * (not its value) is cached so concurrent first callers share one probe.
 */
let loginShellProbe: Promise<string[] | undefined> | undefined

/**
 * Probe the user's login shell for the `PATH` it exports, once per process.
 *
 * `-i` is required, not incidental: Homebrew's `shellenv` line lives in
 * `.zshrc`, which a non-interactive `zsh -lc` never reads. The probe prints
 * one marker line and then the value, so a shell that writes banners or
 * prompts to stdout cannot be mistaken for the value. Every failure —
 * non-darwin, no shell, timeout, malformed output — resolves to `undefined`
 * rather than throwing, because a caller must be able to fall back silently
 * to today's behavior.
 *
 * @returns the absolute directories the login shell resolves, or `undefined`
 *   when the probe could not produce a usable `PATH`.
 */
export function loginShellPathEntries(): Promise<string[] | undefined> {
  loginShellProbe ??= probeLoginShellPath()
  return loginShellProbe
}

async function probeLoginShellPath(): Promise<string[] | undefined> {
  if (process.platform !== 'darwin') return undefined
  const stdout = await new Promise<string | undefined>(resolve => {
    execFile('/bin/zsh', ['-ilc', `print -r -- ${PATH_MARKER} && print -r -- "$PATH"`], { timeout: PROBE_TIMEOUT_MS }, (error, output) => {
      resolve(error === null ? output : undefined)
    })
  })
  if (stdout === undefined) return undefined
  const markerIndex = stdout.lastIndexOf(PATH_MARKER)
  if (markerIndex === -1) return undefined
  const afterMarker = stdout.slice(markerIndex + PATH_MARKER.length)
  const line = afterMarker
    .split('\n')
    .map(part => part.trim())
    .find(part => part !== '')
  if (line === undefined) return undefined
  const entries: string[] = []
  for (const entry of line.split(delimiter)) {
    if (entry !== '' && isAbsolute(entry) && !entries.includes(entry)) entries.push(entry)
  }
  return entries.length > 0 ? entries : undefined
}

/**
 * Read the executable lookup path out of the environment the way the host
 * subprocess provider does: a non-empty `PATH` entry, or the platform
 * default when the variable is absent (as `child_process.spawn` itself
 * resolves it).
 */
export function environmentPath(env: Readonly<Record<string, string | undefined>> | undefined): string {
  const value = env?.PATH
  if (value !== undefined && value !== '') return value
  return process.env.PATH ?? '/usr/bin:/bin'
}

/**
 * Append every directory the login shell has and `basePath` lacks, keeping
 * `basePath`'s order and precedence intact.
 *
 * @returns the merged `PATH` and the appended directories, or `undefined`
 *   when the probe failed or added nothing.
 */
export async function augmentChildPath(basePath: string): Promise<{ path: string; added: string[] } | undefined> {
  const entries = await loginShellPathEntries()
  if (entries === undefined) return undefined
  const current = basePath === '' ? [] : basePath.split(delimiter)
  const present = new Set(current)
  const added = entries.filter(entry => !present.has(entry))
  if (added.length === 0) return undefined
  return { path: [...current, ...added].join(delimiter), added }
}

/**
 * Read the host's executable lookup seam from a cordis context, tolerantly.
 * The service is optional — a context without a subprocess runtime resolves
 * nothing and the caller keeps today's behavior.
 */
export function subprocessResolver(ctx: unknown): ((command: string, env: Record<string, string>) => Promise<string>) | undefined {
  const subprocess = optionalService(ctx, 'subprocess') as { resolveExecutable?: unknown } | undefined
  const resolve = subprocess?.resolveExecutable
  if (typeof resolve !== 'function') return undefined
  return (command, env) => (resolve as (command: string, env: Record<string, string>) => Promise<string>).call(subprocess, command, env)
}

/**
 * How one declared command resolved for a spawn.
 *
 * `path` is the `PATH` a child must carry, present only when the login shell
 * added directories. `diagnostic` is the fact to report — the extension, or
 * the searched `PATH` when resolution still failed; it is absent on the happy
 * path where the base environment resolved the command unchanged.
 */
export interface DeclaredCommandResolution {
  /** `PATH` the child must carry so `command` resolves; absent when the base `PATH` suffices. */
  path?: string
  /** The resolution fact to report; absent when the base environment resolved the command. */
  diagnostic?: string
}

/**
 * Per-context memo of command resolutions, keyed by `${command}\u0000${basePath}`.
 * The lsp-mounts and MCP-bridge reconciles ask on every pass, and a resolution
 * walks a subprocess per attempt, so the promise (not its value) is cached —
 * concurrent first callers share one walk. Keyed first by `ctx` so tests and
 * fresh contexts stay isolated.
 */
const resolutionMemo = new WeakMap<object, Map<string, Promise<DeclaredCommandResolution | undefined>>>()

/**
 * Resolve one command a suite or the user declared, against the environment a
 * spawn would inherit, extending `PATH` from the login shell only when that
 * environment cannot find the command.
 *
 * The rule the two consumers share: an explicit `env.PATH` is a declaration
 * and is never touched, so the caller gets `undefined` and keeps it verbatim.
 * The plugin never rewrites the command itself — the bare name stays the
 * command, and only the child's `PATH` grows.
 *
 * @param ctx - the cordis context carrying the host subprocess seam.
 * @param command - the declared command, exactly as written.
 * @param declaredEnv - the environment the suite/user declared for the child.
 * @returns the extension to apply and its fact, or `undefined` when there is
 *   nothing to do (no seam, or an explicit `PATH`).
 */
export function resolveDeclaredCommand(ctx: unknown, command: string, declaredEnv: Readonly<Record<string, string>>): Promise<DeclaredCommandResolution | undefined> {
  const resolveExecutable = subprocessResolver(ctx)
  // A context without the seam must not pin a stale no-seam result: the memo
  // only exists once the seam is real. A declared `env.PATH` is a declaration
  // and stays verbatim.
  if (resolveExecutable === undefined || declaredEnv.PATH !== undefined) return Promise.resolve(undefined)
  if (!((typeof ctx === 'object' || typeof ctx === 'function') && ctx !== null)) return Promise.resolve(undefined)
  const environment = { ...scrubbedParentEnv(), ...declaredEnv }
  const basePath = environmentPath(environment)
  let byCommand = resolutionMemo.get(ctx)
  if (byCommand === undefined) {
    byCommand = new Map()
    resolutionMemo.set(ctx, byCommand)
  }
  const memoKey = `${command}\u0000${basePath}`
  const memoized = byCommand.get(memoKey)
  if (memoized !== undefined) return memoized
  const resolution = resolveOnce(resolveExecutable, command, environment, basePath)
  byCommand.set(memoKey, resolution)
  return resolution
}

/** One full resolution walk: resolve, and extend `PATH` from the login shell only on a lookup miss. */
async function resolveOnce(
  resolveExecutable: (command: string, env: Record<string, string>) => Promise<string>,
  command: string,
  environment: Record<string, string>,
  basePath: string
): Promise<DeclaredCommandResolution | undefined> {
  try {
    await resolveExecutable(command, { ...environment, PATH: basePath })
    return {}
  } catch (error) {
    // Only a genuine lookup miss earns the extra probe; any other failure
    // (a relative-path rejection, a provider fault) keeps today's behavior.
    if (!(error instanceof SubprocessExecutableNotFoundError)) return undefined
    const augmented = await augmentChildPath(basePath)
    if (augmented === undefined) {
      return { diagnostic: `could not resolve "${command}" on the Host PATH (${basePath}); the login shell could not supply a usable PATH to extend it` }
    }
    try {
      await resolveExecutable(command, { ...environment, PATH: augmented.path })
    } catch {
      return { diagnostic: `could not resolve "${command}" even after extending PATH from the login shell (searched: ${augmented.path})` }
    }
    return { path: augmented.path, diagnostic: `PATH extended from the login shell: ${augmented.added.join(', ')}` }
  }
}
