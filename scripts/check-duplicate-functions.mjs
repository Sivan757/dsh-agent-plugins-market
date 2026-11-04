/**
 * Duplicate-function gate.
 *
 * The audit that started this file found five byte-identical copies of the same route
 * plumbing, two climb-to-the-project-root helpers, and two groupings of output styles by
 * source. Each one had been written as a copy because nothing in the repository would
 * ever say so: a duplicated helper compiles, lints, type-checks and tests exactly as well
 * as the shared one, and its cost only appears when one copy is fixed and the others are
 * not. This gate is the thing that says so.
 *
 * The unit is a function body, not a line window. That is deliberate: a clone detector
 * built on sliding windows drowns in near-matches (every `if (error) throw` looks alike),
 * while the pairs this repository actually shipped were whole functions copied verbatim.
 * Bodies are normalized first (whitespace collapsed, string and number literals masked),
 * so a copy that renamed its variables or changed a constant still matches.
 *
 * Usage:
 *   node scripts/check-duplicate-functions.mjs [options]
 *
 * Options:
 *   --ledger <path>   Ledger path relative to the repo root
 *                     (default: docs/reference/duplicate-functions.md).
 *   --min-chars <n>   Shortest normalized body to compare (default: 200).
 *   --json            Emit a machine-readable report.
 *   --self-test      Run the built-in assertions and exit.
 *
 * Exit codes: 0 gate green, 1 findings (or self-test failure), 2 the gate itself could not run.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGES = join(ROOT, 'packages')
/** Build output and vendored trees hold no hand-written functions. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', 'coverage'])

const argv = process.argv.slice(2)
const flag = name => argv.includes('--' + name)
const option = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}
const ledgerPath = option('ledger', 'docs/reference/duplicate-functions.md')
const minChars = Number(option('min-chars', '200'))
const useJson = flag('json')
const selfTest = flag('self-test')

/** Strip comments, so two bodies that differ only in prose still match. */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * Mask the parts a copy is free to change: spacing, string bodies, and numbers.
 * @param body - one function body, without its braces.
 * @returns the comparable text.
 */
function normalize(body) {
  return body
    .replace(/\s+/g, ' ')
    .replace(/'[^']*'/g, "'S'")
    .replace(/"[^"]*"/g, '"S"')
    .replace(/(?<![A-Za-z0-9_$])\d+/g, 'N')
    .trim()
}

/**
 * Bodies of the function-like declarations in one file's source text.
 * Matches declarations, arrow bindings and class or object methods by their opening
 * brace, then walks braces to the matching close.
 * @param text - comment-free source text.
 * @returns one record per body, with the index its declaration started at.
 */
function bodiesIn(text) {
  const openers =
    /(?:function\s*\*?\s*[A-Za-z0-9_$]*\s*\([^)]*\)\s*(?::[^{;]+)?\{|(?:const|let)\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^{;]+)?=>\s*\{|(?:^|[,{;]\s*)(?:private|public|protected|static|async|readonly|get|set)\s+[A-Za-z0-9_$]+\s*\([^)]*\)\s*(?::[^{;]+)?\{)/gm
  const found = []
  for (const match of text.matchAll(openers)) {
    const open = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let index = open
    for (; index < text.length; index += 1) {
      if (text[index] === '{') depth += 1
      else if (text[index] === '}') {
        depth -= 1
        if (depth === 0) {
          index += 1
          break
        }
      }
    }
    found.push({ at: match.index ?? 0, body: text.slice(open + 1, index - 1) })
  }
  return found
}

/**
 * Every TypeScript source file under one directory, sorted for a stable report.
 * @param dir - directory to walk.
 * @param out - accumulator.
 * @returns the absolute paths collected.
 */
function sourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/**
 * The production sources to compare.
 *
 * Tests are excluded on purpose. A test that stands up its own fake host is
 * clearer with the fake inline than with a shared helper three files away, and
 * a gate that pushed them together would buy a passing check with a harder
 * failure to read. What this gate is for is shipped code: five copied route
 * helpers is a bug, two similar fixtures is not.
 * @returns the absolute source paths under each package's `src`.
 */
function productionFiles() {
  const found = []
  if (!existsSync(PACKAGES)) return found
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    sourceFiles(join(PACKAGES, entry.name, 'src'), found)
  }
  return found
}

/**
 * Duplicate groups across the repository.
 * @param files - absolute source paths to read.
 * @param minimum - shortest normalized body to compare.
 * @returns one record per group of two or more identical bodies.
 */
function duplicates(files, minimum) {
  const groups = new Map()
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const { body } of bodiesIn(text)) {
      const normalized = normalize(body)
      if (normalized.length < minimum) continue
      const key = createHash('sha256').update(normalized).digest('hex').slice(0, 12)
      const group = groups.get(key) ?? { key, size: normalized.length, sites: [], excerpt: normalized.slice(0, 120) }
      group.sites.push(relative(ROOT, file).split(sep).join('/'))
      groups.set(key, group)
    }
  }
  return [...groups.values()].filter(group => group.sites.length > 1)
}

