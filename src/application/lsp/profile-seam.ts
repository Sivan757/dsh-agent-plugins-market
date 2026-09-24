/**
 * Legacy profile LSP layer: detection and one-action removal.
 *
 * Releases before the plugin provisioned LSP itself told users to expose the
 * capability from their profile — a `cordis.patch.yml` `insert` row for
 * `@deepseek-ai/dsh-lsp` and `@deepseek-ai/dsh-tool-lsp`, anchored by profile
 * dependencies on the packages. `LspMountRegistry` now mounts both seams from
 * this plugin's own aligned copies, so that layer registers a second `lsp`
 * service and the mount fails with `seam-conflict`.
 *
 * The plugin cannot drop the layer by patching: a profile's own patch file is
 * applied *after* every bundle layer, so this package's patch can never
 * disable the row. The user has to remove it, and that is the whole job here:
 * find the profile, and edit out exactly those rows.
 *
 * Editing happens on a file the user wrote by hand, so the rules are
 * conservative: the YAML document model preserves comments and unknown keys,
 * the rewrite is verified against an independently computed result before it
 * lands, and the previous content is kept beside it. Nothing else is touched —
 * a profile's `dependencies` stay as they are, because dropping a dependency
 * means running pnpm and this module never spawns anything.
 *
 * All paths come from `node:path` and all file work from `node:fs/promises`
 * plus the harness atomic-write helper, so the same code runs on macOS, Linux
 * and Windows; no shell, no path-separator assumption.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isNode, isScalar, isSeq, parseDocument, type Document, type Node } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '../../catalog/paths.js'

/** Every package the plugin provisions for LSP, in declaration order. */
export const LSP_PACKAGE_SPECIFIERS = ['@deepseek-ai/dsh-lsp', '@deepseek-ai/dsh-lsp-stdio', '@deepseek-ai/dsh-tool-lsp'] as const

/**
 * The specifiers whose `insert` row registers a seam this plugin now owns.
 * The stdio provider is excluded: it publishes no service, so a row for it
 * cannot conflict.
 */
const SEAM_SPECIFIERS: ReadonlySet<string> = new Set(['@deepseek-ai/dsh-lsp', '@deepseek-ai/dsh-tool-lsp'])

/** The profile patch filename the harness reads; part of the profile contract. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Default patch-file lifecycle when a profile manifest omits `dsh.profile.patchReload`. */
const DEFAULT_PATCH_RELOAD: PatchReload = 'live'

/** Whether the launcher watches the profile patch file after boot. */
export type PatchReload = 'live' | 'startup'

/** One `insert` row that claims a seam the plugin owns. */
export interface LegacySeamRow {
  /** The row's `id`, or an empty string when the user wrote none. */
  id: string
  /** The package name the row inserts. */
  name: string
}

/** A profile carrying a legacy LSP layer that must be removed. */
export interface LegacyLspSeam {
  /** Profile name, i.e. its directory basename. */
  profile: string
  /** Absolute profile directory. */
  dir: string
  /** Absolute path of the profile's patch file. */
  patchPath: string
  /** The conflicting `insert` rows, in file order. */
  rows: LegacySeamRow[]
  /** `dsh.profile.bundles` entries naming one of {@link LSP_PACKAGE_SPECIFIERS}. */
  bundles: string[]
  /** Declared dependency names drawn from {@link LSP_PACKAGE_SPECIFIERS}. */
  dependencies: string[]
  /** Whether the host hot-reloads the patch file, i.e. whether a restart is needed. */
  patchReload: PatchReload
}

/** Outcome of removing one profile's legacy LSP layer. */
export interface SeamMigrationResult {
  profile: string
  patchPath: string
  /** Where the pre-edit content was kept. */
  backupPath: string
  /** The rows that were removed. */
  removed: LegacySeamRow[]
  /** True when the host must restart before the removal takes effect. */
  restartRequired: boolean
}

/**
 * Find every profile that still registers a legacy LSP seam.
 *
 * Best effort by design: profile files are the user's, so a directory that
 * cannot be read or a patch file that does not parse is skipped rather than
 * failing the status surface that calls this.
 * @param home - the Harness home; defaults to `$DSH_HOME` or `~/.dsh`.
 * @returns each matching profile, ordered by profile name.
 */
export async function findLegacyLspSeams(home: string = resolveDshHome()): Promise<LegacyLspSeam[]> {
  const profilesDir = join(home, 'profiles')
  let entries: string[]
  try {
    entries = await readdir(profilesDir)
  } catch {
    return []
  }
  const found: LegacyLspSeam[] = []
  for (const name of entries.sort()) {
    // `node_modules` is the installation fallback sibling, not a profile, and
    // dot-directories hold launcher bookkeeping or the user's own backups.
    if (name === 'node_modules' || name.startsWith('.')) continue
    const dir = join(profilesDir, name)
    try {
      if (!(await stat(dir)).isDirectory()) continue
    } catch {
      continue
    }
    const seam = await inspectProfile(name, dir)
    if (seam !== undefined) found.push(seam)
  }
  return found
}

