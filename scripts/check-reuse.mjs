#!/usr/bin/env node
/**
 * Host reuse gate.
 *
 * The AGENTS.md standing rule is: reuse the host's own capability before building one, and
 * record every deliberate deviation. Records rot when the authority they cite moves — the
 * npm-published host packages. This gate reads the reuse ledger
 * (docs/reference/reuse-manifest.md), lists the self-built surfaces on disk, and reads the
 * real exports of the installed host packages from their package.json plus declaration files,
 * all without touching the network. Three rules fail the tree:
 *
 * - R1  a self-built file whose normalized name equals a published host export, with no
 *       manifest row naming that file (a duplicate is being built silently);
 * - R2  a manifest row citing a host export the installed package no longer exports
 *       (the host API moved; the ledger statement is now false);
 * - R3  a wait-host row whose cited export now exists in the installed package
 *       (the deviation can be retired; move the row to use-host or self-built).
 *
 * Deterministic by construction: the walk order is sorted, every read is synchronous, and
 * no registry, network, or monorepo checkout is consulted. The npm tarball is the authority
 * for what the host publishes, so the gate audits exactly what an install provides.
 *
 * Usage:
 *   node scripts/check-reuse.mjs [options]
 *
 * Options:
 *   --manifest <path>    Ledger path relative to the repo root
 *                        (default: docs/reference/reuse-manifest.md).
 *   --surface <dir>      Repeatable; extra self-built surface directory relative to the
 *                        repo root (default: src/client/ui).
 *   --package <name>     Repeatable; extra installed host package to scan exports from.
 *   --json               Emit a machine-readable report and exit 0 when no findings.
 *   --self-test          Run the built-in assertions and exit; checks the parser, the
 *                        export-name extractor, and each rule's positive and negative.
 *
 * Exit codes: 0 gate green, 1 findings (or self-test failure), 2 the gate itself could not run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MANIFEST_PATH = join(ROOT, 'docs', 'reference', 'reuse-manifest.md')
const SURFACE_DIRS = [join(ROOT, 'src', 'client', 'ui')]
/** The published UI surface this plugin's client components must be checked against. */
const EXPORT_PACKAGES = [
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-attachment'
]
const FILE_EXTENSIONS = new Set(['.ts', '.tsx'])
const STATUSES = new Set(['use-host', 'self-built', 'wait-host'])

const argv = process.argv.slice(2)
const flag = name => argv.includes('--' + name)
const optionValues = (name, fallback) => {
  const values = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--' + name) {
      const value = argv[i + 1]
      if (value === undefined) fail('missing value after --' + name)
      values.push(value)
      i++
    }
  }
  return values.length === 0 ? fallback : values
}
const fail = message => {
  console.error(message)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// manifest table parsing
// ---------------------------------------------------------------------------

/**
 * Splits one Markdown table row into raw cell texts, honoring the backslash-escaped pipe
 * so a literal pipe inside a cell survives; every other pipe separates cells.
 */
function splitMarkdownTableCells(line) {
  const cells = []
  let current = ''
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (char === '\\' && line[index + 1] === '|') {
      current += '|'
      index += 2
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      index++
      continue
    }
    current += char
    index++
  }
  cells.push(current.trim())
  return cells
}

/** Parses the ledger into row objects; ignores every line that is not a data row. */
function extractManifestRows(text, manifestPath) {
  const rows = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = splitMarkdownTableCells(line)
    const first = cells[1] ?? ''
    // Header, separator, and commentary rows do not name a file in the first cell.
    if (!first.startsWith(String.fromCharCode(96)) || !first.endsWith(String.fromCharCode(96))) continue
    const surface = first.slice(1, -1).trim()
    if (!surface.startsWith('src/')) continue
    const status = (cells[3] ?? '').toLowerCase()
    if (!STATUSES.has(status)) {
      throw new Error(manifestPath + ':' + (index + 1) + ': unknown status "' + (cells[3] ?? '') + '"' + ' (expected use-host, self-built or wait-host) on row for ' + surface)
    }
    rows.push({
      line: index + 1,
      surface,
      counterpart: cells[2] ?? '',
      status,
      decisionRecord: cells[4] ?? ''
    })
  }
  return rows
}

/**
 * Extracts the host-export references the counterpart cell cites, in the two
 * documented shapes: "@deepseek-ai/<pkg>/<subpath>.<Names>" (a subpath export) and
 * "@deepseek-ai/<pkg>.<Names>" (the root entry). Dotted export names such as
 * "plugins.item" are one reference, so the name run is consumed greedily.
 */
