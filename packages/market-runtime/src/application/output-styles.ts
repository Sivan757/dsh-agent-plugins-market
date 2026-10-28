/**
 * Where output styles come from, and the rules that turn them into one list.
 *
 * Three sources, in order of trust. `builtin` styles ship with this plugin as
 * Markdown under `plugins/output-styles/`; `user` styles are authored in the
 * page under the Agent layout root; `suite` styles belong to a market suite that
 * delivers its text through a SessionStart hook.
 *
 * A suite's text is never produced here. Running a hook is an effect with a
 * process behind it, so this module only computes the fingerprint a capture is
 * bound to and parses the text a capture produced. The run itself belongs to the
 * composition root, which already owns the bounded dry run.
 * @module application/output-styles
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { stripFrontmatter } from '../../../market-catalog/src/index.js'
import { parseFrontmatterRecord } from './panels/user-store.js'
import type { OutputStyleRow } from '../../../market-contracts/src/contracts/output-styles.js'

/** The directory inside the Agent layout root that holds user-authored styles. */
export const USER_OUTPUT_STYLE_DIRECTORY = 'output-styles'

/** The one builtin style name the default selection points at. */
export const BUILTIN_DEFAULT_NAME = 'default'

/** A user style name is a file stem: no separators, no traversal, no leading dot. */
const STYLE_NAME = /^[a-z0-9][a-z0-9._-]*$/

/**
 * Walk up to this package's root and return the builtin style directory.
 *
 * The workspace package and the packed artifact expose the collection at the
 * same relative spot, exactly like the vendored schemas: beside this package in
 * the checkout, and under the `plugins/output-styles` path preserved by the npm
 * "files" entry. The walk stops at the first manifest naming this package, so a
 * nested workspace package cannot answer for it.
 * @returns the absolute builtin style directory.
 * @throws when neither layout exists, because a missing builtin source would
 * silently drop the style that turns styles off.
 */
export function builtinStyleDirectory(): string {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name
      // `plugins/output-styles` is the Agent Plugins v1 plugin in the first-party
      // collection; the style documents are its `styles/` directory.
      if (name === '@dsh-market/runtime') return join(directory, '..', '..', 'plugins', 'output-styles', 'styles')
      if (name === 'dsh-agent-plugins-market') return join(directory, 'plugins', 'output-styles', 'styles')
    }
    const parent = dirname(directory)
    // One level per pass: a walk that skips a level could step over the package
    // root the next manifest would have named.
    if (parent === directory) throw new Error('dsh-agent-plugins-market package root is unavailable')
    directory = parent
  }
}

/** One Markdown style document: its frontmatter description and its body. */
interface StyleDocument {
  label: string
  description: string
  body: string
}

/**
 * Read one style document.
 *
 * The frontmatter carries `description:`; a document without one falls back to
 * its first non-empty line, so a hand-written file still says what it does
 * rather than rendering an empty description.
 * @param path - the document's absolute path.
 * @param name - the style name, used as the label.
 * @returns the parsed document.
 */
async function readStyleDocument(path: string, name: string): Promise<StyleDocument> {
  const text = await readFile(path, 'utf8')
  const body = stripFrontmatter(text)
  let description = ''
  try {
    const metadata = parseFrontmatterRecord(text)
    const declared = metadata['description']
    if (typeof declared === 'string') description = declared.trim()
  } catch {
    // An unreadable frontmatter leaves the body intact; the row then describes
    // itself from its first line instead of disappearing.
    description = ''
  }
  if (description === '') {
    description =
      body
        .split('\n')
        .map(line => line.trim())
        .find(line => line !== '') ?? ''
  }
  return { label: name, description, body }
}

/**
 * Read every builtin style.
 *
 * A missing directory answers an empty list rather than throwing: the collection
 * is a shipped artifact, and a profile that lacks it keeps every other source
 * working while the page reports no builtin styles.
 * @param directory - the builtin style directory; overridden by tests.
 * @returns the builtin rows in file-name order.
 */
export async function readBuiltinStyles(directory: string = builtinStyleDirectory()): Promise<OutputStyleRow[]> {
  let names: string[]
  try {
    names = (await readdir(directory)).filter(entry => entry.endsWith('.md')).sort()
  } catch {
    return []
  }
  const rows: OutputStyleRow[] = []
  for (const entry of names) {
    const name = entry.slice(0, -'.md'.length)
    try {
      const document = await readStyleDocument(join(directory, entry), name)
      rows.push({ id: `builtin:${name}`, label: document.label, description: document.description, body: document.body, source: 'builtin' })
    } catch {
      // One unreadable file costs that style, never the list.
      continue
    }
  }
  return rows
}

/** The directory holding the user's authored styles for one Agent layout root. */
export function userStyleDirectory(agentsRoot: string): string {
  return join(agentsRoot, USER_OUTPUT_STYLE_DIRECTORY)
}

/**
 * Validate one requested style name and return the file it may write.
 *
 * The name is a file stem the page shows and the heading carries. Anything with
 * a separator or a traversal segment is refused here, so a request can never
 * name a path outside the style directory.
 * @param agentsRoot - the Agent layout root.
 * @param name - the requested style name.
 * @returns the style's absolute file path.
 * @throws when the name is not a usable file stem.
 */
