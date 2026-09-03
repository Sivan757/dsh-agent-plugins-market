/**
 * Git operations for repository sources: clone, sync, head, remote-url, remove.
 *
 * Every operation runs `git` through `execFile` without a shell, so a source
 * URL or branch can never interpolate into a command string. Failures carry
 * the stderr tail as the message; the manager surfaces them as source errors.
 *
 * Network tuning rides one {@link GitOptions} object: a proxy, `insteadOf`
 * URL rewrites (mirror acceleration), a per-operation timeout, and one
 * automatic retry for network-flaky clones. Low-speed guards
 * (`GIT_HTTP_LOW_SPEED_*`) fail a stalled transfer early instead of burning
 * the whole timeout.
 */
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const DEFAULT_GIT_TIMEOUT_MS = 120_000

/** Network tuning applied to every remote-touching git invocation. */
export interface GitOptions {
  /** Value for `http.proxy` / `https.proxy` (e.g. `http://127.0.0.1:7890`). */
  proxy?: string
  /** URL-prefix rewrites, git `insteadOf` semantics: `{'https://github.com/': 'https://mirror/https://github.com/'}`. */
  insteadOf?: Record<string, string>
  /** Timeout per git invocation; defaults to 120s. */
  timeoutMs?: number
  /** Retry a failed clone once (network flake); default true. */
  cloneRetry?: boolean
}

interface RunSpec {
  args: string[]
  options: GitOptions
  operation: string
  /** Payload-carrying commands need a larger stdout/stderr buffer. */
  maxBuffer?: number
}

function configArgs(options: GitOptions): string[] {
  const args: string[] = []
  if (options.proxy !== undefined && options.proxy !== '') {
    args.push('-c', `http.proxy=${options.proxy}`, '-c', `https.proxy=${options.proxy}`)
  }
  for (const [from, to] of Object.entries(options.insteadOf ?? {})) {
    if (from === '' || to === '') continue
    args.push('-c', `url.${to}.insteadOf=${from}`)
  }
  return args
}

function gitEnv(): NodeJS.ProcessEnv {
  // Fail early on a stalled transfer; the timeout then catches the remainder.
  return { ...process.env, GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '30' }
}

async function runGit({ args, options, operation, maxBuffer }: RunSpec): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
  try {
    const { stdout } = await run('git', args, { timeout: timeoutMs, maxBuffer: maxBuffer ?? 10 * 1024 * 1024, env: gitEnv() })
    return stdout
  } catch (error) {
    throw gitError(operation, error)
  }
}

/** Clone a source (depth 1, optional branch) into a not-yet-existing directory. */
export async function gitClone(url: string, branch: string | undefined, dest: string, options: GitOptions = {}): Promise<void> {
  const attempt = (): Promise<string> =>
    runGit({
      args: [...configArgs(options), 'clone', '--depth', '1', '--no-tags', ...(branch === undefined ? [] : ['--branch', branch]), '--', url, dest],
      options,
      operation: 'clone'
    })
  const retry = options.cloneRetry !== false
  try {
    await attempt()
  } catch (error) {
    if (!retry) throw error
    // One retry: transient network failures are the dominant clone failure
    // mode; `git clone` cleans its partial target before failing.
    await attempt()
  }
}

/**
 * Shallow-friendly update: fetch depth 1 into FETCH_HEAD and hard-reset.
 * `git pull --ff-only` on shallow clones can refuse with history-divergence
 * errors; fetch+reset is idempotent and always lands on the remote tip. The
 * local checkout is plugin-managed, so discarding working-tree drift is the
 * intended semantics.
 */
export async function gitSync(dir: string, branch: string | undefined, options: GitOptions = {}): Promise<void> {
  const config = configArgs(options)
  await runGit({ args: [...config, '-C', dir, 'fetch', '--depth', '1', 'origin', branch ?? 'HEAD'], options, operation: 'fetch' })
  await runGit({ args: [...config, '-C', dir, 'reset', '--hard', 'FETCH_HEAD'], options, operation: 'reset' })
}

/** Read the checked-out HEAD commit. */
export async function gitHead(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('rev-parse', error)
  }
}

/** Read the checked-out branch name (`HEAD` when detached). */
export async function gitCurrentBranch(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('rev-parse', error)
  }
}

/** Read the checkout's `origin` remote URL; throws when the directory is not a git repository. */
export async function gitRemoteUrl(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('remote', error)
  }
}

/** Remove a source checkout tree entirely. */
export async function gitRemove(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

function gitError(operation: string, error: unknown): Error {
  if (error instanceof Error && 'stderr' in error && typeof (error as { stderr: unknown }).stderr === 'string') {
    const stderr = (error as { stderr: string }).stderr.trim()
    return new Error(`git ${operation} failed: ${stderr.split('\n').at(-1) ?? stderr}`)
  }
  return new Error(`git ${operation} failed: ${error instanceof Error ? error.message : String(error)}`)
}
