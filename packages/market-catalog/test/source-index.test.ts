import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceIndexStore } from '../src/application/source-index.js'
import { sourceBindingsSchema, sourceIndexSchema } from '../src/application/source-index-schema.js'
import * as discovery from '../src/scanning/source-catalog.js'
import * as probes from '../src/scanning/fs-probes.js'
import * as resolvers from '../src/scanning/scan-resolvers.js'
import { gitHead } from '../src/scanning/git.js'
import { removeTempRoot } from '../../market-bundle/test/integration/helpers/temp-root.js'

vi.mock('../src/scanning/git.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/scanning/git.js')>()),
  gitHead: vi.fn(async () => 'revision-one')
}))

const fixture = fileURLToPath(new URL('../../market-bundle/test/integration/fixtures/v1-suite', import.meta.url))
const roots: string[] = []
const stores: SourceIndexStore[] = []

beforeEach(() => {
  vi.mocked(gitHead).mockResolvedValue('revision-one')
})
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.dispose()))
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(removeTempRoot))
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'market-source-index-'))
  roots.push(root)
  const checkout = join(root, '.sources', 'demo')
  await cp(fixture, checkout, { recursive: true })
  const entry: discovery.SourceCheckout = { sourceId: 'demo', checkout, sourceUrl: 'https://example.test/demo.git', source: { id: 'demo', url: 'https://example.test/demo.git' } }
  const create = (now: () => number = Date.now) => {
    const store = new SourceIndexStore(join(root, 'data'), now)
    stores.push(store)
    return store
  }
  return { root, entry, create }
}

async function addSkill(checkout: string): Promise<void> {
  const dir = join(checkout, 'skills', 'late-skill')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: late-skill\ndescription: Added after indexing\n---\n')
}

const skillNames = (result: Awaited<ReturnType<SourceIndexStore['read']>>) => result.suites.flatMap(suite => suite.skills.map(skill => skill.name))