/** Read one profile directory and report its legacy layer, or undefined when it has none. */
async function inspectProfile(profile: string, dir: string): Promise<LegacyLspSeam | undefined> {
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  let text: string
  try {
    text = await readFile(patchPath, 'utf8')
  } catch {
    return undefined
  }
  const document = parseDocument(text)
  if (document.errors.length > 0) return undefined
  const rows = seamRows(document)
  const manifest = await readManifest(join(dir, 'package.json'))
  // Only a row (or a bundle layer) claims a seam. A bare dependency cannot
  // register anything, so a profile that lists the packages but inserts no row
  // is not the cause of a conflict and stays out of the report.
  if (rows.length === 0 && manifest.bundles.length === 0) return undefined
  return { profile, dir, patchPath, rows, bundles: manifest.bundles, dependencies: manifest.dependencies, patchReload: manifest.patchReload }
}

/**
 * Remove one profile's legacy LSP rows.
 *
 * The file is re-read here rather than trusting the caller's snapshot, so a
 * migration always edits the current on-disk content. The rewrite is verified
 * before it lands and the pre-edit content is written beside it first, so a
 * failure leaves the profile exactly as it was.
 * @param seam - a profile previously returned by {@link findLegacyLspSeams}.
 * @param now - timestamp used in the backup filename; injectable for tests.
 * @returns what was removed and where the backup went.
 * @throws Error when the profile no longer carries a removable row, or the rewrite does not verify.
 */
export async function migrateLegacyLspSeam(seam: LegacyLspSeam, now: Date = new Date()): Promise<SeamMigrationResult> {
  let original: string
  try {
    original = await readFile(seam.patchPath, 'utf8')
  } catch (error) {
    throw new Error(`cannot read the profile patch file ${seam.patchPath}: ${messageOf(error)}`, { cause: error })
  }
  const document = parseDocument(original)
  if (document.errors.length > 0) {
    throw new Error(`the profile patch file ${seam.patchPath} does not parse: ${document.errors[0]?.message ?? 'unknown error'}`)
  }
  const removed = stripSeamRows(document)
  if (removed.length === 0) throw new Error(`the profile ${seam.profile} no longer registers an LSP layer; reload the panel and try again`)
  const next = document.toString()
  assertStripped(original, next)
  const mode = await fileMode(seam.patchPath)
  const backupPath = `${seam.patchPath}.bak-lsp-seam-${stamp(now)}`
  await writeFileAtomic(backupPath, original, { mode })
  await writeFileAtomic(seam.patchPath, next, { mode })
  return { profile: seam.profile, patchPath: seam.patchPath, backupPath, removed, restartRequired: seam.patchReload !== 'live' }
}

/**
 * Drop every `insert` entry naming a seam package, in place.
 * A patch entry whose whole `insert` list is consumed leaves the document when
 * nothing else remains — the entry existed only to insert.
 * @returns the removed rows, in file order.
 */
function stripSeamRows(document: Document): LegacySeamRow[] {
  const removed: LegacySeamRow[] = []
  for (const item of rootItems(document)) {
    const container = mapNode(item, 'insert')
    if (!isSeq(container)) continue
    const entries = container.items as Node[]
    const keep: Node[] = []
    for (const entry of entries) {
      const name = mapText(entry, 'name')
      if (name !== undefined && SEAM_SPECIFIERS.has(name)) {
        removed.push({ id: mapText(entry, 'id') ?? '', name })
        continue
      }
      keep.push(entry)
    }
    if (keep.length === entries.length) continue
    if (keep.length > 0) {
      container.items = keep
      continue
    }
    // The `- insert:` form carries no other key, so the entry goes with its
    // list; the `- id: <group>` form configures a group and stays.
    if (isMap(item) && item.items.length > 1) {
      item.delete('insert')
      continue
    }
    const root = document.contents
    if (isSeq(root)) root.items = root.items.filter(candidate => candidate !== item)
  }
  return removed
}

/**
 * Prove the rewrite removed exactly the seam rows and nothing else.
 *
 * The expected result is computed independently from the plain parsed data, so
 * this compares two derivations rather than trusting the edit that produced
 * one of them. A mismatch aborts before anything is written.
 */
function assertStripped(original: string, next: string): void {
  if (seamRows(parseDocument(next)).length !== 0) throw new Error('the rewritten profile patch file still registers an LSP layer')
  const before: unknown = parseDocument(original).toJS()
  const after: unknown = parseDocument(next).toJS()
  const expected = stripSeamEntriesFromData(before)
  if (JSON.stringify(expected) !== JSON.stringify(after)) {
    throw new Error('the rewritten profile patch file would change unrelated patch entries; remove the LSP rows by hand instead')
  }
}

