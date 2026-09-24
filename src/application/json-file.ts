/**
 * The one JSON persistence loop every plugin-owned document runs: read with
 * ENOENT tolerance, validate through a caller hook, and write back through the
 * harness atomic-write helper with the private-file modes. Files here are
 * plugin state under `$DSH_HOME`, written by the host process only; a caller
 * needing shared or user-authored content keeps its own rules.
 *
 * The read resolves `undefined` when the file does not exist or parses to
 * nothing usable, and rethrows anything else — a permission problem must
 * surface, not read as an empty document. What counts as usable is the
 * caller's `parse`: it receives the parsed value and returns the typed
 * document, so each store keeps its own tolerance policy (fail-closed to a
 * default, or reject) instead of sharing one.
 * @module application/json-file
 */
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** How a parsed JSON value becomes the store's typed document. */
export interface JsonDocumentParse<T> {
  (raw: unknown): T
}

/**
 * Read one JSON document. Resolves `undefined` when the file is absent or its
 * text is empty; a `parse` that wants an absent file to read as a default
 * handles `undefined` itself.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, 'utf8')
    if (text.trim() === '') return undefined
    return JSON.parse(text) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Read one JSON document through a parse hook. Absent or empty files hand
 * `undefined` to the hook; any non-ENOENT read failure rejects.
 */
export async function readJsonDocument<T>(path: string, parse: JsonDocumentParse<T>): Promise<T> {
  return parse(await readJsonFile(path))
}

/**
 * Write one JSON document atomically: two-space indent, trailing newline, and
 * the private-file modes the plugin's state files carry (0o600 file, 0o700
 * directory).
 */
export async function writeJsonDocument(path: string, document: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