describe('persistent source discovery', () => {
  it('reuses a managed source after the freshness window and after reopening the catalog', async () => {
    const { root, entry, create } = await setup()
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    let now = 0
    const first = create(() => now)
    const result = await first.read(entry, 'user', root, 30_000)
    expect(result.suites).toHaveLength(1)
    now = 3_600_000
    expect(await first.read(entry, 'user', root, 30_000)).toBe(result)
    await first.dispose()
    expect(await create().read(entry, 'user', root, 30_000)).toEqual(result)
    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when a managed checkout has a different HEAD at reopen', async () => {
    const { root, entry, create } = await setup()
    const first = create()
    await first.read(entry, 'user', root, 30_000)
    await first.dispose()
    await addSkill(entry.checkout)
    vi.mocked(gitHead).mockResolvedValue('revision-two')
    expect(skillNames(await create().read(entry, 'user', root, 30_000))).toContain('late-skill')
  })

  it('keeps unrelated sources reusable across a targeted refresh', async () => {
    const { root, entry, create } = await setup()
    const other: discovery.SourceCheckout = {
      ...entry,
      sourceId: 'other',
      checkout: join(root, '.sources', 'other'),
      source: { id: 'other', url: 'https://example.test/other.git' }
    }
    await cp(fixture, other.checkout, { recursive: true })
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    const store = create()
    await store.read(entry, 'user', root, 30_000)
    const retained = await store.read(other, 'user', root, 30_000)
    await store.invalidate(['demo'], 'user', root)
    await addSkill(entry.checkout)
    expect(skillNames(await store.read(entry, 'user', root, 30_000))).toContain('late-skill')
    expect(await store.read(other, 'user', root, 30_000)).toBe(retained)
    expect(scan).toHaveBeenCalledTimes(3)
  })

  it('cannot publish an older scan over a later invalidation and rebuild', async () => {
    const { root, entry, create } = await setup()
    let release!: () => void
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    let signalStarted!: () => void
    const started = new Promise<void>(resolve => {
      signalStarted = resolve
    })
    const original = discovery.scanSourceCheckout
    let hold = true
    vi.spyOn(discovery, 'scanSourceCheckout').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (hold) {
        hold = false
        signalStarted()
        await barrier
      }
      return result
    })
    const store = create()
    const older = store.read(entry, 'user', root, 30_000)
    try {
      await started
      await store.invalidate(['demo'], 'user', root)
      await addSkill(entry.checkout)
      expect(skillNames(await store.read(entry, 'user', root, 30_000))).toContain('late-skill')
      release()
      await older
      await store.dispose()
      expect(skillNames(await create().read(entry, 'user', root, 30_000))).toContain('late-skill')
    } finally {
      release()
      await older
    }
  })

  it.each(['truncated JSON', 'format version', 'invalid declaration', 'escaped resource path'] as const)('rebuilds instead of trusting %s', async corruption => {
    const { root, entry, create } = await setup()
    const first = create()
    await first.read(entry, 'user', root, 30_000)
    await first.dispose()
    const dir = join(root, 'data', 'catalog-index')
    const [name] = await readdir(dir)
    if (name === undefined) throw new Error('source index was not persisted')
    const path = join(dir, name)
    const document = sourceIndexSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    const suite = document.suites[0]
    if (suite === undefined) throw new Error('source index contains no suite')
    const broken =
      corruption === 'format version'
        ? { ...document, version: 0 }
        : corruption === 'invalid declaration'
          ? { ...document, suites: [{ ...suite, mcp: { schema: '', servers: { broken: { type: 'stdio', command: 123 } } } }] }
          : corruption === 'escaped resource path'
            ? { ...document, suites: [{ ...suite, skills: suite.skills.map(skill => ({ ...skill, file: join(root, 'outside.md') })) }] }
            : document
    await writeFile(path, corruption === 'truncated JSON' ? '{' : JSON.stringify(broken))
    await addSkill(entry.checkout)
    expect(skillNames(await create().read(entry, 'user', root, 30_000))).toContain('late-skill')
  })

  it('retains native MCP OAuth metadata across durable-index reloads', async () => {
    const { root, entry, create } = await setup()
    await rm(entry.checkout, { recursive: true })
    await mkdir(join(entry.checkout, '.claude-plugin'), { recursive: true })
    await writeFile(join(entry.checkout, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'oauth-suite' }))
    const server = { type: 'http', url: 'https://example.test/mcp', oauth: { clientId: 'fixture-client', scope: 'fixture-scope' } }
    await writeFile(join(entry.checkout, '.mcp.json'), JSON.stringify({ mcpServers: { remote: server } }))
    const first = create()
    const original = await first.read(entry, 'user', root, 30_000)
    expect(original.suites[0]?.mcp?.servers.remote).toMatchObject({ oauth: server.oauth })
    await first.dispose()
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    const reopened = await create().read(entry, 'user', root, 30_000)
    expect(reopened.suites[0]?.mcp).toEqual(original.suites[0]?.mcp)
    expect(scan).not.toHaveBeenCalled()
  })

  it.each(['git', 'archive'] as const)('refuses a deleted %s checkout and rebuilds if it is restored', async kind => {
    const { root, entry, create } = await setup()
    entry.source = { id: 'demo', url: 'https://example.test/demo', kind }
    vi.mocked(gitHead).mockRejectedValue(new Error('no Git metadata'))
    const first = create()
    await first.read(entry, 'user', root, 30_000)
    await first.dispose()
    await rm(entry.checkout, { recursive: true })
    const reopened = create()
    const missing = await reopened.read(entry, 'user', root, 30_000)
    expect(missing.suites).toEqual([])
    expect(missing.notes).toEqual([expect.stringContaining('unavailable')])
    await cp(fixture, entry.checkout, { recursive: true })
    await addSkill(entry.checkout)
    expect(skillNames(await reopened.read(entry, 'user', root, 30_000))).toContain('late-skill')
  })

  it('holds readers outside an unfinished source change until its rebuilt index is published', async () => {
    const { root, entry, create } = await setup()
    const store = create()
    await store.read(entry, 'user', root, 30_000)
    let release!: () => void
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })
    let signalStarted!: () => void
    const started = new Promise<void>(resolve => {
      signalStarted = resolve
    })
    const mutation = store.change(['demo'], 'user', root, async () => {
      await addSkill(entry.checkout)
      signalStarted()
      await blocked
      await store.refresh(entry, 'user', root, 30_000)
    })
    await started
    const probe = vi.spyOn(probes, 'isDirectory')
    const waiting = store.read(entry, 'user', root, 30_000)
    try {
      expect(probe).not.toHaveBeenCalled()
      release()
      expect(skillNames(await waiting)).toContain('late-skill')
      await mutation
    } finally {
      release()
      await Promise.allSettled([waiting, mutation])
    }
  })

  it.each(['local', 'adopted'] as const)('reopens %s installed roots without discovering unrelated suites or trusting old declarations', async mode => {
    const { root, entry, create } = await setup()
    entry.source = { id: 'demo', url: entry.checkout, ...(mode === 'local' ? { local: true } : { adopted: true }) }
    await rm(entry.checkout, { recursive: true })
    for (const id of ['installed', 'unused']) {
      const suite = join(entry.checkout, 'plugins', id)
      await mkdir(join(suite, '.claude-plugin'), { recursive: true })
      await mkdir(join(suite, 'skills', id), { recursive: true })
      await writeFile(join(suite, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: id }))
      await writeFile(join(suite, 'skills', id, 'SKILL.md'), `---\nname: ${id}\ndescription: Original description\n---\n`)
    }
    const first = create()
    await first.read(entry, 'user', root, 30_000, false, ['installed'])
    await first.dispose()
    const installed = join(entry.checkout, 'plugins', 'installed')
    await writeFile(join(installed, 'skills', 'installed', 'SKILL.md'), '---\nname: installed\ndescription: Edited before reopen\n---\n')
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    const read = vi.spyOn(resolvers, 'readSuite')
    const result = await create().read(entry, 'user', root, 30_000, false, ['installed'])
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0]?.skills[0]?.description).toBe('Edited before reopen')
    expect(scan).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]?.[0]).toBe(installed)
  })

  it('replays marketplace inline declarations when reopening a mutable installed root', async () => {
    const { root, entry, create } = await setup()
    entry.source = { id: 'demo', url: 'https://example.test/demo.git', adopted: true }
    await rm(entry.checkout, { recursive: true })
    const suite = join(entry.checkout, 'packages', 'installed')
    await mkdir(join(suite, '.claude-plugin'), { recursive: true })
    await writeFile(join(suite, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'installed' }))
    await mkdir(join(entry.checkout, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(entry.checkout, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'routing',
        owner: { name: 'Fixture' },
        plugins: [{ name: 'installed', source: './packages/installed', lspServers: { ts: { command: 'fixture-lsp', extensionToLanguage: { '.ts': 'typescript' } } } }]
      })
    )
    const first = create()
    const before = await first.read(entry, 'user', root, 30_000, false, ['installed'])
    expect(before.suites[0]?.lsp?.servers.ts).toMatchObject({ command: 'fixture-lsp' })
    await first.dispose()
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    const after = await create().read(entry, 'user', root, 30_000, false, ['installed'])
    expect(after.suites[0]?.lsp).toEqual(before.suites[0]?.lsp)
    expect(scan).not.toHaveBeenCalled()
  })

  it.each(['reroute', 'remove'] as const)('re-resolves a mutable marketplace when its installed entry changes: %s', async change => {
    const { root, entry, create } = await setup()
    entry.source = { id: 'demo', url: 'https://example.test/demo.git', adopted: true }
    await rm(entry.checkout, { recursive: true })
    for (const name of ['first', 'second', 'other']) {
      const suite = join(entry.checkout, 'packages', name)
      await mkdir(join(suite, '.claude-plugin'), { recursive: true })
      await mkdir(join(suite, 'skills', name), { recursive: true })
      await writeFile(join(suite, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: name === 'other' ? 'other' : 'installed' }))
      await writeFile(join(suite, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`)
    }
    const marketplace = join(entry.checkout, '.claude-plugin', 'marketplace.json')
    await mkdir(join(entry.checkout, '.claude-plugin'), { recursive: true })
    const route = async (target?: string) =>
      writeFile(
        marketplace,
        JSON.stringify({
          name: 'routing',
          owner: { name: 'Fixture' },
          plugins: [...(target === undefined ? [] : [{ name: 'installed', source: './packages/' + target }]), { name: 'other', source: './packages/other' }]
        })
      )
    await route('first')
    let now = 0
    const store = create(() => now)
    expect(skillNames(await store.read(entry, 'user', root, 30_000, false, ['installed']))).toEqual(['first'])
    await route(change === 'reroute' ? 'second' : undefined)
    now = 30_000
    const refreshed = await store.read(entry, 'user', root, 30_000, false, ['installed'])
    expect(skillNames(refreshed)).toEqual(change === 'reroute' ? ['second'] : [])
  })

  it.each(['local', 'adopted', 'project'] as const)('checks %s working-tree edits on demand without persisting them as managed content', async mode => {
    const { root, entry, create } = await setup()
    if (mode !== 'project') entry.source = { id: 'demo', url: entry.checkout, ...(mode === 'local' ? { local: true } : { adopted: true }) }
    const dimension = mode === 'project' ? 'project' : 'user'
    let now = 0
    const store = create(() => now)
    const first = await store.read(entry, dimension, root, 30_000)
    await addSkill(entry.checkout)
    expect(await store.read(entry, dimension, root, 30_000)).toBe(first)
    now = 30_000
    expect(skillNames(await store.read(entry, dimension, root, 30_000))).toContain('late-skill')
    const directory = join(root, 'data', 'catalog-index')
    if (mode === 'project') {
      await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      const [file] = await readdir(directory)
      if (file === undefined) throw new Error('mutable source routing hints were not persisted')
      const hints = sourceBindingsSchema.parse(JSON.parse(await readFile(join(directory, file), 'utf8')))
      expect(hints.roots).toHaveLength(1)
      expect(hints).not.toHaveProperty('suites')
    }
  })
})
