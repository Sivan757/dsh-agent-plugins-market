#!/usr/bin/env node
/**
 * Compatibility report: validate every schema in `schemas/` against a real
 * repository, then scan that repository with the real catalog scanner.
 *
 * The report answers two separate questions, because they fail separately:
 *
 * 1. **Schema conformance** — does the repository's dialect manifest satisfy
 *    the contract this repository documents for that dialect? Validated with
 *    Ajv against `schemas/<dialect>/*.schema.json`.
 * 2. **Scanner integration** — when this plugin reads that checkout, which
 *    manifest does it actually use as the suite identity, and which surfaces
 *    does it discover? Measured by running `scanSource` from `lib/`.
 *
 * Samples are pinned in `scripts/compat-sources.json`; acquisition is a
 * sparse, blobless, depth-1 clone cached under `node_modules/.cache/` so a
 * 12 GB repository costs under a megabyte.
 *
 * Usage: `node scripts/compat-report.mjs [--refresh] [--dialect <name>]`
 * Outputs `docs/compat-report.json` and `docs/compat-report.md`.
 */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import Ajv2020Default from 'ajv/dist/2020.js'

const exec = promisify(execFile)
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'compat-report')
const CONFIG_PATH = join(ROOT, 'scripts', 'compat-sources.json')
const REPORT_JSON = join(ROOT, 'docs', 'compat-report.json')
const REPORT_MD = join(ROOT, 'docs', 'compat-report.md')

/** Marketplace manifests the scanner's `MarketplaceStrategy` can read, in its order. */
let scannerMarketplaces = []
/** Every marketplace path any documented dialect defines, for presence reporting. */
const ALL_MARKETPLACES = [
  '.claude-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
  '.agents/plugins/api_marketplace.json',
  'marketplace.json',
  '.cursor-plugin/marketplace.json',
  '.kimi-plugin/marketplace.json',
  '.plugin/marketplace.json',
  '.zcode-plugin/marketplace.json',
  '.qoder-plugin/marketplace.json',
  '.github/plugin/marketplace.json'
]

const argv = process.argv.slice(2)
const refresh = argv.includes('--refresh')
const onlyIndex = argv.indexOf('--dialect')
const only = onlyIndex === -1 ? undefined : argv[onlyIndex + 1]

const Ajv2020 = Ajv2020Default

/** Run a command, returning trimmed stdout; throws with stderr attached. */
async function sh(command, args, options = {}) {
  try {
    const { stdout } = await exec(command, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 300_000, ...options })
    return stdout.trim()
  } catch (error) {
    const detail = typeof error.stderr === 'string' && error.stderr.trim() !== '' ? error.stderr.trim() : String(error.message)
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Compile the plugin's TypeScript into `lib/` so the report runs the shipped scanner. */
async function ensureScanner() {
  const entry = join(ROOT, 'lib', 'catalog', 'suite-scanner.js')
  await sh('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'])
  scannerMarketplaces = (await import(pathToFileURL(join(ROOT, 'lib', 'model', 'layouts.js')).href)).MARKETPLACE_PATHS
  return import(pathToFileURL(entry).href)
}

