/**
 * Read one completed tool call as LSP evidence, when it is one.
 *
 * The `lsp` tool is the only place the host reports what a language-server
 * provider did: the seam publishes no process snapshot and no death event, so a
 * mounted provider that stopped answering looks exactly like a healthy one
 * until a request fails. The observation is recorded against the provider that
 * owns the file's extension, so this helper answers two questions at once —
 * was this an LSP call, and what did it do.
 *
 * @module runtime/lsp-call-observation
 */

/** One completed LSP call, ready to record against its provider. */
export interface LspCallOutcome {
  /** The file the call named; its extension identifies the provider. */
  filePath: string
  /** Whether the call returned an error. */
  ok: boolean
  /** The failure's own message, when it failed. */
  error?: string
}

/**
 * Extract an LSP call outcome from a `tools/post-execute` event.
 *
 * A call that names no `file_path` is not attributable, and a non-LSP tool is
 * not ours; both answer undefined rather than recording a guess.
 *
 * @param exec - the executed call: its tool name and arguments.
 * @param result - the result the tool returned.
 * @returns the attributable outcome, or undefined for anything else.
 */
export function lspCallOutcome(exec: { name: string; arguments?: unknown }, result: { isError: boolean; error?: { message: string } }): LspCallOutcome | undefined {
  if (exec.name !== 'lsp') return undefined
  const path = (exec.arguments as { file_path?: unknown } | undefined)?.file_path
  if (typeof path !== 'string' || path === '') return undefined
  if (!result.isError) return { filePath: path, ok: true }
  return { filePath: path, ok: false, error: result.error?.message ?? '' }
}
