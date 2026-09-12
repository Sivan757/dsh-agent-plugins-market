import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadState, saveState } from '../src/runtime/state-store.js'

describe('state: persisted suite state', () => {
  it('round-trips sources and install entries through the state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-state-'))
    const path = join(dir, 'state.json')
    await saveState(path, {
      version: 1,
      sources: [{ id: 'demo', url: 'https://example.com/demo.git', branch: 'main' }],
      installed: { 'demo/mysql': { enabled: true, lockCommit: 'abc123', installedAt: '2026-01-01T00:00:00.000Z' } }
    })
    const loaded = await loadState(path)
    expect(loaded.sources).toHaveLength(1)
    expect(loaded.installed['demo/mysql']?.enabled).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('drops malformed source rows during normalization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-state3-'))
    const path = join(dir, 'state.json')
    await saveState(path, {
      version: 1,
      sources: [{ id: '', url: 'x' }, { id: 'ok', url: 'https://example.com/ok.git' }, 'junk'],
      installed: {}
    } as never)
    const loaded = await loadState(path)
    expect(loaded.sources).toEqual([{ id: 'ok', url: 'https://example.com/ok.git' }])
  })
})

describe('state: local source round-trip', () => {
  it('preserves the local flag through save and load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-state4-'))
    const path = join(dir, 'state.json')
    await saveState(path, {
      version: 1,
      sources: [{ id: 'local-repo', url: '/tmp/whatever', local: true }],
      installed: {}
    })
    const loaded = await loadState(path)
    expect(loaded.sources).toEqual([{ id: 'local-repo', url: '/tmp/whatever', local: true }])
  })
})

describe('state: atomic publication', () => {
  it('creates the missing parent directory and rewrites an existing file in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-state5-'))
    // Two levels missing: the atomic write owns parent creation.
    const path = join(dir, 'nested', 'root', 'state.json')
    await saveState(path, { version: 1, sources: [{ id: 'first', url: 'https://example.com/first.git' }], installed: {} })
    await saveState(path, { version: 1, sources: [{ id: 'second', url: 'https://example.com/second.git' }], installed: {} })
    const loaded = await loadState(path)
    expect(loaded.sources.map(source => source.id)).toEqual(['second'])
  })

  it('leaves no temporary sibling behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-state6-'))
    const path = join(dir, 'state.json')
    await saveState(path, { version: 1, sources: [], installed: {} })
    expect(await readdir(dir)).toEqual(['state.json'])
  })

  it.runIf(process.platform !== 'win32')('stamps the private mode on the replacement inode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-state7-'))
    const path = join(dir, 'state.json')
    await saveState(path, { version: 1, sources: [], installed: {} })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})