/** Sparse, blobless, depth-1 checkout pinned to the sample's branch. */
async function acquire(sample) {
  const dir = join(CACHE_DIR, sample.dialect)
  if (refresh) await rm(dir, { recursive: true, force: true })
  const hasHead = await isFile(join(dir, '.git', 'HEAD'))
  if (!hasHead) {
    await rm(dir, { recursive: true, force: true })
    await mkdir(CACHE_DIR, { recursive: true })
    // `--no-checkout` matters: a plain `--sparse` clone still materializes the
    // root blobs first, which costs tens of megabytes on repositories that keep
    // large media files at the root. Setting the sparse patterns before the
    // first checkout keeps the download proportional to the paths we read.
    await sh('git', ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', sample.branch, `https://github.com/${sample.repo}.git`, dir])
    await sh('git', ['-C', dir, 'sparse-checkout', 'set', '--no-cone', ...sample.sparsePaths])
    await sh('git', ['-C', dir, 'checkout'])
  }
  const commit = await sh('git', ['-C', dir, 'rev-parse', 'HEAD'])
  return { dir, commit }
}

/** Validate one JSON document against a schema file; returns the verdict and errors. */
function validate(schemaCache, schemaRelative, document) {
  let compiled = schemaCache.get(schemaRelative)
  if (compiled === undefined) {
    const schema = JSON.parse(readFileSync(join(ROOT, schemaRelative), 'utf8'))
    compiled = new Ajv2020({ strict: false, allErrors: true }).compile(schema)
    schemaCache.set(schemaRelative, compiled)
  }
  const valid = compiled(document)
  return {
    valid,
    errors: (compiled.errors ?? []).map(error => `${error.instancePath === '' ? 'root' : error.instancePath} ${error.message ?? 'invalid'}`)
  }
}

/** Which schema files back a dialect, and whether it is vendored upstream. */
function schemaPaths(schema) {
  if (schema === 'agent-plugins') return { plugin: 'schemas/1.0.0/plugin.schema.json', marketplace: null }
  return { plugin: `schemas/${schema}/plugin.schema.json`, marketplace: `schemas/${schema}/marketplace.schema.json` }
}

/** Relative, POSIX-style path of `target` under `base`. */
function rel(base, target) {
  return relative(base, target).split(sep).join('/')
}

/** Validate the sample's dialect manifests and return the schema half of the row. */
async function validateManifests(sample, checkout, schemaCache) {
  const paths = schemaPaths(sample.schema)
  const result = { vendored: sample.schema === 'agent-plugins', plugin: null, marketplace: null }
  for (const [slot, manifestRelative, schemaRelative] of [
    ['plugin', sample.pluginManifest, paths.plugin],
    ['marketplace', sample.marketplaceManifest, paths.marketplace]
  ]) {
    if (manifestRelative === null || manifestRelative === undefined) continue
    const absolute = join(checkout, manifestRelative)
    if (!(await isFile(absolute))) {
      result[slot] = { file: manifestRelative, schema: schemaRelative, present: false, valid: false, errors: ['manifest not present in the sample checkout'] }
      continue
    }
    let document
    try {
      document = JSON.parse(await readFile(absolute, 'utf8'))
    } catch (error) {
      result[slot] = {
        file: manifestRelative,
        schema: schemaRelative,
        present: true,
        valid: false,
        errors: [`unparsable: ${error instanceof Error ? error.message : String(error)}`]
      }
      continue
    }
    const verdict = schemaRelative === null ? { valid: true, errors: [] } : validate(schemaCache, schemaRelative, document)
    result[slot] = { file: manifestRelative, schema: schemaRelative, present: true, valid: verdict.valid, errors: verdict.errors }
  }
  return result
}

/** Run the real scanner over the checkout and summarize what it did. */
async function scanCheckout(scanner, sample, checkout) {
  const result = await scanner.scanSource(checkout, sample.dialect, 'user', `https://github.com/${sample.repo}`)
  const suites = result.suites.map(suite => ({
    id: suite.id,
    layout: suite.manifest.layout,
    manifestPath: suite.manifest.path === '' ? null : rel(checkout, suite.manifest.path),
    identity: suite.manifest.name,
    remote: suite.remote?.url ?? null,
    surfaces: suite.surfaces
  }))
  const surfaces = { skills: 0, commands: 0, agents: 0, mcp: 0, hooks: 0, lsp: 0 }
  for (const suite of result.suites) for (const key of Object.keys(surfaces)) surfaces[key] += suite.surfaces[key] ?? 0
  const manifestPaths = suites.map(suite => suite.manifestPath).filter(path => path !== null)
  const matchesDialectManifest = candidate => candidate !== null && candidate !== undefined && manifestPaths.some(path => path === candidate || path.endsWith(`/${candidate}`))
  const presentMarketplaces = []
  for (const path of ALL_MARKETPLACES) if (await isFile(join(checkout, path))) presentMarketplaces.push(path)
  const scannerMarketplace = result.marketplacePath === undefined ? null : rel(checkout, result.marketplacePath)
  return {
    suites: suites.slice(0, 20),
    suiteCount: result.suites.length,
    layouts: [...new Set(result.suites.map(suite => suite.manifest.layout))],
    surfaces,
    attempts: result.attempts,
    notes: result.notes.slice(0, 12),
    noteCount: result.notes.length,
    dialectManifestRead: matchesDialectManifest(sample.pluginManifest),
    dialectMarketplaceRead: sample.marketplaceManifest !== null && sample.marketplaceManifest !== undefined && scannerMarketplace === sample.marketplaceManifest,
    presentMarketplaces,
    scannerMarketplace
  }
}

/** The one-line verdict: did this manager read the dialect's own declaration? */
function verdictOf(schema, scan) {
  if (scan.dialectManifestRead || scan.dialectMarketplaceRead) return 'integrated'
  if (scan.suiteCount > 0) return 'shadowed'
  return 'unread'
}

function interpret(schema, sample, scan, verdict) {
  const target = sample.pluginManifest ?? sample.marketplaceManifest
  if (verdict === 'integrated') {
    return scan.dialectManifestRead
      ? `The scanner read \`${sample.pluginManifest}\` as the suite identity.`
      : `The scanner read \`${sample.marketplaceManifest}\` as the marketplace manifest.`
  }
  if (verdict === 'shadowed') {
    const winning = scan.layouts.length > 0 ? scan.layouts.join(', ') : 'none'
    return `The scanner discovered ${scan.suiteCount} suite(s) but not through \`${target}\`; the winning layout was ${winning}.`
  }
  return `The scanner discovered no suite from this checkout; \`${target}\` and the shared scanning conventions produced nothing.`
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  const scanner = await ensureScanner()
  const schemaCache = new Map()
  const samples = []
  for (const sample of config.samples) {
    if (only !== undefined && sample.dialect !== only) continue
    const entry = {
      dialect: sample.dialect,
      schema: sample.schema,
      repo: sample.repo,
      branch: sample.branch,
      stars: sample.stars,
      note: sample.note,
      pluginManifest: sample.pluginManifest,
      marketplaceManifest: sample.marketplaceManifest
    }
    try {
      const { dir, commit } = await acquire({ ...sample, sparsePaths: config.sparsePaths })
      entry.commit = commit
      entry.manifest = await validateManifests(sample, dir, schemaCache)
      entry.scan = await scanCheckout(scanner, sample, dir)
      entry.verdict = verdictOf(sample.schema, entry.scan)
      entry.interpretation = interpret(sample.schema, sample, entry.scan, entry.verdict)
      process.stdout.write(`ok    ${sample.dialect.padEnd(15)} ${sample.repo}@${commit.slice(0, 7)}  ${entry.verdict}\n`)
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error)
      entry.verdict = 'error'
      process.stdout.write(`error ${sample.dialect.padEnd(15)} ${sample.repo}: ${entry.error}\n`)
    }
    samples.push(entry)
  }
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10),
    selection: config.selection,
    method: {
      schema:
        'Each sample dialect manifest is parsed and validated with Ajv 2020-12 against the schema named in the row. The agent-plugins sample uses the vendored schemas/1.0.0/plugin.schema.json.',
      scanner:
        'Each checkout is scanned by the shipped catalog scanner (lib/catalog/suite-scanner.js scanSource) after a sparse depth-1 clone, so the row records what this plugin actually does with the repository.',
      marketplace: `The scanner marketplace lookup order is ${scannerMarketplaces.map(path => `\`${path}\``).join(' then ')}; other dialects' marketplace files are listed for context but are not read.`,
      verdicts: {
        integrated: 'The scanner read this dialect\u2019s own manifest as the suite identity.',
        shadowed: 'Suites were discovered, but a different dialect\u2019s manifest won.',
        unread: 'The checkout produced no suite.',
        error: 'Acquisition or scanning failed; see the error field.'
      }
    },
    samples
  }
  await mkdir(join(ROOT, 'docs'), { recursive: true })
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(REPORT_MD, renderMarkdown(report), 'utf8')
  process.stdout.write(`\nwrote docs/compat-report.json and docs/compat-report.md (${samples.length} sample(s))\n`)
}

