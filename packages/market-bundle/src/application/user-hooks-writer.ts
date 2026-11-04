/**
 * Appending one hook entry to the reader's own hook document.
 *
 * The document is the reader's file: they may have written it by hand, so an append merges into
 * whatever shape it already has (bare event table or wrapped) and never rewrites the rest. An
 * entry that already exists, byte for byte, is refused rather than written twice.
 *
 * @module application/user-hooks-writer
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type UserHookEvent, type UserHookSaveRequest } from '../../../market-contracts/src/contracts/user-hooks.js'

/** The document paths this writer considers, in the order the layout reads them. */
const DOCUMENTS = ['hooks/hooks.json', 'hooks.json']

/** Read the document this append will land in, creating a fresh one when neither file exists. */
async function readDocument(agentsRoot: string): Promise<{ file: string; doc: Record<string, unknown> }> {
  for (const file of DOCUMENTS) {
    const path = join(agentsRoot, file)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw Object.assign(new Error('the hook document is not valid JSON: ' + path), { code: 'user-hooks-malformed' })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw Object.assign(new Error('the hook document is not an object: ' + path), { code: 'user-hooks-malformed' })
    }
    return { file, doc: parsed as Record<string, unknown> }
  }
  return { file: DOCUMENTS[0]!, doc: {} }
}

/**
 * Append one hook entry.
 * @param agentsRoot - the Agent layout root the document lives under.
 * @param entry - the event, the command, and an optional matcher.
 * @returns the file the entry landed in.
 */
export async function appendUserHook(agentsRoot: string, entry: UserHookSaveRequest & { event: UserHookEvent }): Promise<string> {
  const { file, doc } = await readDocument(agentsRoot)
  // A bare event table merges in place; anything else merges under the wrapper key, which is
  // what a fresh document gets too.
  const wrapped = doc['hooks'] !== undefined
  const table = (wrapped ? doc['hooks'] : doc) as Record<string, unknown>
  const list = Array.isArray(table[entry.event]) ? (table[entry.event] as unknown[]) : []
  const triple = JSON.stringify({ matcher: entry.matcher ?? '', command: entry.command })
  for (const item of list) {
    const record = item as { matcher?: string; hooks?: Array<{ type?: string; command?: string }> }
    const command = record.hooks?.find(hook => hook.type === 'command')?.command ?? ''
    if (JSON.stringify({ matcher: record.matcher ?? '', command }) === triple) {
      throw Object.assign(new Error('this exact hook entry is already in the document'), { code: 'user-hooks-duplicate' })
    }
  }
  table[entry.event] = [...list, { ...(entry.matcher === undefined ? {} : { matcher: entry.matcher }), hooks: [{ type: 'command', command: entry.command }] }]
  const next = wrapped ? { ...doc, hooks: table } : { ...doc, ...table }
  const path = join(agentsRoot, file)
  // A first hook creates the directory it lives in: the layout root may have no hooks folder
  // yet, and that is not an error the reader caused.
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return path
}
