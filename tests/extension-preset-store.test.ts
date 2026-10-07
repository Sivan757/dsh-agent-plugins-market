import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExtensionPresetStore, extensionPresetLibraryPath } from '../packages/market-runtime/src/application/state/extension-presets.js'
import { captureExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'extension-presets-'))
  roots.push(root)
  return { root, store: new ExtensionPresetStore(root) }
}

describe('workspace extension preset library', () => {
  it('keeps libraries private to a workspace and persists its new-session default', async () => {
    const { root, store: s } = await store()
    expect(await s.read('/project/a')).toEqual({ revision: 0, defaultPresetId: null, presets: [] })
    const created = await s.create('/project/a', 0, { name: 'Frontend', enabledIds: ['skills:react'] })
    const p = created.presets[0]!
    const selected = await s.setDefault('/project/a', created.revision, p.id)
    expect((await new ExtensionPresetStore(root).read('/project/a')).defaultPresetId).toBe(p.id)
    expect((await s.read('/project/b')).presets).toEqual([])
    expect(selected.revision).toBe(2)
    expect((await stat(extensionPresetLibraryPath(root, '/project/a'))).mode & 0o777).toBe(0o600)
  })

  it('auto-saves a revisioned preset without changing captured sessions', async () => {
    const { store: s } = await store()
    const first = await s.create('/project', 0, { name: 'Frontend', enabledIds: ['skills:react'] })
    const captured = captureExtensionSelection(first.presets[0]!, [])
    const second = await s.update('/project', first.revision, first.presets[0]!.id, { name: 'Frontend', enabledIds: [] })
    expect(second.presets[0]!.revision).toBe(2)
    expect(captured.enabledIds).toEqual(['skills:react'])
  })

  it('rejects stale editors rather than silently losing another write', async () => {
    const { root, store: s } = await store()
    const peer = new ExtensionPresetStore(root)
    const outcomes = await Promise.allSettled([s.create('/project', 0, { name: 'A', enabledIds: [] }), peer.create('/project', 0, { name: 'B', enabledIds: [] })])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const failed = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason as unknown).toMatchObject({ code: 'preset-conflict' })
    expect((await s.read('/project')).presets).toHaveLength(1)
  })

  it('requires valid defaults and clears the pointer when deleting the default preset', async () => {
    const { store: s } = await store()
    const first = await s.create('/project', 0, { name: 'A', enabledIds: [] })
    await expect(s.setDefault('/project', first.revision, 'missing')).rejects.toMatchObject({ code: 'preset-not-found' })
    const selected = await s.setDefault('/project', first.revision, first.presets[0]!.id)
    const deleted = await s.delete('/project', selected.revision, selected.defaultPresetId!)
    expect(deleted.defaultPresetId).toBeNull()
    expect(deleted.presets).toEqual([])
  })

  it('rejects corrupt state without overwriting it', async () => {
    const { root, store: s } = await store()
    await s.create('/project', 0, { name: 'A', enabledIds: [] })
    const path = extensionPresetLibraryPath(root, '/project')
    await writeFile(path, '{broken')
    await expect(s.read('/project')).rejects.toThrow()
    await expect(s.create('/project', 0, { name: 'B', enabledIds: [] })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })

  it('rejects duplicate names and relative workspace identities', async () => {
    const { store: s } = await store()
    await s.create('/project', 0, { name: 'A', enabledIds: [] })
    await expect(s.create('/project', 1, { name: ' A ', enabledIds: [] })).rejects.toMatchObject({ code: 'preset-name-conflict' })
    await expect(s.read('relative')).rejects.toThrow('absolute workspace')
  })
})
