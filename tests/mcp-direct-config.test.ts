import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addUserMcpServer, loadUserMcpSuite } from '../src/runtime/mcp-direct-config.js'
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
    const before = await readFile(join(path, 'mcp-servers.json'), 'utf8')
    await expect(addUserMcpServer(path, 'one', { type: 'stdio', command: 'other' })).rejects.toThrow('already exists')
    await expect(addUserMcpServer(path, 'bad', { type: 'streamable-http' })).rejects.toThrow('invalid MCP')
    expect(await readFile(join(path, 'mcp-servers.json'), 'utf8')).toBe(before)
  })
  it('fails closed on corrupt storage and refuses to overwrite it', async () => {
    const path = await root()
    await writeFile(join(path, 'mcp-servers.json'), 'broken')
    const suite = await loadUserMcpSuite(path)
    expect(suite.mcp.servers).toEqual({})
    expect(suite.errors).toHaveLength(1)
    await expect(addUserMcpServer(path, 'one', { type: 'stdio', command: 'node' })).rejects.toThrow('mcp-servers.json')
  })
})
