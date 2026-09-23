/**
 * Shared persistence primitives for the market's user-authored panels:
 * skills, commands, and agent personas. Each panel owns one directory of
 * Markdown documents under the Agent layout root, parsed with the same
 * frontmatter rules the catalog uses, so user entries look exactly like suite
 * entries to the runtime mounts.
 *
 * An entry is one document. A flat panel reads the immediate `<name>.md`
 * children of its directory; a nested panel (commands and agent personas)
 * reads every `.md` document at any depth and names each by its path relative
 * to that directory. Skills also accept the cross-tool directory spelling
 * (`<name>/SKILL.md`) that other Agent tools and the harness's own reader of
 * `~/.agents/skills` author, and read it from the top level only.
 * @module runtime/user-store
 */

import { readdir, readFile, rmdir, rm, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseDocument, stringify } from 'yaml'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'

/** Where user panel entries persist: `<agentsRoot>/<kind>/`. */
export function userEntryDir(agentsRoot: string, kind: 'skills' | 'commands' | 'agents'): string {
  return join(agentsRoot, kind)
}

/** `[a-z][a-z0-9_-]*` — one segment of a panel entry name. */
export const USER_ENTRY_NAME = /^[a-z][a-z0-9_-]*$/

/**
 * The path grammar a nested panel entry name satisfies: one or more
 * {@link USER_ENTRY_NAME} segments joined by `/`. It rejects `..`, leading or
 * trailing separators, empty segments, backslashes, and uppercase, so the name
 * stays a path relative to the panel directory.
 */
export const USER_ENTRY_PATH = /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/

/** The file name of a directory-shaped skill's document. */
export const SKILL_ENTRY_FILE = 'SKILL.md'

/**
 * How one entry is spelled on disk under its kind directory: `<name>.md`, or
 * `<name>/SKILL.md` for the cross-tool skill directory shape.
 */
export type EntryShape = 'file' | 'skill-directory'

/**
 * The spellings the skills panel serves, most preferred first: a name present
 * as both a directory and a file resolves to the directory, which is the
 * canonical cross-tool spelling and the one the harness's own reader of
 * `~/.agents/skills` reaches first.
 */
export const SKILL_ENTRY_SHAPES: readonly EntryShape[] = ['skill-directory', 'file']

/** The document path one entry name maps to under its kind directory. */
export function entryDocumentPath(dir: string, name: string, shape: EntryShape): string {
  return shape === 'skill-directory' ? join(dir, name, SKILL_ENTRY_FILE) : join(dir, `${name}.md`)
}

/** One resolved entry document, before its bytes are read. */
export interface EntryDocument {
  /** Entry identity: the file's base name, or the skill directory's name. */
  name: string
  /** Absolute document path. */
  file: string
  /** Directory that relative resources inside the document resolve against. */
  directory: string
  shape: EntryShape
}

/** Whether a path is a regular file; strict runtime snapshots propagate real I/O failures. */
async function isFile(file: string, strict: boolean): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

/**
 * Resolve one entry name to its document, taking the first shape the path
 * exists in. A nested panel accepts a path name (`git/commit`); a flat panel
 * accepts a single segment. Names outside the panel's grammar never touch the
 * filesystem.
 */
export async function resolveEntryDocument(dir: string, name: string, shapes: readonly EntryShape[], strict = false, nested = false): Promise<EntryDocument | undefined> {
  if (!(nested ? USER_ENTRY_PATH : USER_ENTRY_NAME).test(name)) return undefined
  for (const shape of shapes) {
    const file = entryDocumentPath(dir, name, shape)
    if (await isFile(file, strict)) return { name, file, directory: dirname(file), shape }
  }
  return undefined
}

/**
 * Every entry document the served shapes expose. A flat panel reads immediate
 * children only; a nested panel walks every subdirectory to any depth and
 * names each entry by its path relative to `dir`. Entries are deduplicated by
 * name at the first shape that has it.
 */
export async function listEntryDocuments(dir: string, strict = false, shapes: readonly EntryShape[] = ['file'], nested = false): Promise<EntryDocument[]> {
  const found = new Map<string, EntryDocument>()
  if (nested) {
    await collectNestedEntryDocuments(dir, '', shapes, strict, found)
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
  for (const entry of entries.sort()) {
    const name = entry.endsWith('.md') ? entry.slice(0, -3) : shapes.includes('skill-directory') ? entry : undefined
    if (name === undefined || !USER_ENTRY_NAME.test(name)) continue
    for (const shape of shapes) {
      const file = entryDocumentPath(dir, name, shape)
      if (!(await isFile(file, strict))) continue
      found.set(name, { name, file, directory: dirname(file), shape })
      break
    }
  }
  return [...found.values()]
}

/**
 * Recursively collect the entry documents under one directory. Dot-directories,
 * `node_modules`, and symlinks are skipped, so the walk cannot follow a link
 * out of the panel directory; every segment must satisfy the entry grammar, so
 * a discovered name stays a relative path. `prefix` is that path so far, with
 * `/` separators and no trailing slash.
 */
async function collectNestedEntryDocuments(dir: string, prefix: string, shapes: readonly EntryShape[], strict: boolean, found: Map<string, EntryDocument>): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    if (entry.isDirectory()) {
      if (!USER_ENTRY_NAME.test(entry.name)) continue
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (shapes.includes('skill-directory') && (await isFile(join(dir, entry.name, SKILL_ENTRY_FILE), strict))) {
        found.set(name, { name, file: join(dir, entry.name, SKILL_ENTRY_FILE), directory: join(dir, entry.name), shape: 'skill-directory' })
      }
      await collectNestedEntryDocuments(join(dir, entry.name), name, shapes, strict, found)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const segment = entry.name.slice(0, -3)
    if (!USER_ENTRY_NAME.test(segment)) continue
    const name = prefix === '' ? segment : `${prefix}/${segment}`
    found.set(name, { name, file: join(dir, entry.name), directory: dir, shape: 'file' })
  }
}