function extractCounterpartReferences(cell) {
  const references = []
  const pattern = /@deepseek-ai\/([A-Za-z0-9-]+)((?:\/[A-Za-z0-9-]+)*)\.([A-Za-z0-9-]+(?::type)?(?:\.[A-Za-z0-9-]+(?::type)?)*)/g
  for (const match of cell.matchAll(pattern)) {
    const pkg = '@deepseek-ai/' + match[1]
    const subpath = match[2]
    references.push({ pkg, subpath: subpath === '' ? '.' : './' + subpath.slice(1), names: [match[3]] })
  }
  return references
}

/** Splits the decision record cell into link targets and an optional trailing note. */
function extractDecisionRecords(cell) {
  const links = []
  for (const match of cell.matchAll(/\(([^()\s]+\.md)\)/g)) links.push(match[1])
  const parts = cell.split(' || ')
  const note = parts.length > 1 ? parts[1].trim() : ''
  return { links, note }
}

// ---------------------------------------------------------------------------
// self-built surface inventory
// ---------------------------------------------------------------------------

/** Every code file under the surface, sorted, as a repo-relative path. */
function collectSurfaceFiles(rootDir, surfaceDir) {
  const files = []
  const walk = dir => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry)
      const stats = statSync(full)
      if (stats.isDirectory()) walk(full)
      else if (FILE_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) files.push(relative(rootDir, full).split(sep).join('/'))
    }
  }
  walk(surfaceDir)
  return files
}

// ---------------------------------------------------------------------------
// installed host package exports
// ---------------------------------------------------------------------------

/**
 * Reads the package's declared types entry (or subpath types entry) and collects every
 * exported declaration name, following re-export chains through the package's own
 * declaration files. Names stay exactly as published.
 */
function collectExportedNames(packageDir, subpath) {
  const manifestPath = join(packageDir, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error('cannot read ' + manifestPath + ': ' + error.message)
  }
  const entry = manifest.exports?.[subpath]
  const typesRel = entry?.types ?? (subpath === '.' ? manifest.types : undefined)
  if (!typesRel) {
    throw new Error(relative(ROOT, packageDir) + ' has no types entry for "' + subpath + '"')
  }
  const names = new Set()
  const seen = new Set()
  const walkDts = file => {
    if (seen.has(file)) return
    seen.add(file)
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return
    }
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const match of text.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) {
      const base = resolve(file, '..', match[1]).replace(/\.d\.ts$/, '')
      walkDts(base + '.d.ts')
      walkDts(base + '.d.cts')
      walkDts(base + '.d.mts')
    }
    for (const match of text.matchAll(/['"]([A-Za-z0-9.]+)['"]\s*:/g)) names.add(match[1])
    for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      for (const token of match[1].split(',')) {
        const trimmed = token.trim().replace(/^type\s+/, '')
        if (trimmed === '') continue
        const exported = trimmed.includes(' as ') ? trimmed.split(' as ').pop().trim() : trimmed
        if (/^[A-Za-z0-9-]+$/.test(exported)) names.add(exported)
      }
    }
    for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:const|let|var|function\s*\*?|class|interface|type|enum|namespace)\s+([A-Za-z0-9-]+)/g)) {
      names.add(match[1])
    }
  }
  walkDts(resolve(packageDir, typesRel))
  return names
}

/**
 * Reads the exports the installed package really publishes: subpath keys from
 * package.json exports, names from the declaration files behind their types entries.
 */
function collectPublishedExports(packageName) {
  const packageDir = join(ROOT, 'node_modules', ...packageName.split('/'))
  if (!existsSync(packageDir)) {
    throw new Error(packageName + ' is not installed under node_modules; the gate reads installed packages only')
  }
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const subpaths = Object.keys(manifest.exports ?? { '.': {} }).filter(key => key === '.' || (key.startsWith('./') && !key.includes('*')))
  const bySubpath = new Map()
  for (const subpath of subpaths) {
    try {
      bySubpath.set(subpath, collectExportedNames(packageDir, subpath))
    } catch (error) {
      if (subpath === '.') throw error
      // A subpath that publishes no types entry carries no name contract to check.
      bySubpath.set(subpath, new Set())
    }
  }
  return { packageDir, bySubpath }
}

/** Looks one reference up against the collected package exports. */
function referenceNamesFromExports(publishedExports, pkg, subpath) {
  const entry = publishedExports.get(pkg)
  if (!entry) return undefined
  const names = entry.bySubpath.get(subpath)
  if (names === undefined && subpath !== '.') return new Set()
  return names ?? new Set()
}

