/**
 * Archive source acquisition: HTTPS download, SHA-256 verification, and safe
 * extraction of zip / tar.gz / tgz / tar payloads into a source checkout.
 *
 * The pipeline mirrors the acquisition guarantees of Claude Code's `archive`
 * plugin source: HTTPS-only by default, a 256 MiB cap, and an optional
 * SHA-256 pin that doubles as an integrity check. Extraction is guarded
 * against path traversal (zip-slip): zip entries are name-checked and never
 * materialized as symlinks, and tar output is walked afterward so no symlink
 * may point outside the extraction root.
 *
 * The same primitives back the git codeload-tarball fallback in
 * `application/catalog.ts`, which is why extraction and layout normalization
 * live here instead of inline in the manager.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, open, readdir, readFile, readlink, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { unzipSync } from 'fflate'

const run = promisify(execFile)

/** Hard cap on archive download size (mirrors Claude Code's archive limit). */
export const ARCHIVE_MAX_BYTES = 256 * 1024 * 1024

/** Hard cap on the total decompressed bytes one archive may write. */
export const ARCHIVE_MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024

/** Hard cap on the number of files one archive may write. */
export const ARCHIVE_MAX_ENTRIES = 20_000

/** Hard cap on the decompressed size of a single archive entry. */
export const ARCHIVE_MAX_ENTRY_BYTES = 128 * 1024 * 1024

export const DEFAULT_ARCHIVE_TIMEOUT_MS = 180_000

/** Options for one archive acquisition. */
export interface ArchiveOptions {
  /** Required SHA-256 hex digest of the payload; mismatch rejects the install. */
  sha256?: string
  /** Download timeout; defaults to 180s. */
  timeoutMs?: number
  /** Allow plain `http://` (intranet mirrors); defaults to HTTPS-only. */
  allowHttp?: boolean
  /**
   * Explicit format for URLs whose extension does not reveal the payload
   * (e.g. a codeload tarball ending in a branch path). Overrides
   * {@link archiveFormatOf}; the caller owns the correctness of the hint.
   */
  format?: ArchiveFormat
}

/** Result of one successful archive install. */
export interface ArchiveInstallResult {
  /** SHA-256 hex digest of the downloaded payload (usable as a lock value). */
  sha256: string
}

/** Recognized archive payload kinds. */
export type ArchiveFormat = 'zip' | 'tar' | 'targz'

/** Classify an archive URL by extension; undefined when unsupported. */
export function archiveFormatOf(url: string): ArchiveFormat | undefined {
  const clean = url.trim().toLowerCase()
  if (clean.endsWith('.zip')) return 'zip'
  if (clean.endsWith('.tar.gz') || clean.endsWith('.tgz')) return 'targz'
  if (clean.endsWith('.tar')) return 'tar'
  return undefined
}

/** Download the payload to a temp file, enforcing the size cap and digest. */
export async function downloadArchive(url: string, tempFile: string, options: ArchiveOptions = {}): Promise<string> {
  const trimmed = url.trim()
  if (options.allowHttp !== true && !trimmed.startsWith('https://')) {
    throw new Error(`archive source requires an https:// URL: ${trimmed}`)
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_ARCHIVE_TIMEOUT_MS
  const response = await fetch(trimmed, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!response.ok) throw new Error(`archive download failed: HTTP ${response.status} for ${trimmed}`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > ARCHIVE_MAX_BYTES) {
    throw new Error(`archive exceeds the ${ARCHIVE_MAX_BYTES} byte limit: ${declared}`)
  }
  const body = response.body
  if (body === null) throw new Error(`archive download failed: empty response body for ${trimmed}`)
  const hash = createHash('sha256')
  const handle = await open(tempFile, 'w')
  try {
    let size = 0
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > ARCHIVE_MAX_BYTES) {
        void reader.cancel()
        throw new Error(`archive exceeds the ${ARCHIVE_MAX_BYTES} byte limit`)
      }
      hash.update(value)
      await handle.write(value)
    }
  } finally {
    await handle.close()
  }
  const sha256 = hash.digest('hex')
  if (options.sha256 !== undefined && options.sha256 !== '' && options.sha256.toLowerCase() !== sha256) {
    throw new Error(`archive sha256 mismatch: expected ${options.sha256}, got ${sha256}`)
  }
  return sha256
}

/**
 * Acquire one archive source into `dest`: download, verify, extract into a
 * sibling temp directory, normalize a single top-level wrapper directory,
 * then swap into `dest`. Returns the payload digest.
 */
