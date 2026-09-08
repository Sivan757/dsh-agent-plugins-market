import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDataRoot, resolveUserRoot } from '../src/catalog/paths.js'
import { migratePluginStorage } from '../src/runtime/storage-migration.js'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'market-storage-'))
  vi.stubEnv('DSH_HOME', join(root, 'home'))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
async function file(path: string, text: string) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

describe('canonical plugin storage', () => {
  it('uses DSH_HOME instead of legacy root overrides for every new write', () => {
    expect(resolveUserRoot('/external/user')).toBe(join(root, 'home', 'agent-plugins'))
    expect(resolveDataRoot('/external/data', '/external/user')).toBe(join(root, 'home', 'agent-plugins', 'data'))
  })

  it('migrates source checkouts, install state, data, and user panels before reads', async () => {
    const legacy = join(root, 'old-user')
    await file(join(legacy, '.sources', 'demo', 'README.md'), 'suite')
    await file(join(legacy, 'state.json'), JSON.stringify({ version: 1, sources: [{ id: 'demo', local: true, url: join(legacy, '.sources', 'demo') }], installed: {} }))
    await file(join(legacy, 'data', 'user', 'agents', 'reviewer.md'), 'role')
    await file(join(legacy, 'data', 'data', 'demo', 'db'), 'data')
    await file(join(legacy, 'notes.txt'), 'not plugin owned')
    expect(await migratePluginStorage({ userRoot: legacy })).toEqual({ conflicts: [] })
    expect(await readFile(join(resolveUserRoot(), '.sources', 'demo', 'README.md'), 'utf8')).toBe('suite')
    expect(await readFile(join(resolveUserRoot(), 'user', 'agents', 'reviewer.md'), 'utf8')).toBe('role')
    expect(await readFile(join(resolveDataRoot(), 'data', 'demo', 'db'), 'utf8')).toBe('data')
    expect(existsSync(join(legacy, 'state.json'))).toBe(false)
    expect(JSON.parse(await readFile(join(resolveUserRoot(), 'state.json'), 'utf8')).sources[0].url).toBe(join(resolveUserRoot(), '.sources', 'demo'))
    expect(existsSync(join(legacy, 'notes.txt'))).toBe(true)
    expect(await migratePluginStorage({ userRoot: legacy })).toEqual({ conflicts: [] })
  })

  it('keeps install state and checkouts together when install state conflicts', async () => {
    const legacy = join(root, 'old-user')
    await file(join(legacy, '.sources', 'old', 'README.md'), 'old suite')
    await file(join(legacy, 'state.json'), '{"version":1,"sources":[{"id":"old"}]}')
    await file(join(resolveUserRoot(), 'state.json'), '{"version":1,"sources":[{"id":"new"}]}')
    expect((await migratePluginStorage({ userRoot: legacy })).conflicts).toContain(join(legacy, 'state.json'))
    expect(await readFile(join(legacy, '.sources', 'old', 'README.md'), 'utf8')).toBe('old suite')
    expect(existsSync(join(resolveUserRoot(), '.sources', 'old'))).toBe(false)
  })

  it('never merges two Git checkouts with the same source id', async () => {
    const legacy = join(root, 'old-user')
    await file(join(legacy, '.sources', 'same', '.git', 'HEAD'), 'old head')
    await file(join(resolveUserRoot(), '.sources', 'same', '.git', 'HEAD'), 'new head')
    expect((await migratePluginStorage({ userRoot: legacy })).conflicts).toContain(join(legacy, '.sources', 'same'))
    expect(await readFile(join(legacy, '.sources', 'same', '.git', 'HEAD'), 'utf8')).toBe('old head')
    expect(await readFile(join(resolveUserRoot(), '.sources', 'same', '.git', 'HEAD'), 'utf8')).toBe('new head')
  })

  it('migrates explicit data overrides including LSP and feedback', async () => {
    const legacy = join(root, 'old-data')
    await file(join(legacy, 'lsp-servers.json'), '{}')
    await file(join(legacy, 'feedback', 'reports.jsonl'), 'report')
    await file(join(legacy, 'user', 'skills', 'example.md'), 'skill')
    await migratePluginStorage({ dataRoot: legacy })
    expect(await readFile(join(resolveDataRoot(), 'lsp-servers.json'), 'utf8')).toBe('{}')
    expect(await readFile(join(resolveDataRoot(), 'feedback', 'reports.jsonl'), 'utf8')).toBe('report')
    expect(await readFile(join(resolveUserRoot(), 'user', 'skills', 'example.md'), 'utf8')).toBe('skill')
  })

  it('preserves both versions of conflicting nested files, including repeated starts', async () => {
    const legacyFile = join(resolveDataRoot(), 'user', 'agents', 'reviewer.md')
    const target = join(resolveUserRoot(), 'user', 'agents', 'reviewer.md')
    await file(legacyFile, 'old unique role')
    await file(target, 'current unique role')
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await migratePluginStorage()).conflicts).toEqual([legacyFile])
      expect(await readFile(legacyFile, 'utf8')).toBe('old unique role')
      expect(await readFile(target, 'utf8')).toBe('current unique role')
    }
  })

  it('does not traverse symbolic links to unrelated directories', async () => {
    const external = join(root, 'external')
    await file(join(external, 'untouched.md'), 'private')
    const legacy = join(resolveDataRoot(), 'user')
    await mkdir(legacy, { recursive: true })
    await symlink(external, join(legacy, 'skills'))
    expect((await migratePluginStorage()).conflicts).toEqual([join(legacy, 'skills')])
    expect(await readFile(join(external, 'untouched.md'), 'utf8')).toBe('private')
  })

  it('rejects overlapping root overrides without touching files', async () => {
    await expect(migratePluginStorage({ userRoot: root })).rejects.toThrow('overlaps')
  })

  it('retains checkouts beside malformed legacy install state', async () => {
    const legacy = join(root, 'old-user')
    await file(join(legacy, '.sources', 'demo', 'README.md'), 'suite')
    await file(join(legacy, 'state.json'), '{invalid')
    await expect(migratePluginStorage({ userRoot: legacy })).rejects.toThrow()
    expect(await readFile(join(legacy, '.sources', 'demo', 'README.md'), 'utf8')).toBe('suite')
    expect(await readFile(join(legacy, 'state.json'), 'utf8')).toBe('{invalid')
    expect(existsSync(join(resolveUserRoot(), '.sources', 'demo'))).toBe(false)
  })

  it.each(['userRoot', 'dataRoot'] as const)('refuses a symbolic-link %s before moving external files', async key => {
    const external = join(root, 'external')
    await file(join(external, 'user', 'skills', 'example.md'), 'private')
    const legacy = join(root, 'legacy-link')
    await symlink(external, legacy)
    await expect(migratePluginStorage({ [key]: legacy })).rejects.toThrow('symbolic-link root')
    expect(await readFile(join(external, 'user', 'skills', 'example.md'), 'utf8')).toBe('private')
  })
})