/** Human-readable companion to the JSON report. */
function renderMarkdown(report) {
  const lines = []
  lines.push('# Compatibility report')
  lines.push('')
  lines.push(`Generated ${report.generatedAt} by \`node scripts/compat-report.mjs\`. Samples are pinned in \`scripts/compat-sources.json\`.`)
  lines.push('')
  lines.push(
    'Every schema in `schemas/` is exercised against one real GitHub repository: the highest-starred candidate that ships the layout, found with GitHub code search on the selection date. Each row answers two independent questions — does the repository satisfy the schema, and what does this plugin actually do when it reads the checkout.'
  )
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('| Layout | Sample repository | Commit | Dialect manifest | Schema | Scanner verdict | Suites | Surfaces |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const sample of report.samples) {
    const manifest = sample.pluginManifest ?? sample.marketplaceManifest ?? '—'
    const schemaCell =
      sample.manifest === undefined
        ? '—'
        : [sample.manifest.plugin, sample.manifest.marketplace]
            .filter(entry => entry !== null && entry !== undefined)
            .map(entry => (entry.valid ? 'valid' : 'invalid'))
            .join(' / ') || '—'
    const surfaces =
      sample.scan === undefined
        ? '—'
        : Object.entries(sample.scan.surfaces)
            .map(([key, value]) => `${key} ${value}`)
            .join(', ')
    lines.push(
      `| ${sample.dialect} | [${sample.repo}](https://github.com/${sample.repo}) | \`${(sample.commit ?? '—').slice(0, 7)}\` | \`${manifest}\` | ${schemaCell} | ${sample.verdict} | ${sample.scan?.suiteCount ?? '—'} | ${surfaces} |`
    )
  }
  lines.push('')
  lines.push('## Method')
  lines.push('')
  lines.push(`- **Schema.** ${report.method.schema}`)
  lines.push(`- **Scanner.** ${report.method.scanner}`)
  lines.push(`- **Marketplace.** ${report.method.marketplace}`)
  lines.push('- **Selection.** ' + report.selection.method + ` Metric: ${report.selection.metric}, checked ${report.selection.checkedOn}.`)
  lines.push('')
  lines.push(
    'Verdicts: ' +
      Object.entries(report.method.verdicts)
        .map(([key, value]) => `**${key}** — ${value}`)
        .join(' ')
  )
  lines.push('')
  lines.push('## Samples')
  lines.push('')
  for (const sample of report.samples) {
    lines.push(`### ${sample.dialect}`)
    lines.push('')
    lines.push(
      `- **Repository:** [${sample.repo}](https://github.com/${sample.repo}) @ \`${sample.commit ?? '—'}\` (branch \`${sample.branch}\`, ${sample.stars} stars at selection).`
    )
    lines.push(
      `- **Dialect manifest:** \`${sample.pluginManifest ?? '—'}\`${sample.marketplaceManifest === null || sample.marketplaceManifest === undefined ? '' : ` · marketplace \`${sample.marketplaceManifest}\``}`
    )
    lines.push(`- **Verdict:** **${sample.verdict}** — ${sample.interpretation ?? sample.error ?? ''}`)
    if (sample.manifest !== null && sample.manifest !== undefined) {
      for (const slot of ['plugin', 'marketplace']) {
        const entry = sample.manifest[slot]
        if (entry === null || entry === undefined) continue
        const state = entry.present === false ? 'not present' : entry.valid ? 'valid' : 'invalid'
        lines.push(`- **Schema (${slot}):** \`${entry.file}\` against \`${entry.schema ?? '—'}\` — ${state}`)
        for (const problem of entry.errors ?? []) lines.push(`  - ${problem}`)
      }
    }
    if (sample.scan !== undefined) {
      lines.push(
        `- **Scanner:** ${sample.scan.suiteCount} suite(s); layouts ${sample.scan.layouts.length === 0 ? 'none' : sample.scan.layouts.map(layout => `\`${layout}\``).join(', ')}.`
      )
      lines.push(
        `- **Surfaces:** ${Object.entries(sample.scan.surfaces)
          .map(([key, value]) => `${key} ${value}`)
          .join(', ')}.`
      )
      lines.push(
        `- **Marketplace files present:** ${sample.scan.presentMarketplaces.length === 0 ? 'none' : sample.scan.presentMarketplaces.map(path => `\`${path}\``).join(', ')}; productive marketplace reported by the scanner: ${sample.scan.scannerMarketplace === null ? 'none' : `\`${sample.scan.scannerMarketplace}\``}.`
      )
      if (sample.scan.suites.length > 0) {
        lines.push('- **Suites read:**')
        for (const suite of sample.scan.suites) {
          lines.push(
            `  - \`${suite.id}\` — layout \`${suite.layout}\`, identity from ${suite.manifestPath === null ? 'a remote entry' : `\`${suite.manifestPath}\``}, surfaces ${Object.entries(
              suite.surfaces
            )
              .map(([key, value]) => `${key} ${value}`)
              .join(', ')}.`
          )
        }
      }
      if (sample.scan.notes.length > 0) {
        lines.push('- **Scan notes:**')
        for (const note of sample.scan.notes) lines.push(`  - ${note}`)
        if (sample.scan.noteCount > sample.scan.notes.length) lines.push(`  - …and ${sample.scan.noteCount - sample.scan.notes.length} more.`)
      }
    }
    if (sample.note !== undefined) lines.push(`- **Why this repository:** ${sample.note}`)
    lines.push('')
  }
  lines.push('## Regenerating')
  lines.push('')
  lines.push('```sh')
  lines.push('node scripts/compat-report.mjs            # reuse cached checkouts')
  lines.push('node scripts/compat-report.mjs --refresh  # re-clone every sample')
  lines.push('node scripts/compat-report.mjs --dialect zcode')
  lines.push('```')
  lines.push('')
  lines.push(
    'Checkouts are cached under `node_modules/.cache/compat-report/<dialect>`; acquisition is a sparse, blobless, depth-1 clone, so a multi-gigabyte repository costs under a megabyte. The report is a point-in-time measurement: `tests/compat-report.test.ts` keeps it structurally valid and covered, but it does not re-fetch the repositories.'
  )
  lines.push('')
  return `${lines.join('\n')}\n`
}

await main()
