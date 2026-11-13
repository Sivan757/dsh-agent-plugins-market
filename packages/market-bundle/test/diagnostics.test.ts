import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDiagnostics, pluginVersion, renderDiagnosticsSection, writeDiagnosticBundle, type DiagnosticSnapshot } from '../src/platform/diagnostics.js'
import type { OverviewPayload } from '../../market-contracts/src/contracts/market.js'
import { ALL_SURFACES_ON } from '../../market-contracts/src/contracts/surface-toggles.js'

/** One overview whose sources disagree, so the snapshot has something to report. */
function overview(): OverviewPayload {
  return {
    sources: [
      {
        id: 'alpha',
        displayName: 'owner/alpha',
        url: 'https://github.com/owner/alpha',
        kind: 'git',
        cloned: true,
        suiteIds: ['one', 'two'],
        scanNotes: ['one: manifest name is missing; used the directory name']
      },
      {
        id: 'beta',
        url: 'file:///tmp/beta',
        kind: 'local',
        local: true,
        cloned: false,
        suiteIds: [],
        error: 'checkout is unavailable'
      }
    ],
    suites: [
      {
        sourceId: 'alpha',
        suiteId: 'one',
        name: 'one',
        keywords: [],
        surfaces: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0, instructions: 0 },
        enabled: true,
        installed: true,
        dimension: 'user'
      },
      {
        sourceId: 'alpha',
        suiteId: 'two',
        name: 'two',
        keywords: [],
        surfaces: { skills: 0, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0, instructions: 0 },
        enabled: false,
        installed: false,
        dimension: 'user'
      }
    ],
    totals: { all: 2, installed: 1, enabled: 1 },
    roots: { user: '/tmp/user', data: '/tmp/data' }
  } as unknown as OverviewPayload
}

const snapshotInput = {
  version: '9.9.9',
  userRoot: '/tmp/user',
  dataRoot: '/tmp/data',
  overview: async () => overview(),
  toggles: () => ALL_SURFACES_ON,
  now: () => 1_700_000_000_000
}

describe('deployment diagnostics', () => {
  it('counts suites per source and flattens what needs attention', async () => {
    const snapshot = await collectDiagnostics(snapshotInput)
    expect(snapshot.plugin.version).toBe('9.9.9')
    expect(snapshot.capturedAt).toBe(new Date(1_700_000_000_000).toISOString())
    expect(snapshot.totals).toEqual({ suites: 2, installed: 1, enabled: 1 })
    expect(snapshot.sources.map(source => [source.id, source.suites, source.installed])).toEqual([
      ['alpha', 2, 1],
      ['beta', 0, 0]
    ])
    // An error and a scan note are both something a maintainer must read.
    expect(snapshot.problems).toEqual(['beta: checkout is unavailable', 'alpha: one: manifest name is missing; used the directory name'])
  })

  it('renders a deployment section a maintainer can read without the JSON', async () => {
    const text = renderDiagnosticsSection(await collectDiagnostics(snapshotInput))
    expect(text.startsWith('## Deployment')).toBe(true)
    expect(text).toContain('dsh-agent-plugins-market@9.9.9')
    expect(text).toContain('2 suite(s) discovered, 1 installed, 1 enabled')
    expect(text).toContain('| `owner/alpha` | git | 2 | 1 |')
    expect(text).toContain('beta: checkout is unavailable')
    expect(renderDiagnosticsSection(undefined)).toContain('Diagnostics could not be collected')
  })

  it('writes the report and the machine-readable state into one bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diagnostics-'))
    try {
      const snapshot: DiagnosticSnapshot = await collectDiagnostics(snapshotInput)
      const bundle = await writeDiagnosticBundle(
        root,
        { title: 'Install fails', description: 'The button errors.', expected: 'It installs.', actual: 'It failed.' },
        snapshot,
        1_700_000_000_000
      )
      const markdown = await readFile(bundle.reportPath, 'utf8')
      expect(markdown).toContain('# Install fails')
      expect(markdown).toContain('**Expected:** It installs.')
      expect(markdown).toContain('## Deployment')
      expect(markdown).toContain('beta: checkout is unavailable')
      const state = JSON.parse(await readFile(join(bundle.directory, 'state.json'), 'utf8')) as DiagnosticSnapshot
      expect(state.plugin.version).toBe('9.9.9')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads the running artifact version from its own manifest', () => {
    expect(pluginVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
