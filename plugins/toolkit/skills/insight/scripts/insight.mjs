#!/usr/bin/env node
// Insight engine entry point.
//
// One offline engine produces a deterministic retrospective of this machine's
// recorded DSH sessions, and one bounded semantic stage hands evidence to the
// calling model for reading. Nothing here calls a model or opens a network.
//
//   node scripts/insight.mjs report [options]
//   node scripts/insight.mjs semantic <prepare|get-batch|submit-batch|
//     prepare-aggregate|submit-aggregate|finalize|cleanup> [options]
import { spawn } from 'node:child_process'
import { readFileSync, copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { analyze, collectSnapshots, dshHome, EmptyProjectScopeError } from '../engine/reader.js'
import { MAX_JSON_BYTES, Store } from '../engine/storage.js'
import {
  finalize,
  getBatch,
  prepareAggregate,
  prepareSemantic,
  renderReport,
  submitAggregate,
  submitBatch,
} from '../engine/semantic.js'

const PRIVACY = new Set(['local', 'redacted', 'metrics'])
const DEPTHS = new Set(['conversation', 'evidence'])
const LOCALES = new Set(['zh-CN', 'en'])
const FORMATS = new Set(['html', 'json'])

const HELP = `Insight engine

Analyze this machine's DeepSeek Harness session history. The deterministic
report is offline: it reads session logs, computes counts, and writes a
self-contained HTML dashboard plus a companion JSON report. The semantic stage
hands bounded, sanitized evidence to the calling model in batches.

Usage:
  node scripts/insight.mjs report [options]
  node scripts/insight.mjs semantic prepare [options] [--resume]
  node scripts/insight.mjs semantic get-batch --workdir DIR --batch ID
  node scripts/insight.mjs semantic submit-batch --workdir DIR --batch ID --payload FILE
  node scripts/insight.mjs semantic prepare-aggregate --workdir DIR
  node scripts/insight.mjs semantic submit-aggregate --workdir DIR --payload FILE
  node scripts/insight.mjs semantic finalize --workdir DIR [--fallback]
  node scripts/insight.mjs semantic cleanup --workdir DIR [--confirm]

Selection options (report and semantic prepare):
  --days N                 rolling window in days; a positive integer, default 30
  --project PATH           absolute project path; keeps that project and its
                           subdirectories
  --privacy MODE           local | redacted (default) | metrics
  --analysis-privacy MODE  local | redacted | metrics; overrides --privacy for
                           the text handed to the model
  --analysis-depth DEPTH   conversation | evidence (default)
  --locale L               zh-CN (default) | en

Report options:
  --format FORMAT          html (default) | json
  --output PATH            write the artifacts to PATH; a directory receives
                           report.html and report.json, a file receives one
                           artifact chosen by --format
  --open                   open the rendered HTML in the default application

Semantic options:
  --resume                 continue the most recent resumable run
  --workdir DIR            a managed run directory under \$DSH_HOME/insights/runs
  --batch ID               batch id as printed by semantic prepare, e.g. batch-001
  --payload FILE           a JSON file holding the structured model output
  --fallback               finalize from the deterministic data alone
  --confirm                actually delete the run directory

The default privacy of redacted keeps structure and short excerpts while
scrubbing credential-like values. metrics omits all text and skips the semantic
stage. local keeps local content and is an explicit opt-in.

A selection wider than the session or snapshot-byte bound is capped newest-first.
The run then completes and states in its coverage how many sessions in scope were
analyzed and how many were not.

Validated facets are cached per task family under \$DSH_HOME/insights/cache/facets
and reused only while the evidence fingerprint, analysis privacy, analysis depth
and contract version are unchanged.

Session logs are read in place under \$DSH_HOME/sessions and are never modified.
Run directories live under \$DSH_HOME/insights/runs and are removed only by
'semantic cleanup --confirm'.
`

function fail(message) {
  process.stderr.write(`insight: ${message}\n`)
  process.exit(2)
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function parse(command) {
  let parsed
  try {
    parsed = parseArgs({
      args: command.args,
      strict: true,
      allowPositionals: false,
      options: command.options,
    })
  } catch (error) {
    fail(`${describe(error)}\n\n${HELP}`)
  }
  if (parsed.positionals.length > 0)
    fail(`unexpected argument: ${parsed.positionals.join(' ')}`)
  for (const [name, spec] of Object.entries(command.required ?? {})) {
    if (parsed.values[name] === undefined) fail(`${spec} is required`)
  }
  return parsed.values
}

function normalizeOptions(values) {
  const days = values.days === undefined ? 30 : positiveInteger(values.days, '--days')
  const privacy = values.privacy ?? 'redacted'
  if (!PRIVACY.has(privacy)) fail('--privacy must be local, redacted, or metrics')
  const analysisPrivacy = values['analysis-privacy']
  if (analysisPrivacy !== undefined && !PRIVACY.has(analysisPrivacy))
    fail('--analysis-privacy must be local, redacted, or metrics')
  const analysisDepth = values['analysis-depth'] ?? 'evidence'
  if (!DEPTHS.has(analysisDepth))
    fail('--analysis-depth must be conversation or evidence')
  const locale = values.locale ?? 'zh-CN'
  if (!LOCALES.has(locale)) fail('--locale must be zh-CN or en')
  let project
  if (values.project !== undefined) {
    project = resolve(values.project)
    // A path that no longer exists is still a project scope: sessions that used
    // it can outlive the directory. Selection decides the outcome, and a scope
    // that matches nothing is a distinct non-zero exit, not a usage error. A
    // path that exists but is not a directory stays a usage error.
    let stat = null
    try {
      stat = statSync(project)
    } catch {
      stat = null
    }
    if (stat !== null && !stat.isDirectory()) fail(`--project is not a directory: ${project}`)
  }
  return { days, project, privacy, analysis_privacy: analysisPrivacy, analysis_depth: analysisDepth, locale }
}

const selectionOptions = {
  days: { type: 'string' },
  project: { type: 'string' },
  privacy: { type: 'string' },
  'analysis-privacy': { type: 'string' },
  'analysis-depth': { type: 'string' },
  locale: { type: 'string' },
}

/** Parse one numeric option, refusing anything that is not a positive integer. */
function positiveInteger(value, name) {
  if (!/^[0-9]+$/.test(String(value)))
    fail(`${name} must be a positive integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0)
    fail(`${name} must be a positive integer`)
  return number
}

/** Select snapshots for one option set, announcing the selection on stderr. */
async function selectSnapshots(options) {
  process.stderr.write(
    `insight: reading session logs under ${join(dshHome(), 'sessions')}\n`,
  )
  const { snapshots, selection } = await collectSnapshots(options)
  process.stderr.write(
    `insight: ${selection.read} sessions selected (${formatBytes(selection.snapshot_bytes)})` +
      `${selection.skipped_unreadable > 0 ? `, ${selection.skipped_unreadable} unreadable` : ''}\n`,
  )
  // Plain-language coverage line: a capped selection must never read as complete.
  if (selection.truncated) {
    const percent =
      selection.in_scope > 0
        ? Math.round((selection.read / selection.in_scope) * 100)
        : 100
    const bound =
      selection.stopped_by === 'max_sessions'
        ? `${selection.bounds.max_sessions}-session`
        : `${formatBytes(selection.bounds.max_snapshot_bytes)} snapshot-byte`
    process.stderr.write(
      `insight: coverage: this report covers the newest ${selection.read} of ${selection.in_scope} sessions in scope (${percent}%); ` +
        `${selection.not_analyzed} sessions in scope were not analyzed because the selection reached the ${bound} bound. ` +
        `Narrow --days or filter --project for a fuller window.\n`,
    )
  } else {
    process.stderr.write(
      `insight: coverage: all ${selection.read} sessions in scope were analyzed\n`,
    )
  }
  return { snapshots, selection }
}

/** Run the deterministic analysis, then hand the report to a fresh run directory. */
async function buildRun(values) {
  const options = { ...normalizeOptions(values), now: Date.now() }
  const { snapshots, selection } = await selectSnapshots(options)
  // The selection bounds travel into the report so a truncated window is
  // visible in report.json and not only on stderr.
  const built = await analyze(snapshots, { ...options, selection })
  const store = new Store()
  const run = store.create()
  return { store, run, built, selection }
}

/** Refuse an output path inside the session log tree, so reports never mix with logs. */
function refuseInsideSessions(target) {
  const sessions = join(dshHome(), 'sessions')
  const rest = relative(sessions, target)
  const inside = rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`))
  if (inside) fail(`--output must stay outside ${sessions}`)
}

function emitReport(store, run, built, selection, values) {
  const rendered = renderReport(store, run, built.report)
  const artifacts = { html: rendered.report, json: rendered.data }
  const output = []
  if (values.output !== undefined) {
    const target = resolve(values.output)
    const extension = extname(target).toLowerCase()
    const directory = extension !== '.html' && extension !== '.json'
    const kinds = directory ? Object.keys(artifacts) : [extension.slice(1)]
    if (directory) mkdirSync(target, { recursive: true })
    else mkdirSync(dirname(target), { recursive: true })
    for (const kind of kinds) {
      const destination = directory ? join(target, `report.${kind}`) : target
      copyFileSync(artifacts[kind], destination)
      output.push(destination)
    }
  }
  const report = {
    workdir: run,
    report: rendered.report,
    data: rendered.data,
    sessions: rendered.sessions,
    format: values.format,
    ...(output.length > 0 ? { output } : {}),
    selection,
  }
  if (values.open === true && values.format === 'html') openInDefaultApplication(rendered.report)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

function openInDefaultApplication(path) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [path]
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* opening the report is a convenience; the file is already written */
  }
}