export function userStylePath(agentsRoot: string, name: string): string {
  if (!STYLE_NAME.test(name)) throw new Error(`"${name}" is not a usable style name: use lowercase letters, digits, dot, dash or underscore`)
  const directory = userStyleDirectory(agentsRoot)
  const path = join(directory, `${name}.md`)
  // Belt and braces: the resolved path must stay inside the style directory even
  // if the pattern above is ever relaxed.
  const prefix = resolve(directory) + sep
  if (!resolve(path).startsWith(prefix)) throw new Error(`"${name}" resolves outside the output-style directory`)
  return path
}

/**
 * Read every user-authored style.
 *
 * A name that fails the file-stem rule is skipped, because the page cannot
 * address it and a rename needs the pattern; a document that cannot be read
 * costs that style only.
 * @param agentsRoot - the Agent layout root.
 * @returns the user rows in file-name order.
 */
export async function readUserStyles(agentsRoot: string): Promise<OutputStyleRow[]> {
  const directory = userStyleDirectory(agentsRoot)
  let names: string[]
  try {
    names = (await readdir(directory)).filter(entry => entry.endsWith('.md')).sort()
  } catch {
    return []
  }
  const rows: OutputStyleRow[] = []
  for (const entry of names) {
    const name = entry.slice(0, -'.md'.length)
    if (!STYLE_NAME.test(name)) continue
    try {
      const document = await readStyleDocument(join(directory, entry), name)
      rows.push({ id: `user:${name}`, label: document.label, description: document.description, body: document.body, source: 'user' })
    } catch {
      continue
    }
  }
  return rows
}

/**
 * Create or replace one user-authored style.
 *
 * The document is the description in frontmatter followed by the body, which is
 * the shape `readUserStyles` parses back. The write is atomic and creates the
 * style directory only.
 * @param agentsRoot - the Agent layout root.
 * @param name - the style name, already validated as a file stem.
 * @param description - the one-line description the page shows.
 * @param body - the style text.
 */
export async function writeUserStyle(agentsRoot: string, name: string, description: string, body: string): Promise<void> {
  const path = userStylePath(agentsRoot, name)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const frontmatter = ['---', `description: ${JSON.stringify(description.trim())}`, '---', ''].join('\n')
  await writeFileAtomic(path, `${frontmatter}${body}`, { mode: 0o644, dirMode: 0o700 })
}

/**
 * Remove one user-authored style.
 * @param agentsRoot - the Agent layout root.
 * @param name - the style name, already validated as a file stem.
 */
export async function deleteUserStyle(agentsRoot: string, name: string): Promise<void> {
  await rm(userStylePath(agentsRoot, name), { force: true })
}

/** One suite that declares a SessionStart hook, as the styles list needs it. */
export interface SuiteStyleCandidate {
  /** `sourceId/suiteId`. */
  suiteKey: string
  label: string
  description: string
  /** Hash of the declaration the captured text was produced from. */
  fingerprint: string
}

/**
 * Compute the fingerprint a suite's captured text is bound to.
 *
 * The identity covers everything a re-capture would read differently: the suite
 * address, its manifest version, where its files live, and the exact
 * SessionStart commands in declaration order. It deliberately does not hash the
 * hook script's own bytes: that would mean reading arbitrary executables on
 * every list read, and a suite that edits its script without changing its
 * declaration or version is caught the next time a person captures again, which
 * the page always offers.
 * @param input - the suite identity and its SessionStart commands.
 * @returns a stable hex digest.
 */
export function suiteStyleFingerprint(input: { suiteKey: string; version?: string; root?: string; commands: readonly string[] }): string {
  return createHash('sha256')
    .update(JSON.stringify({ suiteKey: input.suiteKey, version: input.version ?? '', root: input.root ?? '', commands: [...input.commands] }))
    .digest('hex')
}

/**
 * Extract the style text one SessionStart hook produced.
 *
 * A Claude Code hook answers JSON with `hookSpecificOutput.additionalContext`;
 * that field is the style. A hook that prints prose instead is accepted too,
 * because a style is text and the dry run already bounded it. Anything else is
 * a capture that produced nothing usable, and the caller reports it rather than
 * storing an empty style.
 * @param stdout - the dry run's standard output.
 * @returns the captured text.
 * @throws when the output carries no text, or the JSON carries no context.
 */
export function parseCapturedStyle(stdout: string): string {
  const trimmed = stdout.trim()
  if (trimmed === '') throw new Error('the SessionStart hook produced no output to capture')
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Not JSON after all; a style may legitimately start with a brace, so the
      // raw text is the answer rather than a parse failure.
      return trimmed
    }
    if (typeof parsed !== 'object' || parsed === null) return trimmed
    const specific = (parsed as Record<string, unknown>)['hookSpecificOutput']
    if (typeof specific === 'object' && specific !== null) {
      const context = (specific as Record<string, unknown>)['additionalContext']
      if (typeof context === 'string' && context.trim() !== '') return context.trim()
    }
    throw new Error('the SessionStart hook output carries no hookSpecificOutput.additionalContext text')
  }
  return trimmed
}
