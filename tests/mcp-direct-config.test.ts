import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { addUserMcpServer, importUserMcpServers, loadUserMcpSuite } from '../src/runtime/mcp-direct-config.js'
import { CommandMountRegistry } from '../src/runtime/commands-mounts.js'
import { toMcpMounts } from '../src/runtime/mcp-config.js'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'market-user-mcp-'))
  roots.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('user MCP persistence', () => {
  it('preserves services and feeds the real mount request builder', async () => {
    const path = await root()
    await addUserMcpServer(path, 'one', { type: 'stdio', command: 'node', args: ['--version'] })
    await addUserMcpServer(path, 'two', { type: 'streamable-http', url: 'https://example.com/mcp' })
    const suite = await loadUserMcpSuite(path)
    expect(Object.keys(suite.mcp.servers)).toEqual(['one', 'two'])
    expect(suite.enabled).toBe(true)
    const requests = await toMcpMounts(suite, path)
    expect(requests.mounts).toHaveLength(2)
  })
  it('rejects duplicate and malformed entries without changing the file', async () => {
    const path = await root()
    await addUserMcpServer(path, 'one', { type: 'stdio', command: 'node' })
    const before = await readFile(join(path, 'mcp.json'), 'utf8')
    await expect(addUserMcpServer(path, 'one', { type: 'stdio', command: 'other' })).rejects.toThrow('already exists')
    await expect(addUserMcpServer(path, 'bad', { type: 'streamable-http' })).rejects.toThrow('invalid MCP')
    expect(await readFile(join(path, 'mcp.json'), 'utf8')).toBe(before)
  })
  it('still rejects a malformed entry through the write path', async () => {
    const path = await root()
    await expect(addUserMcpServer(path, 'broken', { type: 'streamable-http' })).rejects.toThrow('server "broken": remote servers require a url')
    await expect(addUserMcpServer(path, 'nameless', { type: 'stdio', args: [] })).rejects.toThrow('server "nameless": stdio servers require a command')
  })
  it('keeps keys this client does not know in the user’s own file', async () => {
    const path = await root()
    await writeFile(
      join(path, 'mcp.json'),
      JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.1.0/mcp.schema.json',
        mcpServers: { one: { type: 'stdio', command: 'node', alwaysAllow: ['x'], timeout: 30 } }
      })
    )
    const suite = await loadUserMcpSuite(path)
    expect(suite.errors.join(' | ')).toBe('')
    expect(suite.mcp.servers['one']).toMatchObject({ command: 'node', alwaysAllow: ['x'], timeout: 30 })
  })

  it('imports many pasted services in one write and reports each outcome', async () => {
    const path = await root()
    await addUserMcpServer(path, 'one', { type: 'stdio', command: 'node' })
    const result = await importUserMcpServers(
      path,
      [
        { name: 'two', server: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] } },
        { name: 'one', server: { type: 'stdio', command: 'node' } },
        { name: 'bad name', server: { type: 'stdio', command: 'node' } },
        { name: 'broken', server: { type: 'streamable-http' } }
      ],
      false
    )
    expect(result.imported).toEqual(['two'])
    expect(result.skipped.map(entry => entry.name)).toEqual(['one', 'bad name', 'broken'])
    expect(Object.keys((await loadUserMcpSuite(path)).mcp.servers)).toEqual(['one', 'two'])
  })

  it('replaces an existing name only when the import says so', async () => {
    const path = await root()
    await addUserMcpServer(path, 'one', { type: 'stdio', command: 'node' })
    const result = await importUserMcpServers(path, [{ name: 'one', server: { type: 'stdio', command: 'uvx' } }], true)
    expect(result.imported).toEqual(['one'])
    expect((await loadUserMcpSuite(path)).mcp.servers['one']).toMatchObject({ command: 'uvx' })
  })

  it('fails closed on corrupt storage and refuses to overwrite it', async () => {
    const path = await root()
    await writeFile(join(path, 'mcp.json'), 'broken')
    const suite = await loadUserMcpSuite(path)
    expect(suite.mcp.servers).toEqual({})
    expect(suite.errors).toHaveLength(1)
    await expect(addUserMcpServer(path, 'one', { type: 'stdio', command: 'node' })).rejects.toThrow('mcp.json')
  })

  it('loads a hand-written server table that carries no $schema', async () => {
    const path = await root()
    await writeFile(
      join(path, 'mcp.json'),
      JSON.stringify({ mcpServers: { one: { type: 'stdio', command: 'node' }, remote: { type: 'streamable-http', url: 'https://example.test/mcp' } } })
    )

    const suite = await loadUserMcpSuite(path)
    expect(suite.errors).toEqual([])
    expect(Object.keys(suite.mcp.servers)).toEqual(['one', 'remote'])
    // The baseline ruleset applies to the server whose `$schema` was absent.
    expect(suite.mcp.schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
    expect(suite.mcp.servers.one).toMatchObject({ type: 'stdio', command: 'node' })
    expect(suite.mcp.servers.remote).toMatchObject({ type: 'streamable-http', url: 'https://example.test/mcp' })
    expect(suite.surfaces.mcp).toBe(2)
  })

  it('keeps the file-level rule for a $schema-less file whose server is malformed', async () => {
    const path = await root()
    await writeFile(join(path, 'mcp.json'), JSON.stringify({ mcpServers: { good: { command: 'node' }, broken: { type: 'streamable-http' } } }))

    const suite = await loadUserMcpSuite(path)
    expect(suite.mcp.servers).toEqual({})
    expect(suite.errors).toEqual(['mcp.json: invalid MCP configuration: server "broken": remote servers require a url'])
  })

  it('enables the MCP surface only, so the command registry never re-reads the Agent layout root', async () => {
    const path = await root()
    await writeFile(join(path, 'mcp.json'), JSON.stringify({ mcpServers: { one: { command: 'node' } } }))
    await mkdir(join(path, 'commands'), { recursive: true })
    await writeFile(join(path, 'commands', 'helper.md'), '---\ndescription: A user command.\n---\nDo the thing.')
    const suite = await loadUserMcpSuite(path)
    expect(suite.activeSurfaces).toEqual({ skills: false, mcp: true, hooks: false, commands: false, agents: false, lsp: false })

    const registered: string[] = []
    const registry = new CommandMountRegistry({ commands: { register: (entry: { name: string }) => (registered.push(entry.name), () => {}) } } as unknown as Context)
    try {
      expect(await registry.reconcile([suite])).toEqual([])
      expect(registered).toEqual([])
    } finally {
      registry.disposeAll()
    }
  })
})
