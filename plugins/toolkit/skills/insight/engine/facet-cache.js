// Cross-run facet cache for the insight semantic stage.
//
// One validated facet is persisted per task family under
// `$DSH_HOME/insights/cache/facets` so a later run can reuse a judgement whose
// evidence, privacy, depth and contract version are unchanged. Entries are
// private (0700 directories, 0600 files), symlinks are never followed, a
// corrupt entry is deleted and treated as a miss, and no cache failure may fail
// the run: the cache disables itself and reports the reason instead.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** Largest cache entry this module will read or write. */
const MAX_ENTRY_BYTES = 256 * 1024
/** Components below the managed home, created one at a time to refuse links. */
const DIRECTORIES = ['insights', 'cache', 'facets']
/** A family id that is already one safe path segment inlines into the file name. */
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,120}$/

const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** `lstat` that reports absence as null and any error as unsafe absence. */
function lstat(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

const sha = (value) =>
  createHash('sha256').update(String(value)).digest('hex')

export class FacetCache {
  /**
   * @param {{home: string, contractVersion: string, analysisPrivacy: string, analysisDepth: string}} options
   */
  constructor({ home, contractVersion, analysisPrivacy, analysisDepth }) {
    this.contractVersion = contractVersion
    this.analysisPrivacy = analysisPrivacy
    this.analysisDepth = analysisDepth
    this.directory = join(home, ...DIRECTORIES)
    this.home = home
    this.stats = {
      enabled: true,
      hits: 0,
      misses: 0,
      invalidations: 0,
      deleted: 0,
      write_errors: 0,
      disabled_reason: null,
    }
  }

  /** Walk the managed components without following links; create them on demand. */
  resolveDirectory(create) {
    let current = this.home
    for (const part of DIRECTORIES) {
      current = join(current, part)
      let stat = lstat(current)
      if (stat === null) {
        if (!create) return null
        try {
          mkdirSync(current, { mode: 0o700 })
        } catch (error) {
          return this.disable(error)
        }
        stat = lstat(current)
      }
      if (stat === null || stat.isSymbolicLink() || !stat.isDirectory())
        return this.disable(new Error(`unsafe cache directory: ${current}`))
    }
    return current
  }

  /** Record why the cache is off; the run continues without it. */
  disable(error) {
    if (this.stats.enabled) {
      this.stats.enabled = false
      this.stats.disabled_reason =
        error instanceof Error ? error.message : String(error)
    }
    return null
  }

  /** One file per task family; an unsafe id keeps a stable hashed name. */
  entryName(taskFamilyId) {
    return SAFE_SEGMENT.test(taskFamilyId) &&
      taskFamilyId !== '.' &&
      taskFamilyId !== '..'
      ? `${taskFamilyId}.json`
      : `family-${sha(taskFamilyId).slice(0, 32)}.json`
  }

  entryPath(taskFamilyId, directory) {
    return join(directory, this.entryName(taskFamilyId))
  }

  /** Delete one entry; never throws. */
  remove(path) {
    try {
      unlinkSync(path)
      return true
    } catch {
      return false
    }
  }

  /** Read and parse one entry, deleting it when it is not a usable regular file. */
  readEntry(path) {
    const stat = lstat(path)
    if (stat === null) return null
    let fd = null
    try {
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
        if (this.remove(path)) this.stats.deleted++
        return null
      }
      fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      const opened = fstatSync(fd)
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.size > MAX_ENTRY_BYTES
      ) {
        closeSync(fd)
        fd = null
        if (this.remove(path)) this.stats.deleted++
        return null
      }
      const buffer = Buffer.alloc(opened.size)
      let offset = 0
      while (offset < opened.size) {
        const length = readSync(fd, buffer, offset, opened.size - offset, offset)
        if (!length) break
        offset += length
      }
      const record = JSON.parse(buffer.subarray(0, offset).toString('utf8'))
      if (!object(record) || !object(record.facet)) {
        if (this.remove(path)) this.stats.deleted++
        return null
      }
      return record
    } catch {
      // A corrupt or unreadable entry is deleted and treated as a miss.
      if (this.remove(path)) this.stats.deleted++
      return null
    } finally {
      if (fd !== null) closeSync(fd)
    }
  }

  /**
   * Return the stored facet when every key component matches. A stale entry is
   * a miss and is left in place; a corrupt entry is a miss and is deleted.
   */
  get(taskFamilyId, fingerprint) {
    if (!this.stats.enabled) {
      this.stats.misses++
      return null
    }
    const directory = this.resolveDirectory(false)
    if (directory === null) {
      this.stats.misses++
      return null
    }
    const record = this.readEntry(this.entryPath(taskFamilyId, directory))
    if (
      record === null ||
      record.contract_version !== this.contractVersion ||
      record.fingerprint !== fingerprint ||
      record.analysis_privacy !== this.analysisPrivacy ||
      record.analysis_depth !== this.analysisDepth ||
      record.task_family_id !== taskFamilyId
    ) {
      this.stats.misses++
      return null
    }
    this.stats.hits++
    return record.facet
  }

  /** Persist one validated facet; a write failure is recorded, never thrown. */
  set(taskFamilyId, fingerprint, facet) {
    if (!this.stats.enabled) return false
    const directory = this.resolveDirectory(true)
    if (directory === null) return false
    const path = this.entryPath(taskFamilyId, directory)
    const record = {
      contract_version: this.contractVersion,
      fingerprint,
      analysis_privacy: this.analysisPrivacy,
      analysis_depth: this.analysisDepth,
      task_family_id: taskFamilyId,
      facet,
      saved_at: new Date().toISOString(),
    }
    let text
    try {
      text = JSON.stringify(record, null, 2) + '\n'
      if (Buffer.byteLength(text) > MAX_ENTRY_BYTES)
        throw new Error('cache entry is oversized')
    } catch {
      this.stats.write_errors++
      return false
    }
    const temporary = join(directory, `.entry-${randomUUID()}`)
    let fd = null
    try {
      if (lstat(path)?.isSymbolicLink()) this.remove(path)
      fd = openSync(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW || 0),
        0o600,
      )
      writeFileSync(fd, text, 'utf8')
      closeSync(fd)
      fd = null
      renameSync(temporary, path)
      return true
    } catch {
      this.stats.write_errors++
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {
          /* best effort */
        }
      }
      this.remove(temporary)
      return false
    }
  }

  /** Drop one entry, e.g. when a reused facet no longer validates. */
  invalidate(taskFamilyId) {
    if (!this.stats.enabled) return false
    const directory = this.resolveDirectory(false)
    if (directory === null) return false
    const removed = this.remove(this.entryPath(taskFamilyId, directory))
    if (removed) this.stats.invalidations++
    return removed
  }
}
