import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
/* The pure parser/rule functions live inside the gate script, which runs main() at import time;
 * evaluating the shared source block is the only way to drive them in-process. */
/* eslint-disable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call */

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCRIPT = join(ROOT, 'scripts', 'check-reuse.mjs')
/** Runs the gate as a child process; returns stdout, or the failure object when it exits non-zero. */
type GateSuccess = { ok: true; stdout: string }
type GateFailure = { ok: false; status: number; stdout: string; stderr: string }
type GateResult = GateSuccess | GateFailure
const runGate = (args: string[], options: { expectFailure?: boolean } = {}): GateResult => {
  try {
    return { ok: true, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    if (options.expectFailure) return { ok: false, status: failure.status, stdout: failure.stdout, stderr: failure.stderr }
    throw error
  }
}

/** Extracts the pure functions out of the gate script's source text. The gate runs
 * main() at import time, so the tests evaluate the shared function block and drive it
 * with fixture data instead of importing the module. */
function loadPureFns() {
  const source = readFileSync(SCRIPT, 'utf8')
  const start = source.indexOf('function splitMarkdownTableCells')
  const end = source.indexOf('// self test')
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const consts = source.slice(source.indexOf('const STATUSES'), source.indexOf('const argv'))
  const factory = new Function(
    consts +
      String.fromCharCode(10) +
      source.slice(start, end) +
      '; return { splitMarkdownTableCells, extractManifestRows, extractCounterpartReferences, evaluateRules, normalizeName, fileComparisonName }'
  )
  return factory() as {
    splitMarkdownTableCells(line: string): string[]
    extractManifestRows(text: string, manifestPath: string): { line: number; surface: string; counterpart: string; status: string; decisionRecord: string }[]
    extractCounterpartReferences(cell: string): { pkg: string; subpath: string; names: string[] }[]
    evaluateRules(input: {
      rows: { line: number; surface: string; counterpart: string; status: string; decisionRecord: string }[]
      surfaceFiles: string[]
      publishedExports: Map<string, { bySubpath: Map<string, Set<string>> }>
      exportPackages: string[]
      surfaceDirs: string[]
    }): { findings: { rule: string; line?: number; message: string }[]; warnings: { message: string }[]; surfacesScanned: string[]; publishedNameCount: number }
    normalizeName(name: string): string
    fileComparisonName(path: string): string
  }
}

describe('reuse manifest table parsing', () => {
  const fns = loadPureFns()

  it('splits table cells and honors escaped pipes', () => {
    expect(fns.splitMarkdownTableCells('| a | b' + String.fromCharCode(92) + '|c | d |')).toEqual(['', 'a', 'b|c', 'd', ''])
  })

  it('keeps data rows and drops headers, separators, and commentary', () => {
    const ledger = [
      '# ledger',
      '',
      '| self-built surface | host counterpart | status | decision record |',
      '| --- | --- | --- | --- |',
      '| `src/x.ts` | uses @deepseek-ai/pkg-a.Name | use-host | link.md |',
      '| a commentary row without a backticked path | - | use-host | - |'
    ].join('\n')
    const rows = fns.extractManifestRows(ledger, 'm.md')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ surface: 'src/x.ts', status: 'use-host', counterpart: 'uses @deepseek-ai/pkg-a.Name' })
  })

  it('throws on an unknown status', () => {
    expect(() => fns.extractManifestRows('| `src/y.ts` | - | undecided | - |', 'm.md')).toThrow(/unknown status/)
  })

  it('extracts root, subpath, dotted, and type-only citations', () => {
    const refs = fns.extractCounterpartReferences('typed by @deepseek-ai/pkg-a/client.plugins.item plus @deepseek-ai/pkg-b.Name and @deepseek-ai/pkg-c.Alias:type')
    expect(refs).toEqual([
      { pkg: '@deepseek-ai/pkg-a', subpath: './client', names: ['plugins.item'] },
      { pkg: '@deepseek-ai/pkg-b', subpath: '.', names: ['Name'] },
      { pkg: '@deepseek-ai/pkg-c', subpath: '.', names: ['Alias:type'] }
    ])
    expect(fns.extractCounterpartReferences('free prose only')).toEqual([])
  })

  it('normalizes names bidirectionally across cases', () => {
    expect(fns.normalizeName('JsonTreeLabels')).toBe(fns.normalizeName('json-tree-labels'))
    expect(fns.fileComparisonName('src/a/JsonTreeLabels.tsx')).toBe(fns.normalizeName('JsonTreeLabels'))
  })
})

