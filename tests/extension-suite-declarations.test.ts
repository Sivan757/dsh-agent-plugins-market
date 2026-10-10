import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { readExtensionSuiteDeclarations } from '../packages/market-runtime/src/application/extension-suite-declarations.js'
import { parseCommandResource, readCommands } from '../packages/market-runtime/src/application/command-resources.js'
import { readCommands as runtimeReadCommands } from '../packages/market-runtime/src/runtime/surfaces/commands-mounts.js'
import { scanSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'
import * as discovery from '../packages/market-catalog/src/scanning/source-catalog.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'extension-declarations-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}
async function put(root: string, path: string, content: string) {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
}

describe('validated installed suite declarations', () => {
  it('reads installed disabled suites from the cached catalog without widening global discovery', async () => {
    const root = await tempRoot()
    for (const source of ['installed', 'uninstalled']) {
      await cp(join(import.meta.dirname, 'fixtures/v1-suite'), join(root, '.sources', source), { recursive: true })
    }
    await put(
      root,
      '.sources/remote/.claude-plugin/marketplace.json',
      JSON.stringify({ name: 'remote', owner: { name: 'owner' }, plugins: [{ name: 'remote-suite', source: { source: 'url', url: 'https://example.test/remote-suite.git' } }] })
    )
    await put(
      root,
      'state.json',
      JSON.stringify({
        version: 1,
        sources: ['installed', 'uninstalled', 'remote'].map(id => ({ id, url: join(root, '.sources', id), local: true })),
        installed: {
          'installed/v1-suite': { enabled: false, installedAt: new Date(0).toISOString(), surfaces: { skills: false } },
          'remote/remote-suite': { enabled: false, installedAt: new Date(0).toISOString() }
        }
      })
    )
    const stateBefore = await readFile(join(root, 'state.json'))
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
    cleanups.push(() => catalog.dispose())
    await catalog.load()
    const scan = vi.spyOn(discovery, 'discoverSourceListWithNotes')
    const snapshot = await catalog.readUserCatalog()
    expect(snapshot.suites.some(suite => suite.remote !== undefined)).toBe(true)
    const before = structuredClone(snapshot)
    const first = await catalog.installedSuiteDeclarations()
    const second = await catalog.installedSuiteDeclarations()
    expect(first.map(row => row.suite.sourceId)).toEqual(['installed'])
    expect(second).toEqual(first)
    expect(first[0]?.suite).toMatchObject({ enabled: false, activeSurfaces: { skills: false } })
    expect(first[0]?.validSurfaces.skills).toBe(true)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(await catalog.enabledUserSuites()).toEqual([])
    expect(scan).toHaveBeenCalledTimes(1)
    expect(await catalog.readUserCatalog()).toEqual(before)
    expect(await readFile(join(root, 'state.json'))).toEqual(stateBefore)
  })

  it('retains valid disabled markdown identities and rejects invalid siblings per parser', async () => {
    const root = await tempRoot()
    await put(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'demo' }))
    await put(root, 'skills/good/SKILL.md', '---\nname: good\ndescription: Good skill\n---\nBody')
    await put(root, 'commands/nested/run.md', '---\ndescription: Valid disabled command\ndisabled: true\n---\nRun')
    await put(root, 'commands/nested-run.md', 'Plain command body')
    await put(root, 'commands/broken.md', '---\ndescription: [\n---\nBroken')
    await put(root, 'agents/valid.md', '---\nname: valid\ndisabled: true\nmodel: inherit\n---\nRole body')
    await put(root, 'agents/broken.md', '---\nmodel: [invalid]\n---\nRole body')
    await put(root, '.mcp.json', '{ invalid json')
    const [scanned] = (await scanSource(root, 'source', 'user')).suites
    if (!scanned) throw new Error('expected local suite')
    const suite = withDefaultSurfaces(scanned)
    expect(suite.errors.length).toBeGreaterThan(0)
    const before = structuredClone(suite)
    const [candidate] = await readExtensionSuiteDeclarations([suite])
    expect(candidate?.validSurfaces).toEqual({ skills: true, commands: true, agents: true, hooks: false, mcp: false, lsp: false })
    expect(candidate?.suite.resources?.commands.map(row => row.name).sort()).toEqual(['nested-run', 'nested/run'])
    expect(candidate?.suite.resources?.agents.map(row => row.name)).toEqual(['valid'])
    expect(candidate?.suite.resources?.commands.find(row => row.name === 'nested/run')?.content).toContain('disabled: true')
    expect(candidate?.suite.errors).toEqual(suite.errors)
    expect(suite).toEqual(before)
    expect(await runtimeReadCommands(root)).toEqual(await readCommands(root))
    expect((await readCommands(root)).map(row => row.resourceName)).toEqual(['nested-run'])
    expect((await readCommands(root, suite.resources?.commands, { includeDisabled: true })).map(row => row.resourceName).sort()).toEqual(['nested-run', 'nested/run'])
  })

  it('uses only materialized declarations and preserves parsed policies while project LSP stays invalid', async () => {
    const root = await tempRoot()
    await cp(join(import.meta.dirname, 'fixtures/v1-suite'), root, { recursive: true })
    const [scanned] = (await scanSource(root, 'source', 'project')).suites
    if (!scanned) throw new Error('expected local suite')
    const suite = withDefaultSurfaces(scanned)
    suite.mcp!.servers.remote = {
      type: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'fixture-only' },
      auth: { enabled: false },
      disabledTools: ['blocked']
    }
    delete suite.resources
    const before = structuredClone(suite)
    const [candidate] = await readExtensionSuiteDeclarations([suite])
    expect(candidate?.suite.resources).toEqual({ commands: [], agents: [] })
    expect(candidate?.validSurfaces).toMatchObject({ commands: false, agents: false, lsp: false, mcp: true, hooks: true })
    expect(candidate?.suite.mcp).toEqual(suite.mcp)
    expect(candidate?.suite.lsp).toEqual(suite.lsp)
    expect(candidate?.suite.hooks).toEqual(suite.hooks)
    expect(suite).toEqual(before)
  })

  it('keeps the shared command parser default and original identity for colliding call names', () => {
    const resource = { name: 'nested/run', file: '/fixture/command.md' }
    const text = '---\ndescription: Valid\ndisabled: true\n---\nRun'
    expect(parseCommandResource(resource, text)).toBeUndefined()
    expect(parseCommandResource(resource, text, { includeDisabled: true })).toMatchObject({ name: 'nested-run', resourceName: 'nested/run', body: 'Run' })
    expect(parseCommandResource(resource, '---\ndescription: [\n---\nBad', { includeDisabled: true })).toBeUndefined()
  })
})