/** Parse full YAML metadata without flattening arrays, mappings, or multiline strings. */
export function parseFrontmatterRecord(text: string): Record<string, unknown> {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1]
  if (frontmatter === undefined) {
    if (/^---(?:\r?\n|$)/.test(text)) throw new Error('Invalid frontmatter: missing closing delimiter')
    return {}
  }
  const doc = parseDocument(frontmatter)
  const error = doc.errors[0]
  if (error !== undefined) throw new Error(`Invalid frontmatter: ${error.message}`)
  const value: unknown = doc.toJS({ maxAliasCount: 100 })
  if (value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Frontmatter must be a mapping')
  return value as Record<string, unknown>
}

/** Read one resolved entry; strict runtime snapshots throw on I/O errors other than a vanished file. */
export async function readEntryDocument(document: EntryDocument, strict = false): Promise<UserEntryFile | undefined> {
  let text: string
  try {
    text = await readFile(document.file, 'utf8')
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
  let meta: Record<string, unknown>
  try {
    meta = parseFrontmatterRecord(text)
  } catch (error) {
    meta = { disabled: true, validationError: String(error) }
  }
  // The declared name is read without an expected-value check: the harness's
  // own reader of this directory takes the frontmatter name as the skill's
  // name and never compares it to the file or directory name.
  const parsed = parseSkillFrontmatter(text, undefined)
  const name = typeof parsed === 'string' ? document.name : typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : document.name
  return {
    documentName: document.name,
    name,
    file: document.file,
    directory: document.directory,
    shape: document.shape,
    text,
    body: stripFrontmatter(text),
    meta,
    ...(typeof parsed === 'string' ? {} : parsed)
  }
}

/** One parsed Markdown panel entry. */
export interface UserEntryFile {
  /** The document's own name: the file's base name, or the skill directory's name. */
  documentName: string
  /** The `name` the document declares, else its document name. */
  name: string
  /** Absolute file path. */
  file: string
  /** Directory that relative resources inside the document resolve against. */
  directory: string
  /** How the entry is spelled on disk. */
  shape: EntryShape
  /** The raw file text, frontmatter included. */
  text: string
  /** The body after frontmatter removal. */
  body: string
  /** The shallow frontmatter record (description, hint, disabled, …). */
  meta: Record<string, unknown>
  /** Additional fields when the entry carried valid skill frontmatter. */
  whenToUse?: string
  /** The strict-parse description when the frontmatter was valid YAML. */
  description?: string
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
}

/** List entries across the served shapes; strict runtime snapshots propagate I/O errors instead of publishing partial inventories. */
export async function listEntryFiles(dir: string, strict = false, shapes: readonly EntryShape[] = ['file'], nested = false): Promise<UserEntryFile[]> {
  const documents = await listEntryDocuments(dir, strict, shapes, nested)
  const found: UserEntryFile[] = []
  for (const document of documents) {
    const parsed = await readEntryDocument(document, strict)
    if (parsed !== undefined) found.push(parsed)
  }
  return found
}

/** Create one panel entry's document from its name: `<name>.md`, or `<name>/SKILL.md` in the directory shape. */
export async function writeEntryFile(dir: string, name: string, text: string, shape: EntryShape = 'file'): Promise<void> {
  assertEntryName(name)
  const file = entryDocumentPath(dir, name, shape)
  await writeEntryDocument({ name, file, directory: dirname(file), shape }, text)
}

/** Replace one resolved entry's document in place, wherever it lives. */
export async function writeEntryDocument(document: EntryDocument, text: string): Promise<void> {
  assertEntryName(document.name)
  parseFrontmatterRecord(text)
  await writeFileAtomic(document.file, text, { mode: 0o644, dirMode: 0o700 })
}

/**
 * Enforce the entry-name path grammar at every filesystem choke point. The
 * name is interpolated into `join(dir, name + '.md')`, so an unchecked name
 * with separators or `..` could address any `.md` file (or directory) on disk
 * — read, write, and delete all go through this guard. Whether the panel
 * accepts a nested path or a single segment is decided where a caller-supplied
 * name enters the store (`resolveEntryDocument` and the store's own checks).
 */
function assertEntryName(name: string): void {
  if (!USER_ENTRY_PATH.test(name)) throw new Error(`invalid entry name "${name}" — use lowercase letters, digits, dashes, or underscores, starting with a letter`)
}

/**
 * Delete one resolved entry's document; a missing file resolves silently. A
 * skill directory belongs to whichever tool authored it, so removal deletes
 * the document it served and the directory only once nothing else is left in
 * it — never the `references/`, `scripts/`, or persona files beside its
 * `SKILL.md`.
 */
export async function deleteEntryDocument(document: EntryDocument): Promise<void> {
  assertEntryName(document.name)
  await rm(document.file, { force: true })
  if (document.shape === 'skill-directory') await rmdir(dirname(document.file)).catch(() => undefined)
}

/** Whether an entry document with that name exists in any served shape. */
export async function entryExists(dir: string, name: string, shapes: readonly EntryShape[] = ['file'], nested = false): Promise<boolean> {
  return (await resolveEntryDocument(dir, name, shapes, false, nested)) !== undefined
}

/** Serialize a frontmatter block from a shallow record (deterministic key order). */
export function serializeFrontmatter(meta: Record<string, unknown>): string {
  if (Object.keys(meta).length === 0) return ''
  return `---\n${stringify(meta, { sortMapEntries: true })}---\n`
}
