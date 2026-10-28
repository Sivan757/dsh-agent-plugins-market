/**
 * Module reachability gate.
 *
 * A source module nothing imports is invisible to every other check here: it compiles,
 * lints and tests exactly like live code, and it survives refactors because nothing reads
 * it. The audit pass that removed the dead exports left one behind by hand, the tab-row
 * component a new rail replaced, and no gate could see it: the export gate compares
 * package entries and the module was never one, and the duplication gate wants a body in
 * two files where this was one body in none.
 *
 * The rule is reachability, not import count. Every module under `packages/<name>/src`
 * must be reachable from a package entry by following relative imports, dynamic ones
 * included, because a module loaded only through `import()` is still shipped. A module
 * kept for a reason the walk cannot see, such as a file the host loads by path or a helper
 * only a test imports, is recorded in the ledger with that reason.
 *
 * Usage:
 *   node scripts/check-module-reachability.mjs [options]
 *
 * Options:
 *   --ledger <path>  Ledger path relative to the repo root
 *                    (default: docs/reference/module-reachability.md).
 *   --json           Emit a machine-readable report.
 *   --self-test      Run the built-in assertions and exit.
 *
 * Exit codes: 0 gate green, 1 findings (or self-test failure), 2 the gate itself could not run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGES = join(ROOT, 'packages')
/** Build output, vendored code and dependencies hold nothing this gate owns. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', 'coverage'])

const argv = process.argv.slice(2)
const flag = name => argv.includes('--' + name)
const option = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}
const ledgerPath = option('ledger', 'docs/reference/module-reachability.md')
const useJson = flag('json')
const selfTest = flag('self-test')

/** Strip comments, so a path mentioned in prose is not read as an import. */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * Every module specifier one file loads: static imports, re-exports, dynamic imports and require.
 * @param source - module text.
 * @returns the raw specifiers, in source order.
 */
function specifiersIn(source) {
  const text = stripComments(source)
  const found = []
  const patterns = [
    /\bfrom\s+'([^']+)'/g,
    /\bfrom\s+"([^"]+)"/g,
    /\bimport\s*\(\s*'([^']+)'\s*\)/g,
    /\bimport\s*\(\s*"([^"]+)"\s*\)/g,
    /\brequire\s*\(\s*'([^']+)'\s*\)/g,
    /\bimport\s+'([^']+)'/g
  ]
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(match[1])
  return found
}

/**
 * The file a relative specifier names, if it exists.
 * @param from - the importing file's absolute path.
 * @param specifier - the raw specifier, which must be relative.
 * @returns the absolute path, or undefined when it names nothing this gate reads.
 */