export async function archiveInstall(url: string, dest: string, options: ArchiveOptions = {}): Promise<ArchiveInstallResult> {
  const format = options.format ?? archiveFormatOf(url)
  if (format === undefined) throw new Error(`unsupported archive format (expected .zip, .tar.gz, .tgz, or .tar): ${url}`)
  const parent = resolve(dest, '..')
  await mkdir(parent, { recursive: true })
  const stamp = `${process.pid}.${Date.now()}`
  const tempFile = join(parent, `.${stamp}.download`)
  const extractDir = join(parent, `.${stamp}.extract`)
  try {
    const sha256 = await downloadArchive(url, tempFile, options)
    await mkdir(extractDir, { recursive: true })
    if (format === 'zip') {
      await extractZip(tempFile, extractDir)
    } else {
      await extractTar(tempFile, extractDir, format)
    }
    await assertNoEscapingSymlinks(extractDir)
    const root = await unwrapSingleRoot(extractDir)
    await rm(dest, { recursive: true, force: true })
    try {
      await rename(root, dest)
    } catch {
      await copyTree(root, dest)
    }
    return { sha256 }
  } finally {
    await rm(tempFile, { force: true })
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Extract a zip payload with per-entry path-traversal guards and decompression
 * limits: total bytes, entry count, and per-entry size are bounded so a zip
 * bomb cannot exhaust memory or disk.
 */
async function extractZip(archiveFile: string, dest: string): Promise<void> {
  const buffer = await readFile(archiveFile)
  const entries = unzipSync(buffer)
  let totalBytes = 0
  const names = Object.keys(entries)
  if (names.length > ARCHIVE_MAX_ENTRIES) {
    throw new Error(`archive exceeds the ${ARCHIVE_MAX_ENTRIES} entry limit: ${names.length}`)
  }
  for (const [name, data] of Object.entries(entries)) {
    const normalized = name.replace(/\\/g, '/')
    if (normalized === '' || normalized.endsWith('/')) continue
    totalBytes += data.byteLength
    if (totalBytes > ARCHIVE_MAX_EXTRACTED_BYTES) {
      throw new Error(`archive exceeds the ${ARCHIVE_MAX_EXTRACTED_BYTES} byte extracted-size limit`)
    }
    if (data.byteLength > ARCHIVE_MAX_ENTRY_BYTES) {
      throw new Error(`archive entry "${name}" exceeds the ${ARCHIVE_MAX_ENTRY_BYTES} byte per-entry limit`)
    }
    assertSafeEntryName(normalized)
    const target = join(dest, normalized)
    if (target !== dest && !target.startsWith(`${dest}/`)) throw new Error(`zip entry escapes the extraction root: ${name}`)
    await mkdir(resolve(target, '..'), { recursive: true })
    const handle = await open(target, 'w')
    try {
      await handle.write(data)
    } finally {
      await handle.close()
    }
  }
}

function assertSafeEntryName(name: string): void {
  if (name.startsWith('/') || name === '..' || name.startsWith('../') || name.includes('/../')) {
    throw new Error(`archive entry escapes the extraction root: ${name}`)
  }
}

/**
 * Extract a tar / tar.gz payload with the system tar (bsdtar and GNU tar
 * sanitize member names), then bound what landed on disk: the walk enforces
 * the total-bytes, entry-count, and per-file limits so a tar bomb cannot
 * exhaust the disk. The system tar streams to disk, so the cap runs on the
 * output tree rather than on a decompressed in-memory buffer.
 */
async function extractTar(archiveFile: string, dest: string, format: ArchiveFormat): Promise<void> {
  const args = format === 'targz' ? ['-xzf', archiveFile] : ['-xf', archiveFile]
  args.push('--no-same-owner')
  await run('tar', args, { cwd: dest, timeout: 120_000 })
  await assertBoundedTree(dest)
}

/** Post-extraction disk bounds shared by tar formats. */
async function assertBoundedTree(root: string): Promise<void> {
  const stack: string[] = [root]
  let entriesSeen = 0
  let totalBytes = 0
  while (stack.length > 0) {
    const dir = stack.pop()!
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of dirents) {
      const path = join(dir, entry.name)
      entriesSeen += 1
      if (entriesSeen > ARCHIVE_MAX_ENTRIES) {
        throw new Error(`archive exceeds the ${ARCHIVE_MAX_ENTRIES} entry limit`)
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(path)
        continue
      }
      let size = 0
      try {
        size = (await stat(path)).size
      } catch {
        continue
      }
      totalBytes += size
      if (size > ARCHIVE_MAX_ENTRY_BYTES) {
        throw new Error(`archive entry exceeds the ${ARCHIVE_MAX_ENTRY_BYTES} byte per-entry limit: ${entry.name}`)
      }
      if (totalBytes > ARCHIVE_MAX_EXTRACTED_BYTES) {
        throw new Error(`archive exceeds the ${ARCHIVE_MAX_EXTRACTED_BYTES} byte extracted-size limit`)
      }
    }
  }
}

/** Walk the extracted tree and reject any symlink whose target resolves outside `root`. */
async function assertNoEscapingSymlinks(root: string): Promise<void> {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        // readlink, not readFile: readFile would follow the link and return the
        // target's *content*, so a link pointing outside the root resolves to a
        // bogus in-root path and the escape survives extraction.
        const target = await readlink(path, 'utf8').catch(() => '')
        const resolved = resolve(dir, target)
        if (resolved !== root && !resolved.startsWith(`${root}/`)) {
          throw new Error(`archive contains a symlink escaping the extraction root: ${entry.name} -> ${target}`)
        }
        continue
      }
      if (entry.isDirectory()) stack.push(path)
    }
  }
}

/** Test seam: run the symlink-containment walk against a prepared tree. */
export const assertNoEscapingSymlinksForTest = assertNoEscapingSymlinks

/** If the extraction produced exactly one top-level directory and nothing else, use it as the root. */
async function unwrapSingleRoot(extractDir: string): Promise<string> {
  const entries = await readdir(extractDir, { withFileTypes: true })
  if (entries.length === 1 && entries[0]!.isDirectory()) return join(extractDir, entries[0]!.name)
  return extractDir
}

async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await copyTree(source, target)
    else if (entry.isFile()) {
      const handle = await open(target, 'w')
      try {
        await handle.write(await readFile(source))
      } finally {
        await handle.close()
      }
    }
  }
}

/** Probe whether a path exists and is a directory. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
