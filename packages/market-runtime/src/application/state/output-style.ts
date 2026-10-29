/**
 * One persisted workspace output-style selection and its atomic read-modify-write.
 *
 * A sibling of the tab layout and the surface-toggle policy, not a section of
 * either: every one of these documents has exactly one owner, and a second
 * writer sharing a file would clobber whichever mutation lost the race. This
 * file owns `output-style/<workspace hash>.json` and nothing else.
 *
 * The read is tolerant the way every plugin state file is: an absent, empty,
 * unparsable, or hand-edited document resolves to the default selection, never
 * to a throw that would block the workspace. The selection id is validated by
 * its shape only; whether it names a style that still exists is decided where
 * the styles are known, so this module stays independent of the catalog.
 * @module application/state/output-style
 */
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readJsonFile, writeJsonDocument } from '../../../../market-catalog/src/index.js'
import { OUTPUT_STYLE_NONE_ID, type OutputStyleCaptured } from '../../../../market-contracts/src/contracts/output-styles.js'

/** Version of the persisted selection document this release reads and writes. */
export const OUTPUT_STYLE_VERSION = 1

/** One workspace's selection as this store keeps it. */
export interface OutputStyleState {
  /** The selected style's id. */
  styleId: string
  /** The suite text the selection relies on, when it is a suite style. */
  captured?: OutputStyleCaptured
}

/** The default selection: the style that injects nothing. */
export function defaultOutputStyleState(): OutputStyleState {
  return { styleId: OUTPUT_STYLE_NONE_ID }
}

/**
 * Where one workspace's selection is stored.
 *
 * The workspace string is hashed rather than escaped: a workspace path is
 * arbitrary text, and the hash keeps the file name short and the directory
 * listing free of path fragments. The 24-hex prefix is the same budget the tab
 * layout and the surface-toggle policy use beside it.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the selection belongs to.
 * @returns the selection document's absolute path.
 */
export function outputStylePath(dataRoot: string, workspace: string): string {
  const key = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
  return join(dataRoot, 'output-style', key + '.json')
}

/**
 * Read one workspace's selection.
 *
 * An unusable document reads as the default selection, which injects nothing:
 * that is the safe direction for a prompt contribution nobody can see.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the selection belongs to.
 * @returns the resolved selection.
 */
export async function loadOutputStyle(dataRoot: string, workspace: string): Promise<OutputStyleState> {
  let value: unknown
  try {
    value = await readJsonFile(outputStylePath(dataRoot, workspace))
  } catch (error) {
    // Unparsable text is a malformed document rather than an I/O failure: it
    // reads as the default selection so the workspace opens, and the next write
    // replaces the file. Every other failure stays fatal, because a permission
    // problem must surface instead of quietly changing what the prompt carries.
    if (error instanceof SyntaxError) return defaultOutputStyleState()
    throw error
  }
  if (typeof value !== 'object' || value === null) return defaultOutputStyleState()
  const record = value as Record<string, unknown>
  const recorded = typeof record['styleId'] === 'string' ? record['styleId'] : ''
  // A selection recorded while the plugin still shipped styles of its own names a style
  // this release does not have, so it reads as no selection.
  const styleId = recorded === '' || recorded.startsWith('builtin:') ? OUTPUT_STYLE_NONE_ID : recorded
  const captured = parseCaptured(record['captured'])
  return { styleId, ...(captured === undefined ? {} : { captured }) }
}

/** Read one captured record, or undefined when any field is unusable. */
function parseCaptured(value: unknown): OutputStyleCaptured | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const suiteKey = record['suiteKey']
  const fingerprint = record['fingerprint']
  const text = record['text']
  if (typeof suiteKey !== 'string' || suiteKey === '') return undefined
  if (typeof fingerprint !== 'string' || fingerprint === '') return undefined
  if (typeof text !== 'string') return undefined
  return { suiteKey, fingerprint, text }
}

/**
 * Re-read under the published host file lock, persist once, and return the
 * committed selection.
 *
 * Re-reading inside the lock is what makes two concurrent writers serialize:
 * the second sees the first's bytes, applies its own change, and writes the
 * result. The mutation stays synchronous, so no caller callback runs under the
 * lock.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the selection belongs to.
 * @param mutate - the change to apply to the document just read.
 * @returns the committed selection.
 */
export async function mutateOutputStyle(dataRoot: string, workspace: string, mutate: (current: OutputStyleState) => OutputStyleState): Promise<OutputStyleState> {
  const path = outputStylePath(dataRoot, workspace)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    const next = mutate(await loadOutputStyle(dataRoot, workspace))
    await writeJsonDocument(path, {
      version: OUTPUT_STYLE_VERSION,
      workspace,
      styleId: next.styleId,
      ...(next.captured === undefined ? {} : { captured: next.captured })
    })
    return next
  })
}

/**
 * Select one style as this workspace's own.
 *
 * The capture is kept only when the new selection is that suite's own style:
 * a capture belonging to another suite would otherwise travel with an unrelated
 * selection and be reported as staleness that is not real.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the selection belongs to.
 * @param styleId - the style to select.
 * @returns the committed selection.
 */
export async function saveOutputStyleSelection(dataRoot: string, workspace: string, styleId: string): Promise<OutputStyleState> {
  return mutateOutputStyle(dataRoot, workspace, current => ({
    styleId,
    // The capture stays only while the selection is that same suite's style.
    // Carrying another suite's text would report staleness for a style nobody
    // selected, and replaying it is exactly the drift the fingerprint prevents.
    ...(current.captured !== undefined && styleId === 'suite:' + current.captured.suiteKey ? { captured: current.captured } : {})
  }))
}

/**
 * Record one captured suite text beside the current selection.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the selection belongs to.
 * @param captured - the captured text and the suite state it came from.
 * @returns the committed selection.
 */
export async function saveOutputStyleCapture(dataRoot: string, workspace: string, captured: OutputStyleCaptured): Promise<OutputStyleState> {
  return mutateOutputStyle(dataRoot, workspace, current => ({ styleId: current.styleId, captured }))
}
