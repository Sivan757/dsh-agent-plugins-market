/**
 * Dead-export gate.
 *
 * Every package here publishes an entry point, and an entry export is a promise to whoever
 * imports it. When nothing imports it, the promise is stale: it keeps a symbol alive through
 * refactors, forces its module to stay loadable, and hides the fact that a feature was removed.
 * Nothing else in this repository notices, because a redundant export compiles, lints and tests
 * green. Fifteen accumulated before this gate existed, and each was found by a human reading an
 * audit report.
 *
 * The rule: for every symbol a package entry exports, some file outside that package must
 * mention it. A symbol that only its own package uses is an orphan, because the package can
 * import its own module directly. An export kept on purpose, as public API or for a host
 * integration, is recorded in the ledger with the reason; a new orphan without a row fails.
 *
 * Usage:
 *   node scripts/check-dead-exports.mjs [options]
 *
 * Options:
 *   --ledger <path>   Ledger path relative to the repo root
 *                     (default: docs/reference/public-exports.md).
 *   --json            Emit a machine-readable report.
 *   --self-test      Run the built-in assertions and exit.
 *
 * Exit codes: 0 gate green, 1 findings (or self-test failure), 2 the gate itself could not run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGES = join(ROOT, 'packages')
/** Directories that hold build output or vendored code rather than repository source. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', 'coverage'])

const argv = process.argv.slice(2)
const flag = name => argv.includes('--' + name)
const option = (name, fallback) => {
  const index = argv.indexOf('--' + name)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}
const ledgerPath = option('ledger', 'docs/reference/public-exports.md')
const useJson = flag('json')
const selfTest = flag('self-test')

/** Strip comments so a name mentioned only in prose is not read as a consumer. */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * Names one module's source text exports, without following re-exports.
 * Split from the file walk so the self-test exercises the parser directly.
 * @param source - module text.
 * @returns the exported names.
 */
function parseExportedNames(source) {
  const text = stripComments(source)
  const names = new Set()
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const token of match[1].split(',')) {
      const trimmed = token.trim().replace(/^type\s+/, '')
      if (trimmed === '') continue
      const exported = trimmed.includes(' as ') ? trimmed.split(' as ').pop().trim() : trimmed
      if (/^[A-Za-z0-9_$]+$/.test(exported)) names.add(exported)
    }
  }
  const declaration = /export\s+(?:declare\s+)?(?:const|let|var|function\s*\*?|class|interface|type|enum|namespace)\s+([A-Za-z0-9_$]+)/g
  for (const match of text.matchAll(declaration)) names.add(match[1])
  return names
}

/**
 * Names one entry file exports, following `export * from` so a re-export chain counts.
 * @param file - absolute path to an entry or a module it re-exports.
 * @param seen - files already walked, so a cycle terminates.
 * @returns the exported names.
 */
