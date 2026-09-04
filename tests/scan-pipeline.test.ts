/**
 * Scan pipeline tests: filter-chain semantics, marketplace-entry handler
 * chain (GitHub shorthand, self-references, containment), dialect fallback,
 * and the scan diagnostics surfaced through the catalog overview.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalGitUrl, resolveMarketplaceEntry, scanSource } from '../src/catalog/suite-scanner.js'
import { discoverSuitesInSource } from '../src/catalog/suite-scanner.js'
import { runScanChain, type ScanContext, type ScanFilter } from '../src/catalog/scan-pipeline.js'
import type { MarketplaceEntry } from '../src/catalog/manifests.js'
import { Catalog } from '../src/application/catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

describe('scan pipeline: canonical git URLs', () => {
  it('normalizes host case, trailing slashes, .git suffix, and scp shorthand', () => {
    const canonical = 'https://github.com/owner/repo'
    expect(canonicalGitUrl('https://github.com/owner/repo')).toBe(canonical)
    expect(canonicalGitUrl('https://github.com/owner/repo.git')).toBe(canonical)
    expect(canonicalGitUrl('https://github.com/owner/repo/')).toBe(canonical)
    expect(canonicalGitUrl('https://GitHub.com/owner/repo.git')).toBe(canonical)
    expect(canonicalGitUrl('git@github.com:owner/repo.git')).toBe(canonical)
    expect(canonicalGitUrl('ssh://git@github.com/owner/repo')).toBe(canonical)
    expect(canonicalGitUrl('https://github.com/owner/repo')).not.toBe('https://gitlab.com/owner/repo')
  })
})

describe('scan pipeline: marketplace entry handler chain', () => {
  const checkout = join(fixtures, 'dual-dialect-selfref')

  it('resolves a github repo shorthand entry as a remote reference', async () => {
    const entry: MarketplaceEntry = { name: 'x', source: { source: 'github', repo: 'example/other' } }
    const resolution = await resolveMarketplaceEntry(checkout, entry, undefined)
    expect(resolution).toEqual({ kind: 'remote', url: 'https://github.com/example/other' })
  })

  it('resolves a self-referencing github entry to the local checkout', async () => {
    const entry: MarketplaceEntry = { name: 'self', source: { source: 'github', repo: 'example/dual-selfref' } }
    const resolution = await resolveMarketplaceEntry(checkout, entry, 'https://github.com/example/dual-selfref')
    expect(resolution).toEqual({ kind: 'local', dir: checkout })
  })

  it('self-reference matching ignores case, .git suffix, and trailing slash', async () => {
    const entry: MarketplaceEntry = { name: 'self', source: { source: 'github', repo: 'example/dual-selfref' } }
    const resolution = await resolveMarketplaceEntry(checkout, entry, 'https://GitHub.com/example/dual-selfref.git/')
    expect(resolution).toEqual({ kind: 'local', dir: checkout })
  })

  it('rejects local paths escaping the checkout with a diagnosis', async () => {
    const entry: MarketplaceEntry = { name: 'esc', source: '../outside' }
    const resolution = await resolveMarketplaceEntry(checkout, entry, undefined)
    // `rejected`: the local-path handler positively identified the shape, so
    // its containment verdict is authoritative — later handlers never run.
    expect(resolution.kind).toBe('rejected')
    expect((resolution as { reason: string }).reason).toContain('escapes the checkout')
  })
})

describe('scan pipeline: chain semantics', () => {
  const baseContext: ScanContext = { checkout: '/tmp/nowhere', sourceId: 's', dimension: 'user', notes: [] }

  it('records one attempt per filter and stops at the first productive hit', async () => {
    const hit: ScanFilter = {
      name: 'hit',
      doScan: () => Promise.resolve({ kind: 'resolved', suites: [{ id: 'x' } as never] })
    }
    const never: ScanFilter = {
      name: 'never',
      doScan: (_context, chain) => chain.next(_context)
    }
    const result = await runScanChain([never, hit, never], baseContext)
    expect(result.suites).toHaveLength(1)
    // Attempts unwind innermost-first: the delegating outer filter records
    // an abstention, the filter that produced the answer records a hit.
    expect(result.attempts.map(attempt => `${attempt.filter}:${attempt.outcome}`)).toEqual(['hit:resolved', 'never:abstain'])
  })

  it('treats a recognized-but-empty resolution as an abstention and notes it', async () => {
    const empty: ScanFilter = { name: 'empty', doScan: () => Promise.resolve({ kind: 'resolved', suites: [] }) }
    const terminal: ScanFilter = { name: 'terminal', doScan: () => Promise.resolve({ kind: 'resolved', suites: [{ id: 'y' } as never] }) }
    const result = await runScanChain([empty, terminal], baseContext)
    expect(result.suites).toHaveLength(1)
    expect(result.notes.some(note => note.includes('filter "empty"'))).toBe(true)
  })

  it('terminal chains answer with an empty result instead of throwing', async () => {
    const result = await runScanChain([], baseContext)
    expect(result.suites).toEqual([])
    expect(result.attempts).toEqual([])
  })
})

describe('scan pipeline: fixtures', () => {
  it('dual-dialect-selfref: self-reference entry scans the local repo (25-skill class)', async () => {
    const result = await scanSource(join(fixtures, 'dual-dialect-selfref'), 'dual', 'user', 'https://github.com/example/dual-selfref')
    expect(result.suites).toHaveLength(1)
    const suite = result.suites[0]!
    // The root metadata manifest (no $schema) is read leniently, not strict v1.
    expect(suite.errors).toEqual([])
    expect(suite.skills.map(skill => skill.name).sort()).toEqual(['one', 'two'])
    expect(result.notes).toEqual([])
  })

  it('marketplace-github-remote: github shorthand yields a remote card with the URL', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'marketplace-github-remote'), 'ghr', 'user')
    expect(suites).toHaveLength(1)
    expect(suites[0]!.manifest.layout).toBe('remote')
    expect(suites[0]!.remote).toEqual({ url: 'https://github.com/example/external-gh' })
    expect(suites[0]!.root).toBe('')
  })

  it('marketplace-all-broken: every entry unresolvable falls back to the root manifest with notes', async () => {
    const result = await scanSource(join(fixtures, 'marketplace-all-broken'), 'broken', 'user')
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0]!.id).toBe('broken-root')
    expect(result.suites[0]!.skills.map(skill => skill.name)).toEqual(['root-skill'])
    expect(result.notes.some(note => note.includes('escaper'))).toBe(true)
    expect(result.notes.some(note => note.includes('void-one'))).toBe(true)
    expect(result.notes.some(note => note.includes('no marketplace dialect produced suites'))).toBe(true)
  })

  it('marketplace-empty-entries: an empty plugins array falls through to flat collections', async () => {
    const result = await scanSource(join(fixtures, 'marketplace-empty-entries'), 'empty', 'user')
    expect(result.suites.map(suite => suite.id).sort()).toEqual(['alpha', 'beta'])
    expect(result.suites.every(suite => suite.manifest.layout === 'skill-collection')).toBe(true)
  })

  it('dual-dialect-codex-fallback: an unproductive claude dialect defers to the codex dialect', async () => {
    const result = await scanSource(join(fixtures, 'dual-dialect-codex-fallback'), 'dialects', 'user')
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0]!.id).toBe('x-plugin')
    expect(result.suites[0]!.manifest.layout).toBe('codex')
    expect(result.suites[0]!.skills.map(skill => skill.name)).toEqual(['xskill'])
  })
})

describe('scan pipeline: catalog overview surfaces scan notes', () => {
  it('reports per-source scan diagnostics on the source row', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-scan-notes-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'broken', url: join(fixtures, 'marketplace-all-broken'), local: true }])
    const overview = await manager.overview()
    const row = overview.sources.find(source => source.id === 'broken')!
    expect(row.scanNotes).toBeDefined()
    expect(row.scanNotes!.some(note => note.includes('escaper'))).toBe(true)
    // The suite still resolves via fallback.
    expect(row.suiteIds).toEqual(['broken-root'])
  })

  it('omits scanNotes for clean sources', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-scan-clean-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'v1', url: join(fixtures, 'v1-suite'), local: true }])
    const overview = await manager.overview()
    const row = overview.sources.find(source => source.id === 'v1')!
    expect(row.scanNotes).toBeUndefined()
  })
})
