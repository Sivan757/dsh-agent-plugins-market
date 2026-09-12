import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { loadState, saveState, EMPTY_STATE, type SuiteState } from '../src/runtime/state-store.js'

/**
 * Regression tests for state.json backward/forward compatibility.
 *
 * The persisted state file is the only durable contract between releases.
 * These tests lock in the promise from ADR-0001: "Persisted state.json stays
 * readable throughout the migration." A future version-2 state must not crash
 * the loader; a v1 state written by any past release must round-trip.
 */

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp()
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('loadState — v1 forward compatibility (future versions do not crash)', () => {
  it('returns EMPTY_STATE for a hypothetical v2 state instead of crashing', async () => {
    const future = { version: 2, sources: [{ id: 'x', url: 'y' }], installed: {}, extra: 'unknown' }
    await writeFile(statePath(), JSON.stringify(future))
    expect(await loadState(statePath())).toEqual(EMPTY_STATE)
  })

  it('returns EMPTY_STATE for an unversioned / missing version field', async () => {
    await writeFile(statePath(), JSON.stringify({ sources: [], installed: {} }))
    expect(await loadState(statePath())).toEqual(EMPTY_STATE)
  })

  it('returns EMPTY_STATE for malformed JSON', async () => {
    await writeFile(statePath(), '{ not valid json')
    expect(await loadState(statePath())).toEqual(EMPTY_STATE)
  })

  it('returns EMPTY_STATE when the state file does not exist', async () => {
    expect(await loadState(join(tmpRoot, 'nonexistent.json'))).toEqual(EMPTY_STATE)
  })

  it('returns EMPTY_STATE for a non-object root (array)', async () => {
    await writeFile(statePath(), '[]')
    expect(await loadState(statePath())).toEqual(EMPTY_STATE)
  })
})

describe('loadState — v1 backward compatibility (past releases round-trip)', () => {
  it('reads a full v1 state with all optional fields present', async () => {
    const full: SuiteState = {
      version: 1,
      sources: [
        { id: 'alpha', url: 'https://github.com/a/b.git', branch: 'main' },
        { id: 'local-src', url: '/path/to/dir', local: true }
      ],
      installed: {
        'alpha/suite-one': { enabled: true, lockCommit: 'abc123', installedAt: '2025-01-01T00:00:00.000Z' },
        'local-src/other': { enabled: false, installedAt: '2025-01-02T00:00:00.000Z' }
      }
    }
    await writeFile(statePath(), JSON.stringify(full))
    expect(await loadState(statePath())).toEqual(full)
  })

  it('reads a minimal v1 state with no sources and no installed entries', async () => {
    const minimal: SuiteState = { version: 1, sources: [], installed: {} }
    await writeFile(statePath(), JSON.stringify(minimal))
    expect(await loadState(statePath())).toEqual(minimal)
  })

  it('tolerates a source missing optional branch/local fields', async () => {
    const partial = { version: 1, sources: [{ id: 's', url: 'https://github.com/x/y.git' }], installed: {} }
    await writeFile(statePath(), JSON.stringify(partial))
    const state = await loadState(statePath())
    expect(state.sources).toHaveLength(1)
    expect(state.sources[0]).toEqual({ id: 's', url: 'https://github.com/x/y.git' })
    expect(state.sources[0].branch).toBeUndefined()
    expect(state.sources[0].local).toBeUndefined()
  })

  it('tolerates an installed entry missing lockCommit (uses default timestamp for missing installedAt)', async () => {
    const partial = {
      version: 1,
      sources: [],
      installed: { 's/suite': { enabled: true } }
    }
    await writeFile(statePath(), JSON.stringify(partial))
    const state = await loadState(statePath())
    expect(state.installed['s/suite']).toEqual({ enabled: true, installedAt: new Date(0).toISOString() })
    expect(state.installed['s/suite'].lockCommit).toBeUndefined()
  })

  it('skips sources with empty id or url (corrupted entry does not break the file)', async () => {
    const corrupted = {
      version: 1,
      sources: [
        { id: '', url: 'bad' },
        { id: 'good', url: 'https://github.com/x/y.git' }
      ],
      installed: {}
    }
    await writeFile(statePath(), JSON.stringify(corrupted))
    const state = await loadState(statePath())
    expect(state.sources).toHaveLength(1)
    expect(state.sources[0].id).toBe('good')
  })

  it('skips non-object installed entries instead of crashing', async () => {
    const corrupted = {
      version: 1,
      sources: [],
      installed: { 'bad/key': 'not-an-object', 'good/key': { enabled: true, installedAt: '2025-01-01T00:00:00.000Z' } }
    }
    await writeFile(statePath(), JSON.stringify(corrupted))
    const state = await loadState(statePath())
    expect(Object.keys(state.installed)).toEqual(['good/key'])
  })
})

describe('saveState + loadState round-trip', () => {
  it('a saved v1 state can be read back identically', async () => {
    const original: SuiteState = {
      version: 1,
      sources: [{ id: 'rt', url: 'https://github.com/r/t.git', branch: 'dev' }],
      installed: { 'rt/rt-suite': { enabled: true, lockCommit: 'deadbeef', installedAt: '2025-06-01T12:00:00.000Z' } }
    }
    await saveState(statePath(), original)
    const reloaded = await loadState(statePath())
    expect(reloaded).toEqual(original)
  })
})

function statePath(): string {
  return join(tmpRoot, 'state.json')
}

async function mkdtemp(): Promise<string> {
  const dir = join(import.meta.dirname, '..', 'tmp-state-' + Math.random().toString(36).slice(2))
  await mkdir(dir, { recursive: true })
  return dir
}
