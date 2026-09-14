/**
 * Claude Code dynamic context injection: `` !`command` `` in a command body or
 * skill body runs the command and the placeholder becomes its output.
 *
 * One pass over the original text recognizes both spellings — the inline
 * `` !`cmd` `` (only at a line start or after whitespace, matching the authoring
 * rule) and the multi-line ```` ```! ```` fence — and every command runs
 * sequentially in the calling session's directory. Outputs are inserted as
 * plain text and never re-read, so a command cannot emit another placeholder.
 *
 * Failure is contained per invocation rather than per placeholder: the caller
 * aborts the whole invocation with the command's own output, so a model never
 * reads half-injected text. Exit code 1 counts as a result for the commands
 * whose benign outcome it is (`grep`, `rg`, `find`, `diff`, `test`, …).
 *
 * The shell service is reached structurally: the caller supplies the seam it
 * resolved, and a profile without one keeps the author's literal text.
 */

/** How long one injected command may run; the executor caps a larger request. */
export const DYNAMIC_CONTEXT_TIMEOUT_MS = 120_000

/** The requested forward cap for one injected command's stdout, in bytes. */
export const DYNAMIC_CONTEXT_MAX_OUTPUT_BYTES = 32 * 1024

/** The slice of the host shell service this module uses. */
export interface ShellSeam {
  resolve(request: { command: string; workdir?: string; timeoutMs?: number; stdoutMaxBytes?: number; signal?: AbortSignal }): unknown
  run(spec: unknown): Promise<ShellOutcome>
}

/** The fields of one shell run this module reads. */
export interface ShellOutcome {
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
  stdout: { text: string; truncated: boolean; spillPath?: string }
  stderr: { text: string; truncated: boolean; spillPath?: string }
}

export interface DynamicContextOptions {
  shell: ShellSeam
  /** Session directory every injected command runs in. */
  workdir?: string
  signal?: AbortSignal
}

/**
 * Commands whose exit code 1 is a result rather than a failure, mirroring the
 * shell consumers the harness already treats this way.
 */
const BENIGN_EXIT_ONE = new Set(['grep', 'rg', 'egrep', 'fgrep', 'find', 'diff', 'test', '['])
const BENIGN_EXIT_ONE_SUBCOMMANDS = new Set(['git diff', 'git grep'])

/** One recognized placeholder in an author's text. */
interface Injection {
  /** Index of the first character the output replaces. */
  start: number
  /** Index one past the last character the output replaces. */
  end: number
  command: string
}

const INJECTION = /(^|[ \t])!`([^`\n]+)`|^```!\r?\n([\s\S]*?)^```[ \t]*$/gm

/**
 * Run every placeholder's command and return the text the model receives.
 *
 * @param text - author text whose `${...}` variables and arguments are already resolved.
 * @param options - the resolved shell seam, session directory and cancellation signal.
 * @returns the text with each placeholder replaced by its command's output.
 * @throws when a command fails, times out or is aborted, carrying the command and its output.
 */
export async function injectDynamicContext(text: string, options: DynamicContextOptions): Promise<string> {
  const injections = findInjections(text)
  if (injections.length === 0) return text
  const parts: string[] = []
  let cursor = 0
  for (const injection of injections) {
    parts.push(text.slice(cursor, injection.start), await runInjection(injection.command, options))
    cursor = injection.end
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}

/** Locate every placeholder in one pass so an inserted output is never re-scanned. */
function findInjections(text: string): Injection[] {
  const found: Injection[] = []
  for (const match of text.matchAll(INJECTION)) {
    const index = match.index ?? 0
    const script = match[3]
    if (script !== undefined) {
      // The capture runs to the closing fence line; the block's own framing
      // whitespace is not part of the script.
      found.push({ start: index, end: index + match[0].length, command: script.trim() })
      continue
    }
    const command = match[2]
    if (command === undefined) continue
    // The captured prefix stays in the text, so the replacement keeps the
    // author's own leading whitespace.
    const prefix = match[1] ?? ''
    found.push({ start: index + prefix.length, end: index + match[0].length, command })
  }
  return found
}

/** Run one placeholder's command and return its output, or throw with the command's own words. */
async function runInjection(command: string, options: DynamicContextOptions): Promise<string> {
  const spec = options.shell.resolve({
    command,
    ...(options.workdir === undefined ? {} : { workdir: options.workdir }),
    timeoutMs: DYNAMIC_CONTEXT_TIMEOUT_MS,
    stdoutMaxBytes: DYNAMIC_CONTEXT_MAX_OUTPUT_BYTES,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  })
  const result = await options.shell.run(spec)
  if (!benignExit(result.exitCode, command)) throw injectionFailure(command, result)
  const body = stripTrailingNewline(mergeOutputs(result.stdout.text, result.stderr.text))
  if (!result.stdout.truncated && !result.stderr.truncated) return body
  const notice = truncationNotice(result)
  return body === '' ? notice : `${body}\n${notice}`
}

/** Whether this command's exit status is a result rather than a failure. */
export function benignExit(exitCode: number | null, command: string): boolean {
  if (exitCode === 0) return true
  if (exitCode !== 1) return false
  const [program = '', subcommand = ''] = stripEnvironmentPrefix(command.trim().replace(/\s+/g, ' ')).split(' ')
  // A path-qualified invocation names the same command as its bare spelling.
  if (BENIGN_EXIT_ONE.has(program.split('/').pop() ?? program)) return true
  return program === 'git' && BENIGN_EXIT_ONE_SUBCOMMANDS.has(`git ${subcommand}`)
}

/** Skip leading `NAME=value` assignments so `FOO=1 grep x` keeps its benign status. */
function stripEnvironmentPrefix(command: string): string {
  let rest = command
  for (;;) {
    const match = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.exec(rest)
    if (match === null) return rest
    rest = rest.slice(match[0].length)
  }
}

/** Merge the two captured streams the way the default shell surfaces them. */
function mergeOutputs(stdout: string, stderr: string): string {
  if (stderr === '') return stdout
  if (stdout === '') return stderr
  return stdout.endsWith('\n') ? stdout + stderr : `${stdout}\n${stderr}`
}

/** One trailing newline is dropped so the output joins the surrounding text. */
function stripTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

/** What the caller reports when a placeholder's command does not produce a result. */
function injectionFailure(command: string, result: ShellOutcome): Error {
  const cause = result.timedOut
    ? `timed out after ${DYNAMIC_CONTEXT_TIMEOUT_MS}ms`
    : result.aborted
      ? 'was aborted'
      : `exited with ${result.exitCode === null ? 'a signal' : `code ${result.exitCode}`}`
  return new Error(
    [
      `Shell command failed for pattern "!\`${command}\`" (${cause})`,
      ...(result.stdout.text === '' ? [] : ['[stdout]', result.stdout.text.trimEnd()]),
      ...(result.stderr.text === '' ? [] : ['[stderr]', result.stderr.text.trimEnd()])
    ].join('\n')
  )
}

/** Tell the model the injected text is only part of the command's output. */
function truncationNotice(result: ShellOutcome): string {
  const spill = result.stdout.spillPath ?? result.stderr.spillPath
  return `[output truncated${spill === undefined ? '' : `; full output: ${spill}`}]`
}