/** The same removal applied to plain parsed data, as the independent expectation. */
function stripSeamEntriesFromData(data: unknown): unknown {
  if (!Array.isArray(data)) return data
  const result: unknown[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      result.push(entry)
      continue
    }
    const record = entry as Record<string, unknown>
    if (!Array.isArray(record['insert'])) {
      result.push(entry)
      continue
    }
    const keep = record['insert'].filter(item => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return true
      const name = (item as Record<string, unknown>)['name']
      return !(typeof name === 'string' && SEAM_SPECIFIERS.has(name))
    })
    if (keep.length === record['insert'].length) {
      result.push(entry)
      continue
    }
    if (keep.length > 0) {
      result.push({ ...record, insert: keep })
      continue
    }
    const rest = Object.entries(record).filter(([key]) => key !== 'insert')
    if (rest.length > 0) result.push(Object.fromEntries(rest))
  }
  return result
}

/** Collect the `insert` rows that name one of {@link SEAM_SPECIFIERS}. */
function seamRows(document: Document): LegacySeamRow[] {
  const found: LegacySeamRow[] = []
  for (const item of rootItems(document)) {
    const entries = sequenceItems(mapNode(item, 'insert'))
    if (entries === undefined) continue
    for (const entry of entries) {
      const name = mapText(entry, 'name')
      if (name === undefined || !SEAM_SPECIFIERS.has(name)) continue
      found.push({ id: mapText(entry, 'id') ?? '', name })
    }
  }
  return found
}

/** The root sequence of a patch document; empty when the file holds something else. */
function rootItems(document: Document): Node[] {
  return sequenceItems(document.contents) ?? []
}

/** Read a mapping key as a child node, or undefined when the node is not a mapping. */
function mapNode(node: unknown, key: string): Node | undefined {
  if (!isMap(node)) return undefined
  const value: unknown = node.get(key, true)
  return isNode(value) ? value : undefined
}

/** Read a mapping key that holds a string scalar. */
function mapText(node: unknown, key: string): string | undefined {
  const value = mapNode(node, key)
  return isScalar(value) && typeof value.value === 'string' ? value.value : undefined
}

/** The items of a sequence node, or undefined when the node is not one. */
function sequenceItems(node: Node | null | undefined): Node[] | undefined {
  return isSeq(node) ? (node.items as Node[]) : undefined
}

/** The profile manifest fields this module reads; every one is optional in a local profile. */
interface ProfileManifestFacts {
  bundles: string[]
  dependencies: string[]
  patchReload: PatchReload
}

/** Read the manifest facts, treating an absent or malformed file as an empty profile. */
async function readManifest(path: string): Promise<ProfileManifestFacts> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return { bundles: [], dependencies: [], patchReload: DEFAULT_PATCH_RELOAD }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { bundles: [], dependencies: [], patchReload: DEFAULT_PATCH_RELOAD }
  }
  const record = parsed as Record<string, unknown>
  const known = new Set<string>(LSP_PACKAGE_SPECIFIERS)
  const dependencies: string[] = []
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const table = record[field]
    if (typeof table !== 'object' || table === null || Array.isArray(table)) continue
    for (const name of Object.keys(table)) if (known.has(name) && !dependencies.includes(name)) dependencies.push(name)
  }
  const scope = objectAt(objectAt(record['dsh'], 'profile'))
  const rawBundles = scope['bundles']
  const bundles = Array.isArray(rawBundles) ? rawBundles.filter((value): value is string => typeof value === 'string' && known.has(value)) : []
  return { bundles, dependencies, patchReload: scope['patchReload'] === 'startup' ? 'startup' : DEFAULT_PATCH_RELOAD }
}

/** Read one nested object field, or an empty record when the value is not an object. */
function objectAt(value: unknown, key?: string): Record<string, unknown> {
  const target = key === undefined ? value : typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
  return typeof target === 'object' && target !== null && !Array.isArray(target) ? (target as Record<string, unknown>) : {}
}

/** Preserve the patch file's permission bits; Windows reports a synthetic mode. */
async function fileMode(path: string): Promise<number> {
  try {
    return (await stat(path)).mode & 0o777 || 0o644
  } catch {
    return 0o644
  }
}

/** A filename-safe local timestamp: no colons, so Windows accepts it. */
function stamp(now: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One-line remediation shared by the mount diagnostic and the status payload. */
export function describeLegacySeam(seam: LegacyLspSeam): string {
  const rows = seam.rows.map(row => (row.id === '' ? row.name : `${row.id} (${row.name})`)).join(', ')
  return `profile "${seam.profile}" still inserts the LSP layer (${rows}) from ${seam.patchPath}`
}