describe('reuse gate rules', () => {
  const fns = loadPureFns()
  const exportsByPackage = new Map([['@deepseek-ai/test-pkg', { bySubpath: new Map([['.', new Set(['Modal', 'DisclosureRow'])]]) }]])
  type Row = { line: number; surface: string; counterpart: string; status: string; decisionRecord: string }
  const row = (surface: string, counterpart: string, status: string, line: number): Row => ({ line, surface, counterpart, status, decisionRecord: '' })

  it('R1 fires on an unregistered collision and its kebab twin, not on registered files', () => {
    const result = fns.evaluateRules({
      rows: [row('src/a/Modal.tsx', '@deepseek-ai/test-pkg.Modal', 'use-host', 3)],
      surfaceFiles: ['src/a/Modal.tsx', 'src/a/modal.tsx', 'src/a/unrelated.ts'],
      publishedExports: exportsByPackage,
      exportPackages: ['@deepseek-ai/test-pkg'],
      surfaceDirs: []
    })
    const r1 = result.findings.filter(f => f.rule === 'R1')
    expect(r1).toHaveLength(1)
    expect(r1[0]?.message).toContain('src/a/modal.tsx')
  })

  it('R2 fires when a cited export no longer exists', () => {
    const result = fns.evaluateRules({
      rows: [row('src/a/Ghost.tsx', '@deepseek-ai/test-pkg.Ghost', 'self-built', 4)],
      surfaceFiles: [],
      publishedExports: exportsByPackage,
      exportPackages: ['@deepseek-ai/test-pkg'],
      surfaceDirs: []
    })
    expect(result.findings.some(f => f.rule === 'R2' && f.message.includes('Ghost'))).toBe(true)
  })

  it('R3 fires when a wait-host citation already exists upstream', () => {
    const result = fns.evaluateRules({
      rows: [row('src/a/Wish.tsx', '@deepseek-ai/test-pkg.Modal', 'wait-host', 5)],
      surfaceFiles: [],
      publishedExports: exportsByPackage,
      exportPackages: ['@deepseek-ai/test-pkg'],
      surfaceDirs: []
    })
    expect(result.findings.some(f => f.rule === 'R3' && f.message.includes('Wish'))).toBe(true)
  })

  it('a fully consistent fixture yields zero findings', () => {
    const result = fns.evaluateRules({
      rows: [row('src/a/Modal.tsx', '@deepseek-ai/test-pkg.Modal', 'use-host', 2)],
      surfaceFiles: ['src/a/Modal.tsx'],
      publishedExports: exportsByPackage,
      exportPackages: ['@deepseek-ai/test-pkg'],
      surfaceDirs: []
    })
    expect(result.findings).toEqual([])
  })
})

describe('check-reuse script contract', () => {
  it('passes --self-test', () => {
    expect(runGate(['--self-test']).stdout).toContain('check-reuse self-test: ok')
  })

  it('exits 0 on the current tree and prints the ledger summary', () => {
    expect(runGate([]).stdout).toContain('check-reuse: ok')
  })

  it('exits 1 on a manifest citing an export the installed package lacks', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'reuse-gate-test-'))
    try {
      writeFileSync(
        join(tmp, 'reuse-manifest.md'),
        [
          '# ledger',
          '',
          '| self-built surface | host counterpart | status | decision record |',
          '| --- | --- | --- | --- |',
          '| `src/x.ts` | @deepseek-ai/dsh-client-ui-primitives.DefinitelyNotExported | self-built | note.md |'
        ].join('\n')
      )
      const failure = runGate(['--manifest', join(tmp, 'reuse-manifest.md')], { expectFailure: true })
      if (!failure.ok) {
        expect(failure.status).toBe(1)
        expect(failure.stderr).toContain('DefinitelyNotExported')
      } else {
        expect.unreachable('gate should have failed')
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('exits 1 on a wait-host row whose citation already exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'reuse-gate-test-'))
    try {
      writeFileSync(
        join(tmp, 'reuse-manifest.md'),
        [
          '# ledger',
          '',
          '| self-built surface | host counterpart | status | decision record |',
          '| --- | --- | --- | --- |',
          '| `src/x.ts` | @deepseek-ai/dsh-client-ui-primitives.relativeTime | wait-host | note.md |'
        ].join('\n')
      )
      const failure = runGate(['--manifest', join(tmp, 'reuse-manifest.md')], { expectFailure: true })
      if (!failure.ok) {
        expect(failure.status).toBe(1)
        expect(failure.stderr).toContain('already exports it')
      } else {
        expect.unreachable('gate should have failed')
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
