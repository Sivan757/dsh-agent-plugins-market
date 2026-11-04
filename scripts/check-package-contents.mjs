/**
 * Package-contents gate.
 *
 * The published tarball is what a user installs, and it is smaller than the
 * checkout: `files` in package.json decides what travels. An emitted module that
 * imports a file the tarball does not carry compiles here, passes every test here,
 * and fails only after installation, when the fewest people are watching.
 *
 * This walks the built `lib/` graph and resolves each relative specifier against
 * the paths the manifest actually ships, so a stale cross-directory import fails
 * before the pack rather than after it.
 *
 * Usage:
 *   node scripts/check-package-contents.mjs [--json] [--self-test]
 *
 * Exit codes: 0 gate green, 1 findings or self-test failure, 2 the gate could not run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const useJson = argv.includes('--json')
const selfTest = argv.includes('--self-test')

/** Strip comments, so a path mentioned in prose is not read as an import. */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * Every module specifier one file loads: static imports, re-exports and dynamic ones.
 * @param source - module text.
 * @returns the raw specifiers, in source order.
 */
function specifiersIn(source) {
  const text = stripComments(source)
  const found = []
  // A side-effect import carries no `from`, so it needs its own pattern: an
  // emitted file that loads a stylesheet or a setup module that way is as much a
  // shipped-path dependency as any other.
  const patterns = [
    /\bfrom\s+'([^']+)'/g,
    /\bfrom\s+"([^"]+)"/g,
    /\bimport\s+'([^']+)'/g,
    /\bimport\s+"([^"]+)"/g,
    /\bimport\s*\(\s*'([^']+)'\s*\)/g,
    /\bimport\s*\(\s*"([^"]+)"\s*\)/g
  ]
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(match[1])
  return found
}

/** Every JavaScript module under one directory, sorted for a stable report. */
function modulesUnder(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) modulesUnder(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * The repository paths the manifest ships, as absolute prefixes.
 * @param files - the `files` entries from package.json.
 * @param base - the package root the entries are relative to.
 * @returns absolute paths, each either a file or a directory.
 */
function shippedRoots(files, base = ROOT) {
  return files.map(entry => resolve(base, entry.replace(/\/$/, '')))
}

/**
 * Whether a resolved path travels in the tarball.
 * @param target - the absolute path an import names.
 * @param roots - the shipped prefixes.
 * @returns true when the path is inside one of them.
 */
function shipped(target, roots) {
  return roots.some(root => target === root || target.startsWith(root + sep))
}

/**
 * Resolve one relative specifier to the file it names.
 * @param from - the importing file's absolute path.
 * @param specifier - the raw specifier, which must be relative.
 * @returns the absolute path, or undefined when nothing exists there.
 */
function resolveRelative(from, specifier) {
  const base = resolve(from, '..', specifier.replace(/\.js$/, ''))
  for (const candidate of [base + '.js', base + '.json', base, join(base, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

/**
 * Check the built graph against what the manifest ships.
 * @param root - the package root.
 * @param files - the manifest's `files` entries.
 * @returns findings, each with a code and a message.
 */
export function findings(root, files) {
  const roots = shippedRoots(files)
  const found = []
  for (const entry of files) {
    if (!existsSync(resolve(root, entry.replace(/\/$/, '')))) found.push({ code: 'missing-entry', message: 'package.json files lists ' + entry + ', which does not exist' })
  }
  for (const module of modulesUnder(join(root, 'lib'))) {
    for (const specifier of specifiersIn(readFileSync(module, 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      const target = resolveRelative(module, specifier)
      const where = relative(root, module).split(sep).join('/')
      if (target === undefined) {
        found.push({ code: 'unresolved-import', message: where + ' imports ' + specifier + ', which does not exist' })
        continue
      }
      if (!shipped(target, roots)) found.push({ code: 'outside-package', message: where + ' imports ' + specifier + ', which the manifest does not ship' })
    }
  }
  return found
}

function main() {
  if (selfTest) return runSelfTest()
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const files = manifest.files ?? []
  if (!Array.isArray(files) || files.length === 0) throw new Error('package.json has no files list, so nothing is known to ship')
  const modules = modulesUnder(join(ROOT, 'lib')).length
  if (modules === 0) throw new Error('no built modules under lib; run pnpm run build first')
  const report = findings(ROOT, files)
  if (useJson) console.log(JSON.stringify({ modules, shipped: files.length, findings: report }, null, 2))
  else {
    console.log('package contents: ' + String(modules) + ' module(s), ' + String(files.length) + ' shipped path(s), ' + String(report.length) + ' finding(s)')
    for (const finding of report) console.log('  x [' + finding.code + '] ' + finding.message)
    if (report.length === 0) console.log('  ok every import resolves inside a shipped path')
  }
  return report.length === 0 ? 0 : 1
}

/** Assertions over the parser, the shipped-path rule and the resolver. */
function runSelfTest() {
  const cases = []
  const insideRoot = '/tmp/pkg'
  const roots = shippedRoots(['lib', 'client'], insideRoot)
  cases.push(['reads a static import', specifiersIn("import { a } from './a.js'").includes('./a.js')])
  cases.push(['reads a dynamic import', specifiersIn("await import('./b.js')").includes('./b.js')])
  cases.push(['reads a side-effect import', specifiersIn("import './setup.js'").includes('./setup.js')])
  cases.push(['ignores a comment', !specifiersIn("// from './c.js'\nconst x = 1").includes('./c.js')])
  cases.push(['a lib file ships', shipped(resolve(insideRoot, 'lib/index.js'), roots)])
  cases.push(['a client file ships', shipped(resolve(insideRoot, 'client/client.js'), roots)])
  cases.push(['a source file does not', !shipped(resolve(insideRoot, 'src/index.ts'), roots)])
  cases.push(['a sibling prefix is not a match', !shipped(resolve(insideRoot, 'library/x.js'), roots)])
  cases.push(['a missing file resolves to nothing', resolveRelative(insideRoot + '/lib/index.js', './gone.js') === undefined])
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
  else console.log('package contents gate could not run: ' + String(error?.message ?? error))
  process.exitCode = 2
}
