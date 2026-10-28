/**
 * CSS module class gate.
 *
 * A class nothing references is invisible: the stylesheet still ships, the build
 * still passes, and the name reads as if some screen used it. The audit that
 * removed dead exports and unreachable modules could not see this half of the same
 * problem, because a class name is data rather than an import.
 *
 * The analysis stays conservative on purpose. A class is reported only when its
 * module's importers are all known, none of them reaches the module by a computed
 * key, and the name appears neither as \`ident.name\` nor as a string literal. A
 * stylesheet with a computed access is skipped entirely: a wrong report here is a
 * style that disappears from a screen nobody checked.
 *
 * Usage:
 *   node scripts/check-css-classes.mjs [--json] [--self-test]
 *
 * Exit codes: 0 gate green, 1 findings or self-test failure, 2 the gate could not run.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const useJson = argv.includes('--json')
const selfTest = argv.includes('--self-test')
const LEDGER = 'docs/reference/css-classes.md'

/** Source files the analysis reads. */
function sourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * The classes a stylesheet defines.
 * @param text - stylesheet contents.
 * @returns the class names, in source order.
 */
function classNames(text) {
  const names = []
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of withoutComments.matchAll(/^\s*\.([a-zA-Z][\w-]*)\b/gm)) names.push(match[1])
  // A stylesheet may state the same class twice, for a variant block; it is still one name.
  return [...new Set(names)]
}

/**
 * The identifiers one file binds a stylesheet to.
 * @param text - module text.
 * @param stylesheet - absolute path of the stylesheet.
 * @param file - absolute path of the importing file.
 * @returns the bound identifiers.
 */
function boundIdentifiers(text, stylesheet, file) {
  const idents = []
  for (const match of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+\.module\.css)'/g)) {
    if (resolve(dirname(file), match[2]) === stylesheet) idents.push(match[1])
  }
  return idents
}

/**
 * Whether a file reaches a stylesheet through a computed key, which the analysis cannot follow.
 * @param text - module text.
 * @param ident - the identifier the stylesheet is bound to.
 * @returns true when the identifier is indexed or concatenated.
 */
function computedAccess(text, ident) {
  const escaped = ident.replace(/[$]/g, '\\$&')
  return new RegExp('\\b' + escaped + '\\s*\\[').test(text) || new RegExp(escaped + "\\s*\\+\\s*'").test(text) || new RegExp("'\\s*\\+\\s*" + escaped + '\\b').test(text)
}

/**
 * Read the ledger's recorded class names.
 * @param text - ledger contents.
 * @returns one entry per Markdown table row, as \`path#class\`.
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
    if (cells[0].toLowerCase() === 'class' || /^-+$/.test(cells[0].replace(/[: ]/g, ''))) continue
    const module = cells[0].replace(/`/g, '')
    if (module !== '') rows.push(module)
  }
  return rows
}

/**
 * Report classes no importer references.
 * @param root - the repository root.
 * @returns findings and the number of stylesheets the analysis could read.
 */