function readPayload(path) {
  const file = resolve(path)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    fail(`cannot read --payload ${file}: ${describe(error)}`)
  }
  if (Buffer.byteLength(text) > MAX_JSON_BYTES)
    fail(`--payload exceeds ${formatBytes(MAX_JSON_BYTES)}: ${file}`)
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`--payload is not valid JSON: ${file}: ${describe(error)}`)
  }
}

function manager(values) {
  if (values.workdir === undefined) fail('--workdir is required')
  const store = new Store()
  return { store, run: store.run(values.workdir) }
}

function printRun(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function commandReport(args) {
  const values = parse({
    args,
    options: {
      ...selectionOptions,
      format: { type: 'string' },
      output: { type: 'string' },
      open: { type: 'boolean' },
    },
  })
  const format = values.format ?? 'html'
  if (!FORMATS.has(format)) fail('--format must be html or json')
  const output = values.output === undefined ? undefined : resolve(values.output)
  if (output !== undefined) refuseInsideSessions(output)
  const { store, run, built, selection } = await buildRun(values)
  try {
    emitReport(store, run, built, selection, { ...values, format, output })
  } catch (error) {
    // Never leave a half-written run behind. Store.cleanup refuses links and
    // special files and never recurses blindly, so a failed render cannot
    // damage anything outside the run.
    store.cleanup(run, true)
    throw error
  }
}

async function commandPrepare(args) {
  const values = parse({
    args,
    options: { ...selectionOptions, resume: { type: 'boolean' } },
  })
  if (values.resume === true) {
    const runs = new Store()
    for (const workdir of runs.list()) {
      try {
        const manifest = runs.read(workdir, 'manifest.json')
        if (
          manifest.semantic_schema_version !== '1.0.0' ||
          manifest.native_version !== 2 ||
          !Array.isArray(manifest.batch_ids)
        )
          continue
        printRun({
          workdir,
          batches: manifest.batch_ids,
          selected: manifest.selected_task_family_ids.length,
          locale: manifest.locale,
          metrics_semantic_skipped: manifest.metrics_semantic_skipped,
          resumed: true,
        })
        return
      } catch {
        /* an old or incomplete run is not resumable */
      }
    }
    fail('no resumable run exists under $DSH_HOME/insights/runs; start a new prepare')
  }
  const { store, run, built, selection } = await buildRun(values)
  try {
    const prepared = prepareSemantic(store, run, built)
    printRun({ ...prepared, selection })
  } catch (error) {
    // Never leave a half-written run behind. Store.cleanup refuses links and
    // special files and never recurses blindly, so a failed prepare cannot
    // damage anything outside the run.
    store.cleanup(run, true)
    throw error
  }
}

function commandGetBatch(args) {
  const values = parse({
    args,
    options: {
      workdir: { type: 'string' },
      batch: { type: 'string' },
    },
    required: { workdir: '--workdir', batch: '--batch' },
  })
  const { store, run } = manager(values)
  printRun(getBatch(store, run, values.batch))
}

function commandSubmitBatch(args) {
  const values = parse({
    args,
    options: {
      workdir: { type: 'string' },
      batch: { type: 'string' },
      payload: { type: 'string' },
    },
    required: { workdir: '--workdir', batch: '--batch', payload: '--payload' },
  })
  const { store, run } = manager(values)
  printRun(submitBatch(store, run, values.batch, readPayload(values.payload)))
}

function commandPrepareAggregate(args) {
  const values = parse({
    args,
    options: { workdir: { type: 'string' } },
    required: { workdir: '--workdir' },
  })
  const { store, run } = manager(values)
  const value = prepareAggregate(store, run)
  printRun({
    workdir: run,
    sections: value.output_contract.required_sections,
    facets: value.facets.length,
    facet_summary: value.facet_summary,
    evidence: value.evidence.length,
    selection: value.selection,
  })
}

function commandSubmitAggregate(args) {
  const values = parse({
    args,
    options: { workdir: { type: 'string' }, payload: { type: 'string' } },
    required: { workdir: '--workdir', payload: '--payload' },
  })
  const { store, run } = manager(values)
  printRun({ workdir: run, ...submitAggregate(store, run, readPayload(values.payload)) })
}

function commandFinalize(args) {
  const values = parse({
    args,
    options: { workdir: { type: 'string' }, fallback: { type: 'boolean' } },
    required: { workdir: '--workdir' },
  })
  const { store, run } = manager(values)
  const result = finalize(store, run, values.fallback === true)
  printRun({ workdir: run, ...result })
}

function commandCleanup(args) {
  const values = parse({
    args,
    options: { workdir: { type: 'string' }, confirm: { type: 'boolean' } },
    required: { workdir: '--workdir' },
  })
  const { store, run } = manager(values)
  const plan = store.cleanup(run, values.confirm === true)
  printRun({
    workdir: run,
    files: plan.files.length,
    bytes: plan.bytes,
    deleted: plan.deleted,
    ...(plan.deleted ? {} : { note: 'preview only; pass --confirm to delete permanently' }),
  })
}

const SEMANTIC = {
  prepare: commandPrepare,
  'get-batch': commandGetBatch,
  'submit-batch': commandSubmitBatch,
  'prepare-aggregate': commandPrepareAggregate,
  'submit-aggregate': commandSubmitAggregate,
  finalize: commandFinalize,
  cleanup: commandCleanup,
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP)
    return
  }
  const command = argv[0]
  if (command === 'report') return commandReport(argv.slice(1))
  if (command === 'semantic') {
    const subcommand = argv[1]
    if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
      process.stdout.write(HELP)
      return
    }
    const handler = SEMANTIC[subcommand]
    if (handler === undefined)
      fail(`unknown semantic subcommand: ${subcommand}\n\n${HELP}`)
    const rest = argv.slice(2)
    if (rest.includes('--help') || rest.includes('-h')) {
      process.stdout.write(HELP)
      return
    }
    return handler(rest)
  }
  fail(`unknown command: ${command}\n\n${HELP}`)
}

main().catch((error) => {
  // A --project scope that matched nothing is its own outcome: a plain message
  // and exit 3, before any run directory or report exists.
  if (error instanceof EmptyProjectScopeError) {
    process.stderr.write(`insight: ${error.message}\n`)
    process.exit(3)
  }
  fail(describe(error))
})
