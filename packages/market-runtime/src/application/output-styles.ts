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
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { stripFrontmatter } from '../../../market-catalog/src/index.js'
import { parseFrontmatterRecord } from './panels/user-store.js'
import type { OutputStyleRow } from '../../../market-contracts/src/contracts/output-styles.js'

/** The directory inside the Agent layout root that holds user-authored styles. */
export const USER_OUTPUT_STYLE_DIRECTORY = 'output-styles'

/** A user style name is a file stem: no separators, no traversal, no leading dot. */
const STYLE_NAME = /^[a-z0-9][a-z0-9._-]*$/

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
  // A trailing newline is the file's habit, not part of the style text: the injected
  // section is exactly the instructions.
  const body = stripFrontmatter(text).trim()
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

/** One Markdown style an enabled suite ships. */
export interface SuiteStyleEntry {
  /** The suite address, `sourceId/suiteId`. */
  suiteKey: string
  /** The suite's display name, so a row can say which suite it came from. */
  suiteName: string
  /** The style's name, from its frontmatter or its file stem. */
  name: string
  description: string
  /** The instructions themselves. */
  body: string
  /** The Markdown file the style was read from. */
  file: string
}

/** The directory a workspace keeps its own styles in, Claude Code's project scope. */
export const PROJECT_OUTPUT_STYLE_DIRECTORY = '.claude/output-styles'

/**
 * Read the styles a workspace keeps for itself.
 *
 * Claude Code loads project styles from every `.claude/output-styles/` between the
 * working directory and the repository root, and the directory closest to the working
 * directory wins when two declare the same name. This walks the same chain outward and
 * keeps the first hit for each name.
 * @param workspace - the workspace's absolute directory.
 * @returns the project rows, nearest first by name.
 */
export async function readProjectStyles(workspace: string): Promise<OutputStyleRow[]> {
  const found = new Map<string, OutputStyleRow>()
  let directory = resolve(workspace)
  for (let depth = 0; depth < 16; depth += 1) {
    const styleDirectory = join(directory, PROJECT_OUTPUT_STYLE_DIRECTORY)
    let names: string[]
    try {
      names = (await readdir(styleDirectory)).filter(entry => entry.endsWith('.md')).sort()
    } catch {
      names = []
    }
    for (const entry of names) {
      const name = entry.slice(0, -'.md'.length)
      // The nearest directory wins, so an outer copy never replaces one already found.
      if (found.has(name)) continue
      try {
        const document = await readStyleDocument(join(styleDirectory, entry), name)
        found.set(name, {
          id: `project:${name}`,
          label: document.label,
          description: document.description,
          body: document.body,
          source: 'project',
          file: join(styleDirectory, entry)
        })
      } catch {
        continue
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return [...found.values()].sort((left, right) => left.label.localeCompare(right.label))
}