export function analyze(root) {
  const files = sourceFiles(join(root, 'packages'))
  const texts = new Map(files.map(file => [file, readFileSync(file, 'utf8')]))
  const stylesheets = files.filter(file => file.endsWith('.module.css'))
  const all = [
    ...texts.keys(),
    ...readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(root, 'packages', entry.name))
  ]
  const sheets = []
  const walkSheets = dir => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'lib') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walkSheets(full)
      else if (entry.name.endsWith('.module.css')) sheets.push(full)
    }
  }
  walkSheets(join(root, 'packages'))
  // A class can be pulled into another sheet by `composes`, which no importer mentions.
  const composed = new Map()
  for (const sheet of sheets) {
    const text = readFileSync(sheet, 'utf8')
    for (const match of text.matchAll(/composes:\s*([\w-]+)\s+from\s+'([^']+)'/g)) {
      const target = resolve(dirname(sheet), match[2])
      if (!composed.has(target)) composed.set(target, new Set())
      composed.get(target).add(match[1])
    }
  }
  const findings = []
  let analyzed = 0
  for (const sheet of sheets) {
    const names = classNames(readFileSync(sheet, 'utf8'))
    if (names.length === 0) continue
    const importers = []
    for (const [file, text] of texts) {
      const idents = boundIdentifiers(text, sheet, file)
      if (idents.length > 0) importers.push({ file, text, idents })
    }
    if (importers.length === 0) continue
    if (importers.some(importer => importer.idents.some(ident => computedAccess(importer.text, ident)))) continue
    analyzed += 1
    const where = relative(root, sheet).split(sep).join('/')
    for (const name of names) {
      const referenced = importers.some(
        importer =>
          importer.idents.some(ident => new RegExp('\\b' + ident + '\\.' + name + '\\b').test(importer.text)) || new RegExp('[\'"\`]' + name + '[\'"\`]').test(importer.text)
      )
      const borrowed = composed.get(sheet)?.has(name) === true
      if (!referenced && !borrowed) findings.push({ code: 'unused-class', message: where + ' defines .' + name + ', which no importer references' })
    }
  }
  return { findings, analyzed, sheets: sheets.length }
}

function main() {
  if (selfTest) return runSelfTest()
  const result = analyze(ROOT)
  const ledgerFile = join(ROOT, LEDGER)
  const recorded = new Set(existsSync(ledgerFile) ? ledgerRows(readFileSync(ledgerFile, 'utf8')) : [])
  const rows = new Set()
  const findings = []
  for (const finding of result.findings) {
    const module = /\.module\.css defines \.([\w-]+)/.exec(finding.message)
    const path = /\(([^)]+)\.module\.css\)/.exec(finding.message)
    rows.add(finding.message)
    if (!recorded.has(finding.message)) findings.push(finding)
  }
  const stale = [...recorded].filter(row => !result.findings.some(finding => finding.message === row))
  for (const row of stale) findings.push({ code: 'ledger-stale', message: LEDGER + ' records a class that is referenced again: ' + row })
  if (useJson) console.log(JSON.stringify({ sheets: result.sheets, analyzed: result.analyzed, findings }, null, 2))
  else {
    console.log(
      'css classes: ' +
        String(result.sheets) +
        ' stylesheet(s), ' +
        String(result.analyzed) +
        ' analyzed, ' +
        String(result.findings.length) +
        ' finding(s), ' +
        String(recorded.size) +
        ' recorded'
    )
    for (const finding of findings) console.log('  x [' + finding.code + '] ' + finding.message)
    if (findings.length === 0) console.log('  ok every class is referenced or recorded')
  }
  return findings.length === 0 ? 0 : 1
}

/** Assertions over the parser and the reference rules. */
function runSelfTest() {
  const cases = []
  cases.push(['reads a class', classNames('.a {\n  color: red;\n}').includes('a')])
  cases.push(['reads the first class of a compound selector', classNames('.a.b {\n}').includes('a')])
  cases.push(['ignores a comment', !classNames('/* .gone { } */\n.live { }').includes('gone')])
  cases.push(['binds an import', boundIdentifiers("import css from './x.module.css'", '/p/x.module.css', '/p/a.ts').includes('css')])
  cases.push(['ignores another sheet', boundIdentifiers("import css from './y.module.css'", '/p/x.module.css', '/p/a.ts').length === 0])
  cases.push(['sees a computed key', computedAccess('const x = css[name]', 'css')])
  cases.push(['sees a concatenation', computedAccess("const x = css + '-' + y", 'css')])
  cases.push(['a plain use is not computed', !computedAccess('const x = css.a', 'css')])
  const table = '| class | reason |\n| --- | --- |\n| .a | unused |\n'
  cases.push(['reads a ledger row', ledgerRows(table).length === 1])
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
  else console.log('css class gate could not run: ' + String(error?.message ?? error))
  process.exitCode = 2
}