/**
 * Ledger rows, parsed from the Markdown table.
 * @param text - ledger contents.
 * @returns one record per row, with the fingerprint and the stated reason.
 */
function ledgerRows(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim())
    if (cells.length < 3) continue
    if (cells[0].toLowerCase() === 'fingerprint' || cells[1].toLowerCase() === 'copies') continue
    if (/^-+$/.test(cells[0].replace(/[: ]/g, ''))) continue
    const key = cells[0].replace(/"/g, '')
    if (!/^[0-9a-f]{12}$/.test(key)) continue
    rows.push({ key, reason: cells[2] })
  }
  return rows
}

function main() {
  if (selfTest) return runSelfTest()
  const files = productionFiles()
  if (files.length === 0) throw new Error('no source files found under ' + PACKAGES)
  const groups = duplicates(files, minChars)
  const ledgerFile = join(ROOT, ledgerPath)
  const rows = existsSync(ledgerFile) ? ledgerRows(readFileSync(ledgerFile, 'utf8')) : []
  const recorded = new Set(rows.map(row => row.key))
  const findings = []
  for (const group of groups) {
    if (recorded.has(group.key)) continue
    findings.push({
      code: 'duplicate-body',
      message: group.sites.join(' and ') + ' contain the same ' + String(group.size) + '-character body: ' + group.excerpt + '…'
    })
  }
  const found = new Set(groups.map(group => group.key))
  for (const row of rows) {
    if (!found.has(row.key)) findings.push({ code: 'ledger-stale', message: ledgerPath + ' records ' + row.key + ', which is no longer duplicated' })
  }
  if (useJson) {
    console.log(JSON.stringify({ files: files.length, groups: groups.length, recorded: rows.length, findings }, null, 2))
  } else {
    console.log(
      'duplicate functions: ' + String(files.length) + ' source files, ' + String(groups.length) + ' duplicated body group(s), ' + String(rows.length) + ' recorded on purpose'
    )
    for (const finding of findings) console.log('  x [' + finding.code + '] ' + finding.message)
    if (findings.length === 0) console.log('  ok no body is duplicated unless the ledger says why')
    if (findings.length > 0) console.log('\nExtract the shared body, or record it in ' + ledgerPath + ' with the reason two copies must exist.')
  }
  return findings.length === 0 ? 0 : 1
}

/** Assertions over the parser, the normalizer and both rules. */
function runSelfTest() {
  const cases = []
  const one = 'function alpha(a) {\n  if (a === undefined) return []\n  const out = []\n  for (const item of a) out.push(item)\n  return out\n}'
  cases.push(['reads a declaration body', bodiesIn(one).length === 1])
  const nested = 'function beta() {\n  const inner = () => { return 1 }\n  if (inner) { return 2 }\n}'
  cases.push(['walks nested braces to the matching close', bodiesIn(nested)[0].body.includes('inner')])
  cases.push(['ignores whitespace differences', normalize('a  +\n b') === normalize('a + b')])
  cases.push(['masks string bodies', normalize("x = 'one'") === normalize("x = 'two'")])
  cases.push(['masks numbers', normalize('n = 12') === normalize('n = 99')])
  cases.push(['keeps identifiers distinct', normalize('alpha + beta') !== normalize('alpha + gamma')])
  const table = '| fingerprint | copies | reason |\n| --- | --- | --- |\n| 0123456789ab | two | probe |\n'
  const rows = ledgerRows(table)
  cases.push(['reads a ledger row', rows.length === 1 && rows[0].key === '0123456789ab'])
  cases.push(['skips the header and the rule', rows.every(row => row.key !== 'fingerprint')])
  const failures = cases.filter(([, ok]) => !ok).map(([name]) => name)
  for (const [name, ok] of cases) console.log((ok ? '  ok ' : '  x ') + name)
  if (failures.length > 0) {
    console.log('self-test failed: ' + failures.join(', '))
    return 1
  }
  console.log('self-test passed: ' + String(cases.length) + ' assertions')
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (useJson) console.log(JSON.stringify({ error: String(error?.message ?? error) }, null, 2))
  else console.log('duplicate-function gate could not run: ' + String(error?.message ?? error))
  process.exitCode = 2
}