function resolveRelative(from, specifier) {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(from, '..', specifier.replace(/\.js$/, ''))
  for (const candidate of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

/** Every TypeScript module under one directory, sorted for a stable report. */
function modulesUnder(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) modulesUnder(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** The package directories under `packages/`, flat or grouped. */
function packageDirs() {
  const found = []
  const consider = dir => {
    if (existsSync(join(dir, 'src'))) found.push(dir)
  }
  for (const top of readdirSync(PACKAGES, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!top.isDirectory()) continue
    const topDir = join(PACKAGES, top.name)
    consider(topDir)
    for (const child of readdirSync(topDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.isDirectory()) consider(join(topDir, child.name))
    }
  }
  return found
}

/**
 * Walk every import from the entries and report what the walk never reached.
 * @param entries - absolute entry paths.
 * @param modules - every module the gate expects to be reachable.
 * @returns the unreachable modules, relative and sorted.
 */
function unreachable(entries, modules) {
  const reached = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || reached.has(file)) continue
    reached.add(file)
    for (const specifier of specifiersIn(readFileSync(file, 'utf8'))) {
      const target = resolveRelative(file, specifier)
      if (target !== undefined && !reached.has(target)) queue.push(target)
    }
  }
  return modules.filter(module => !reached.has(module)).map(module => relative(ROOT, module).split(sep).join('/'))
}

/**
 * Ledger rows, parsed from the Markdown table.
 * @param text - ledger contents.
 * @returns one record per row, with the module path and the stated reason.
 */
function ledgerRows(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim())
    if (cells.length < 2) continue
    if (cells[0].toLowerCase() === 'module' || /^-+$/.test(cells[0].replace(/[: ]/g, ''))) continue
    const module = cells[0].replace(/`/g, '')
    if (module === '') continue
    rows.push({ module, reason: cells[1] })
  }
  return rows
}

function main() {
  if (selfTest) return runSelfTest()
  const packages = packageDirs()
  if (packages.length === 0) throw new Error('no package source directories found under ' + PACKAGES)
  const entries = packages.map(dir => join(dir, 'src', 'index.ts')).filter(entry => existsSync(entry))
  if (entries.length === 0) throw new Error('no package entry points found; this gate walks imports from them')
  const modules = packages.flatMap(dir => modulesUnder(join(dir, 'src')))
  const orphans = unreachable(entries, modules)
  const ledgerFile = join(ROOT, ledgerPath)
  const rows = existsSync(ledgerFile) ? ledgerRows(readFileSync(ledgerFile, 'utf8')) : []
  const recorded = new Set(rows.map(row => row.module))
  const findings = []
  for (const orphan of orphans) {
    if (recorded.has(orphan)) continue
    findings.push({ code: 'unreachable-module', message: orphan + ' is not reachable from any package entry and the ledger does not record it' })
  }
  const found = new Set(orphans)
  for (const row of rows) {
    if (!found.has(row.module)) findings.push({ code: 'ledger-stale', message: ledgerPath + ' records ' + row.module + ', which is now reachable' })
  }
  if (useJson) {
    console.log(JSON.stringify({ entries: entries.length, modules: modules.length, unreachable: orphans.length, recorded: rows.length, findings }, null, 2))
  } else {
    console.log(
      'module reachability: ' +
        String(entries.length) +
        ' entry point(s), ' +
        String(modules.length) +
        ' module(s), ' +
        String(orphans.length) +
        ' unreachable, ' +
        String(rows.length) +
        ' recorded on purpose'
    )
    for (const finding of findings) console.log('  x [' + finding.code + '] ' + finding.message)
    if (findings.length === 0) console.log('  ok every module is reachable from an entry or recorded')
    if (findings.length > 0) console.log('\nDelete the module, import it from an entry, or record it in ' + ledgerPath + '.')
  }
  return findings.length === 0 ? 0 : 1
}

/** Assertions over the parser, the resolver and both rules. */
function runSelfTest() {
  const cases = []
  cases.push(['reads a static import', specifiersIn("import { a } from './a.js'").includes('./a.js')])
  cases.push(['reads a re-export', specifiersIn("export * from './b.js'").includes('./b.js')])
  cases.push(['reads a dynamic import', specifiersIn("const m = await import('./c.js')").includes('./c.js')])
  cases.push(['reads a side-effect import', specifiersIn("import './d.css'").includes('./d.css')])
  cases.push(['reads require', specifiersIn("const x = require('./e.js')").includes('./e.js')])
  cases.push(['ignores a path in a comment', !specifiersIn("// from './f.js'\nconst x = 1").includes('./f.js')])
  cases.push(['ignores a bare specifier', resolveRelative(new URL(import.meta.url).pathname, '@scope/pkg') === undefined])
  const table = '| module | reason |\n| --- | --- |\n| packages/x/src/y.ts | loaded by path |\n'
  const rows = ledgerRows(table)
  cases.push(['reads a ledger row', rows.length === 1 && rows[0].module === 'packages/x/src/y.ts'])
  cases.push(['skips the header and the rule', rows.every(row => row.module !== 'module')])
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
  else console.log('module reachability gate could not run: ' + String(error?.message ?? error))
  process.exitCode = 2
}
