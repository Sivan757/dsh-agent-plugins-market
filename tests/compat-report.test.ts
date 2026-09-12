/**
 * Guards the compatibility report: every schema in `schemas/` must have a
 * pinned sample, the checked-in report must stay structurally valid, both
 * READMEs must link the report and the audit, and the evidence docs must cite
 * every sampled repository. The network harness (`scripts/compat-report.mjs`)
 * is not run here — this test keeps the checked-in evidence honest between
 * regenerations.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VERDICTS = new Set(['integrated', 'shadowed', 'unread', 'error'])
const SURFACES = ['skills', 'commands', 'agents', 'mcp', 'hooks', 'lsp'] as const

interface ManifestResult {
  file: string
  schema: string | null
  present?: boolean
  valid: boolean
  errors: string[]
}

interface ReportSample {
  dialect: string
  schema: string
  repo: string
  branch: string
  stars: number
  commit?: string
  pluginManifest: string | null
  marketplaceManifest: string | null
  verdict: string
  interpretation?: string
  error?: string
  manifest?: { vendored: boolean; plugin: ManifestResult | null; marketplace: ManifestResult | null }
  scan?: {
    suiteCount: number
    layouts: string[]
    surfaces: Record<string, number>
    dialectManifestRead: boolean
    dialectMarketplaceRead: boolean
    presentMarketplaces: string[]
  }
}

interface Report {
  generatedAt: string
  selection: { metric: string; checkedOn: string }
  samples: ReportSample[]
}

interface PinnedSample {
  dialect: string
  schema: string
  repo: string
  branch: string
  stars: number
}

const report = JSON.parse(await readFile(join(ROOT, 'docs', 'compat-report.json'), 'utf8')) as Report
const config = JSON.parse(await readFile(join(ROOT, 'scripts', 'compat-sources.json'), 'utf8')) as { samples: PinnedSample[] }
/** Dialect directories that ship a plugin schema; `1.0.0/` is vendored and `skill-collection/` has no manifest. */
const schemaDirectories: string[] = []
for (const entry of await readdir(join(ROOT, 'schemas'), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === '1.0.0') continue
  const files = await readdir(join(ROOT, 'schemas', entry.name))
  if (files.includes('plugin.schema.json')) schemaDirectories.push(entry.name)
}

describe('compatibility report', () => {
  it('covers every dialect schema, including the vendored agent-plugins schema', () => {
    const covered = new Set(report.samples.map(sample => sample.schema))
    for (const dialect of schemaDirectories) expect(covered, `schemas/${dialect} has no sample`).toContain(dialect)
    expect(covered).toContain('agent-plugins')
    expect(report.samples.length).toBeGreaterThanOrEqual(schemaDirectories.length + 1)
  })

  it('matches the pinned sample matrix', () => {
    expect(report.samples.map(sample => sample.dialect).sort()).toEqual(config.samples.map(sample => sample.dialect).sort())
    for (const pinned of config.samples) {
      const sample = report.samples.find(candidate => candidate.dialect === pinned.dialect)
      expect(sample, `${pinned.dialect} missing from the report`).toBeDefined()
      expect(sample?.repo).toBe(pinned.repo)
      expect(sample?.branch).toBe(pinned.branch)
      expect(sample?.stars).toBe(pinned.stars)
      expect(sample?.schema).toBe(pinned.schema)
    }
  })

  it('records a commit, a verdict and a schema verdict per sample', () => {
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(report.selection.metric).toBe('stargazers')
    expect(report.selection.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (const sample of report.samples) {
      expect(sample.repo, `${sample.dialect} repo shape`).toMatch(/^[\w.-]+\/[\w.-]+$/)
      expect(VERDICTS, `${sample.dialect} verdict`).toContain(sample.verdict)
      if (sample.verdict === 'error') {
        expect(sample.error, `${sample.dialect} error text`).toBeTruthy()
        continue
      }
      expect(sample.commit, `${sample.dialect} commit`).toMatch(/^[0-9a-f]{40}$/)
      expect(sample.manifest, `${sample.dialect} manifest results`).toBeDefined()
      expect(sample.scan, `${sample.dialect} scan results`).toBeDefined()
      for (const slot of ['plugin', 'marketplace'] as const) {
        const entry = sample.manifest?.[slot]
        if (entry === null || entry === undefined) continue
        expect(entry.file, `${sample.dialect} ${slot} file`).toBeTruthy()
        expect(Array.isArray(entry.errors), `${sample.dialect} ${slot} errors`).toBe(true)
        if (entry.valid) expect(entry.errors).toHaveLength(0)
      }
      expect(sample.scan?.suiteCount, `${sample.dialect} suite count`).toBeGreaterThanOrEqual(0)
      for (const surface of SURFACES) expect(sample.scan?.surfaces[surface], `${sample.dialect} ${surface}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps every referenced schema file present', async () => {
    for (const sample of report.samples) {
      for (const slot of ['plugin', 'marketplace'] as const) {
        const schema = sample.manifest?.[slot]?.schema
        if (schema === null || schema === undefined) continue
        const text = await readFile(join(ROOT, schema), 'utf8').catch(() => undefined)
        expect(text, `${sample.dialect} references missing ${schema}`).toBeDefined()
      }
    }
  })

  it('links the report and audit from both READMEs and cites every sample in the evidence docs', async () => {
    for (const file of ['README.md', 'README.zh.md']) {
      const text = await readFile(join(ROOT, file), 'utf8')
      expect(text, `${file} must link the compatibility report`).toContain('docs/compat-report.md')
      expect(text, `${file} must link the layout audit`).toContain('docs/layout-coverage')
    }
    // Per-sample evidence lives with the report and the audit, not in the READMEs.
    for (const file of ['docs/compat-report.md', 'docs/layout-coverage.md', 'docs/layout-coverage.zh.md']) {
      const text = await readFile(join(ROOT, file), 'utf8')
      for (const sample of report.samples) {
        if (sample.verdict === 'error') continue
        expect(text, `${file} must cite ${sample.repo}`).toContain(sample.repo)
      }
    }
  })
})
