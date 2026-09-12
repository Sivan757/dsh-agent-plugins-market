/**
 * Shared persistence primitives for the market's user-authored panels:
 * skills, commands, and agent personas. Each panel owns one directory of
 * Markdown files under the plugin data root, parsed with the same frontmatter
 * rules the catalog uses, so user entries look exactly like suite entries to
 * the runtime mounts.
 * @module runtime/user-store
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'

/** Where user panel entries persist: `<userRoot>/user/<kind>/`. */
export function userEntryDir(dataRoot: string, kind: 'skills' | 'commands' | 'agents'): string {
  return join(dataRoot, 'user', kind)
}

/** `[a-z][a-z0-9_-]*` — the grammar every panel entry name must satisfy. */
export const USER_ENTRY_NAME = /^[a-z][a-z0-9_-]*$/

/** Parse full YAML metadata without flattening arrays, mappings, or multiline strings. */
export function parseFrontmatterRecord(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null) {
    if (/^---(?:\r?\n|$)/.test(text)) throw new Error('Invalid frontmatter: missing closing delimiter')
    return {}
  }
  const doc = parseDocument(match[1])
  if (doc.errors.length > 0) throw new Error(`Invalid frontmatter: ${doc.errors[0]!.message}`)
  const value: unknown = doc.toJS({ maxAliasCount: 100 })
  if (value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Frontmatter must be a mapping')
  return value as Record<string, unknown>
}

/** Read one entry; strict runtime snapshots throw on I/O errors other than a vanished file. */
export async function readEntryFile(file: string, fallbackName: string, strict = false): Promise<UserEntryFile | undefined> {
  if (fallbackName !== '' && !USER_ENTRY_NAME.test(fallbackName)) return undefined
  let text: string
  try {
    text = await readFile(file, 'utf8')
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
  const parsed = parseSkillFrontmatter(text, fallbackName)
  const name = typeof parsed === 'string' ? fallbackName : typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : fallbackName
  return {
    fallbackName,
    name,
    file,
    text,
    body: stripFrontmatter(text),
    meta,
    ...(typeof parsed === 'string' ? {} : parsed)
  }
}

/** One parsed Markdown panel entry. */
export interface UserEntryFile {
  /** The file's base name (the entry identity). */
  fallbackName: string
  /** The frontmatter name when valid, else the fallback. */
  name: string
  /** Absolute file path. */
  file: string
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

/** List `.md` entries; strict runtime snapshots propagate I/O errors instead of publishing partial inventories. */
export async function listEntryFiles(dir: string, strict = false): Promise<UserEntryFile[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
  const found: UserEntryFile[] = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.md')) continue
    const file = join(dir, entry)
    try {
      const info = await stat(file)
      if (!info.isFile()) continue
    } catch (error) {
      if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      continue
    }
    const parsed = await readEntryFile(file, entry.slice(0, -3), strict)
    if (parsed !== undefined) found.push(parsed)
  }
  return found
}

/** Write one panel entry; the name becomes `<name>.md`. */
export async function writeEntryFile(dir: string, name: string, text: string): Promise<void> {
  assertEntryName(name)
  parseFrontmatterRecord(text)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.md`), text, 'utf8')
}

/**
 * Enforce the entry-name grammar at every filesystem choke point. The name
 * is interpolated into `join(dir, name + '.md')`, so an unchecked name with
 * separators or `..` could address any `.md` file (or directory) on disk —
 * read, write, and delete all go through this guard.
 */
function assertEntryName(name: string): void {
  if (!USER_ENTRY_NAME.test(name)) throw new Error(`invalid entry name "${name}" — use lowercase letters, digits, dashes, or underscores, starting with a letter`)
}

/** Delete one panel entry file; missing files resolve silently. */
export async function deleteEntryFile(dir: string, name: string): Promise<void> {
  assertEntryName(name)
  await rm(join(dir, `${name}.md`), { force: true })
}

/** Whether an entry file with that name already exists. */
export async function entryExists(dir: string, name: string): Promise<boolean> {
  if (!USER_ENTRY_NAME.test(name)) return false
  try {
    await stat(join(dir, `${name}.md`))
    return true
  } catch {
    return false
  }
}

/** Serialize a frontmatter block from a shallow record (deterministic key order). */
export function serializeFrontmatter(meta: Record<string, unknown>): string {
  if (Object.keys(meta).length === 0) return ''
  return `---\n${stringify(meta, { sortMapEntries: true })}---\n`
}
