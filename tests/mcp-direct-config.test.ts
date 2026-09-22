import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addUserMcpServer, importUserMcpServers, loadUserMcpSuite } from '../src/runtime/mcp-direct-config.js'
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
})
