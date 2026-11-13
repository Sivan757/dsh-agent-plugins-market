/**
 * The deployment snapshot one experience report carries.
 *
 * A report is only actionable when the maintainer can see the state it happened
 * in: which plugin build ran, how many sources and suites were configured, which
 * surfaces were on, and what the scanner complained about. The person reporting
 * knows the story but not that state, and the model knows neither. Collecting it
 * here means the issue body, the saved bundle and the GitHub page all carry the
 * same facts.
 *
 * Collection never throws into the report path: a snapshot that cannot be read
 * degrades to "unavailable" in the body rather than costing the user their
 * report. Paths are kept to the two roots a maintainer already knows
 * (`userRoot`, `dataRoot`) because a report is not a permission to publish the
 * reporter's home directory.
 * @module platform/diagnostics
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OverviewPayload } from '../../../market-contracts/src/contracts/market.js'
import type { SurfaceToggles } from '../../../market-contracts/src/contracts/surface-toggles.js'

/** One configured source as a report reader needs it. */
export interface DiagnosticSource {
  id: string
  /** The repository a reader recognizes, when the id alone does not say it. */
  display?: string
  kind: string
  url: string
  /** Suites the scan found, and how many of them were installed. */
  suites: number
  installed: number
  /** Scanner diagnostics for this source, when it produced any. */
  notes: string[]
}

/** One redacted, machine-readable snapshot of the deployment. */
export interface DiagnosticSnapshot {
  capturedAt: string
  plugin: { version: string; userRoot: string; dataRoot: string }
  host: { node: string; platform: string; arch: string }
  totals: { suites: number; installed: number; enabled: number }
  surfaces: SurfaceToggles
  sources: DiagnosticSource[]
  /** Scan notes and source errors, flattened for a reader who wants one list. */
  problems: string[]
}

/** What the snapshot is read from; every member is already needed by the bundle. */
export interface DiagnosticInput {
  version: string
  userRoot: string
  dataRoot: string
  overview(): Promise<OverviewPayload>
  toggles(): SurfaceToggles
  now?(): number
}

/**
 * Read one deployment snapshot.
 * @param input - the live reads the snapshot is built from.
 * @returns the snapshot, with a timestamp in UTC.
 */
export async function collectDiagnostics(input: DiagnosticInput): Promise<DiagnosticSnapshot> {
  const overview = await input.overview()
  const installedBySuite = new Map(overview.suites.map(suite => [suite.sourceId + '\u0000' + suite.suiteId, suite.installed === true]))
  const sources: DiagnosticSource[] = overview.sources.map(source => ({
    id: source.id,
    ...(source.displayName === undefined ? {} : { display: source.displayName }),
    kind: source.kind,
    url: source.url,
    suites: source.suiteIds.length,
    installed: source.suiteIds.filter(id => installedBySuite.get(source.id + '\u0000' + id) === true).length,
    notes: source.scanNotes ?? []
  }))
  const problems = [
    ...overview.sources.flatMap(source => (source.error === undefined ? [] : [source.id + ': ' + source.error])),
    ...overview.sources.flatMap(source => (source.scanNotes ?? []).map(note => source.id + ': ' + note))
  ]
  const now = input.now?.() ?? Date.now()
  return {
    capturedAt: new Date(now).toISOString(),
    plugin: { version: input.version, userRoot: input.userRoot, dataRoot: input.dataRoot },
    host: { node: process.version, platform: process.platform, arch: process.arch },
    totals: { suites: overview.totals.all, installed: overview.totals.installed, enabled: overview.totals.enabled },
    surfaces: input.toggles(),
    sources,
    problems
  }
}

/** Render one snapshot as the issue body's deployment section. */
export function renderDiagnosticsSection(snapshot: DiagnosticSnapshot | undefined): string {
  if (snapshot === undefined) return '## Deployment\n\nDiagnostics could not be collected for this report.'
  const lines = [
    '## Deployment',
    '',
    `- Plugin: \`dsh-agent-plugins-market@${snapshot.plugin.version}\``,
    `- Host: Node \${snapshot.host.node} on \${snapshot.host.platform}/${snapshot.host.arch}`,
    `- Captured: ${snapshot.capturedAt}`,
    `- Totals: ${snapshot.totals.suites} suite(s) discovered, ${snapshot.totals.installed} installed, ${snapshot.totals.enabled} enabled`,
    `- Surfaces: ${Object.entries(snapshot.surfaces)
      .map(([key, on]) => key + '=' + (on ? 'on' : 'off'))
      .join(', ')}`,
    '',
    '### Sources',
    ''
  ]
  if (snapshot.sources.length === 0) lines.push('None configured.')
  else {
    lines.push('| Source | Kind | Suites | Installed |', '| --- | --- | --- | --- |')
    for (const source of snapshot.sources) {
      lines.push(`| \`${source.display ?? source.id}\` | ${source.kind} | ${source.suites} | ${source.installed} |`)
    }
  }
  lines.push('', '### Diagnostics', '')
  if (snapshot.problems.length === 0) lines.push('No scan notes or source errors.')
  else for (const problem of snapshot.problems) lines.push('- ' + problem)
  return lines.join('\n')
}

/** One saved bundle: the report the person wrote plus the state it happened in. */
export interface DiagnosticBundle {
  directory: string
  reportPath: string
}

/**
 * Write one report and its snapshot under `<dataRoot>/feedback/<stamp>/`.
 *
 * The directory is per report so a second report never overwrites the evidence
 * of the first, and the two files are separate because a person reads the
 * markdown while a tool reads the JSON.
 * @param dataRoot - the plugin's data root.
 * @param report - the composed report.
 * @param snapshot - the deployment snapshot, when it could be collected.
 * @param now - the capture time used in the directory name.
 * @returns the bundle's directory and report path.
 */
export async function writeDiagnosticBundle(
  dataRoot: string,
  report: { title: string; description: string; expected?: string; actual?: string },
  snapshot: DiagnosticSnapshot | undefined,
  now = Date.now()
): Promise<DiagnosticBundle> {
  const stamp = new Date(now).toISOString().replaceAll(/[:.]/gu, '-')
  const directory = join(dataRoot, 'feedback', stamp)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const reportPath = join(directory, 'report.md')
  const lines = [
    '# ' + report.title,
    '',
    '**Problem:** ' + report.description,
    ...(report.expected === undefined ? [] : ['', '**Expected:** ' + report.expected]),
    ...(report.actual === undefined ? [] : ['', '**Actual:** ' + report.actual]),
    '',
    renderDiagnosticsSection(snapshot)
  ]
  await writeFile(reportPath, lines.join('\n'), { mode: 0o600 })
  await writeFile(join(directory, 'state.json'), JSON.stringify(snapshot ?? { unavailable: true }, null, 2), { mode: 0o600 })
  return { directory, reportPath }
}

let cachedVersion: string | undefined

/**
 * The running artifact's own version.
 *
 * The bundle is one published package whose entry sits at the repository root,
 * while this module lives five directories down in the emitted layout. Reading
 * the nearest `package.json` whose name is this plugin is the one spelling that
 * works from both the source tree and `lib/`.
 * @returns the package version, or `unknown` when no manifest can be read.
 */
export function pluginVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion
  let directory = new URL('.', import.meta.url)
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8')) as { name?: string; version?: string }
      if (manifest.name === 'dsh-agent-plugins-market' && typeof manifest.version === 'string') {
        cachedVersion = manifest.version
        return cachedVersion
      }
    } catch {
      // Not the package root yet; keep walking up.
    }
    directory = new URL('../', directory)
  }
  cachedVersion = 'unknown'
  return cachedVersion
}