// ---------------------------------------------------------------------------
// name normalization
// ---------------------------------------------------------------------------

/** kebab-case, snake_case, PascalCase and camelCase collapse to one comparison key. */
function normalizeName(name) {
  return name
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, '-')
    .replace(/\:+/g, '-')
    .toLowerCase()
}

/** A file's comparison name: last segment without its extension, normalized. */
function fileComparisonName(filePath) {
  const last = filePath.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  return normalizeName(dot === -1 ? last : last.slice(0, dot))
}

// ---------------------------------------------------------------------------
// rule evaluation — pure over the collected inputs
// ---------------------------------------------------------------------------

/**
 * Evaluates the three rules. Inputs are plain data (rows, files, exports) so tests can
 * feed fixtures without building a repository on disk.
 */
function evaluateRules({ rows, surfaceFiles, publishedExports, exportPackages, surfaceDirs }) {
  const findings = []
  const warnings = []
  const registered = new Set(rows.map(row => row.surface))

  // R1: a scanned surface file colliding with a published export name, unregistered.
  const publishedNames = new Map()
  for (const pkg of exportPackages) {
    const entry = publishedExports.get(pkg)
    if (!entry) continue
    for (const names of entry.bySubpath.values()) {
      for (const name of names) {
        const key = normalizeName(name)
        const holder = publishedNames.get(key)
        if (holder && holder.name !== name) continue
        publishedNames.set(key, { name, pkg })
      }
    }
  }
  const surfacesScanned = surfaceDirs.map(dir => relative(ROOT, dir).split(sep).join('/'))
  for (const file of surfaceFiles) {
    const comparison = fileComparisonName(file)
    const hit = publishedNames.get(comparison)
    if (!hit) continue
    if (registered.has(file)) continue
    findings.push({
      rule: 'R1',
      message: file + ' collides with published export ' + hit.pkg + '.' + hit.name + ' but has no row in the reuse ledger; register the surface or rename the file'
    })
  }

  // R2 and R3: every cited export must still exist; wait-host citations must not exist yet.
  for (const row of rows) {
    for (const reference of extractCounterpartReferences(row.counterpart)) {
      const names = referenceNamesFromExports(publishedExports, reference.pkg, reference.subpath)
      if (names === undefined) {
        warnings.push({
          rule: 'R2',
          line: row.line,
          message:
            'ledger row "' +
            row.surface +
            '" cites ' +
            reference.pkg +
            subpathString(reference.subpath) +
            ' but that package is not among the scanned host packages; add it with --package'
        })
        continue
      }
      for (const name of reference.names) {
        const bare = name.replace(/:type$/, '')
        const where = reference.pkg + subpathString(reference.subpath) + '.' + name
        if (!names.has(bare)) {
          findings.push({
            rule: 'R2',
            line: row.line,
            message:
              'ledger row "' +
              row.surface +
              '" cites ' +
              where +
              ' which the installed ' +
              reference.pkg +
              ' does not export' +
              ' (docs/reference/reuse-manifest.md:' +
              row.line +
              ')'
          })
          continue
        }
        if (row.status === 'wait-host') {
          findings.push({
            rule: 'R3',
            line: row.line,
            message:
              'ledger row "' + row.surface + '" waits for ' + where + ' but the installed package already exports it; retire the deviation (move the row to use-host or self-built)'
          })
        }
      }
    }
  }

  return {
    findings,
    warnings,
    surfacesScanned,
    publishedNameCount: publishedNames.size
  }
}

/** Renders a subpath for messages: the root entry stays invisible. */
function subpathString(subpath) {
  return subpath === '.' ? '' : subpath
}

// ---------------------------------------------------------------------------
// self test
// ---------------------------------------------------------------------------

