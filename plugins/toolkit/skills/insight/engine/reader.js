// Session discovery and snapshot collection for the insight engine.
//
// This module stands in for the host `sessionQuery` service the upstream engine
// expects. It enumerates persisted session logs, resolves the canonical
// generation of each logical session, reads snapshots through the installed
// host persistence and query libraries, and applies the window, project and
// hard selection bounds before the analyzer ever sees a snapshot. A project
// scope is decided by the recorded `cwd` in each session header, never by the
// on-disk project directory name, which is a lossy encoding of the path.
//
// Session logs are read in place. Nothing here writes below the sessions root.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

/** Hard bound on the sessions one selection may carry. */
export const MAX_SESSIONS = 2000
/** Hard bound on the serialized snapshot bytes one selection may carry. */
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024

/**
 * Raised when a `--project` scope matched no session in the window.
 *
 * An empty retrospective that exits 0 is the worst failure mode this engine
 * has, so a scope with no sessions is a distinct non-zero outcome: the caller
 * prints this message and never writes a report.
 */
export class EmptyProjectScopeError extends Error {
  constructor(project, days, inWindow) {
    super(
      `no session used project ${project} within the last ${days} days ` +
        `(${inWindow} sessions were examined in that window); no report was written`,
    )
    this.name = 'EmptyProjectScopeError'
    this.project = project
    this.days = days
    this.sessions_in_window = inWindow
  }
}

/** Canonical session log grammar: `session.jsonl` is v0, `session.vN.jsonl` is vN. */
const LOG_VERSION_RE = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/
const COMPRESSIONS = ['none', 'zstd']
const COMPRESSION_SUFFIX = { none: '', zstd: '.zstd' }
/** The three host packages the reader imports, resolved at run time. */
const HOST_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-query',
]

/** Candidate directories that may hold the host's installed packages. */
function moduleSearchRoots(home) {
  const roots = []
  const add = (value) => {
    if (value && !roots.includes(value)) roots.push(join(value, 'node_modules'))
  }
  add(join(home, 'profiles'))
  add(home)
  add(dirname(home))
  const profiles = join(home, 'profiles')
  if (existsSync(profiles)) {
    for (const entry of readdirSync(profiles)) add(join(profiles, entry))
  }
  return roots.filter(existsSync)
}

/** Resolve one installed host package to its module entry file. */
function resolveHostPackage(roots, name) {
  for (const root of roots) {
    const directory = join(root, ...name.split('/'))
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) continue
    const entry = join(directory, 'lib', 'index.js')
    if (!existsSync(entry))
      throw new Error(
        `host package ${name} has no lib/index.js at ${directory}; reinstall it or remove it from ${root}`,
      )
    return entry
  }
  throw new Error(
    `host package ${name} is not installed; looked for it under:\n  ${roots.join('\n  ')}`,
  )
}

/** Return the resolved DSH home directory, failing loudly when it is absent. */
export function dshHome() {
  const home = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  if (!existsSync(home))
    throw new Error(
      `DSH_HOME does not exist: ${home}; set DSH_HOME to the harness home directory`,
    )
  return home
}

/** Import the host libraries this reader drives. */
async function loadHost() {
  const roots = moduleSearchRoots(dshHome())
  const [cordis, jsonl, query] = HOST_PACKAGES.map((name) =>
    resolveHostPackage(roots, name),
  )
  const [{ Context }, persistence, queryModule] = await Promise.all([
    import(pathToFileURL(cordis).href),
    import(pathToFileURL(jsonl).href),
    import(pathToFileURL(query).href),
  ])
  return {
    Context,
    JsonlSessionPersistence: persistence.default,
    readColdSessionLog: queryModule.readColdSessionLog,
    formatVersion: await currentFormatVersion(roots),
  }
}