function exportedNames(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return new Set()
  seen.add(file)
  const text = stripComments(readFileSync(file, 'utf8'))
  const names = parseExportedNames(text)
  for (const match of text.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) {
    const target = resolve(file, '..', match[1])
    for (const candidate of [target + '.ts', target + '.tsx', join(target, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        for (const name of exportedNames(candidate, seen)) names.add(name)
        break
      }
    }
  }
  return names
}

/** Every TypeScript source file under packages/, skipping build output and vendor trees. */
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
 * Package directories that carry a source entry point.
 * A workspace package is either `packages/<name>` or `packages/<group>/<name>`.
 * @returns one record per entry point, sorted by path.
 */
function packageEntries() {
  const found = []
  const consider = dir => {
    const entry = join(dir, 'src', 'index.ts')
    if (existsSync(entry)) found.push({ pkgDir: dir, entry })
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
 * Ledger rows, parsed from the Markdown table.
 * @param text - ledger contents.
 * @returns one record per row, with the package, the export and the stated reason.
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
    if (cells[0].toLowerCase() === 'package' || cells[1].toLowerCase() === 'export') continue
    if (/^-+$/.test(cells[0].replace(/[: ]/g, ''))) continue
    const pkg = cells[0].replace(/`/g, '')
    const name = cells[1].replace(/`/g, '')
    if (pkg === '' || name === '') continue
    rows.push({ pkg, name, reason: cells[2] })
  }
  return rows
}

/**
 * Orphan exports: symbols a package entry exports and no other package mentions.
 * @param entries - package entry records.
 * @param files - every source file to search.
 * @returns `{ pkg, file, name }` per orphan.
 */
function findOrphans(entries, files) {
  const contents = new Map(files.map(file => [file, stripComments(readFileSync(file, 'utf8'))]))
  const orphans = []
  for (const { pkgDir, entry } of entries) {
    const ownSrc = join(pkgDir, 'src') + sep
    const outside = files.filter(file => file !== entry && !file.startsWith(ownSrc))
    for (const name of [...exportedNames(entry)].sort()) {
      const word = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b')
      if (outside.some(file => word.test(contents.get(file) ?? ''))) continue
      orphans.push({ pkg: relative(PACKAGES, pkgDir).split(sep).join('/'), file: relative(ROOT, entry), name })
    }
  }
  return orphans
}

/** Whether a ledger row names a package the way an orphan record does. */
const samePackage = (a, b) => a === b || a.endsWith('/' + b) || b.endsWith('/' + a)

function main() {
  if (selfTest) return runSelfTest()
  const entries = packageEntries()
  if (entries.length === 0) throw new Error('no package entry points found under ' + PACKAGES)
  const orphans = findOrphans(entries, sourceFiles(PACKAGES))
  const ledgerFile = join(ROOT, ledgerPath)
  const rows = existsSync(ledgerFile) ? ledgerRows(readFileSync(ledgerFile, 'utf8')) : []
  const recorded = new Set(rows.map(row => row.pkg + '#' + row.name))
  const declared = new Set(entries.map(entry => relative(PACKAGES, entry.pkgDir).split(sep).join('/')))
  const findings = []
  for (const orphan of orphans) {
    const covered = rows.some(row => samePackage(row.pkg, orphan.pkg) && row.name === orphan.name)
    if (!covered) findings.push({ code: 'orphan-export', message: orphan.file + ' exports ' + orphan.name + ', which no other package mentions and the ledger does not record' })
  }
  for (const row of rows) {
    if (!declared.has(row.pkg)) {
      findings.push({ code: 'ledger-unknown-package', message: ledgerPath + ' records ' + row.pkg + ', which is not a package entry' })
      continue
    }
    if (!orphans.some(orphan => samePackage(row.pkg, orphan.pkg) && orphan.name === row.name)) {
      findings.push({ code: 'ledger-stale', message: ledgerPath + ' records ' + row.pkg + ' ' + row.name + ', which is either consumed again or no longer exported' })
    }
  }
  if (useJson) {
    console.log(
      JSON.stringify(
        {
          packages: entries.length,
          exports: entries.reduce((total, entry) => total + exportedNames(entry.entry).size, 0),
          orphans: orphans.length,
          recorded: rows.length,
          findings
        },
        null,
        2
      )
    )
  } else {
    console.log(
      'dead exports: ' + entries.length + ' package entries, ' + orphans.length + ' export(s) with no consumer outside their package, ' + rows.length + ' recorded on purpose'
    )
    for (const finding of findings) console.log('  x [' + finding.code + '] ' + finding.message)
    if (findings.length === 0) console.log('  ok every entry export is either consumed or recorded')
    if (findings.length > 0) console.log('\nDelete the export, or record it in ' + ledgerPath + ' with the reason it stays.')
  }
  return findings.length === 0 ? 0 : 1
}

/** Assertions over the parser and both rules, so a broken gate fails itself. */
function runSelfTest() {
  const cases = []
  const sample = "export const Alpha = 1\nexport type { Beta } from './x.js'\nexport function Gamma(): void {}\nexport * from './y.js'\n"
  const parsed = parseExportedNames(sample)
  cases.push(['parses a declaration', parsed.has('Alpha')])
  cases.push(['reads a named re-export', parsed.has('Beta')])
  cases.push(['parses a function declaration', parsed.has('Gamma')])
  cases.push(['reads a type-only brace list', parseExportedNames('export type { Delta }\n').has('Delta')])
  cases.push(['reads an aliased export by its public name', parseExportedNames('export { Inner as Outer }\n').has('Outer')])
  cases.push(['ignores a name that only appears in a comment', !parseExportedNames('// export const Ghost = 1\n').has('Ghost')])
  const table = '| Package | Export | Reason |\n| --- | --- | --- |\n| market-ui | `Zeta` | public API |\n'
  const rows = ledgerRows(table)
  cases.push(['reads a ledger row', rows.length === 1 && rows[0].name === 'Zeta' && rows[0].pkg === 'market-ui'])
  cases.push(['skips the header and the rule', rows.every(row => row.name !== 'Export')])
  cases.push(['matches a nested package path', samePackage('group/market-ui', 'market-ui')])
  cases.push(['does not match a different package', !samePackage('market-ui', 'market-mcp')])
  const failures = cases.filter(([, ok]) => !ok).map(([name]) => name)
  for (const [name, ok] of cases) console.log((ok ? '  ok ' : '  x ') + name)
  if (failures.length > 0) {
    console.log('self-test failed: ' + failures.join(', '))
    return 1
  }
  console.log('self-test passed: ' + cases.length + ' assertions')
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (useJson) console.log(JSON.stringify({ error: String(error?.message ?? error) }, null, 2))
  else console.log('dead-export gate could not run: ' + String(error?.message ?? error))
  process.exitCode = 2
}