async function selfTest() {
  const assert = (condition, label) => {
    if (!condition) {
      console.error('self-test failed: ' + label)
      process.exitCode = 1
    }
  }
  const assertEqual = (actual, expected, label) =>
    assert(JSON.stringify(actual) === JSON.stringify(expected), label + ' — got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))

  // table cell splitting, including an escaped pipe
  assertEqual(splitMarkdownTableCells('| a | b\\|c | d |'), ['', 'a', 'b|c', 'd', ''], 'splitMarkdownTableCells handles escaped pipes')

  // row extraction: data rows kept, headers/separators/commentary dropped, bad status throws
  const ledger = [
    '# ledger',
    '',
    '| self-built surface | host counterpart | status | decision record |',
    '| --- | --- | --- | --- |',
    '| \`src/x.ts\` | something | use-host | link.md |',
    '| commentary row without backticks | - | use-host | - |',
    '| \`src/y.ts\` | something | undecided | link.md |'
  ].join('\n')
  const okRows = extractManifestRows(ledger.split('\n').slice(0, 5).join('\n'), 'm.md')
  assertEqual(
    okRows.map(row => [row.surface, row.status]),
    [['src/x.ts', 'use-host']],
    'extractManifestRows keeps data rows only'
  )
  let threw = false
  try {
    extractManifestRows(ledger, 'm.md')
  } catch {
    threw = true
  }
  assert(threw, 'extractManifestRows rejects an unknown status')

  // counterpart reference extraction: root, subpath, dotted names, type suffix, free text
  assertEqual(
    extractCounterpartReferences(
      'uses @deepseek-ai/dsh-client-ui-plugin-manager/client.plugins.item and @deepseek-ai/dsh-client-store.createSnapshotStore plus @deepseek-ai/dsh-client-ui-primitives.JsonTreeLabels:type'
    ),
    [
      { pkg: '@deepseek-ai/dsh-client-ui-plugin-manager', subpath: './client', names: ['plugins.item'] },
      { pkg: '@deepseek-ai/dsh-client-store', subpath: '.', names: ['createSnapshotStore'] },
      { pkg: '@deepseek-ai/dsh-client-ui-primitives', subpath: '.', names: ['JsonTreeLabels:type'] }
    ],
    'extractCounterpartReferences reads all documented shapes'
  )
  assertEqual(extractCounterpartReferences('no references here'), [], 'extractCounterpartReferences ignores free text')

  // decision record cell splitting
  assertEqual(
    extractDecisionRecords('(../../docs/a.md) || note: evaluated'),
    { links: ['../../docs/a.md'], note: 'note: evaluated' },
    'extractDecisionRecords splits link and note'
  )

  // export-name extraction from a synthetic declaration set
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const tmp = mkdtempSync(join(tmpdir(), 'reuse-selftest-'))
  try {
    mkdirSync(join(tmp, 'lib', 'types'), { recursive: true })
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test-pkg',
        exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } }
      })
    )
    writeFileSync(
      join(tmp, 'lib', 'types', 'index.d.ts'),
      [
        '/** block comment export FakeName should not leak */',
        "export { RealName } from './real.d.ts';",
        "import type { TypeAlias } from './real.d.ts';",
        'export type { TypeAlias as RenamedAlias };',
        "export * from './leaf.d.ts';",
        'export declare const DeclaredConst: string;',
        'export interface DeclaredInterface {}'
      ].join('\n')
    )
    writeFileSync(join(tmp, 'lib', 'types', 'real.d.ts'), 'export const RealName = 1\nexport type TypeAlias = number\n')
    writeFileSync(join(tmp, 'lib', 'types', 'leaf.d.ts'), 'export interface LeafName {}\n')
    const names = collectExportedNames(tmp, '.')
    assert(names.has('RealName'), 'collectExportedNames reads named re-exports')
    assert(names.has('RenamedAlias'), 'collectExportedNames reads renamed type exports')
    assert(names.has('LeafName'), 'collectExportedNames follows export * chains')
    assert(names.has('DeclaredConst') && names.has('DeclaredInterface'), 'collectExportedNames reads local declarations')
    assert(!names.has('FakeName'), 'collectExportedNames ignores names inside comments')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  // rule evaluation on fixture inputs
  const exportsByPackage = new Map([['@deepseek-ai/test-pkg', { bySubpath: new Map([['.', new Set(['Modal', 'DisclosureRow'])]]) }]])
  const fixture = {
    rows: [
      { line: 3, surface: 'src/a/Modal.tsx', counterpart: '@deepseek-ai/test-pkg.Modal', status: 'use-host', decisionRecord: '' },
      { line: 4, surface: 'src/a/Ghost.tsx', counterpart: '@deepseek-ai/test-pkg.Ghost', status: 'self-built', decisionRecord: '' },
      { line: 5, surface: 'src/a/Wish.tsx', counterpart: '@deepseek-ai/test-pkg.Modal', status: 'wait-host', decisionRecord: '' },
      { line: 6, surface: 'src/a/queue-modal.ts', counterpart: '-', status: 'self-built', decisionRecord: '' },
      { line: 7, surface: 'src/a/Other.tsx', counterpart: '@deepseek-ai/absent-pkg.Thing', status: 'use-host', decisionRecord: '' }
    ],
    surfaceFiles: ['src/a/Modal.tsx', 'src/a/modal.tsx', 'src/a/queue-modal.ts'],
    publishedExports: exportsByPackage,
    exportPackages: ['@deepseek-ai/test-pkg'],
    surfaceDirs: [join(ROOT, 'src', 'a')]
  }
  const result = evaluateRules(fixture)
  // R1: the PascalCase file is registered and suppressed; its kebab twin is not.
  assert(
    result.findings.some(f => f.rule === 'R1' && f.message.includes('src/a/modal.tsx')),
    'R1 fires on the unregistered kebab twin of a published export'
  )
  assert(!result.findings.some(f => f.rule === 'R1' && f.message.includes('src/a/Modal.tsx')), 'R1 stays quiet while a ledger row registers the file')
  assert(!result.findings.some(f => f.rule === 'R1' && f.message.includes('queue-modal')), 'R1 ignores files whose normalized name matches no published export')
  // R2: Ghost is cited but no longer exported; absent-pkg is not scanned at all.
  assert(
    result.findings.some(f => f.rule === 'R2' && f.message.includes('Ghost')),
    'R2 fires on the vanished export'
  )
  assert(
    result.warnings.some(w => w.message.includes('not among the scanned host packages')),
    'unscanned packages are warned instead of failing the gate'
  )
  // R3: the wait-host row cites an export that already exists.
  assert(
    result.findings.some(f => f.rule === 'R3' && f.message.includes('src/a/Wish.tsx')),
    'R3 fires on the published-while-waiting row'
  )
  // Clean fixture: no findings at all.
  const clean = evaluateRules({
    rows: [{ line: 2, surface: 'src/a/Modal.tsx', counterpart: '@deepseek-ai/test-pkg.Modal', status: 'use-host', decisionRecord: '' }],
    surfaceFiles: ['src/a/Modal.tsx'],
    publishedExports: exportsByPackage,
    exportPackages: ['@deepseek-ai/test-pkg'],
    surfaceDirs: [join(ROOT, 'src', 'a')]
  })
  assertEqual(clean.findings, [], 'clean fixture yields zero findings')

  // name normalization is bidirectional across cases
  assertEqual(normalizeName('JsonTreeLabels'), normalizeName('json-tree-labels'), 'normalizeName maps PascalCase to kebab')
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (flag('self-test')) {
    await selfTest()
    if (process.exitCode === 1) {
      console.error('check-reuse self-test: FAILED')
    } else {
      console.log('check-reuse self-test: ok')
    }
    return
  }

  const manifestPath = resolve(ROOT, optionValues('manifest', [relative(ROOT, MANIFEST_PATH)])[0])
  const exportPackages = [...EXPORT_PACKAGES, ...optionValues('package', []).map(name => (name.startsWith('@deepseek-ai/') ? name : '@deepseek-ai/' + name))]
  const surfaceDirs = [...SURFACE_DIRS, ...optionValues('surface', []).map(dir => resolve(ROOT, dir))]

  let text
  try {
    text = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    fail('cannot read the reuse ledger at ' + manifestPath + ': ' + error.message)
  }
  let rows
  try {
    rows = extractManifestRows(text, manifestPath)
  } catch (error) {
    fail(String(error.message ?? error))
  }

  const publishedExports = new Map()
  try {
    for (const packageName of exportPackages) publishedExports.set(packageName, collectPublishedExports(packageName))
  } catch (error) {
    fail(String(error.message ?? error))
  }

  const surfaceFiles = surfaceDirs.flatMap(dir => {
    if (!existsSync(dir)) fail('surface directory ' + dir + ' does not exist')
    return collectSurfaceFiles(ROOT, dir)
  })

  const result = evaluateRules({ rows, surfaceFiles, publishedExports, exportPackages, surfaceDirs })

  if (flag('json')) {
    console.log(JSON.stringify({ manifest: relative(ROOT, manifestPath), ...result }, null, 2))
    if (result.findings.length > 0) process.exitCode = 1
    return
  }

  console.log('check-reuse: ' + rows.length + ' ledger rows, ' + result.surfacesScanned.length + ' surface dir(s), ' + result.publishedNameCount + ' published export names')
  if (result.findings.length === 0) {
    console.log('check-reuse: ok')
    return
  }
  for (const warning of result.warnings) {
    console.error('[warn] ' + warning.message)
  }
  for (const finding of result.findings) {
    console.error('[' + finding.rule + '] ' + finding.message)
  }
  console.error('check-reuse: ' + result.findings.length + ' finding(s) — add or update the ledger row')
  process.exitCode = 1
}

await main()