/** Read the session log format version the installed Session package reads. */
async function currentFormatVersion(roots) {
  const session = resolveHostPackage(roots, '@deepseek-ai/dsh-session')
  const module = await import(pathToFileURL(session).href)
  const version = module.SESSION_FORMAT_VERSION
  if (!Number.isSafeInteger(version) || version < 0)
    throw new Error(
      'the installed @deepseek-ai/dsh-session does not export a usable SESSION_FORMAT_VERSION',
    )
  return version
}

/** Read the format version named by one canonical log filename. */
function logVersion(filename, compression) {
  const suffix = COMPRESSION_SUFFIX[compression]
  if (!filename.endsWith(suffix)) return null
  const match = LOG_VERSION_RE.exec(filename.slice(0, filename.length - suffix.length))
  if (match === null) return null
  return match[1] === undefined ? 0 : Number(match[1])
}

function info(path) {
  try {
    return statSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function normalizeProject(value) {
  const path = String(value).replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path
}

function projectMatches(cwd, project) {
  const actual = normalizeProject(cwd)
  const requested = normalizeProject(project)
  return actual === requested || actual.startsWith(requested + '/')
}

/**
 * Enumerate one selection of canonical session logs.
 *
 * Only immediate children of the sessions root are project directories and only
 * immediate children of those are session directories, mirroring the host
 * resolver. Inside a session directory the numerically highest canonical
 * generation of the encoded suffix wins; a directory holding both the plain and
 * the compressed encoding is ambiguous and is reported rather than guessed at.
 * The directory name is never decoded back into a path: a project scope needs
 * the recorded header `cwd`, which `collectSnapshots` reads before filtering.
 * @param {string} sessionsRoot - the harness sessions root.
 * @param {{formatVersion: number}} limits
 * @returns {{entries: object[], coverage: object, skipped: object[]}}
 */
export function discoverSessionLogs(sessionsRoot, limits) {
  const coverage = {
    project_dirs: 0,
    session_dirs: 0,
    logs_selected: 0,
    skipped_no_log: 0,
    skipped_encoding_mismatch: 0,
    skipped_newer_generation: 0,
    skipped_flat_artifact: 0,
    // Discovery never drops a project directory: the project filter needs the
    // recorded header `cwd`, so it runs later, in collectSnapshots, and its own
    // counter lives on the selection.
    skipped_project: 0,
    unreadable_dirs: 0,
    generation_diagnostics: {
      versioned_generations: 0,
      legacy_generations: 0,
      plaintext_generations: 0,
      coexisting_generations: 0,
    },
  }
  const skipped = []
  const entries = []
  if (info(sessionsRoot) === null) return { entries, coverage, skipped }
  let projects
  try {
    projects = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    coverage.unreadable_dirs++
    return { entries, coverage, skipped }
  }
  for (const project of projects) {
    coverage.project_dirs++
    const projectPath = join(sessionsRoot, project)
    let sessionDirs
    try {
      sessionDirs = readdirSync(projectPath, { withFileTypes: true })
    } catch {
      coverage.unreadable_dirs++
      continue
    }
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) {
        if (sessionDir.name.endsWith('.jsonl') || sessionDir.name.endsWith('.jsonl.zstd'))
          coverage.skipped_flat_artifact++
        continue
      }
      coverage.session_dirs++
      const directory = join(projectPath, sessionDir.name)
      let names
      try {
        names = readdirSync(directory)
      } catch {
        coverage.unreadable_dirs++
        continue
      }
      const generations = new Map()
      for (const compression of COMPRESSIONS) {
        const found = names
          .map((name) => ({ name, version: logVersion(name, compression) }))
          .filter((item) => item.version !== null)
        if (found.length > 0) generations.set(compression, found)
      }
      if (generations.size === 0) {
        coverage.skipped_no_log++
        continue
      }
      if (generations.size > 1) {
        coverage.skipped_encoding_mismatch++
        skipped.push({
          session_id: sessionDir.name,
          workspace_dir: project,
          reason: 'encoding_mismatch',
        })
        continue
      }
      const [compression, found] = [...generations][0]
      if (found.length > 1) coverage.generation_diagnostics.coexisting_generations++
      found.sort((a, b) => b.version - a.version)
      const selected = found[0]
      if (selected.version > limits.formatVersion) {
        coverage.skipped_newer_generation++
        skipped.push({
          session_id: sessionDir.name,
          workspace_dir: project,
          reason: `generation_v${selected.version}_newer_than_v${limits.formatVersion}`,
        })
        continue
      }
      if (selected.version >= 1) coverage.generation_diagnostics.versioned_generations++
      else coverage.generation_diagnostics.legacy_generations++
      if (compression !== 'zstd') coverage.generation_diagnostics.plaintext_generations++
      coverage.logs_selected++
      entries.push({
        id: sessionDir.name,
        workspace_dir: project,
        path: join(directory, selected.name),
        version: selected.version,
      })
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return { entries, coverage, skipped }
}

/**
 * Collect snapshots for one selection.
 *
 * A project scope is decided by the recorded `cwd` of each session header, the
 * authoritative value, and never by the on-disk project directory name. The
 * window filter runs first and the project filter second, so a project scope
 * still reports how many sessions the window examined. The window and project
 * filters are applied twice on purpose: once on the lightweight header so
 * unreadable logs outside the selection are never opened, and again by the
 * analyzer, which owns the same contract. The session and byte ceilings cap the
 * selection instead of refusing it: candidates are taken newest-first until the
 * next one would cross either ceiling, then the read stops and the selection
 * reports the truncation, the counts behind it and the bound that stopped it.
 *
 * A project scope that matches nothing raises `EmptyProjectScopeError` instead
 * of returning an empty selection, so an empty retrospective can never exit 0.
 * @param {{now: number, days: number, project?: string, concurrency?: number}} options
 * @returns {Promise<{snapshots: object[], selection: object}>}
 */
export async function collectSnapshots(options) {
  const home = dshHome()
  const sessionsRoot = join(home, 'sessions')
  if (info(sessionsRoot) === null)
    throw new Error(`no session logs at ${sessionsRoot}`)
  const host = await loadHost()
  const context = new host.Context()
  const persistence = new host.JsonlSessionPersistence(context, { root: sessionsRoot })
  const discovered = discoverSessionLogs(sessionsRoot, { formatVersion: host.formatVersion })
  // The stored headers carry the recorded `cwd`, `createdAt` and `id`. Read the
  // whole listing once, up front, so every filter below is decided by the same
  // authoritative records the harness itself persists.
  const headers = await sessionHeaders(persistence)
  const cutoff = options.now - options.days * 86400000
  const selection = {
    sessions_root: sessionsRoot,
    format_version: host.formatVersion,
    cutoff,
    until: options.now,
    discovered: discovered.coverage.logs_selected,
    considered: 0,
    in_window: 0,
    in_scope: 0,
    read: 0,
    not_analyzed: 0,
    skipped_outside_window: 0,
    skipped_project: 0,
    skipped_unreadable: 0,
    skipped_unreadable_sessions: [],
    discovered_skipped: discovered.skipped,
    coverage: discovered.coverage,
    bounds: { max_sessions: MAX_SESSIONS, max_snapshot_bytes: MAX_SNAPSHOT_BYTES },
    snapshot_bytes: 0,
    truncated: false,
    stopped_by: null,
  }
  const candidates = []
  for (const entry of discovered.entries) {
    const stat = info(entry.path)
    if (stat === null) {
      selection.skipped_unreadable++
      selection.skipped_unreadable_sessions.push({ session_id: entry.id, reason: 'log disappeared during the scan' })
      continue
    }
    const header = headers.get(entry.id) ?? (await readHeader(persistence, entry.id))
    if (header === null || header === undefined) {
      selection.skipped_unreadable++
      selection.skipped_unreadable_sessions.push({ session_id: entry.id, reason: 'session header is unreadable' })
      continue
    }
    selection.considered++
    // Window first, project second: a project scope with no sessions in the
    // window is a distinct empty-scope outcome, not a silent empty report.
    if (!Number.isFinite(header.createdAt) || header.createdAt < cutoff || header.createdAt > options.now) {
      selection.skipped_outside_window++
      continue
    }
    selection.in_window++
    if (options.project !== undefined && !projectMatches(String(header.cwd || ''), options.project)) {
      selection.skipped_project++
      continue
    }
    candidates.push({ entry, header })
  }
  candidates.sort((a, b) => b.header.createdAt - a.header.createdAt || a.entry.id.localeCompare(b.entry.id))
  selection.in_scope = candidates.length
  if (options.project !== undefined && candidates.length === 0)
    throw new EmptyProjectScopeError(options.project, options.days, selection.in_window)
  const snapshots = []
  let bytes = 0
  let stoppedBy = null
  for (const candidate of candidates) {
    // The candidate list is already newest-first, so the first ceiling the next
    // session would cross ends the selection instead of failing the run.
    if (snapshots.length >= MAX_SESSIONS) {
      stoppedBy = 'max_sessions'
      break
    }
    let cold
    try {
      cold = await host.readColdSessionLog(persistence, candidate.entry.id)
    } catch (error) {
      selection.skipped_unreadable++
      selection.skipped_unreadable_sessions.push({
        session_id: candidate.entry.id,
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    // The analyzer reads `session` as the stored header; the host cold read
    // names it `header`. The selected on-disk generation replaces the host's
    // normalized current version so the report's generation coverage is
    // truthful about what was actually read.
    const snapshot = {
      session: { ...cold.header, version: candidate.entry.version },
      inheritedEventCount: cold.inheritedEventCount,
      events: cold.events,
    }
    const size = Buffer.byteLength(JSON.stringify(snapshot))
    if (bytes + size > MAX_SNAPSHOT_BYTES) {
      stoppedBy = 'max_snapshot_bytes'
      break
    }
    bytes += size
    snapshots.push(snapshot)
  }
  selection.read = snapshots.length
  selection.snapshot_bytes = bytes
  selection.not_analyzed = candidates.length - snapshots.length
  selection.truncated = stoppedBy !== null
  selection.stopped_by = stoppedBy
  return { snapshots, selection }
}

/**
 * Read the authoritative header listing the host persistence exposes.
 *
 * `persistence.list()` returns one record per stored session with the recorded
 * `id`, `createdAt` and `cwd`, which is the same listing the harness uses to
 * resolve sessions. It is read as a map so a project scope never consults a
 * directory name. A listing that fails outright (a corrupt corpus) degrades to
 * per-session `stat` headers in the caller instead of losing the whole run.
 */
async function sessionHeaders(persistence) {
  const headers = new Map()
  try {
    for (const snapshot of await persistence.list()) headers.set(snapshot.header.id, snapshot.header)
  } catch {
    /* fall back to readHeader(persistence, id) per discovered session */
  }
  return headers
}

/** Read one session header through the host backend without reading its log body. */
async function readHeader(persistence, id) {
  try {
    const snapshot = await persistence.stat(id)
    return snapshot === undefined ? null : snapshot.header
  } catch {
    return null
  }
}

/** Run one analysis job on a worker thread, matching the host worker contract. */
export function analyze(snapshots, options) {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { snapshots, options },
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    })
    let settled = false
    const done = (error, value) => {
      if (settled) return
      settled = true
      void worker.terminate()
      if (error) reject(error)
      else resolvePromise(value)
    }
    worker.once('message', (value) => done(null, value))
    worker.once('error', (error) => done(error))
    worker.once('exit', (code) => {
      if (!settled) done(new Error(`analysis worker exited before a result (${code})`))
    })
  })
}
