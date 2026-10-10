/**
 * One declared command hook's bounded dry run.
 *
 * The declaration is resolved by the caller from the scanned catalog; this
 * module only runs an already-resolved command. A client never supplies the
 * command text, and the run directory is always the user's home directory, so a
 * dry run cannot be steered at an arbitrary path or an arbitrary program.
 *
 * The host shell is reached as the executor seam (resolve plus execute),
 * without injecting shell, because this read may run outside any session
 * fiber. A profile that provides no shell answers a result-level error instead
 * of throwing.
 */
import { homedir } from 'node:os'
import type { ExtensionHookRunResult } from '../../../../market-contracts/src/contracts/extension-presets.js'

/** Per-stream cap, in characters, on the output one result carries. */
export const HOOK_RUN_MAX_OUTPUT_CHARS = 32_768
/** Timeout applied when the declaration carries none. */
export const HOOK_RUN_DEFAULT_TIMEOUT_SEC = 30
/** Hard ceiling on any dry run, whatever the declaration asks for. */
export const HOOK_RUN_MAX_TIMEOUT_MS = 60_000

/** A resolved declaration that named no runnable hook. */
export const HOOK_RUN_UNKNOWN_DECLARATION = 'hook-run-unknown-declaration'
/** A matched declaration that carries no command (a rejected declaration exists only as a diagnostic). */
export const HOOK_RUN_NO_COMMAND = 'hook-run-no-command'
/** No shell executor is mounted in this profile. */
export const HOOK_RUN_SHELL_UNAVAILABLE = 'hook-run-shell-unavailable'
/** The executor rejected the run before it produced an outcome. */
export const HOOK_RUN_FAILED = 'hook-run-failed'

/** The slice of the host shell executor this module uses. */
export interface HookRunShellRequest {
  command: string
  workdir?: string
  timeoutMs?: number
  stdin?: string
  env?: Record<string, string>
  stdoutMaxBytes?: number
}
/** The fields of one shell run this module reads. */
export interface HookRunShellResult {
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
  stdout: { text: string; truncated: boolean }
  stderr: { text: string; truncated: boolean }
}
/** The host shell executor, reached structurally so a missing service stays optional. */
export interface HookRunShell {
  resolve(request: HookRunShellRequest): unknown
  execute(spec: unknown): Promise<{ result(): Promise<HookRunShellResult> }>
}

/**
 * Narrow a resolved shell seam to the executor surface, or answer undefined.
 *
 * The seam is read without injecting shell, so its value is untyped at the
 * boundary. A service that only exposes the legacy run shape is not an
 * executor and is reported as unavailable rather than run against.
 * @param value - the service resolved from the context, if any.
 * @returns the executor surface, or undefined when no executor is mounted.
 */
export function hookRunShellOf(value: unknown): HookRunShell | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const shell = value as Partial<HookRunShell>
  return typeof shell.resolve === 'function' && typeof shell.execute === 'function' ? (shell as HookRunShell) : undefined
}

/**
 * The synthetic stdin payload one dry run writes.
 *
 * It carries the same event name the declaration fired under and the directory
 * the command runs in, so a script that reads stdin sees a coherent event,
 * plus dry_run: true so it can refuse to act for real.
 * @param event - the declared event the hook belongs to.
 * @param cwd - the directory the command runs in.
 * @returns the JSON payload, newline terminated.
 */
export function hookRunStdin(event: string, cwd: string): string {
  return (
    JSON.stringify({
      hook_event_name: event,
      session_id: 'dry-run',
      transcript_path: '',
      cwd,
      permission_mode: 'default',
      dry_run: true
    }) + '\n'
  )
}

/** One bounded stream: the text a result carries and whether it was cut. */
function bounded(text: string, truncated: boolean): { text: string; truncated: boolean } {
  return text.length <= HOOK_RUN_MAX_OUTPUT_CHARS ? { text, truncated } : { text: text.slice(0, HOOK_RUN_MAX_OUTPUT_CHARS), truncated: true }
}

/** One result that reports a failure without running anything. */
export function hookRunFailure(code: string): ExtensionHookRunResult {
  return { cwd: homedir(), stdout: '', stderr: '', durationMs: 0, timedOut: false, truncated: false, error: code }
}

/** How one resolved declaration runs. */
export interface HookDryRunOptions {
  /** The event the declaration belongs to. */
  event: string
  /** The declaration's own timeout in seconds; absent uses the module default. */
  timeoutSec?: number
  /** The suite's path variables as process environment. */
  env?: Record<string, string>
}

/**
 * Run one resolved command in the home directory under a bounded timeout.
 *
 * The timeout is the declaration's own, defaulted to HOOK_RUN_DEFAULT_TIMEOUT_SEC
 * and capped at HOOK_RUN_MAX_TIMEOUT_MS; the command's cwd is the home
 * directory whatever the caller passes elsewhere. Both streams are capped
 * independently, and an executor rejection becomes a result, so the request
 * never fails with a thrown error.
 * @param shell - the resolved host shell executor.
 * @param command - the declaration's own command text.
 * @param options - the event, declared timeout, and suite environment.
 * @returns the bounded result of the run.
 */
export async function runHookDryRun(shell: HookRunShell, command: string, options: HookDryRunOptions): Promise<ExtensionHookRunResult> {
  const cwd = homedir()
  const timeoutMs = Math.min((options.timeoutSec ?? HOOK_RUN_DEFAULT_TIMEOUT_SEC) * 1000, HOOK_RUN_MAX_TIMEOUT_MS)
  const started = performance.now()
  try {
    const spec = shell.resolve({
      command,
      workdir: cwd,
      timeoutMs,
      stdin: hookRunStdin(options.event, cwd),
      stdoutMaxBytes: HOOK_RUN_MAX_OUTPUT_CHARS,
      ...(options.env === undefined ? {} : { env: options.env })
    })
    const result = await (await shell.execute(spec)).result()
    const stdout = bounded(result.stdout.text, result.stdout.truncated)
    const stderr = bounded(result.stderr.text, result.stderr.truncated)
    return {
      cwd,
      ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
      stdout: stdout.text,
      stderr: stderr.text,
      durationMs: performance.now() - started,
      timedOut: result.timedOut,
      truncated: stdout.truncated || stderr.truncated
    }
  } catch (error) {
    return {
      cwd,
      stdout: '',
      stderr: '',
      durationMs: performance.now() - started,
      timedOut: false,
      truncated: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
