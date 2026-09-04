import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLspServers, saveLspServers } from '../src/runtime/lsp-direct-config.js'
import { buildLspStatus, DIRECT_LSP_SUITE_ID } from '../src/runtime/lsp-status.js'
import type { LspMountDiagnostic } from '../src/runtime/lsp-mounts.js'
import type { Suite } from '../src/model/types.js'

const tempRoots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lsp-direct-'))
  tempRoots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('lsp-direct-config', () => {
  it('saves and loads a valid lspServers table', async () => {
    const root = await tempRoot()
    const { servers } = await saveLspServers(root, {
      lspServers: { lua: { command: 'lua-language-server', extensionToLanguage: { '.lua': 'lua' } } }
    })
    expect(Object.keys(servers)).toEqual(['lua'])
    const loaded = await loadLspServers(root)
    expect(loaded.servers['lua']!.command).toBe('lua-language-server')
    // Persisted file is the Claude Code shape, so users can paste upstream snippets.
    const raw = JSON.parse(await readFile(join(root, 'lsp-servers.json'), 'utf8'))
    expect(raw.lspServers.lua.command).toBe('lua-language-server')
  })

  it('rejects an invalid table without writing the file', async () => {
    const root = await tempRoot()
    await expect(saveLspServers(root, { lspServers: { bad: { command: '' } } })).rejects.toThrow('invalid lspServers')
    await expect(loadLspServers(root)).resolves.toEqual({ servers: {}, errors: [] })
  })

  it('normalizes extensions on save (leading dot, lowercase)', async () => {
    const root = await tempRoot()
    const { servers } = await saveLspServers(root, {
      lspServers: { clangd: { command: 'clangd', extensionToLanguage: { C: 'c' } } }
    })
    expect(servers['clangd']!.extensionToLanguage).toEqual({ '.c': 'c' })
  })

  it('tolerates a missing or broken file', async () => {
    const root = await tempRoot()
    await expect(loadLspServers(root)).resolves.toEqual({ servers: {}, errors: [] })
    await writeFile(join(root, 'lsp-servers.json'), 'not json', 'utf8')
    await expect(loadLspServers(root)).resolves.toEqual({ servers: {}, errors: [] })
  })
})

function lspSuite(id: string): Suite {
  return {
    sourceId: 'src',
    id,
    root: `/tmp/${id}`,
    manifest: { layout: 'claude-code', path: '', id, name: id },
    skills: [],
    lsp: { servers: { typescript: { key: 'typescript', command: 'typescript-language-server', args: [], extensionToLanguage: { '.ts': 'typescript' } } } },
    surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 1 },
    dimension: 'user',
    enabled: true,
    installedAt: '2026-08-30T00:00:00.000Z',
    errors: []
  }
}

describe('buildLspStatus with direct servers', () => {
  const directSource = { servers: { lua: { key: 'lua', command: 'lua-language-server', args: [], extensionToLanguage: { '.lua': 'lua' } } }, errors: [] }

  it('emits kind plugin rows for suites and direct rows for user configuration', () => {
    const payload = buildLspStatus([lspSuite('ts')], { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => true }, directSource)
    const plugin = payload.entries.find(entry => entry.id === 'src/ts/typescript')!
    const direct = payload.entries.find(entry => entry.id === `${DIRECT_LSP_SUITE_ID}/lua`)!
    expect(plugin.kind).toBe('plugin')
    expect(plugin.sourceId).toBe('src')
    expect(direct.kind).toBe('direct')
    expect(direct.suiteId).toBe(DIRECT_LSP_SUITE_ID)
    expect(direct.sourceId).toBe('')
    expect(direct.suiteName).toBe('lua')
    expect(direct.state).toBe('mounted')
  })

  it('propagates the direct diagnostic to every direct row', () => {
    const diagnostics = new Map<string, LspMountDiagnostic>([
      [DIRECT_LSP_SUITE_ID, { suiteId: DIRECT_LSP_SUITE_ID, serverKey: 'lua', reason: 'mount failed: exec not found', code: 'mount-failed' }]
    ])
    const payload = buildLspStatus([lspSuite('ts')], { diagnosticsSnapshot: () => diagnostics, hasLiveMounts: () => true }, directSource)
    const direct = payload.entries.find(entry => entry.kind === 'direct')!
    expect(direct.state).toBe('failed')
    expect(direct.reason).toContain('exec not found')
    expect(direct.retryable).toBe(true)
  })

  it('omits direct rows when the table is empty', () => {
    const payload = buildLspStatus([lspSuite('ts')], { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => true }, { servers: {}, errors: [] })
    expect(payload.entries.every(entry => entry.kind === 'plugin')).toBe(true)
  })
})
